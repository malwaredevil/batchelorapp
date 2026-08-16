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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface HardcodedConfigViolation {
  file: string;
  lines: number[];
  names: string[];
  kind: "cluster" | "constant";
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
  "artifacts/api-server/src/elaine/index.ts:902",
  // maxModelRounds/maxToolCalls/maxReplans/maxElapsedMs are now owner-config
  // (Task #1046 — see RuntimeBudgetConfig in lib/elaine-config.ts), not
  // hardcoded here anymore.
  // Pre-existing constants unrelated to Task #1046, flagged only because
  // this file was touched for that task. Genuine owner-configurability
  // candidates, but out of scope here — tracked under the broader
  // hardcoded-config audit rather than folded into an unrelated task's diff.
  "artifacts/api-server/src/elaine/index.ts:9935", // MAX_ROUNDS (restricted-channel OpenAI-Responses attempt loop)
  "artifacts/api-server/src/elaine/index.ts:10195", // MAX_ROUNDS (restricted-channel reply loop, SMS/email/Slack)

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
  "artifacts/api-server/src/lib/image.ts:18",
  "artifacts/api-server/src/lib/image.ts:25",
  "artifacts/api-server/src/lib/image.ts:33",
  // VTracer vectorization algorithm knobs — fixed tuning presets, not owner config.
  "artifacts/api-server/src/lib/image.ts:494",
  "artifacts/api-server/src/lib/image.ts:546",
  "artifacts/api-server/src/lib/image.ts:564",

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
  // Image count and AI reanalysis cost guards.
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:120",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:121",
  "artifacts/api-server/src/routes/ornaments/ornaments.ts:122",

  // ---- routes/pottery/compare.ts ----
  // Pottery compare: extra-image fan-out cost guard.
  "artifacts/api-server/src/routes/pottery/compare.ts:52",

  // ---- routes/pottery/pottery.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/pottery/pottery.ts:111",
  "artifacts/api-server/src/routes/pottery/pottery.ts:112",
  "artifacts/api-server/src/routes/pottery/pottery.ts:113",
  "artifacts/api-server/src/routes/pottery/pottery.ts:114",
  // Image count and AI reanalysis cost guards.
  "artifacts/api-server/src/routes/pottery/pottery.ts:117",
  "artifacts/api-server/src/routes/pottery/pottery.ts:124",
  "artifacts/api-server/src/routes/pottery/pottery.ts:1241",

  // ---- routes/quilting/fabrics.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/quilting/fabrics.ts:102",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:103",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:104",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:105",
  // Image count and AI reanalysis cost guards.
  "artifacts/api-server/src/routes/quilting/fabrics.ts:107",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:108",
  "artifacts/api-server/src/routes/quilting/fabrics.ts:1111",

  // ---- routes/quilting/layouts.ts ----
  // DB field-length validation limit.
  "artifacts/api-server/src/routes/quilting/layouts.ts:18",

  // ---- routes/quilting/patterns.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/quilting/patterns.ts:56",
  "artifacts/api-server/src/routes/quilting/patterns.ts:57",
  "artifacts/api-server/src/routes/quilting/patterns.ts:58",
  "artifacts/api-server/src/routes/quilting/patterns.ts:59",
  // AI reanalysis cost guards.
  "artifacts/api-server/src/routes/quilting/patterns.ts:307",
  "artifacts/api-server/src/routes/quilting/patterns.ts:308",

  // ---- routes/quilting/quilts.ts ----
  // DB field-length validation limits.
  "artifacts/api-server/src/routes/quilting/quilts.ts:59",
  "artifacts/api-server/src/routes/quilting/quilts.ts:60",
  "artifacts/api-server/src/routes/quilting/quilts.ts:61",
  // AI reanalysis cost guards.
  "artifacts/api-server/src/routes/quilting/quilts.ts:374",
  "artifacts/api-server/src/routes/quilting/quilts.ts:375",

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
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:67",
  "artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:65",
  // Client-side crease-removal processing throttle.
  "artifacts/modules/src/quilting/pages/fabrics/index.tsx:536",

  // ---- web/control-panel ----
  // DB reconnect status polling interval — implementation detail.
  "artifacts/web/src/pages/control-panel.tsx:382",

  // ---- lib/elaine-ui ----
  // Max recent commands shown in command palette — UI presentation.
  "lib/elaine-ui/src/CommandPalette.tsx:80",
  // Inline citation collapse threshold and scroll-triggered load threshold.
  "lib/elaine-ui/src/ElaineChatPanel.tsx:350",
  "lib/elaine-ui/src/ElaineChatPanel.tsx:543",
  // Widget minimum dimensions — layout constraints.
  "lib/elaine-ui/src/ElaineWidget.tsx:30",
  "lib/elaine-ui/src/ElaineWidget.tsx:31",
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

  // ---- scripts/src/github-sync.ts ----
  // Safety cap on bulk deletions per sync run — prevents runaway exclusion-list bugs.
  "scripts/src/github-sync.ts:362",

  // ---- lib/image.ts (additional VTracer presets) ----
  // Additional named vectorization presets (smooth, crisp, high-detail, etc.).
  "artifacts/api-server/src/lib/image.ts:582",
  "artifacts/api-server/src/lib/image.ts:604",
  "artifacts/api-server/src/lib/image.ts:626",
  "artifacts/api-server/src/lib/image.ts:644",

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
): HardcodedConfigViolation[] {
  const violations: HardcodedConfigViolation[] = [];
  for (const file of files) {
    if (!isScannableFile(file)) continue;
    const content = readFile(file);
    if (content === null) continue; // deleted in this diff

    for (const cluster of findTunableClustersInFile(content)) {
      const key = `${file}:${cluster.lines[0]}`;
      if (allowlist.has(key)) continue;
      violations.push({ ...cluster, file, kind: "cluster" });
    }

    for (const constant of findTunableConstantsInFile(content)) {
      const key = `${file}:${constant.line}`;
      if (allowlist.has(key)) continue;
      violations.push({
        file,
        lines: [constant.line],
        names: [constant.name],
        kind: "constant",
      });
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

function refResolves(root: string, ref: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      {
        encoding: "utf8",
      },
    );
    return true;
  } catch {
    return false;
  }
}

// This repo's CI checkout (actions/checkout) always creates a remote named
// "origin", but the live Replit workspace's git-to-GitHub connection is a
// remote named "github" instead — "origin" does not exist there. Without
// this fallback, every local run would silently diff against nothing (see
// below) even though a real, resolvable upstream ref is available.
const LOCAL_BASE_FALLBACK: Record<string, string> = {
  "origin/main": "github/main",
};

/**
 * `git diff base...HEAD` silently succeeds with empty output if `base` can't
 * be resolved at all (unknown ref) — which would make this check report a
 * false-clean "no violations" instead of failing loudly. Resolve to a real
 * ref (falling back to this environment's actual upstream remote when the
 * CI-only default isn't present), or fail loudly if nothing resolves.
 */
function resolveBase(root: string, base: string): string {
  if (refResolves(root, base)) return base;
  const fallback = LOCAL_BASE_FALLBACK[base];
  if (fallback && refResolves(root, fallback)) {
    console.error(
      `(note: "${base}" not found in this checkout — diffing against "${fallback}" instead)`,
    );
    return fallback;
  }
  throw new Error(
    `Cannot resolve base ref "${base}"${fallback ? ` (or fallback "${fallback}")` : ""} — ` +
      `no such branch/remote in this checkout, so the diff would silently be empty and ` +
      `this check would falsely report "no violations" instead of actually checking ` +
      `anything. In CI this ref is "origin/main" (created by actions/checkout). Locally, ` +
      `pass a --base that actually exists in this checkout, or fetch the missing ref.`,
  );
}

function readFileOrNull(root: string, file: string): string | null {
  try {
    return fs.readFileSync(`${root}/${file}`, "utf8");
  } catch {
    return null;
  }
}

const AUDIT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".cache",
]);

function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  function walk(current: string) {
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (AUDIT_SKIP_DIRS.has(entry)) continue;
      const full = path.join(current, entry);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (extensions.includes(path.extname(entry))) results.push(full);
    }
  }
  walk(dir);
  return results;
}

export function runHardcodedConfigCheck(
  base: string,
): HardcodedConfigViolation[] {
  const root = repoRoot();
  const resolvedBase = resolveBase(root, base);
  const changedFiles = git(root, [
    "diff",
    "--name-only",
    `${resolvedBase}...HEAD`,
  ])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
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
