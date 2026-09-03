/**
 * check-hardcoded-config.ts
 *
 * Flags newly introduced hardcoded configuration values that look like they
 * should be owner-adjustable (via the Control Panel / elaineGlobalConfig)
 * instead of baked into source as literals.
 *
 * Motivating incident: Elaine's per-turn runtime budget (maxModelRounds,
 * maxToolCalls, maxReplans, maxElapsedMs) was a literal object built inline
 * at the chat call site in elaine/index.ts — invisible to the owner and
 * impossible to raise without a code change. This check exists so that
 * class of bug can't ship again silently.
 *
 * Two detectors, both diff-scoped by default (only inspect files present in
 * the given diff's changed-file list, same pattern as the ad-hoc-OpenAI and
 * passOnStoreError checks in check-guardrails.ts):
 *
 *   1. Clustered tunable object literals — 2+ sibling keys in the same
 *      object literal whose names look like limits/budgets/timeouts/caps,
 *      assigned bare numeric literals. This is the exact shape of the
 *      runtime-budget bug and is high-precision (rare to false-positive).
 *   2. Standalone tunable module-level constants — a single SCREAMING_SNAKE
 *      const whose name matches a high-confidence tunable keyword, assigned
 *      a bare numeric literal, outside a recognized config/defaults/schema
 *      source-of-truth file.
 *
 * A whole-repo, report-only `--audit` mode is also provided so the current
 * backlog can be sized without failing the build — enforcement (the `--base`
 * mode used by CI and pre-publish) only looks at files touched in the diff,
 * so it stops new hardcoding without requiring the entire existing codebase
 * to be fixed in one pass.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-hardcoded-config -- --base origin/main
 *   pnpm --filter @workspace/scripts run check-hardcoded-config -- --audit
 */
import path from "node:path";
import {
  getChangedFiles,
  readFileOrNull,
  repoRoot,
  resolveBase,
  walkFiles,
} from "./lib/git-diff-utils.js";

export interface HardcodedConfigViolation {
  file: string;
  lines: number[];
  names: string[];
  kind: "cluster" | "constant";
  /** Stable nearby declaration/context that distinguishes same-named findings. */
  context: string;
  /** Present only when the focused detector's source allowlist suppressed it. */
  allowlisted?: boolean;
}

// ---------------------------------------------------------------------------
// Name heuristics
// ---------------------------------------------------------------------------

const CAMEL_SUFFIXES = [
  "TimeoutMs",
  "Timeout",
  "Ms",
  "Limits",
  "Limit",
  "Budget",
  "Threshold",
  "Thresholds",
  "Cap",
  "Caps",
  "IntervalMs",
  "Interval",
  "Ttl",
  "Retries",
  "Rounds",
  "Replans",
  "Cooldown",
  "CooldownMs",
  "WindowMs",
  "BatchSize",
  "PageSize",
  "Percent",
  "Rate",
];

/** camelCase identifiers such as maxModelRounds, requestTimeoutMs, idleCooldownMs, pageSize. */
export function isTunableCamelName(name: string): boolean {
  if (/^(max|min)[A-Z]/.test(name)) return true;
  return CAMEL_SUFFIXES.some((suffix) => {
    // The name IS the keyword on its own (e.g. "pageSize", "cooldown") —
    // compare case-insensitively since the leading letter is lowercase.
    if (name.length === suffix.length) {
      return name.toLowerCase() === suffix.toLowerCase();
    }
    // The name ends with the keyword as a camelCase compound (e.g.
    // "requestTimeoutMs"). Require a lowercase/digit character immediately
    // before the suffix so a bare "Ms"/"Cap" fragment glued onto an unrelated
    // word doesn't match.
    if (name.length > suffix.length && name.endsWith(suffix)) {
      const boundaryChar = name[name.length - suffix.length - 1];
      return boundaryChar !== undefined && /[a-z0-9]/.test(boundaryChar);
    }
    return false;
  });
}

const SNAKE_PREFIXES = ["MAX_", "MIN_"];
const SNAKE_SUFFIXES = [
  "_TIMEOUT_MS",
  "_TIMEOUT",
  "_MS",
  "_LIMIT",
  "_LIMITS",
  "_BUDGET",
  "_THRESHOLD",
  "_THRESHOLDS",
  "_CAP",
  "_CAPS",
  "_INTERVAL_MS",
  "_INTERVAL",
  "_TTL",
  "_RETRIES",
  "_ROUNDS",
  "_REPLANS",
  "_COOLDOWN",
  "_COOLDOWN_MS",
  "_WINDOW_MS",
  "_BATCH_SIZE",
  "_PAGE_SIZE",
  "_PERCENT",
  "_RATE",
];

// Bare unit-conversion constants (e.g. `const DAY_MS = 86_400_000;`) look like
// a "_MS" tunable but are just a fixed multiplier, not owner-facing config.
const UNIT_CONSTANT_NAMES = new Set([
  "SECOND_MS",
  "MINUTE_MS",
  "HOUR_MS",
  "DAY_MS",
  "WEEK_MS",
  "MONTH_MS",
  "YEAR_MS",
]);

/** SCREAMING_SNAKE_CASE module-level constants such as MAX_UPLOAD_MB, DEFAULT_TIMEOUT_MS. */
export function isTunableConstName(name: string): boolean {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
  if (UNIT_CONSTANT_NAMES.has(name)) return false;
  if (SNAKE_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return SNAKE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// ---------------------------------------------------------------------------
// File scoping — skip files that are themselves the legitimate source of
// truth for defaults (a literal number there is the point of the file).
// ---------------------------------------------------------------------------

const SOURCE_OF_TRUTH_RE =
  /(^|\/)(admin-config|elaine-config|app-config)\.tsx?$|\.config\.tsx?$|(^|\/)schema(-statements)?\.ts$|(^|\/)schema\/[^/]+\.ts$|defaults?\.tsx?$|constants\.tsx?$/i;

const SELF_EXEMPT = new Set([
  "scripts/src/check-hardcoded-config.ts",
  "scripts/src/check-hardcoded-config.test.ts",
]);

export function isScannableFile(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.endsWith(".generated.ts")) return false;
  if (SELF_EXEMPT.has(file)) return false;
  if (SOURCE_OF_TRUTH_RE.test(file)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Detector 1: clustered tunable object literal
// ---------------------------------------------------------------------------

const OBJECT_KEY_NUMBER_RE =
  /^\s*['"]?([A-Za-z_$][A-Za-z0-9_$]*)['"]?\s*:\s*(-?\d[\d_]*)\s*,?\s*(?:\/\/.*)?$/;

// Lines within this many lines of each other are treated as the same object
// literal for clustering purposes (tight enough to skip past a blank line or
// a comment, loose enough to survive an interleaved non-tunable sibling key).
const CLUSTER_WINDOW_LINES = 4;

export function findTunableClustersInFile(
  content: string,
): Array<{ lines: number[]; names: string[] }> {
  const matches: Array<{ line: number; name: string }> = [];
  content.split("\n").forEach((line, index) => {
    const m = OBJECT_KEY_NUMBER_RE.exec(line);
    const name = m?.[1];
    if (name && isTunableCamelName(name)) {
      matches.push({ line: index + 1, name });
    }
  });

  const clusters: Array<{ lines: number[]; names: string[] }> = [];
  let current: { lines: number[]; names: string[] } | null = null;
  for (const match of matches) {
    const lastLine = current?.lines[current.lines.length - 1];
    if (
      current &&
      lastLine !== undefined &&
      match.line - lastLine <= CLUSTER_WINDOW_LINES
    ) {
      current.lines.push(match.line);
      current.names.push(match.name);
    } else {
      if (current && current.lines.length >= 2) clusters.push(current);
      current = { lines: [match.line], names: [match.name] };
    }
  }
  if (current && current.lines.length >= 2) clusters.push(current);
  return clusters;
}

// ---------------------------------------------------------------------------
// Detector 2: standalone tunable constant
// ---------------------------------------------------------------------------

const CONST_NUMBER_RE =
  /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number)?\s*=\s*(-?\d[\d_]*)\s*;/;

export function findTunableConstantsInFile(
  content: string,
): Array<{ line: number; name: string }> {
  const results: Array<{ line: number; name: string }> = [];
  content.split("\n").forEach((line, index) => {
    const m = CONST_NUMBER_RE.exec(line);
    const name = m?.[1];
    if (name && isTunableConstName(name)) {
      results.push({ line: index + 1, name });
    }
  });
  return results;
}

function findingContext(content: string, firstLine: number): string {
  const lines = content.split("\n");
  for (
    let index = firstLine - 2;
    index >= 0 && index >= firstLine - 16;
    index--
  ) {
    const candidate = lines[index]?.trim();
    if (!candidate || OBJECT_KEY_NUMBER_RE.test(candidate)) continue;
    return candidate.replace(/\s+/g, " ");
  }
  return "file-scope";
}

// ---------------------------------------------------------------------------
// Combined per-file-list scan
// ---------------------------------------------------------------------------

/**
 * Pre-existing hits an engineer has explicitly reviewed and decided are NOT
 * owner-facing config (e.g. a fixed algorithm parameter). Each entry is
 * "path/relative/to/repo-root.ts:lineNumber". Add new entries only with a
 * `//` comment above explaining why — do not use this to silence a genuine
 * miss, fix the code instead.
 */
export const HARDCODED_CONFIG_ALLOWLIST: ReadonlySet<string> = new Set([
  // Fixed protocol limits in the large Elaine dispatcher; these protect phone
  // verification and bound internal tool loops rather than owner settings.
  "artifacts/api-server/src/elaine/index.ts:919", // MAX_PHONE_CODE_ATTEMPTS
  "artifacts/api-server/src/elaine/index.ts:10217", // MAX_ROUNDS
  "artifacts/api-server/src/elaine/index.ts:10479", // MAX_ROUNDS
  // Client-side concurrency safeguard for an expensive image-processing
  // action, not an owner-facing collection setting.
  "artifacts/modules/src/quilting/pages/fabrics/index.tsx:567", // CREASE_BATCH_SIZE
  // Fixed per-request image cap that prevents oversized AI payloads.
  "artifacts/api-server/src/routes/magnets/magnets.ts:259", // MAX_REANALYZE_IMAGES
  "artifacts/api-server/src/elaine/magnets-actions.ts:511",
  // UI-only reconnect poll cadence; it controls a local query refresh, not
  // any owner-facing product behavior or server-side resource budget.
  "artifacts/web/src/pages/control-panel.tsx:381", // POLL_INTERVAL_MS
  // Fixed actor-client execution bounds that prevent an individual Hallmark
  // lookup from consuming unbounded API time, polling, or result payloads.
  "artifacts/api-server/src/lib/ornaments/hallmark-search.ts:82",
  "artifacts/api-server/src/lib/ornaments/hallmark-search.ts:83",
  "artifacts/api-server/src/lib/ornaments/hallmark-search.ts:84",
  // Fixed outbound Firecrawl request budget; this is a network safety bound,
  // not owner-facing scanner configuration.
  "artifacts/api-server/src/lib/ornaments/hallmark-events-source.ts:9",
  // Input-validation cap for a short internal category label, not a tunable
  // collection setting.
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:119", // MAX_LABEL
  // Scanner heuristic that avoids treating short common strings as secrets;
  // it is a fixed detector safeguard, never product configuration.
  "scripts/src/check-public-file-secrets.ts:169", // MIN_SECRET_LENGTH
  // ---- scripts/scaffold-collection-module.ts ----
  // minLength/maxLength inside the generated OpenAPI YAML templates for
  // category/item name fields — input-validation caps mirroring the existing
  // modules' specs, part of code-generation template strings, never
  // owner-facing runtime config.
  "scripts/src/scaffold-collection-module.ts:839",
  "scripts/src/scaffold-collection-module.ts:840",
  "scripts/src/scaffold-collection-module.ts:1025",
  "scripts/src/scaffold-collection-module.ts:1036",

  // ---- scripts/check-duplicate-code.ts ----
  // MIN_TOKENS: fixed algorithm parameter of the duplicate-code detector
  // (minimum normalized-token length for a body to be comparable). A
  // guardrail-internal tuning constant, never owner-facing product config.
  "scripts/src/check-duplicate-code.ts:62",

  // ---- scripts/check-agent-screenshot-access.ts ----
  // CHECK_TIMEOUT_MS: fixed network budget for the development-only liveness
  // probe. This is a diagnostic implementation safeguard, not product config.
  "scripts/src/check-agent-screenshot-access.ts:10",

  // ---- observability / request-logging threshold ----
  // Fixed monitoring constant; changing it has no product-visible effect.
  "artifacts/api-server/src/app.ts:24",

  // ---- elaine/adaptive-actions.ts ----
  // minItems/maxItems on a tool-schema array: fan-out guard, not owner config.
  "artifacts/api-server/src/elaine/adaptive-actions.ts:212",

  // ---- elaine/app-operation-tools.ts ----
  // Resource/security limits on raw HTTP request and response body sizes.
  "artifacts/api-server/src/elaine/app-operation-tools.ts:50",
  "artifacts/api-server/src/elaine/app-operation-tools.ts:51",

  // ---- elaine/index.ts ----
  // Auth security: max verification-code attempts before lockout.
  "artifacts/api-server/src/elaine/index.ts:941",
  // MAX_ROUNDS: fixed 3-attempt ceiling inside the restricted-channel OpenAI
  // Responses attempt loop and the SMS/email/Slack reply loop. Not
  // owner-facing — the outer RuntimeBudgetConfig controls the agentic turn
  // budget; these inner loops are implementation guards for the restricted
  // channel path that are too tightly coupled to the response-parsing logic
  // to be safely raised by the owner.
  "artifacts/api-server/src/elaine/index.ts:10256", // MAX_ROUNDS (restricted-channel OpenAI-Responses attempt loop)
  "artifacts/api-server/src/elaine/index.ts:10518", // MAX_ROUNDS (restricted-channel reply loop, SMS/email/Slack)

  // ---- lib/comm-check-scheduler.ts ----
  // Per-channel network safety timeout. This bounds a single delivery attempt
  // so one provider cannot stall the scheduler; it is not a user preference.
  "artifacts/api-server/src/lib/comm-check-scheduler.ts:305",

  // ---- routes/magnets/magnets.ts ----
  // Fixed per-request image cap that prevents oversized AI payloads.
  "artifacts/api-server/src/routes/magnets/magnets.ts:266",

  // ---- routes/pottery/pottery.ts ----
  // Input-validation and storage caps tied to field sizes and upload safety,
  // not owner-facing product configuration.
  "artifacts/api-server/src/routes/pottery/pottery.ts:114", // MAX_NAME
  "artifacts/api-server/src/routes/pottery/pottery.ts:116", // MAX_TEXT
  "artifacts/api-server/src/routes/pottery/pottery.ts:117", // MAX_LABEL
  "artifacts/api-server/src/routes/pottery/pottery.ts:120", // MAX_SUPPLEMENTAL_IMAGES

  // ---- routes/ornaments/ornaments.ts ----
  // Pre-existing input-validation caps (notes length, supplemental-image
  // counts) — not owner-facing: these are DB column-length guards and
  // a fixed storage cap tied to the upload pipeline.
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:128", // MAX_NOTES
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:129", // MAX_TEXT
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:127", // MAX_NAME
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:130", // MAX_LABEL
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:132", // MAX_SUPPLEMENTAL_IMAGES
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:133", // MAX_AI_SUPPLEMENTAL
  // ornaments MAX_BULK_REANALYZE is now owner-configurable via
  // thresholds.ornamentsBulkReanalyzeLimit in the Elaine config store.

  // ---- routes/quilting/patterns.ts & quilts.ts ----
  // Pre-existing input-validation caps (field/notes/label lengths, reanalyze
  // batch sizes) unrelated to Task #1058; flagged only because import
  // additions for that task placed adjacent diff context around them.
  // Genuine owner-configurability candidates for the broader hardcoded-config
  // audit, not this task's scope.
  // Pre-existing input-validation caps moved verbatim from blocks.ts/layouts.ts
  // into the shared category helper (Task dedupe of category helpers); same
  // rationale as the patterns/quilts caps below.
  "artifacts/api-server/src/routes/quilting/category-helpers.ts:17", // MAX_CATEGORY_NAMES
  "artifacts/api-server/src/routes/quilting/category-helpers.ts:18", // MAX_CATEGORY_NAME_LEN
  "artifacts/api-server/src/routes/quilting/fabrics.ts:107", // MAX_FIELD
  "artifacts/api-server/src/routes/quilting/fabrics.ts:111", // MAX_SUPPLEMENTAL_IMAGES
  "artifacts/api-server/src/routes/quilting/fabrics.ts:112", // MAX_REANALYZE_IMAGES
  "artifacts/api-server/src/routes/quilting/patterns.ts:64", // MAX_NAME
  "artifacts/api-server/src/routes/quilting/patterns.ts:65", // MAX_FIELD
  "artifacts/api-server/src/routes/quilting/patterns.ts:66", // MAX_NOTES
  "artifacts/api-server/src/routes/quilting/patterns.ts:67", // MAX_LABEL
  "artifacts/api-server/src/routes/quilting/patterns.ts:332", // MAX_REANALYZE_IMAGES
  "artifacts/api-server/src/routes/quilting/quilts.ts:67", // MAX_NAME
  "artifacts/api-server/src/routes/quilting/quilts.ts:68", // MAX_NOTES
  "artifacts/api-server/src/routes/quilting/quilts.ts:69", // MAX_LABEL
  // quilting MAX_BULK_REANALYZE (fabrics/patterns/quilts) is now
  // owner-configurable via thresholds.quiltingBulkReanalyzeLimit in the
  // Elaine config store.

  // ---- modules/ornaments/pages/hallmark-events.tsx ----
  // UI-only query timeout that prevents a stalled Calendar request from
  // blocking the page indefinitely; it does not alter scanner reconciliation.
  "artifacts/modules/src/ornaments/pages/hallmark-events.tsx:62",

  // ---- lib/sentry-error-nudges.ts ----
  // MAX_DETAILED_ISSUES: cosmetic cap on how many individual issue lines
  // appear in a single consolidated Elaine nudge message before the rest
  // collapse into a "+N more" count. Pure message-formatting choice, not a
  // limit/threshold/budget the owner would ever need to tune. Flagged only
  // because an unrelated retry-wrapper edit in this file entered the diff.
  "artifacts/api-server/src/lib/sentry-error-nudges.ts:54",

  // ---- lib/collection-ui/src/async-action-status.ts ----
  // Pure UI-polish timings for how long a "success"/"error" badge lingers on
  // a gallery card before auto-clearing back to idle. Not a limit/budget/cap
  // an owner would ever need to tune — no product behavior depends on the
  // exact value, unlike Elaine's per-turn runtime budget.
  "lib/collection-ui/src/async-action-status.ts:6", // SUCCESS_DISPLAY_MS
  "lib/collection-ui/src/async-action-status.ts:7", // ERROR_DISPLAY_MS

  // ---- lib/elaine-ui/src/CommandPalette.tsx ----
  // Pre-existing client-side UI constant (size of the "Recent" search-history
  // list kept in localStorage) unrelated to Task #1106 (adding ornaments to
  // global search); flagged only because that task touched this file for an
  // unrelated import/icon addition. Not an owner-facing limit/budget — purely
  // a UI-polish cap on a local list length.
  "lib/elaine-ui/src/CommandPalette.tsx:81", // MAX_RECENT

  // ---- elaine/runtime/trace-store.ts ----
  // Zero-initializers for usage counters inside a trace summary object.
  "artifacts/api-server/src/elaine/runtime/trace-store.ts:115",

  // ---- elaine/runtime/turn-runtime.ts ----
  // Zero-value usage-counter initializers (modelRounds/replans/elapsedMs
  // start at 0 every turn), not owner-facing limits — the names happen to
  // overlap with RuntimeBudgetConfig's ceiling field names because they
  // track usage against those ceilings, but the values here are always 0.
  "artifacts/api-server/src/elaine/runtime/turn-runtime.ts:141",

  // ---- elaine/test-helpers/runtime-mock.ts ----
  // Test-only mock default for ElaineTurnRuntime.getBudgetStatus() —
  // mirrors RuntimeBudgetConfig's shape so route tests get a realistic
  // budget snapshot, but these are fixture values for assertions, not a
  // real owner-configurable ceiling (that lives in lib/elaine-config.ts).
  "artifacts/api-server/src/elaine/test-helpers/runtime-mock.ts:141",
  "artifacts/api-server/src/elaine/test-helpers/runtime-mock.ts:142",
  "artifacts/api-server/src/elaine/test-helpers/runtime-mock.ts:143",
  "artifacts/api-server/src/elaine/test-helpers/runtime-mock.ts:144",

  // ---- elaine/turn-registry.ts ----
  // Memory/leak protection: max buffered SSE events per live turn.
  "artifacts/api-server/src/elaine/turn-registry.ts:51",

  // ---- instrument.ts ----
  // Recursive Sentry payload redaction depth — defensive security guard.
  "artifacts/api-server/src/instrument.ts:74",

  // ---- lib/agentphone-http.ts ----
  // AgentPhone HTTP transport: retry count and exponential-backoff base delay.
  "artifacts/api-server/src/lib/agentphone-http.ts:24",
  "artifacts/api-server/src/lib/agentphone-http.ts:25",

  // ---- lib/circuit-breaker.ts ----
  // Circuit-breaker infrastructure defaults; per-instantiation overridable via options.
  "artifacts/api-server/src/lib/circuit-breaker.ts:31",
  "artifacts/api-server/src/lib/circuit-breaker.ts:32",
  "artifacts/api-server/src/lib/circuit-breaker.ts:33",
  "artifacts/api-server/src/lib/circuit-breaker.ts:34",
  // Object-literal cluster at the no-args constructor default-fill site.
  "artifacts/api-server/src/lib/circuit-breaker.ts:197",

  // ---- lib/crease-removal.ts ----
  // OpenAI image-edit call options: provider timeout and SDK retry config.
  "artifacts/api-server/src/lib/crease-removal.ts:200",

  // ---- lib/document-generation.ts ----
  // Max rows in a generated document table — output-size guard.
  "artifacts/api-server/src/lib/document-generation.ts:43",

  // ---- lib/document-parsing.ts ----
  // Max extracted chars and XLSX rows — context-window/memory guards.
  "artifacts/api-server/src/lib/document-parsing.ts:17",
  "artifacts/api-server/src/lib/document-parsing.ts:18",

  // ---- lib/ebay/sold-listings.ts ----
  // Apify/eBay actor polling: job timeout and poll cadence.
  "artifacts/api-server/src/lib/ebay/sold-listings.ts:134",

  // ---- lib/elaine-cross-channel.ts ----
  // Bounded cross-channel gist: entry count and topic label length.
  // Both are prompt-engineering / memory-safety constants, not owner config.
  "artifacts/api-server/src/lib/elaine-cross-channel.ts:41",
  "artifacts/api-server/src/lib/elaine-cross-channel.ts:58",

  // ---- lib/gmail-scan.ts ----
  // Gmail scan caps: messages per run — scan resource/cost guards.
  "artifacts/api-server/src/lib/gmail-scan.ts:49",
  "artifacts/api-server/src/lib/gmail-scan.ts:50",

  // ---- lib/google-oauth.ts ----
  // OAuth token pre-refresh buffer — protocol reliability detail.
  "artifacts/api-server/src/lib/google-oauth.ts:34",

  // ---- lib/image.ts ----
  // Decompression-bomb and storage/AI-payload dimension limits.
  "artifacts/api-server/src/lib/image.ts:25",
  "artifacts/api-server/src/lib/image.ts:32",
  "artifacts/api-server/src/lib/image.ts:40",
  // VTracer vectorization algorithm knobs — fixed tuning presets, not owner config.
  "artifacts/api-server/src/lib/image.ts:468",
  "artifacts/api-server/src/lib/image.ts:520",
  "artifacts/api-server/src/lib/image.ts:538",

  // ---- lib/integrations-health-nudges.ts ----
  // Background job rate guard and startup delay.
  "artifacts/api-server/src/lib/integrations-health-nudges.ts:72",
  "artifacts/api-server/src/lib/integrations-health-nudges.ts:75",

  // ---- lib/jobs/worker.ts ----
  // Background job worker heartbeat interval — internal liveness signaling.
  "artifacts/api-server/src/lib/jobs/worker.ts:21",

  // ---- lib/openrouter-models.ts ----
  // Model-list fetch timeout — HTTP transport detail.
  "artifacts/api-server/src/lib/openrouter-models.ts:29",

  // ---- lib/ornaments/book-value.ts ----
  // External Hallmark site fetch timeout.
  "artifacts/api-server/src/lib/ornaments/book-value.ts:108",

  // ---- lib/ornaments/hallmark-search.ts ----
  // Apify Hallmark search actor: polling timeout, cadence, and result cap.
  "artifacts/api-server/src/lib/ornaments/hallmark-search.ts:86",

  // ---- lib/ornaments/hooh-single-lookup.ts ----
  // External Hallmark site single-item fetch timeout.
  "artifacts/api-server/src/lib/ornaments/hooh-single-lookup.ts:15",

  // ---- lib/reminders-scheduler.ts ----
  // Reminder claim batch size — background job implementation detail.
  "artifacts/api-server/src/lib/reminders-scheduler.ts:418",

  // ---- lib/sentry-error-nudges.ts ----
  // Max Sentry issues fetched per nudge run — external API call guard.
  "artifacts/api-server/src/lib/sentry-error-nudges.ts:53",

  // ---- lib/sentry-issues.ts ----
  // Sentry API call timeout and max issues per fetch.
  "artifacts/api-server/src/lib/sentry-issues.ts:89",
  "artifacts/api-server/src/lib/sentry-issues.ts:90",

  // ---- lib/ssrf-safe-fetch.ts ----
  // SSRF security limits: DNS timeout, request timeout, body size, text cap, redirect cap.
  "artifacts/api-server/src/lib/ssrf-safe-fetch.ts:169",
  "artifacts/api-server/src/lib/ssrf-safe-fetch.ts:209",
  "artifacts/api-server/src/lib/ssrf-safe-fetch.ts:210",
  "artifacts/api-server/src/lib/ssrf-safe-fetch.ts:211",
  "artifacts/api-server/src/lib/ssrf-safe-fetch.ts:527",

  // ---- lib/storage-core.ts ----
  // In-memory Supabase Storage bucket policy cache size.
  "artifacts/api-server/src/lib/storage-core.ts:35",

  // ---- lib/travels/google-maps.ts ----
  // Google Maps geocoding API call timeout.
  "artifacts/api-server/src/lib/travels/google-maps.ts:20",

  // ---- lib/travels-nudges.ts ----
  // AQI index reference value — fixed public health standard (100 = unhealthy for sensitive groups).
  "artifacts/api-server/src/lib/travels-nudges.ts:27",

  // ---- lib/web-search-citations.ts ----
  // Web-search citation count cap — presentation detail.
  "artifacts/api-server/src/lib/web-search-citations.ts:1",

  // ---- lib/web-search.ts ----
  // Web-search provider timeouts and max image results.
  "artifacts/api-server/src/lib/web-search.ts:33",
  "artifacts/api-server/src/lib/web-search.ts:36",
  "artifacts/api-server/src/lib/web-search.ts:41",

  // ---- routes/admin/integrations-health.ts ----
  // Health-check call timeout and retry delay.
  "artifacts/api-server/src/routes/admin/integrations-health.ts:53",
  "artifacts/api-server/src/routes/admin/integrations-health.ts:60",

  // ---- routes/auth.ts ----
  // Auth route: max verification-code attempts — mirrors elaine/index.ts counterpart.
  "artifacts/api-server/src/routes/auth.ts:423",

  // ---- routes/hub.ts ----
  // Link-preview: redirect safety limit and fetch timeout.
  "artifacts/api-server/src/routes/hub.ts:250",
  "artifacts/api-server/src/routes/hub.ts:251",

  // ---- routes/messenger/gifs.ts ----
  // GIF search result count defaults — API pagination detail.
  "artifacts/api-server/src/routes/messenger/gifs.ts:10",
  "artifacts/api-server/src/routes/messenger/gifs.ts:11",

  // ---- routes/messenger/link-preview.ts ----
  // Link-preview fetch timeouts and headroom guard.
  "artifacts/api-server/src/routes/messenger/link-preview.ts:9",
  "artifacts/api-server/src/routes/messenger/link-preview.ts:13",
  "artifacts/api-server/src/routes/messenger/link-preview.ts:14",

  // ---- routes/messenger/typing.ts ----
  // Typing indicator ephemeral state TTL — in-memory implementation detail.
  "artifacts/api-server/src/routes/messenger/typing.ts:18",

  // ---- routes/ornaments/ornaments.ts ----
  // DB field-length validation limits — tied to schema column sizes, not owner-adjustable.
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:115",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:116",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:117",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:118",
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:120",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:121",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:122",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:123",

  // ---- routes/pottery/compare.ts ----
  // Pottery compare: extra-image fan-out cost guard.
  "artifacts/api-server/src/routes/pottery/compare.ts:53",

  // ---- scripts/check-duplicate-code.ts ----
  // Duplicate-detection algorithm tuning (minimum body size) — a fixed
  // detector parameter, not owner-facing configuration.
  "scripts/src/check-duplicate-code.ts:62",

  // ---- routes/pottery/pottery.ts ----
  // DB field-length validation limits — tied to schema column sizes, not
  // owner-adjustable.
  "artifacts/api-server/src/routes/pottery/pottery.ts:108",
  "artifacts/api-server/src/routes/pottery/pottery.ts:109",
  "artifacts/api-server/src/routes/pottery/pottery.ts:110",
  "artifacts/api-server/src/routes/pottery/pottery.ts:111",
  "artifacts/api-server/src/routes/pottery/pottery.ts:112",
  // MAX_SUPPLEMENTAL_IMAGES: hard storage cap per item (tied to the upload
  // pipeline's slot count), not an AI cost control — not owner-adjustable.
  "artifacts/api-server/src/routes/pottery/pottery.ts:115",
  // potteryMaxAiSupplemental and potteryBulkReanalyzeLimit are now
  // owner-configurable via the Elaine config store — no allowlist needed.

  // ---- routes/quilting/fabrics.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/quilting/fabrics.ts:103",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:104",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:105",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:106",
  // Image count guards.
  "artifacts/api-server/src/routes/quilting/fabrics.ts:108",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:109",

  // ---- routes/quilting/layouts.ts ----
  // DB field-length validation limit.
  "artifacts/api-server/src/routes/quilting/layouts.ts:18",

  // ---- routes/quilting/patterns.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/quilting/patterns.ts:59",
  "artifacts/api-server/src/routes/quilting/patterns.ts:60",
  "artifacts/api-server/src/routes/quilting/patterns.ts:61",
  "artifacts/api-server/src/routes/quilting/patterns.ts:62",
  // AI reanalysis image-count guard.
  "artifacts/api-server/src/routes/quilting/patterns.ts:310",

  // ---- routes/quilting/quilts.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/quilting/quilts.ts:62",
  "artifacts/api-server/src/routes/quilting/quilts.ts:63",
  "artifacts/api-server/src/routes/quilting/quilts.ts:64",
  // AI reanalysis image-count guard.
  "artifacts/api-server/src/routes/quilting/quilts.ts:377",

  // ---- routes/quilting/stats.ts ----
  // Top-N labels returned by aggregate stats — presentation/query detail.
  "artifacts/api-server/src/routes/quilting/stats.ts:17",

  // ---- routes/travels/gmail.ts ----
  // Inbox pagination bounds — API implementation detail, not owner-configurable.
  "artifacts/api-server/src/routes/travels/gmail.ts:52",
  "artifacts/api-server/src/routes/travels/gmail.ts:53",
  "artifacts/api-server/src/routes/travels/gmail.ts:54",
  // Bulk link-messages cost guard.
  "artifacts/api-server/src/routes/travels/gmail.ts:483",

  // ---- routes/travels/magnets.ts ----
  // Embedding backfill batch size and similarity result count.
  "artifacts/api-server/src/routes/travels/magnets.ts:29",
  "artifacts/api-server/src/routes/travels/magnets.ts:30",

  // ---- Frontend TOAST_LIMIT (all four apps + shared lib) ----
  // Max simultaneous toast notifications — UI presentation constant.
  "artifacts/elaine/src/hooks/use-toast.ts:5",
  "artifacts/mockup-sandbox/src/hooks/use-toast.ts:5",
  "artifacts/modules/src/hooks/use-toast.ts:5",
  "artifacts/web/src/hooks/use-toast.ts:5",
  "lib/ui/src/toast.tsx:133",

  // ---- mockup-sandbox dev plugin ----
  // File-change write-settle timing for the dev preview tool only.
  "artifacts/mockup-sandbox/mockupPreviewPlugin.ts:157",

  // ---- modules/ornaments ----
  // Google Calendar query timeout — external API call guard.
  "artifacts/modules/src/ornaments/pages/hallmark-events.tsx:60",

  // ---- modules/quilting ----
  // Canvas zoom max-scale — UI layout constraint.
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:68",
  "artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:65",
  // Client-side crease-removal processing throttle.
  "artifacts/modules/src/quilting/pages/fabrics/index.tsx:536",
  // CREASE_BATCH_SIZE — internal concurrency cap for the AI crease-fix
  // pipeline; controls how many images are sent per batch to stay within
  // provider rate limits. Not owner-configurable because changing it
  // requires coordinated server-side limit adjustments.
  "artifacts/modules/src/quilting/pages/fabrics/index.tsx:546",

  // ---- web/control-panel ----
  // DB reconnect status polling interval — implementation detail.
  "artifacts/web/src/pages/control-panel.tsx:382",

  // ---- lib/elaine-ui ----
  // Max recent commands shown in command palette — UI presentation.
  "lib/elaine-ui/src/CommandPalette.tsx:80",
  // Inline citation collapse threshold and scroll-triggered load threshold.
  "lib/elaine-ui/src/ElaineChatPanel.tsx:350",
  "lib/elaine-ui/src/ElaineChatPanel.tsx:543",
  // Widget minimum dimensions — layout constraints preventing the chat
  // window from becoming too small to use. Not owner-facing config.
  "lib/elaine-ui/src/ElaineWidget.tsx:33",
  "lib/elaine-ui/src/ElaineWidget.tsx:34",
  // Web Speech API rate bounds — browser API constraint.
  "lib/elaine-ui/src/useTTS.ts:8",
  "lib/elaine-ui/src/useTTS.ts:9",

  // ---- lib/messenger-ui ----
  // Messenger panel minimum dimensions — layout constraints.
  "lib/messenger-ui/src/MessengerNavIcon.tsx:38",
  "lib/messenger-ui/src/MessengerNavIcon.tsx:39",
  // Notification and toast auto-dismiss durations — UI presentation.
  "lib/messenger-ui/src/MessengerNotification.tsx:56",
  "lib/messenger-ui/src/MessengerToast.tsx:18",

  // ---- lib/upload-validation ----
  // Decompression-bomb pixel limit, storage dimension cap, and Sharp concurrency.
  "lib/upload-validation/src/index.ts:43",
  "lib/upload-validation/src/index.ts:49",
  "lib/upload-validation/src/index.ts:244",

  // ---- lib/web-core ----
  // Stale-chunk reload cooldown — prevents reload loops after Vite preload errors.
  "lib/web-core/src/mount-app.tsx:10",

  // ---- scripts/src/check-public-file-secrets.ts ----
  // Minimum value length for secret-leak detection — security heuristic constant.
  "scripts/src/check-public-file-secrets.ts:170",

  // ---- lib/collection-ui/src/async-action-status.ts ----
  // Auto-clear delays for finished async-action status badges — UI presentation
  // timing constants, not owner-configurable behaviour limits.
  "lib/collection-ui/src/async-action-status.ts:6",
  "lib/collection-ui/src/async-action-status.ts:7",

  // ---- artifacts/api-server/src/lib/ornaments/dimensions.ts ----
  // Defensive maximum for a stored display string from an AI/web-research
  // response. This is input sanitization, not a collection behavior or
  // owner-facing budget.
  "artifacts/api-server/src/lib/ornaments/dimensions.ts:14",

  // ---- scripts/src/github-sync.ts ----
  // Safety cap on bulk deletions per sync run — prevents runaway exclusion-list bugs.
  "scripts/src/github-sync.ts:362",

  // ---- lib/image.ts (additional VTracer presets) ----
  // Additional named vectorization presets (smooth, crisp, high-detail, etc.).
  "artifacts/api-server/src/lib/image.ts:556",
  "artifacts/api-server/src/lib/image.ts:578",
  "artifacts/api-server/src/lib/image.ts:600",
  "artifacts/api-server/src/lib/image.ts:618",

  // ---- routes/quilting/block-templates.ts ----
  // DB field-length validation limits for block template tags and names.
  "artifacts/api-server/src/routes/quilting/block-templates.ts:10",
  "artifacts/api-server/src/routes/quilting/block-templates.ts:11",
  "artifacts/api-server/src/routes/quilting/block-templates.ts:12",

  // ---- routes/quilting/blocks.ts ----
  // DB field-length validation limits for block category names.
  "artifacts/api-server/src/routes/quilting/blocks.ts:26",
  "artifacts/api-server/src/routes/quilting/blocks.ts:27",

  // ---- routes/quilting/compare.ts ----
  // Quilting compare extra-image and AI image fan-out cost guards.
  "artifacts/api-server/src/routes/quilting/compare.ts:47",
  "artifacts/api-server/src/routes/quilting/compare.ts:50",

  // ---- routes/quilting/layouts.ts (additional constant) ----
  // DB field-length validation limit for layout category names.
  "artifacts/api-server/src/routes/quilting/layouts.ts:17",
]);

export function checkHardcodedConfigFromFiles(
  files: string[],
  readFile: (file: string) => string | null,
  allowlist: ReadonlySet<string> = HARDCODED_CONFIG_ALLOWLIST,
  includeAllowlisted = false,
): HardcodedConfigViolation[] {
  const violations: HardcodedConfigViolation[] = [];
  for (const file of files) {
    if (!isScannableFile(file)) continue;
    const content = readFile(file);
    if (content === null) continue; // deleted in this diff

    for (const cluster of findTunableClustersInFile(content)) {
      const key = `${file}:${cluster.lines[0]}`;
      const allowlisted = allowlist.has(key);
      if (!allowlisted || includeAllowlisted) {
        violations.push({
          ...cluster,
          file,
          kind: "cluster",
          context: findingContext(content, cluster.lines[0]!),
          ...(allowlisted ? { allowlisted: true } : {}),
        });
      }
    }

    for (const constant of findTunableConstantsInFile(content)) {
      const key = `${file}:${constant.line}`;
      const allowlisted = allowlist.has(key);
      if (!allowlisted || includeAllowlisted) {
        violations.push({
          file,
          lines: [constant.line],
          names: [constant.name],
          kind: "constant",
          context:
            content
              .split("\n")
              [constant.line - 1]?.trim()
              .replace(/\s+/g, " ") ?? "file-scope",
          ...(allowlisted ? { allowlisted: true } : {}),
        });
      }
    }
  }
  return violations;
}

export const HARDCODED_CONFIG_HELP = [
  "Hardcoded configuration value(s) detected — these look like limits,",
  "timeouts, budgets, caps, or thresholds that should be owner-adjustable",
  "instead of baked into source.",
  "",
  "This is the exact shape of a real incident: Elaine's per-turn runtime",
  "budget (maxModelRounds / maxToolCalls / maxReplans / maxElapsedMs) was a",
  "literal object at the chat call site — invisible to the owner and",
  "impossible to raise without a code change.",
  "",
  "Fix: move the value into the owner-configurable Elaine config store —",
  "add a field to AdminConfigBody",
  "(artifacts/api-server/src/elaine/admin-config.ts), a default in",
  "ELAINE_CONFIG_DEFAULTS (artifacts/api-server/src/lib/elaine-config.ts),",
  "and read it via getElaineGlobalConfig() at the call site instead of a",
  "literal. Elaine's own logic already loads elaineConfig broadly, so once",
  "the value lives there her behavior stays in sync automatically.",
  "",
  "If a value is a genuine internal implementation constant that should",
  "never be owner-facing (e.g. a fixed algorithm parameter), add",
  "'path/to/file.ts:lineNumber' to HARDCODED_CONFIG_ALLOWLIST in",
  "scripts/src/check-hardcoded-config.ts with a comment explaining why.",
  "Do not rename or reformat around the check to dodge it.",
].join("\n");

// ---------------------------------------------------------------------------
// Git-backed wiring (diff mode) + whole-repo walk (audit mode)
// ---------------------------------------------------------------------------

export function runHardcodedConfigCheck(
  base: string,
): HardcodedConfigViolation[] {
  const root = repoRoot();
  const resolvedBase = resolveBase(root, base);
  const changedFiles = getChangedFiles(root, resolvedBase);
  return checkHardcodedConfigFromFiles(changedFiles, (f) =>
    readFileOrNull(root, f),
  );
}

export function runHardcodedConfigAudit(): HardcodedConfigViolation[] {
  const root = repoRoot();
  const files = [
    ...walkFiles(path.join(root, "artifacts"), [".ts", ".tsx"]),
    ...walkFiles(path.join(root, "lib"), [".ts", ".tsx"]),
  ].map((f) => path.relative(root, f));
  return checkHardcodedConfigFromFiles(files, (f) => readFileOrNull(root, f));
}

function getArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1] as string;
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function reportViolation(v: HardcodedConfigViolation): void {
  const desc =
    v.kind === "cluster"
      ? `clustered config object (${v.names.join(", ")})`
      : `standalone constant ${v.names[0]}`;
  console.error(`${v.file}:${v.lines.join(",")} — ${desc}`);
}

function main(): void {
  if (hasFlag("audit")) {
    const violations = runHardcodedConfigAudit();
    console.log(
      `Hardcoded-config audit (whole repo, report-only — does not fail the build)\n`,
    );
    for (const v of violations) reportViolation(v);
    console.log(
      `\n${violations.length} potential hardcoded configuration value(s) found across artifacts/ and lib/.`,
    );
    return;
  }

  const base = getArg("base", "origin/main");
  let violations: HardcodedConfigViolation[];
  try {
    violations = runHardcodedConfigCheck(base);
  } catch (error) {
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("ERROR: Ban: hardcoded configuration values");
    console.error("");
    console.error((error as Error).message);
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exitCode = 1;
    return;
  }

  if (violations.length === 0) {
    console.log(
      "✓ Ban: hardcoded configuration values — none found in this diff",
    );
    return;
  }

  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("ERROR: Ban: hardcoded configuration values");
  console.error("");
  for (const v of violations) reportViolation(v);
  console.error("");
  console.error(HARDCODED_CONFIG_HELP);
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-hardcoded-config.ts")) {
  main();
}
