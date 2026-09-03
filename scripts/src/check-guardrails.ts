/**
 * check-guardrails.ts
 *
 * Single source of truth for the repo's diff-based safety bans. Previously
 * these five checks were duplicated as inline bash inside
 * .github/workflows/guardrails.yml, which meant they could only ever be
 * exercised on GitHub — a contributor had no way to run them locally before
 * opening a PR. This script is callable from both:
 *
 *   - CI:    pnpm --filter @workspace/scripts run check-guardrails -- --base origin/main
 *   - local: pnpm --filter @workspace/scripts run check-guardrails -- --base origin/main
 *
 * The pure `*FromDiff`/`*FromFiles` functions below contain the actual rule
 * logic and take plain strings/arrays so they can be unit tested without a
 * real git repository. `runGuardrailChecks()` is the only part that shells
 * out to git, wiring live repo state into those pure functions.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getChangedDiff,
  getChangedFiles,
  git,
  readFileOrNull,
  repoRoot,
  resolveBase,
  walkFiles,
} from "./lib/git-diff-utils.js";

export interface CheckResult {
  name: string;
  violations: string[];
  helpText: string;
}

function addedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
}

// ---------------------------------------------------------------------------
// Check 1: drizzle-kit push is permanently banned (destructive introspection
// against the shared Supabase database).
// ---------------------------------------------------------------------------
export function checkDrizzleKitPushFromDiff(diff: string): string[] {
  return addedLines(diff).filter((l) => l.includes("drizzle-kit push"));
}

export const DRIZZLE_KIT_PUSH_HELP = [
  "'drizzle-kit push' detected in newly added lines.",
  "",
  "This command is permanently banned. It introspects ALL tables in the",
  "shared Supabase database and silently drops any table not in the",
  "current schema — including the other app's tables.",
  "",
  "Use lib/db/src/schema-statements.ts with CREATE TABLE IF NOT EXISTS",
  "and run: pnpm --filter @workspace/db run bootstrap",
].join("\n");

// ---------------------------------------------------------------------------
// Check 2: Replit-local / secret-bearing files must never enter a diff meant
// for the public repo.
// ---------------------------------------------------------------------------
// .replit-artifact/artifact.toml is deliberately exempted (negative lookahead):
// it contains no secrets — the artifact config the platform's artifact-registry
// scan needs to see the app's artifacts (registry-empty support ticket #486854,
// 2026-08-03). Real Replit secrets/config live in .replit, which stays fully
// restricted below. Everything else under .replit-artifact/ remains restricted.
const RESTRICTED_FILE_RE =
  /(^|\/)\.replit-artifact\/(?!artifact\.toml$)|^\.agents\/|^\.local\/|^threat_model\.md|^\.env$|^\.env\.|^\.replit$|^\.replitignore$|^replit\.nix$|^\.upm\//;

export function checkRestrictedFilesFromList(files: string[]): string[] {
  return files.filter((f) => RESTRICTED_FILE_RE.test(f));
}

export const RESTRICTED_FILES_HELP = [
  "These files must never be committed or pushed:",
  "  .agents/        — agent memory files (Replit-local)",
  "  .local/         — Replit platform files (Replit-local)",
  "  threat_model.md — security document (keep local only)",
  "  .env / .env.*   — local secrets (NEVER commit secrets)",
  "  .replit         — Replit workspace config (may contain secrets/email)",
  "  .replitignore   — Replit-local ignore rules",
  "  replit.nix      — Replit-local nix config",
  "  .upm/           — Replit package manager cache",
  "  .replit-artifact/ — Replit-local artifact routing config",
  "    (artifact.toml itself is exempt — no secrets, needed for the",
  "     platform artifact registry scan)",
  "",
  "Remove them from your branch and add them to .gitignore.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 3: ad-hoc `new OpenAI(...)` instantiation outside the reviewed
// provider facades.
// ---------------------------------------------------------------------------
export function checkAdHocOpenAIFromFiles(
  files: string[],
  readFile: (file: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (!file.startsWith("artifacts/api-server/src/")) continue;
    const content = readFile(file);
    if (content === null) continue; // deleted in this diff
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (!line.includes("new OpenAI(")) return;
      const start = Math.max(0, index - 1);
      const end = Math.min(lines.length, index + 2);
      const window = lines.slice(start, end).join("\n");
      if (!window.includes("// openai-direct-ok")) {
        violations.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }
  return violations;
}

export const AD_HOC_OPENAI_HELP = [
  "Provider calls must go through one of the shared facades:",
  "  artifacts/api-server/src/lib/ai-client.ts",
  "  artifacts/api-server/src/lib/openai-responses.ts",
  "",
  "Jina, Voyage, and the owner AI Lab Images client have dedicated clients.",
  "Only a reviewed provider facade may use '// openai-direct-ok'.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 4: rate limiters must fail closed.
// ---------------------------------------------------------------------------
// This script's own help text and unit-test fixtures intentionally contain
// the literal string "passOnStoreError: true" — they describe/exercise the
// ban, they don't commit it. Same self-exclusion problem as check 1 below.
const PASS_ON_STORE_ERROR_SELF_EXEMPT = new Set([
  "scripts/src/check-guardrails.ts",
  "scripts/src/check-guardrails.test.ts",
]);

export function checkPassOnStoreErrorFromFiles(
  files: string[],
  readFile: (file: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (PASS_ON_STORE_ERROR_SELF_EXEMPT.has(file)) continue;
    const content = readFile(file);
    if (content === null) continue;
    content.split("\n").forEach((line, index) => {
      if (/passOnStoreError\s*:\s*true/.test(line)) {
        violations.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }
  return violations;
}

export const PASS_ON_STORE_ERROR_HELP = [
  "Rate limiters must fail CLOSED (deny requests) when the store is",
  "unavailable, not fail open (allow all through).",
  "Remove passOnStoreError: true or set it to false.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 5: only additive schema statements are permitted.
// ---------------------------------------------------------------------------
export function checkDestructiveSqlFromDiff(diff: string): string[] {
  return addedLines(diff).filter((line) => {
    if (/^\+\s*--/.test(line) || /^\+\s*\/\//.test(line)) return false;
    return /^\+\s*(DROP|TRUNCATE|DELETE FROM|ALTER TABLE.*DROP COLUMN)/i.test(
      line,
    );
  });
}

export const DESTRUCTIVE_SQL_HELP = [
  "Only additive statements are permitted in schema-statements.ts:",
  "  CREATE TABLE IF NOT EXISTS ...",
  "  CREATE INDEX IF NOT EXISTS ...",
  "  ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...",
  "",
  "Destructive schema changes require a separate reviewed migration.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 6: the restricted-channel exclusion set may only grow, never shrink
// for an action type that is still a live, callable tool.
// ---------------------------------------------------------------------------
export function extractExclusionEntries(source: string): string[] {
  // Match from the array declaration through to its closing `];`, not a
  // fixed character window — per-entry explanatory comments (e.g. for
  // create_reminder/snooze_reminder) can push the array well past a fixed
  // window, which previously truncated the count and produced a false
  // "shrink" violation even though no entries were removed. Non-greedy so
  // this stops at the array's own close bracket rather than a later one.
  const match = source.match(
    /RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE[\s\S]*?\n\];/,
  );
  if (!match) return [];
  return (match[0].match(/^\s*"[a-z][a-z_]+"/gm) || []).map((line) =>
    line.trim().replace(/^"/, "").replace(/"$/, ""),
  );
}

export function countExclusionEntries(source: string): number {
  return extractExclusionEntries(source).length;
}

/**
 * A removed entry is only a real security loosening if the action type it
 * names is still a live, callable tool. If the tool itself was deleted in
 * the same change (a deprecated-capability removal), the exclusion entry is
 * dead weight referencing nothing — removing it doesn't loosen any actual
 * restriction. `isActionStillLive` lets the real guard run cross-check the
 * removed name against the current codebase; it defaults to "assume still
 * live" so callers that don't wire it up keep the strict, conservative
 * behavior (and so existing unit tests are unaffected).
 */
export function checkExclusionSetShrink(
  currentSource: string | null,
  baseSource: string | null,
  isActionStillLive: (actionType: string) => boolean = () => true,
): string[] {
  const currentEntries = currentSource
    ? extractExclusionEntries(currentSource)
    : [];
  const baseEntries = baseSource ? extractExclusionEntries(baseSource) : [];
  const currentSet = new Set(currentEntries);
  const removed = baseEntries.filter((entry) => !currentSet.has(entry));
  const stillLive = removed.filter((entry) => isActionStillLive(entry));
  if (stillLive.length === 0) return [];
  return [
    `base: ${baseEntries.length} entries, this commit: ${currentEntries.length} entries`,
    `Removed but still a live tool elsewhere in the codebase: ${stillLive.join(", ")}`,
  ];
}

export const EXCLUSION_SHRINK_HELP = [
  "This set is a deliberate security boundary for AgentPhone SMS/voice",
  "and inbound email channels. An entry can only be removed here if the",
  "action type it names was deleted entirely (no longer a callable tool",
  "anywhere in the codebase) in the same change. Removing it while the",
  "tool still exists is a security loosening and requires a reviewed",
  "security decision documented in the PR body.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 7: every Elaine integration test that exercises POST /elaine/chat
// via supertest must mock elaine-lessons.
//
// The real getRelevantElaineLessons issues an extra db.select() that shifts
// the selectQueue slots out of alignment, silently aborting the SSE response
// with ECONNRESET before any headers are sent.  The failure is invisible
// until a hard-tool scenario is added to the test — by then the test author
// may have already merged.  Enforcing the mock at the diff level prevents
// the gap from being introduced in the first place.
// ---------------------------------------------------------------------------

// Detects files that hit the chat route by looking for the literal POST path
// string that supertest uses.  Both `/elaine/chat` (router-relative) and
// `/api/elaine/chat` (full path) are accepted because different test files
// mount the router at different prefixes.
const ELAINE_CHAT_ROUTE_RE = /["'`]\/(?:api\/)?elaine\/chat["'`]/;
const ELAINE_LESSONS_MOCK_RE = /vi\.mock\(["'`]\.\.\/lib\/elaine-lessons["'`]/;

export function checkElaineChatTestMissingLessonsMock(
  files: string[],
  readFile: (file: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".test.ts")) continue;
    if (!file.startsWith("artifacts/api-server/src/elaine/")) continue;
    const content = readFile(file);
    if (content === null) continue; // deleted in this diff — nothing to enforce
    if (!ELAINE_CHAT_ROUTE_RE.test(content)) continue; // doesn't hit the chat route
    if (!ELAINE_LESSONS_MOCK_RE.test(content)) {
      violations.push(file);
    }
  }
  return violations;
}

export const ELAINE_CHAT_LESSONS_MOCK_HELP = [
  "Every Elaine integration test that drives POST /elaine/chat via supertest",
  "must include:",
  "",
  '  vi.mock("../lib/elaine-lessons", () => ({',
  "    ELAINE_LESSON_DOMAINS: [...],",
  "    getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [], evidenceBlock: '' }),",
  "    recordElaineLesson: vi.fn().mockResolvedValue(undefined),",
  "  }));",
  "",
  "Without this mock the real getRelevantElaineLessons issues an extra",
  "db.select() that shifts the selectQueue slots out of alignment, silently",
  "aborting the SSE response with ECONNRESET before headers are sent.",
  "The failure is invisible until a hard-tool scenario is exercised.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 8: Scaffolded Elaine tool stubs must not ship with TODO(scaffold)
// markers. The generator intentionally leaves these as placeholders for the
// human-authored executor body, model-facing description, and confirmation
// label. Placeholder test files (*.test.ts) are exempt — they assert 501
// until real business-logic tests are written.
// ---------------------------------------------------------------------------
export const SCAFFOLDED_TOOLS_DIR =
  "artifacts/api-server/src/elaine/scaffolded-tools";
const SCAFFOLD_TODO_MARKER = "TODO(scaffold)";

export function checkScaffoldedTodosFromFiles(
  files: string[],
  readFile: (file: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!file.startsWith(SCAFFOLDED_TOOLS_DIR + "/")) continue;
    if (file.endsWith(".test.ts")) continue; // placeholder tests are exempt
    if (!file.endsWith(".ts")) continue;
    const content = readFile(file);
    if (content === null) continue; // deleted — nothing to enforce
    content.split("\n").forEach((line, index) => {
      if (line.includes(SCAFFOLD_TODO_MARKER)) {
        violations.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }
  return violations;
}

export const SCAFFOLDED_TODOS_HELP = [
  "One or more scaffolded Elaine tool stubs still contain TODO(scaffold)",
  "markers. These must be replaced with human-authored content before the",
  "tool ships. Remaining work (search TODO(scaffold) in each file above):",
  "",
  "  1. Implement the executor body in the scaffolded stub .ts file",
  "     (replace the 501 stub return with real business logic).",
  "  2. Write the model-facing tool description — when to call it, example",
  "     user phrasings, and any id-visibility requirements.",
  "  3. Write the confirmation label in the domain actions file",
  "     (e.g. pottery-actions.ts / quilting-actions.ts / ornaments-actions.ts).",
  "  4. Add a system-prompt paragraph in index.ts if the tool needs",
  "     behavioural guidance not covered by the description alone.",
  "",
  "Placeholder test files (*.test.ts) are exempt — they may keep their",
  "TODO(scaffold) comment until real business-logic tests are written.",
].join("\n");

// ---------------------------------------------------------------------------
// Check 9: Domain action files must not contain scaffolded TODO confirm labels.
// The scaffold generator inserts `return "TODO: confirm <name>";` as a
// placeholder in the confirmation-label switch inside the domain action files.
// Shipping without replacing it shows the literal TODO string on the
// confirm/cancel card shown to users before an action runs.
// ---------------------------------------------------------------------------
export const DOMAIN_ACTION_FILES = [
  "artifacts/api-server/src/elaine/pottery-actions.ts",
  "artifacts/api-server/src/elaine/quilting-actions.ts",
  "artifacts/api-server/src/elaine/ornaments-actions.ts",
];
const CONFIRM_TODO_MARKER = 'return "TODO: confirm ';

export function checkDomainActionConfirmLabels(
  files: string[],
  readFile: (file: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!DOMAIN_ACTION_FILES.includes(file)) continue;
    const content = readFile(file);
    if (content === null) continue;
    content.split("\n").forEach((line, index) => {
      if (line.includes(CONFIRM_TODO_MARKER)) {
        violations.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }
  return violations;
}

export const DOMAIN_ACTION_CONFIRM_LABELS_HELP = [
  "One or more domain action files still contain a scaffolded TODO confirm label.",
  'The scaffold generator inserts return "TODO: confirm <name>"; as a placeholder.',
  'Shipping it shows "TODO: confirm add_pottery_note" on the user-facing confirm card.',
  "",
  "Replace each TODO return with a human-readable label, e.g.:",
  '  return `Add note to "${itemName}"`;',
  "",
  "Files to fix (search for 'TODO: confirm' in each file listed above).",
].join("\n");

// ---------------------------------------------------------------------------
// Check 10: Scaffold-injected TODO(scaffold) comments in capability-registry.ts
// and restricted-channel-config.ts must be replaced before the tool ships.
// These two files receive soft review comments from the generator — unlike the
// hard scaffolded-tools stubs, the comments are in the files that ship and are
// visible in logs and code review.
// ---------------------------------------------------------------------------
export const CAPABILITY_CONFIG_FILES = [
  "artifacts/api-server/src/elaine/capability-registry.ts",
  "artifacts/api-server/src/elaine/restricted-channel-config.ts",
];

export function checkCapabilityConfigTodos(
  files: string[],
  readFile: (file: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!CAPABILITY_CONFIG_FILES.includes(file)) continue;
    const content = readFile(file);
    if (content === null) continue;
    content.split("\n").forEach((line, index) => {
      if (line.includes(SCAFFOLD_TODO_MARKER)) {
        violations.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }
  return violations;
}

export const CAPABILITY_CONFIG_TODOS_HELP = [
  "One or more capability/channel config files still contain TODO(scaffold) markers",
  "injected by the scaffold generator. These must be replaced before the tool ships.",
  "",
  "  capability-registry.ts: fill in the real channel policy for the new tool.",
  "  restricted-channel-config.ts: decide whether the tool belongs in",
  "    RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE or RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE",
  "    and remove the TODO(scaffold) comment.",
].join("\n");

// ---------------------------------------------------------------------------
// Git-backed wiring (not unit tested directly — exercised end-to-end in CI
// and via manual `--base` runs).
// ---------------------------------------------------------------------------
const ELAINE_INDEX_PATH = "artifacts/api-server/src/elaine/index.ts";
const RESTRICTED_EXCLUSION_SOURCE_PATH =
  "artifacts/api-server/src/elaine/restricted-channel-config.ts";

// This script is invoked via `pnpm --filter @workspace/scripts run
// check-guardrails`, which runs with cwd set to scripts/, not the repo root.
// All paths below (changed-file lists, diff pathspecs, restricted-channel
// config) are repo-root-relative, so every git invocation is pinned to the
// repo root with `-C`, and every fs read is joined against it explicitly.
// Resolving against process.cwd() here previously silently no-op'd two of
// the six checks (the exclusion-shrink guard read this-commit content as
// `null`, and the drizzle-kit-push exclusion pathspecs never matched
// anything, so the script's own help text tripped its own ban).
//
// RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE used to live inline in
// elaine/index.ts; a later refactor extracted it into its own
// restricted-channel-config.ts module. The exclusion-shrink guard must track
// wherever the array actually lives today, or it silently reads 0 entries
// from index.ts (which now only imports the name) and false-positives on
// every PR. Update RESTRICTED_EXCLUSION_SOURCE_PATH if it moves again.
export function runGuardrailChecks(base: string): CheckResult[] {
  const root = repoRoot();
  const resolvedBase = resolveBase(root, base);
  const changedFiles = getChangedFiles(root, resolvedBase);

  const fullDiff = getChangedDiff(root, resolvedBase, [
    ".",
    ":!.github/**",
    ":!scripts/src/check-guardrails.ts",
    ":!scripts/src/check-guardrails.test.ts",
    ":!scripts/src/pre-publish.sh",
    ":!*.md",
    ":!*.txt",
  ]);

  const schemaDiff = getChangedDiff(root, resolvedBase, [
    "lib/db/src/schema-statements.ts",
  ]);

  const readFile = (file: string) => readFileOrNull(root, file);

  // The exclusion array historically lived inline in elaine/index.ts before
  // being extracted into restricted-channel-config.ts. Fall back to
  // index.ts so the guard still works correctly against a base commit that
  // predates the extraction (old base content still has real entries there).
  let baseExclusionSource: string | null = null;
  try {
    baseExclusionSource = git(root, [
      "show",
      `${resolvedBase}:${RESTRICTED_EXCLUSION_SOURCE_PATH}`,
    ]);
  } catch {
    try {
      baseExclusionSource = git(root, [
        "show",
        `${resolvedBase}:${ELAINE_INDEX_PATH}`,
      ]);
    } catch {
      baseExclusionSource = null;
    }
  }
  const currentExclusionSource =
    readFile(RESTRICTED_EXCLUSION_SOURCE_PATH) ?? readFile(ELAINE_INDEX_PATH);

  // A removed exclusion entry is only a real loosening if the action type it
  // names is still a live, callable tool somewhere else in the current
  // codebase (capability registry, executor, planner catalog, etc). If the
  // tool itself was deleted in the same change, the entry is dead weight and
  // its removal isn't a security regression. Scan every current .ts/.tsx
  // file except the exclusion-list file itself for the literal quoted name.
  const isActionStillLive = (actionType: string): boolean => {
    const needle = `"${actionType}"`;
    return walkFiles(root, [".ts", ".tsx"]).some((file) => {
      const rel = path.relative(root, file);
      if (
        rel === RESTRICTED_EXCLUSION_SOURCE_PATH ||
        rel === ELAINE_INDEX_PATH
      ) {
        return false;
      }
      const content = readFileOrNull(root, rel);
      return content !== null && content.includes(needle);
    });
  };

  // Enumerate every .ts file currently in the scaffolded-tools directory so
  // the TODO(scaffold) check covers ALL tools, not just the ones touched in
  // this diff. A tool merged with stubs in a previous PR would otherwise slip
  // past a diff-only check.
  let scaffoldedFiles: string[] = [];
  try {
    const scaffoldedDir = path.join(root, SCAFFOLDED_TOOLS_DIR);
    scaffoldedFiles = fs
      .readdirSync(scaffoldedDir)
      .map((f) => `${SCAFFOLDED_TOOLS_DIR}/${f}`);
  } catch {
    // Directory doesn't exist yet — no scaffolded tools to check.
  }

  return [
    {
      name: "Ban: drizzle-kit push",
      violations: checkDrizzleKitPushFromDiff(fullDiff),
      helpText: DRIZZLE_KIT_PUSH_HELP,
    },
    {
      name: "Ban: restricted files in diff",
      violations: checkRestrictedFilesFromList(changedFiles),
      helpText: RESTRICTED_FILES_HELP,
    },
    {
      name: "Ban: ad-hoc direct OpenAI SDK instantiation",
      violations: checkAdHocOpenAIFromFiles(changedFiles, readFile),
      helpText: AD_HOC_OPENAI_HELP,
    },
    {
      name: "Ban: passOnStoreError: true in rate limiters",
      violations: checkPassOnStoreErrorFromFiles(changedFiles, readFile),
      helpText: PASS_ON_STORE_ERROR_HELP,
    },
    {
      name: "Ban: destructive SQL in schema-statements diff",
      violations: checkDestructiveSqlFromDiff(schemaDiff),
      helpText: DESTRUCTIVE_SQL_HELP,
    },
    {
      name: "Guard: RESTRICTED_EXCLUDED_ACTION_TYPES must not shrink",
      violations: checkExclusionSetShrink(
        currentExclusionSource,
        baseExclusionSource,
        isActionStillLive,
      ),
      helpText: EXCLUSION_SHRINK_HELP,
    },
    {
      name: "Guard: Elaine chat integration tests must mock elaine-lessons",
      violations: checkElaineChatTestMissingLessonsMock(changedFiles, readFile),
      helpText: ELAINE_CHAT_LESSONS_MOCK_HELP,
    },
    {
      name: "Guard: scaffolded Elaine tools must not ship with TODO(scaffold) stubs",
      violations: checkScaffoldedTodosFromFiles(scaffoldedFiles, readFile),
      helpText: SCAFFOLDED_TODOS_HELP,
    },
    // Check 9: domain action files always scanned (not just when in the diff)
    // so a tool merged with a TODO label in a previous PR is still caught.
    {
      name: "Guard: domain action files must not contain TODO confirm labels",
      violations: checkDomainActionConfirmLabels(DOMAIN_ACTION_FILES, readFile),
      helpText: DOMAIN_ACTION_CONFIRM_LABELS_HELP,
    },
    // Check 10: capability-registry.ts and restricted-channel-config.ts always
    // scanned for scaffold-injected TODO(scaffold) review comments.
    {
      name: "Guard: capability/channel config files must not contain TODO(scaffold) markers",
      violations: checkCapabilityConfigTodos(CAPABILITY_CONFIG_FILES, readFile),
      helpText: CAPABILITY_CONFIG_TODOS_HELP,
    },
  ];
}

function getArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1] as string;
  return fallback;
}

function main(): void {
  const base = getArg("base", "origin/main");
  let results: CheckResult[];
  try {
    results = runGuardrailChecks(base);
  } catch (error) {
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("ERROR: Guardrail checks could not run");
    console.error("");
    console.error((error as Error).message);
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exitCode = 1;
    return;
  }
  let failed = false;

  for (const result of results) {
    if (result.violations.length === 0) {
      console.log(`✓ ${result.name}`);
      continue;
    }
    failed = true;
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`ERROR: ${result.name}`);
    console.error("");
    for (const violation of result.violations) console.error(violation);
    console.error("");
    console.error(result.helpText);
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ All guardrail checks passed");
}

if (process.argv[1] && process.argv[1].endsWith("check-guardrails.ts")) {
  main();
}
