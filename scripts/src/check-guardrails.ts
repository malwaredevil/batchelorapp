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
import { execFileSync } from "node:child_process";
import fs from "node:fs";

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
// Check 6: the restricted-channel exclusion set may only grow, never shrink.
// ---------------------------------------------------------------------------
export function countExclusionEntries(source: string): number {
  const match = source.match(/RESTRICTED_EXCLUDED_ACTION_TYPES[\s\S]{0,2000}/);
  if (!match) return 0;
  return (match[0].match(/^\s*"[a-z][a-z_]+"/gm) || []).length;
}

export function checkExclusionSetShrink(
  currentSource: string | null,
  baseSource: string | null,
): string[] {
  const current = currentSource ? countExclusionEntries(currentSource) : 0;
  const baseline = baseSource ? countExclusionEntries(baseSource) : 0;
  return current < baseline
    ? [`base: ${baseline} entries, this commit: ${current} entries`]
    : [];
}

export const EXCLUSION_SHRINK_HELP = [
  "This set is a deliberate security boundary for AgentPhone SMS/voice",
  "and inbound email channels. It cannot be reduced without a reviewed",
  "security decision documented in the PR body.",
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
function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 128,
    });
  } catch (error) {
    const err = error as { stdout?: string };
    if (typeof err.stdout === "string") return err.stdout;
    throw error;
  }
}

function readFileOrNull(root: string, file: string): string | null {
  try {
    return fs.readFileSync(`${root}/${file}`, "utf8");
  } catch {
    return null;
  }
}

export function runGuardrailChecks(base: string): CheckResult[] {
  const root = repoRoot();
  const changedFiles = git(root, ["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const fullDiff = git(root, [
    "diff",
    `${base}...HEAD`,
    "--",
    ".",
    ":!.github/**",
    ":!scripts/src/check-guardrails.ts",
    ":!scripts/src/check-guardrails.test.ts",
    ":!scripts/src/pre-publish.sh",
    ":!*.md",
    ":!*.txt",
  ]);

  const schemaDiff = git(root, [
    "diff",
    `${base}...HEAD`,
    "--",
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
      `${base}:${RESTRICTED_EXCLUSION_SOURCE_PATH}`,
    ]);
  } catch {
    try {
      baseExclusionSource = git(root, ["show", `${base}:${ELAINE_INDEX_PATH}`]);
    } catch {
      baseExclusionSource = null;
    }
  }
  const currentExclusionSource =
    readFile(RESTRICTED_EXCLUSION_SOURCE_PATH) ?? readFile(ELAINE_INDEX_PATH);

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
      ),
      helpText: EXCLUSION_SHRINK_HELP,
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
  const results = runGuardrailChecks(base);
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
