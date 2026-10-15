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
import ts from "typescript";
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
 * owner-facing config (e.g. a fixed algorithm parameter). The default no longer
 * contains source coordinates. Keep the explicit coordinate-set API for callers
 * that supply their own policy exceptions.
 * Every entry needs a reason — do not silence genuine misses; fix them instead.
 */
export const HARDCODED_CONFIG_ALLOWLIST: ReadonlySet<string> = new Set();

type ConfigAnchor = {
  file: string;
  kind: "constant" | "cluster";
  scope: string;
  symbol: string;
  expression: string;
};

function reviewedConstants(
  file: string,
  expressions: Record<string, string>,
  scope = "file-scope",
): ConfigAnchor[] {
  return Object.entries(expressions).map(([symbol, expression]) => ({
    file,
    kind: "constant",
    scope,
    symbol,
    expression,
  }));
}

/**
 * Match complete reviewed expressions in their named scope, not their former
 * source lines. Removed/config-store-backed declarations have no exception.
 */
export const ANCHORED_CONFIG_ALLOWLIST: readonly ConfigAnchor[] = [
  // Fixed provider-call creation bound. A timeout becomes indeterminate and
  // suppresses automatic retry; this is transport safety, not a user setting.
  ...reviewedConstants("artifacts/api-server/src/lib/comm-check-scheduler.ts", {
    PHONE_CREATE_TIMEOUT_MS: "60_000",
    // Per-channel delivery watchdog; not owner-facing product configuration.
    CHANNEL_DELIVERY_TIMEOUT_MS: "60_000",
    // Fixed diagnostic safety window intentionally exceeds interactive user-call
    // polling; comm-check is an internal health probe, not owner-facing config.
    COMM_CHECK_INTERACTIVE_OUTCOME_TIMEOUT_MS: "30_000",
  }),
  // Client-side concurrency safeguard for an expensive image-processing
  // action, not an owner-facing collection setting.
  ...reviewedConstants(
    "artifacts/modules/src/quilting/pages/fabrics/index.tsx",
    { CREASE_BATCH_SIZE: "3" },
    "Fabrics",
  ),
  // Fixed per-request image cap that prevents oversized AI payloads.
  ...reviewedConstants("artifacts/api-server/src/routes/magnets/magnets.ts", {
    MAX_REANALYZE_IMAGES: "5",
  }),
  ...reviewedConstants(
    "artifacts/api-server/src/elaine/magnets-actions.ts",
    { MAX_REANALYZE_IMAGES: "5" },
    "reanalyze_magnet",
  ),
  // UI-only reconnect poll cadence; it controls a local query refresh, not
  // any owner-facing product behavior or server-side resource budget.
  ...reviewedConstants("artifacts/web/src/pages/control-panel.tsx", {
    POLL_INTERVAL_MS: "30_000",
  }),
  // Fixed actor-client execution bounds that prevent an individual Hallmark
  // lookup from consuming unbounded API time, polling, or result payloads.
  {
    file: "artifacts/api-server/src/lib/ornaments/hallmark-search.ts",
    kind: "cluster",
    scope: "searchHallmark",
    symbol: "runApifyActor.arguments.3",
    expression: `{
      timeoutMs: 120_000,
      pollIntervalMs: 5_000,
      maxItems: 1,
      memoryMbytes: 2048,
    }`,
  },
  // Fixed outbound Firecrawl request budget; this is a network safety bound,
  // not owner-facing scanner configuration.
  ...reviewedConstants(
    "artifacts/api-server/src/lib/ornaments/hallmark-events-source.ts",
    {
      REQUEST_TIMEOUT_MS: "45_000",
    },
  ),
  // Fixed client-only display heuristics: collapse unusually long citation
  // lists and load older chat messages near the scroll boundary. Neither
  // changes Elaine's server behavior or belongs in owner-facing settings.
  ...reviewedConstants("lib/elaine-ui/src/ElaineChatPanel.tsx", {
    INLINE_CITATION_LIMIT: "4",
  }),
  ...reviewedConstants(
    "lib/elaine-ui/src/ElaineChatPanel.tsx",
    {
      SCROLL_TOP_LOAD_THRESHOLD: "80",
    },
    "ElaineChatPanel",
  ),
  // Reminder dispatch batch size is a safety limit, not an owner-facing setting.
  ...reviewedConstants("artifacts/api-server/src/lib/reminders-scheduler.ts", {
    CLAIM_BATCH_SIZE: "200",
  }),
  // Scanner heuristic that avoids treating short common strings as secrets;
  // it is a fixed detector safeguard, never product configuration.
  ...reviewedConstants("scripts/src/check-public-file-secrets.ts", {
    MIN_SECRET_LENGTH: "16",
  }),
  // ---- scripts/scaffold-collection-module.ts ----
  // minLength/maxLength inside the generated OpenAPI YAML templates for
  // category/item name fields — input-validation caps mirroring the existing
  // modules' specs, part of code-generation template strings, never
  // owner-facing runtime config.
  {
    file: "scripts/src/scaffold-collection-module.ts",
    kind: "cluster",
    scope: "yamlTemplate",
    symbol: "categorySchemas",
    expression: `spec.categories
    ? \`    Category:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: integer
        name:
          type: string
        bgColor:
          type:
            - string
            - "null"
        textColor:
          type:
            - string
            - "null"
        count:
          type: integer
    CategoryInput:
      type: object
      required:
        - name
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 50
        bgColor:
          type:
            - string
            - "null"
        textColor:
          type:
            - string
            - "null"
    CategoryColorInput:
      type: object
      properties:
        bgColor:
          type:
            - string
            - "null"
        textColor:
          type:
            - string
            - "null"
    MergeCategoryInput:
      type: object
      required:
        - intoId
      properties:
        intoId:
          type: integer
\`
    : ""`,
  },

  // ---- scripts/check-duplicate-code.ts ----
  // MIN_TOKENS: fixed algorithm parameter of the duplicate-code detector
  // (minimum normalized-token length for a body to be comparable). A
  // guardrail-internal tuning constant, never owner-facing product config.
  ...reviewedConstants("scripts/src/check-duplicate-code.ts", {
    MIN_TOKENS: "80",
  }),

  // ---- scripts/check-agent-screenshot-access.ts ----
  // CHECK_TIMEOUT_MS: fixed network budget for the development-only liveness
  // probe. This is a diagnostic implementation safeguard, not product config.
  ...reviewedConstants("scripts/src/check-agent-screenshot-access.ts", {
    CHECK_TIMEOUT_MS: "15_000",
  }),

  // ---- observability / request-logging threshold ----
  // Fixed monitoring constant; changing it has no product-visible effect.
  ...reviewedConstants("artifacts/api-server/src/app.ts", {
    SLOW_REQUEST_THRESHOLD_MS: "2_000",
  }),

  // ---- elaine/adaptive-actions.ts ----
  // minItems/maxItems on a tool-schema array: fan-out guard, not owner config.
  {
    file: "artifacts/api-server/src/elaine/adaptive-actions.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "queries",
    expression: `{
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
    }`,
  },

  // ---- elaine/app-operation-tools.ts ----
  // Resource/security limits on raw HTTP request and response body sizes.
  ...reviewedConstants(
    "artifacts/api-server/src/elaine/app-operation-tools.ts",
    {
      MAX_REQUEST_BYTES: "200_000",
      MAX_RESPONSE_BYTES: "512_000",
    },
  ),

  // ---- routes/pottery/pottery.ts ----
  // Input-validation and storage caps tied to field sizes and upload safety,
  // not owner-facing product configuration.
  ...reviewedConstants("artifacts/api-server/src/routes/pottery/pottery.ts", {
    MAX_NAME: "200",
    MAX_NOTES: "4000",
    MAX_TEXT: "500",
    MAX_LABEL: "100",
    MAX_SUPPLEMENTAL_IMAGES: "20",
  }),

  // ---- routes/ornaments/ornaments.ts ----
  // Pre-existing input-validation caps (notes length, supplemental-image
  // counts) — not owner-facing: these are DB column-length guards and
  // a fixed storage cap tied to the upload pipeline.
  ...reviewedConstants(
    "artifacts/api-server/src/routes/ornaments/ornaments.ts",
    {
      MAX_NAME: "200",
      MAX_NOTES: "4000",
      MAX_TEXT: "500",
      MAX_LABEL: "100",
      MAX_SUPPLEMENTAL_IMAGES: "20",
    },
  ),
  // ornaments MAX_BULK_REANALYZE is now owner-configurable via
  // thresholds.ornamentsBulkReanalyzeLimit in the Elaine config store.

  // ---- routes/quilting/patterns.ts & quilts.ts ----
  // Field/notes/label and shared category validation caps; fixed storage and
  // per-request AI payload guards, not owner-facing collection configuration.
  ...reviewedConstants(
    "artifacts/api-server/src/routes/quilting/category-helpers.ts",
    {
      MAX_CATEGORY_NAMES: "20",
      MAX_CATEGORY_NAME_LEN: "100",
    },
  ),
  ...reviewedConstants("artifacts/api-server/src/routes/quilting/fabrics.ts", {
    MAX_NAME: "200",
    MAX_FIELD: "200",
    MAX_NOTES: "4000",
    MAX_LABEL: "100",
    MAX_SUPPLEMENTAL_IMAGES: "10",
    MAX_REANALYZE_IMAGES: "5",
  }),
  ...reviewedConstants("artifacts/api-server/src/routes/quilting/patterns.ts", {
    MAX_NAME: "200",
    MAX_FIELD: "200",
    MAX_NOTES: "4000",
    MAX_LABEL: "100",
    MAX_REANALYZE_IMAGES: "5",
  }),
  ...reviewedConstants("artifacts/api-server/src/routes/quilting/quilts.ts", {
    MAX_NAME: "200",
    MAX_NOTES: "4000",
    MAX_LABEL: "100",
  }),
  // quilting MAX_BULK_REANALYZE (fabrics/patterns/quilts) is now
  // owner-configurable via thresholds.quiltingBulkReanalyzeLimit in the
  // Elaine config store.

  // ---- modules/ornaments/pages/hallmark-events.tsx ----
  // UI-only query timeout that prevents a stalled Calendar request from
  // blocking the page indefinitely; it does not alter scanner reconciliation.
  ...reviewedConstants(
    "artifacts/modules/src/ornaments/pages/hallmark-events.tsx",
    {
      GCAL_QUERY_TIMEOUT_MS: "10_000",
    },
  ),

  // ---- lib/sentry-error-nudges.ts ----
  // MAX_DETAILED_ISSUES: cosmetic cap on how many individual issue lines
  // appear in a single consolidated Elaine nudge message before the rest
  // collapse into a "+N more" count. Pure message-formatting choice, not a
  // limit/threshold/budget the owner would ever need to tune. Flagged only
  // because an unrelated retry-wrapper edit in this file entered the diff.
  ...reviewedConstants("artifacts/api-server/src/lib/sentry-error-nudges.ts", {
    MAX_DETAILED_ISSUES: "5",
  }),

  // ---- lib/collection-ui/src/async-action-status.ts ----
  // Pure UI-polish timings for how long a "success"/"error" badge lingers on
  // a gallery card before auto-clearing back to idle. Not a limit/budget/cap
  // an owner would ever need to tune — no product behavior depends on the
  // exact value, unlike Elaine's per-turn runtime budget.
  ...reviewedConstants("lib/collection-ui/src/async-action-status.ts", {
    SUCCESS_DISPLAY_MS: "2500",
    ERROR_DISPLAY_MS: "5000",
  }),

  // ---- lib/elaine-ui/src/CommandPalette.tsx ----
  // Size of the localStorage "Recent" search-history list: UI presentation.
  ...reviewedConstants("lib/elaine-ui/src/CommandPalette.tsx", {
    MAX_RECENT: "5",
  }),

  // ---- elaine/test-helpers/runtime-mock.ts ----
  // Test-only mock default for ElaineTurnRuntime.getBudgetStatus() —
  // mirrors RuntimeBudgetConfig's shape so route tests get a realistic
  // budget snapshot, but these are fixture values for assertions, not a
  // real owner-configurable ceiling (that lives in lib/elaine-config.ts).
  {
    file: "artifacts/api-server/src/elaine/test-helpers/runtime-mock.ts",
    kind: "cluster",
    scope: "ElaineTurnRuntime.getBudgetStatus",
    symbol: "budget",
    expression: `{
      maxModelRounds: 4,
      maxToolCalls: 16,
      maxReplans: 2,
      maxElapsedMs: 120_000,
    }`,
  },

  // ---- elaine/turn-registry.ts ----
  // Memory/leak protection: max buffered SSE events per live turn.
  ...reviewedConstants("artifacts/api-server/src/elaine/turn-registry.ts", {
    MAX_BUFFERED_EVENTS: "10_000",
  }),

  // ---- instrument.ts ----
  // Recursive Sentry payload redaction depth — defensive security guard.
  ...reviewedConstants("artifacts/api-server/src/instrument.ts", {
    MAX_REDACT_DEPTH: "12",
  }),

  // ---- lib/agentphone-http.ts ----
  // AgentPhone HTTP transport: retry count and exponential-backoff base delay.
  ...reviewedConstants("artifacts/api-server/src/lib/agentphone-http.ts", {
    MAX_RETRIES: "2",
    BASE_DELAY_MS: "500",
  }),

  // ---- lib/circuit-breaker.ts ----
  // Circuit-breaker infrastructure defaults; per-instantiation overridable via options.
  ...reviewedConstants("artifacts/api-server/src/lib/circuit-breaker.ts", {
    DEFAULT_FAILURE_THRESHOLD: "5",
    DEFAULT_SUCCESS_THRESHOLD: "2",
    DEFAULT_WINDOW_MS: "60_000",
    DEFAULT_RESET_TIMEOUT_MS: "30_000",
  }),
  // Shared singleton's explicit infrastructure defaults.
  {
    file: "artifacts/api-server/src/lib/circuit-breaker.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "new CircuitBreaker.arguments.0",
    expression: `{
      failureThreshold: 5,
      successThreshold: 2,
      windowMs: 60_000,
      resetTimeoutMs: 30_000,
    }`,
  },

  // ---- lib/crease-removal.ts ----
  // OpenAI image-edit call options: provider timeout and SDK retry config.
  {
    file: "artifacts/api-server/src/lib/crease-removal.ts",
    kind: "cluster",
    scope: "removeCreasesFromBuffer",
    symbol: "new OpenAI.arguments.0",
    expression: `{
      apiKey: env.openaiApiKey,
      timeout: 90_000,
      maxRetries: 0,
    }`,
  },

  // ---- lib/document-generation.ts ----
  // Max rows in a generated document table — output-size guard.
  ...reviewedConstants("artifacts/api-server/src/lib/document-generation.ts", {
    MAX_TABLE_ROWS: "2000",
  }),

  // ---- lib/document-parsing.ts ----
  // Max extracted chars and XLSX rows — context-window/memory guards.
  ...reviewedConstants("artifacts/api-server/src/lib/document-parsing.ts", {
    MAX_EXTRACTED_CHARS: "8000",
    MAX_XLSX_ROWS_PER_SHEET: "200",
  }),

  // ---- lib/ebay/sold-listings.ts ----
  // Apify/eBay actor polling: job timeout and poll cadence.
  {
    file: "artifacts/api-server/src/lib/ebay/sold-listings.ts",
    kind: "cluster",
    scope: "lookupEbaySoldListings",
    symbol: "runApifyActor.arguments.3",
    expression: `{
      timeoutMs: 120_000,
      pollIntervalMs: 5_000,
      maxItems: count,
      memoryMbytes: 1024,
    }`,
  },

  // ---- lib/elaine-cross-channel.ts ----
  // Bounded cross-channel gist: entry count and topic label length.
  // Both are prompt-engineering / memory-safety constants, not owner config.
  ...reviewedConstants("artifacts/api-server/src/lib/elaine-cross-channel.ts", {
    MAX_ENTRIES: "15",
    MAX_TOPIC_CHARS: "120",
  }),

  // ---- lib/gmail-scan.ts ----
  // Gmail scan caps: messages per run — scan resource/cost guards.
  ...reviewedConstants("artifacts/api-server/src/lib/gmail-scan.ts", {
    MAX_MESSAGES_PER_SCAN: "150",
    MAX_LABELED_MESSAGES_PER_SCAN: "100",
  }),

  // ---- lib/google-oauth.ts ----
  // OAuth token pre-refresh buffer — protocol reliability detail.
  ...reviewedConstants("artifacts/api-server/src/lib/google-oauth.ts", {
    OAUTH_EXPIRY_BUFFER_MS: "60_000",
  }),

  // ---- lib/image.ts ----
  // Decompression-bomb and storage/AI-payload dimension limits.
  ...reviewedConstants("artifacts/api-server/src/lib/image.ts", {
    MAX_INPUT_PIXELS: "50_000_000",
    MAX_STORAGE_DIMENSION: "2048",
    MAX_AI_DIMENSION: "1024",
  }),
  // VTracer vectorization algorithm knobs — fixed tuning presets, not owner config.
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "generateFabricTileVectorized",
    symbol: "vectorize.arguments.1",
    expression: `{
      colorMode: ColorMode.Color,
      colorPrecision: 6,
      filterSpeckle: 4,
      spliceThreshold: 45,
      cornerThreshold: 60,
      hierarchical: Hierarchical.Stacked,
      mode: PathSimplifyMode.Spline,
      layerDifference: 5,
      lengthThreshold: 5,
      maxIterations: 2,
      pathPrecision: 5,
    }`,
  },
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "DIRECTION_A_BASELINE_TUNING",
    expression: `{
      flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
      textureSuppressSigma: TEXTURE_SUPPRESS_SIGMA,
      posterizeColors: POSTERIZE_COLORS,
      colorPrecision: 6,
      filterSpeckle: 4,
      spliceThreshold: 45,
      cornerThreshold: 60,
      layerDifference: 5,
      lengthThreshold: 5,
    }`,
  },
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "DIRECTION_A_SMOOTH_TUNING",
    expression: `{
      flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
      textureSuppressSigma: 3.2,
      posterizeColors: 5,
      colorPrecision: 5,
      filterSpeckle: 6,
      spliceThreshold: 45,
      cornerThreshold: 75,
      layerDifference: 8,
      lengthThreshold: 6,
    }`,
  },

  // ---- lib/integrations-health-nudges.ts ----
  // Background job rate guard and startup delay.
  ...reviewedConstants(
    "artifacts/api-server/src/lib/integrations-health-nudges.ts",
    {
      MAX_FAILURE_NUDGES_PER_RUN: "3",
      STARTUP_DELAY_MS: "90_000",
    },
  ),

  // ---- lib/jobs/worker.ts ----
  // Background job worker heartbeat interval — internal liveness signaling.
  ...reviewedConstants("artifacts/api-server/src/lib/jobs/worker.ts", {
    HEARTBEAT_INTERVAL_MS: "60_000",
  }),

  // ---- lib/openrouter-models.ts ----
  // Model-list fetch timeout — HTTP transport detail.
  ...reviewedConstants("artifacts/api-server/src/lib/openrouter-models.ts", {
    DEFAULT_FETCH_TIMEOUT_MS: "8_000",
  }),

  // ---- lib/ornaments/book-value.ts ----
  // External Hallmark site fetch timeout.
  ...reviewedConstants("artifacts/api-server/src/lib/ornaments/book-value.ts", {
    FETCH_TIMEOUT_MS: "20_000",
  }),

  // ---- lib/sentry-issues.ts ----
  // Sentry API call timeout and max issues per fetch.
  ...reviewedConstants("artifacts/api-server/src/lib/sentry-issues.ts", {
    FETCH_TIMEOUT_MS: "15_000",
    MAX_ISSUES: "50",
  }),

  // ---- lib/ssrf-safe-fetch.ts ----
  // SSRF security limits: DNS timeout, request timeout, body size, text cap, redirect cap.
  ...reviewedConstants(
    "artifacts/api-server/src/lib/ssrf-safe-fetch.ts",
    {
      DNS_TIMEOUT_MS: "2000",
    },
    "assertSsrfSafeDns",
  ),
  ...reviewedConstants("artifacts/api-server/src/lib/ssrf-safe-fetch.ts", {
    FETCH_ABSOLUTE_TIMEOUT_MS: "12_000",
    MAX_BODY_BYTES: "200_000",
    MAX_TEXT_LENGTH: "6_000",
    MAX_REDIRECTS: "5",
  }),

  // ---- lib/storage-core.ts ----
  // In-memory Supabase Storage bucket policy cache size.
  ...reviewedConstants("artifacts/api-server/src/lib/storage-core.ts", {
    MAX_CACHE_ENTRIES_PER_BUCKET: "250",
  }),

  // ---- lib/travels/google-maps.ts ----
  // Google Maps geocoding API call timeout.
  ...reviewedConstants("artifacts/api-server/src/lib/travels/google-maps.ts", {
    DEFAULT_TIMEOUT_MS: "8000",
  }),

  // ---- lib/travels-nudges.ts ----
  // AQI index reference value — fixed public health standard (100 = unhealthy for sensitive groups).
  ...reviewedConstants("artifacts/api-server/src/lib/travels-nudges.ts", {
    AQI_UNHEALTHY_THRESHOLD: "100",
  }),

  // ---- lib/web-search-citations.ts ----
  // Web-search citation count cap — presentation detail.
  ...reviewedConstants("artifacts/api-server/src/lib/web-search-citations.ts", {
    MAX_WEB_SEARCH_CITATIONS: "20",
  }),

  // ---- lib/web-search.ts ----
  // Web-search provider timeouts and max image results.
  ...reviewedConstants("artifacts/api-server/src/lib/web-search.ts", {
    DEFAULT_SEARCH_TIMEOUT_MS: "15_000",
    MAX_IMAGES: "4",
    FETCH_PAGE_TIMEOUT_MS: "20_000",
  }),

  // ---- routes/admin/integrations-health.ts ----
  // Health-check call timeout and retry delay.
  ...reviewedConstants(
    "artifacts/api-server/src/routes/admin/integrations-health.ts",
    {
      CHECK_TIMEOUT_MS: "15_000",
      CHECK_RETRY_DELAY_MS: "2_000",
    },
  ),

  // ---- routes/auth.ts ----
  // Auth route: max verification-code attempts — mirrors elaine/index.ts counterpart.
  ...reviewedConstants("artifacts/api-server/src/routes/auth.ts", {
    MAX_PHONE_CODE_ATTEMPTS: "5",
  }),

  // ---- routes/hub.ts ----
  // Link-preview: redirect safety limit and fetch timeout.
  ...reviewedConstants("artifacts/api-server/src/routes/hub.ts", {
    MAX_REDIRECTS: "5",
    FETCH_TIMEOUT_MS: "10_000",
  }),

  // ---- routes/messenger/gifs.ts ----
  // GIF search result count defaults — API pagination detail.
  ...reviewedConstants("artifacts/api-server/src/routes/messenger/gifs.ts", {
    DEFAULT_LIMIT: "24",
    MAX_LIMIT: "50",
  }),

  // ---- routes/messenger/link-preview.ts ----
  // Link-preview fetch timeouts and headroom guard.
  ...reviewedConstants(
    "artifacts/api-server/src/routes/messenger/link-preview.ts",
    {
      PREVIEW_TIMEOUT_MS: "6000",
      DIRECT_FETCH_TIMEOUT_MS: "3000",
      MIN_REMAINING_MS: "500",
    },
  ),

  // ---- routes/messenger/typing.ts ----
  // Typing indicator ephemeral state TTL — in-memory implementation detail.
  ...reviewedConstants("artifacts/api-server/src/routes/messenger/typing.ts", {
    TYPING_TTL_MS: "2500",
  }),

  // ---- routes/pottery/compare.ts ----
  // Pottery compare: extra-image fan-out cost guard.
  ...reviewedConstants("artifacts/api-server/src/routes/pottery/compare.ts", {
    MAX_EXTRA_IMAGES: "1",
  }),
  // potteryMaxAiSupplemental and potteryBulkReanalyzeLimit are now
  // owner-configurable via the Elaine config store — no allowlist needed.

  // ---- routes/quilting/stats.ts ----
  // Top-N labels returned by aggregate stats — presentation/query detail.
  ...reviewedConstants("artifacts/api-server/src/routes/quilting/stats.ts", {
    TOP_LIMIT: "8",
  }),

  // ---- routes/travels/gmail.ts ----
  // Inbox pagination bounds — API implementation detail, not owner-configurable.
  ...reviewedConstants("artifacts/api-server/src/routes/travels/gmail.ts", {
    DEFAULT_INBOX_PAGE_SIZE: "20",
    MIN_INBOX_PAGE_SIZE: "10",
    MAX_INBOX_PAGE_SIZE: "50",
    // Bulk link-messages cost guard.
    MAX_BULK_LINK_MESSAGES: "25",
  }),

  // ---- routes/travels/magnets.ts ----
  // Embedding backfill batch size and similarity result count.
  ...reviewedConstants("artifacts/api-server/src/routes/travels/magnets.ts", {
    BACKFILL_LIMIT: "50",
    RESULT_LIMIT: "5",
  }),

  // ---- Frontend TOAST_LIMIT (all four apps + shared lib) ----
  // Max simultaneous toast notifications — UI presentation constant.
  ...[
    "artifacts/elaine/src/hooks/use-toast.ts",
    "artifacts/mockup-sandbox/src/hooks/use-toast.ts",
    "artifacts/modules/src/hooks/use-toast.ts",
    "artifacts/web/src/hooks/use-toast.ts",
    "lib/ui/src/toast.tsx",
  ].flatMap((file) => reviewedConstants(file, { TOAST_LIMIT: "1" })),

  // ---- mockup-sandbox dev plugin ----
  // File-change write-settle timing for the dev preview tool only.
  {
    file: "artifacts/mockup-sandbox/mockupPreviewPlugin.ts",
    kind: "cluster",
    scope: "mockupPreviewPlugin.configureServer",
    symbol: "awaitWriteFinish",
    expression: `{
      stabilityThreshold: 100,
      pollInterval: 50,
    }`,
  },

  // ---- modules/quilting ----
  // Canvas zoom max-scale — UI layout constraint.
  ...reviewedConstants(
    "artifacts/modules/src/quilting/components/FabricAiLab.tsx",
    {
      MAX_SCALE: "10",
    },
  ),
  ...reviewedConstants(
    "artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx",
    {
      MAX_SCALE: "10",
    },
  ),
  // Widget minimum dimensions — layout constraints preventing the chat
  // window from becoming too small to use. Not owner-facing config.
  ...reviewedConstants("lib/elaine-ui/src/ElaineWidget.tsx", {
    MIN_W: "280",
    MIN_H: "340",
  }),
  // Web Speech API rate bounds — browser API constraint.
  ...reviewedConstants("lib/elaine-ui/src/useTTS.ts", {
    MAX_RATE: "2",
    DEFAULT_RATE: "1",
  }),

  // ---- lib/messenger-ui ----
  // Messenger panel minimum dimensions — layout constraints.
  ...reviewedConstants("lib/messenger-ui/src/MessengerNavIcon.tsx", {
    MIN_W: "320",
    MIN_H: "280",
  }),
  // Notification and toast auto-dismiss durations — UI presentation.
  ...reviewedConstants("lib/messenger-ui/src/MessengerNotification.tsx", {
    AUTO_DISMISS_MS: "8_000",
  }),
  ...reviewedConstants("lib/messenger-ui/src/MessengerToast.tsx", {
    AUTO_DISMISS_MS: "5_000",
  }),

  // ---- lib/upload-validation ----
  // Decompression-bomb pixel limit, storage dimension cap, and Sharp concurrency.
  ...reviewedConstants("lib/upload-validation/src/index.ts", {
    MAX_INPUT_PIXELS: "50_000_000",
    MAX_STORAGE_DIMENSION: "4096",
    MAX_CONCURRENT_IMAGE_TRANSFORMS: "2",
  }),

  // ---- lib/web-core ----
  // Stale-chunk reload cooldown — prevents reload loops after Vite preload errors.
  ...reviewedConstants("lib/web-core/src/mount-app.tsx", {
    STALE_CHUNK_RELOAD_COOLDOWN_MS: "10_000",
  }),

  // ---- artifacts/api-server/src/lib/ornaments/dimensions.ts ----
  // Defensive maximum for a stored display string from an AI/web-research
  // response. This is input sanitization, not a collection behavior or
  // owner-facing budget.
  ...reviewedConstants("artifacts/api-server/src/lib/ornaments/dimensions.ts", {
    MAX_DIMENSIONS_LENGTH: "100",
  }),

  // ---- scripts/src/github-sync.ts ----
  // Safety cap on bulk deletions per sync run — prevents runaway exclusion-list bugs.
  ...reviewedConstants(
    "scripts/src/github-sync.ts",
    {
      MAX_DELETIONS: "20",
    },
    "main",
  ),

  // ---- lib/image.ts (additional VTracer presets) ----
  // Additional named vectorization presets (smooth, crisp, high-detail, etc.).
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "DIRECTION_A_CRISP_TUNING",
    expression: `{
      flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
      textureSuppressSigma: 1.4,
      posterizeColors: 8,
      colorPrecision: 7,
      filterSpeckle: 2,
      spliceThreshold: 45,
      cornerThreshold: 50,
      layerDifference: 4,
      lengthThreshold: 4,
    }`,
  },
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "DIRECTION_A_THREE_PASS_TUNING",
    expression: `{
      flatFieldSigmas: [
        FLAT_FIELD_BLUR_SIGMA,
        FLAT_FIELD_V3_SECOND_PASS_SIGMA,
        FLAT_TILE_SIZE * 0.9,
      ],
      textureSuppressSigma: TEXTURE_SUPPRESS_SIGMA,
      posterizeColors: POSTERIZE_COLORS,
      colorPrecision: 6,
      filterSpeckle: 4,
      spliceThreshold: 45,
      cornerThreshold: 60,
      layerDifference: 5,
      lengthThreshold: 5,
    }`,
  },
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "DIRECTION_A_ULTRA_SMOOTH_TUNING",
    expression: `{
      flatFieldSigmas: [
        FLAT_FIELD_BLUR_SIGMA,
        FLAT_FIELD_V3_SECOND_PASS_SIGMA,
        FLAT_TILE_SIZE * 0.9,
      ],
      textureSuppressSigma: 4.5,
      posterizeColors: 4,
      colorPrecision: 4,
      filterSpeckle: 8,
      spliceThreshold: 60,
      cornerThreshold: 90,
      layerDifference: 10,
      lengthThreshold: 8,
    }`,
  },
  {
    file: "artifacts/api-server/src/lib/image.ts",
    kind: "cluster",
    scope: "file-scope",
    symbol: "DIRECTION_A_MAX_DETAIL_TUNING",
    expression: `{
      flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
      textureSuppressSigma: 0.6,
      posterizeColors: 12,
      colorPrecision: 8,
      filterSpeckle: 1,
      spliceThreshold: 30,
      cornerThreshold: 35,
      layerDifference: 2,
      lengthThreshold: 3,
    }`,
  },

  // ---- routes/quilting/block-templates.ts ----
  // DB field-length validation limits for block template tags and names.
  ...reviewedConstants(
    "artifacts/api-server/src/routes/quilting/block-templates.ts",
    {
      MAX_TAGS: "20",
      MAX_TAG_LEN: "100",
      MAX_NAME_LEN: "120",
    },
  ),

  // ---- routes/quilting/compare.ts ----
  // Quilting compare extra-image and AI image fan-out cost guards.
  ...reviewedConstants("artifacts/api-server/src/routes/quilting/compare.ts", {
    MAX_EXTRA_IMAGES: "2",
    MAX_AI_IMAGES: "24",
  }),
  {
    file: "artifacts/api-server/src/elaine/index.ts",
    kind: "constant",
    scope: "file-scope",
    symbol: "MAX_PHONE_CODE_ATTEMPTS",
    // Unchanged OTP security bound, not an owner-facing feature setting.
    expression: "5",
  },
  {
    file: "artifacts/api-server/src/elaine/runtime/trace-store.ts",
    kind: "cluster",
    scope: "loadElaineTurnTracesForMessages",
    symbol: "usage",
    // Usage counters start at zero; elapsed time is derived from stored dates.
    expression: `{
      modelRounds: 0,
      toolCalls: 0,
      replans: 0,
      elapsedMs: row.completedAt
        ? Math.max(0, row.completedAt.getTime() - row.startedAt.getTime())
        : 0,
    }`,
  },
  {
    file: "artifacts/api-server/src/elaine/runtime/turn-runtime.ts",
    kind: "cluster",
    scope: "ElaineTurnRuntime.constructor",
    symbol: "usage",
    // Per-turn usage starts at zero, unlike configurable budget ceilings.
    expression: `{
      modelRounds: 0,
      toolCalls: 0,
      replans: 0,
      elapsedMs: 0,
    }`,
  },
];

function expressionTokens(expression: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    ts.LanguageVariant.Standard,
    expression,
  );
  const tokens: string[] = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push(scanner.getTokenText());
  }
  return JSON.stringify(tokens);
}

function declarationScope(node: ts.Node): string {
  const scopes: string[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) {
      scopes.push(parent.name?.text ?? "anonymous-function");
    } else if (ts.isArrowFunction(parent)) {
      // Action executors wrap their arrow in parentheses / a type assertion.
      let owner = parent.parent;
      while (ts.isParenthesizedExpression(owner) || ts.isAsExpression(owner)) {
        owner = owner.parent;
      }
      scopes.push(
        (ts.isVariableDeclaration(owner) || ts.isPropertyAssignment(owner)) &&
          ts.isIdentifier(owner.name)
          ? owner.name.text
          : "anonymous-function",
      );
    } else if (
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)
    ) {
      scopes.push(
        ts.isIdentifier(parent.name) ? parent.name.text : "anonymous-member",
      );
    } else if (ts.isConstructorDeclaration(parent)) {
      scopes.push("constructor");
    } else if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
      const owner = parent.parent;
      scopes.push(
        parent.name?.text ??
          ((ts.isPropertyAssignment(owner) ||
            ts.isVariableDeclaration(owner)) &&
          ts.isIdentifier(owner.name)
            ? owner.name.text
            : "anonymous-class"),
      );
    }
  }
  return scopes.reverse().join(".") || "file-scope";
}

/** Return only a complete initializer or a single object argument. */
function anchorTarget(
  node: ts.Node,
): { symbol: string; expression: ts.Expression; constant: boolean } | null {
  if (
    (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
    ts.isIdentifier(node.name) &&
    node.initializer
  ) {
    return {
      symbol: node.name.text,
      expression: node.initializer,
      constant:
        ts.isVariableDeclaration(node) &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0,
    };
  }
  const parent = node.parent;
  if (
    ts.isObjectLiteralExpression(node) &&
    (ts.isCallExpression(parent) || ts.isNewExpression(parent))
  ) {
    const index = parent.arguments?.indexOf(node) ?? -1;
    if (index >= 0) {
      return {
        symbol: `${ts.isNewExpression(parent) ? "new " : ""}${parent.expression.getText()}.arguments.${index}`,
        expression: node,
        constant: false,
      };
    }
  }
  return null;
}

function anchoredAllowlistRanges(
  file: string,
  content: string,
): Array<{
  kind: "constant" | "cluster";
  symbol: string;
  start: number;
  end: number;
}> {
  const entries = ANCHORED_CONFIG_ALLOWLIST.filter(
    (entry) => entry.file === file,
  );
  if (entries.length === 0) return [];
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const matches = new Map<
    ConfigAnchor,
    ReturnType<typeof anchoredAllowlistRanges>
  >();
  function visit(node: ts.Node): void {
    const target = anchorTarget(node);
    if (target) {
      for (const entry of entries) {
        if (
          (entry.kind !== "constant" || target.constant) &&
          target.symbol === entry.symbol &&
          declarationScope(node) === entry.scope &&
          expressionTokens(target.expression.getText(source)) ===
            expressionTokens(entry.expression)
        ) {
          const ranges = matches.get(entry) ?? [];
          ranges.push({
            kind: entry.kind,
            symbol: entry.symbol,
            start:
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1,
            end: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          });
          matches.set(entry, ranges);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  // An identical symbol/expression in another object or call is not an
  // additional review. Ambiguous anchors fail closed rather than hiding it.
  return [...matches.values()].flatMap((ranges) =>
    ranges.length === 1 ? ranges : [],
  );
}

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

    // An explicit custom allowlist replaces both default exception mechanisms.
    const anchoredRanges =
      allowlist === HARDCODED_CONFIG_ALLOWLIST
        ? anchoredAllowlistRanges(file, content)
        : [];
    const matchesAnchor = (
      kind: "cluster" | "constant",
      lines: number[],
      names: string[],
    ) =>
      anchoredRanges.some(
        (range) =>
          range.kind === kind &&
          (kind !== "constant" || names[0] === range.symbol) &&
          lines.every((line) => line >= range.start && line <= range.end),
      );

    for (const cluster of findTunableClustersInFile(content)) {
      const key = `${file}:${cluster.lines[0]}`;
      const allowlisted =
        allowlist.has(key) ||
        matchesAnchor("cluster", cluster.lines, cluster.names);
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
      const allowlisted =
        allowlist.has(key) ||
        matchesAnchor("constant", [constant.line], [constant.name]);
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
  "a file/scope/symbol/exact-expression entry to ANCHORED_CONFIG_ALLOWLIST",
  "in scripts/src/check-hardcoded-config.ts with a comment explaining why.",
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
