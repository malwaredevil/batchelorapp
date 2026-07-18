import { db, appConfig } from "@workspace/db";
import { eq, and, notInArray, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * App-wide configurable constants stored in `app_config` (key/value store,
 * keyed by module + key). All values are TEXT in the DB and parsed to the
 * expected type at call time.
 *
 * Pattern:
 *  - Hardcoded DEFAULTS live here; they are seeded into the DB the first time
 *    the service starts so they appear in the admin Control Panel UI.
 *  - An admin (isOwner) can override any row via PUT /api/config/:module/:key.
 *  - A 30-second in-memory cache keeps per-request DB round-trips negligible.
 *
 * NOT for security-critical limits (webhook body caps, rate-limit thresholds,
 * per-request batch-size safety caps) — those must stay hardcoded.
 */

export interface AppConfigDefault {
  module: string;
  key: string;
  value: string;
  type: "string" | "integer" | "float" | "boolean";
  label: string;
  description?: string;
}

export const APP_CONFIG_DEFAULTS: AppConfigDefault[] = [
  // ── web_search ────────────────────────────────────────────────────────────
  {
    module: "web_search",
    key: "search_timeout_ms",
    value: "15000",
    type: "integer",
    label: "Web search timeout (ms)",
    description:
      "AbortController timeout for Perplexity Sonar web-search calls via OpenRouter.",
  },

  // ── openrouter ────────────────────────────────────────────────────────────
  {
    module: "openrouter",
    key: "request_timeout_ms",
    value: "12000",
    type: "integer",
    label: "OpenRouter per-request timeout (ms)",
    description:
      "Timeout applied to every OpenRouter API call (chat, vision, embeddings). " +
      "Must stay well under the reverse proxy's ~30s hard limit. The singleton client " +
      "is rebuilt automatically when this value changes.",
  },
  {
    module: "openrouter",
    key: "model_fetch_timeout_ms",
    value: "8000",
    type: "integer",
    label: "OpenRouter model list fetch timeout (ms)",
    description:
      "AbortController timeout when fetching the OpenRouter model catalogue for the admin UI.",
  },
  {
    module: "openrouter",
    key: "model_list_cache_ttl_ms",
    value: "3600000",
    type: "integer",
    label: "OpenRouter model list cache TTL (ms)",
    description:
      "How long to keep the OpenRouter model catalogue in-memory (default 1 h).",
  },

  // ── ornaments ─────────────────────────────────────────────────────────────
  {
    module: "ornaments",
    key: "barcode_fetch_timeout_ms",
    value: "8000",
    type: "integer",
    label: "Barcode lookup fetch timeout (ms)",
    description: "AbortController timeout for UPCitemdb barcode lookup calls.",
  },
  {
    module: "ornaments",
    key: "upcitemdb_trial_url",
    value: "https://api.upcitemdb.com/prod/trial/lookup",
    type: "string",
    label: "UPCitemdb trial endpoint URL",
    description:
      "UPCitemdb free-tier lookup endpoint used when UPCITEMDB_USER_KEY is not set. Override to swap providers.",
  },
  {
    module: "ornaments",
    key: "upcitemdb_paid_url",
    value: "https://api.upcitemdb.com/prod/v1/lookup",
    type: "string",
    label: "UPCitemdb paid endpoint URL",
    description:
      "UPCitemdb paid/pro lookup endpoint used when UPCITEMDB_USER_KEY is set.",
  },

  // ── quilting ─────────────────────────────────────────────────────────────
  {
    module: "quilting",
    key: "color_suggestion_max_tokens",
    value: "200",
    type: "integer",
    label: "Colour suggestion AI max tokens",
    description:
      "max_tokens cap for the fabric colour-suggestion vision call (quilting tools).",
  },
  {
    module: "quilting",
    key: "pattern_import_max_tokens",
    value: "400",
    type: "integer",
    label: "Pattern import AI max tokens",
    description:
      "max_tokens cap for the quilting pattern-import AI extraction call.",
  },

  // ── travels ───────────────────────────────────────────────────────────────
  {
    module: "travels",
    key: "doc_type_suggestion_max_tokens",
    value: "400",
    type: "integer",
    label: "Document type suggestion AI max tokens",
    description:
      "max_tokens cap for the AI call that suggests a custom document type name.",
  },
  {
    module: "travels",
    key: "packing_ai_max_tokens",
    value: "1000",
    type: "integer",
    label: "Packing list AI max tokens",
    description: "max_tokens cap for AI-generated packing list suggestions.",
  },
  {
    module: "travels",
    key: "itinerary_gen_max_tokens",
    value: "4000",
    type: "integer",
    label: "Itinerary generation AI max tokens",
    description: "max_tokens cap for AI-generated day-by-day itinerary plans.",
  },
  {
    module: "travels",
    key: "place_activities_max_tokens",
    value: "2000",
    type: "integer",
    label: "Place activities AI max tokens",
    description:
      "max_tokens cap for AI-generated destination activity suggestions.",
  },
  {
    module: "travels",
    key: "place_summary_max_tokens",
    value: "300",
    type: "integer",
    label: "Place summary AI max tokens",
    description: "max_tokens cap for brief AI-generated destination summaries.",
  },
  {
    module: "travels",
    key: "explore_overview_max_tokens",
    value: "600",
    type: "integer",
    label: "Explore destination overview AI max tokens",
    description:
      "max_tokens cap for the AI-generated explore-mode destination overview paragraph.",
  },
  {
    module: "travels",
    key: "full_itinerary_max_tokens",
    value: "3000",
    type: "integer",
    label: "Full itinerary text AI max tokens",
    description:
      "max_tokens cap for the full AI-generated itinerary text block.",
  },

  // ── quilting (reranker) ───────────────────────────────────────────────────────
  {
    module: "quilting",
    key: "reranker_timeout_ms",
    value: "10000",
    type: "integer",
    label: "Voyage reranker timeout (ms)",
    description:
      "AbortSignal.timeout value for Voyage AI rerank calls (fabric Compare).",
  },
];

// ── Cache ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;

/**
 * How long to wait before re-attempting bootstrapDefaults() after a transient
 * DB connectivity failure ('warn' status).  60 s is long enough to avoid
 * hammering a recovering DB, but short enough that a cold-start with a briefly
 * unavailable Supabase connection self-heals within the first minute of traffic.
 *
 * NOT used for 'error' status (unexpected JS bugs) — those require a code fix
 * and a restart, so we don't retry them automatically.
 */
const BOOTSTRAP_RETRY_MS = 60_000;

let _cache: {
  rows: (typeof appConfig.$inferSelect)[];
  expiresAt: number;
} | null = null;

/**
 * Controls when bootstrapDefaults() will next be attempted.
 *
 * - `0`        — initial state; bootstrap runs on the very first getAllRows() call.
 * - `Infinity` — bootstrap completed ('success' or non-retryable 'error'); never retry.
 * - future ts  — bootstrap returned 'warn' (transient DB error); retry once this
 *               timestamp has elapsed.  The next getAllRows() call after a cache
 *               miss that finds Date.now() >= _bootstrapRetryAfter will re-run
 *               bootstrapDefaults() and, on success, flip to Infinity.
 */
let _bootstrapRetryAfter = 0;
let _bootstrappedAt: Date | null = null;

/** Tracks whether the last bootstrapDefaults() call completed successfully. */
let _bootstrapStatus: "pending" | "success" | "warn" | "error" = "pending";

/**
 * Returns the outcome of the most recent bootstrapDefaults() run.
 *
 * - "pending" — bootstrap has not run yet (server just started)
 * - "success" — all three steps completed without error
 * - "warn"    — a DB/connectivity error was swallowed (non-fatal at startup)
 * - "error"   — an unexpected JS error occurred; stale labels or missing
 *               defaults may persist until the next successful restart
 */
export function getBootstrapStatus(): "pending" | "success" | "warn" | "error" {
  return _bootstrapStatus;
}

export function invalidateConfigCache(): void {
  _cache = null;
}

// ── Bootstrap helpers ──────────────────────────────────────────────────────

/** Returns the timestamp of the most recent successful bootstrapDefaults() run, or null if not yet run. */
export function getBootstrappedAt(): Date | null {
  return _bootstrappedAt;
}

/**
 * Pure predicate: returns true when an existing DB row's label or description
 * has drifted from what APP_CONFIG_DEFAULTS now declares.
 *
 * Exported so it can be unit-tested independently of the database layer.
 * The Drizzle WHERE clause in Step 3 is built from this same logic, so any
 * regression in the predicate (e.g. accidentally swapping != for ==) will be
 * caught by the bootstrap test suite before it can silently persist stale
 * metadata in the admin Control Panel.
 */
export function rowNeedsLabelSync(
  row: { label: string; description: string | null },
  d: AppConfigDefault,
): boolean {
  if (row.label !== d.label) return true;
  if (d.description !== undefined) return row.description !== d.description;
  return row.description !== null;
}

/**
 * Returns the scheduled next retry time for bootstrapDefaults() when the
 * server is in 'warn' state, or null when no retry is pending (i.e. status
 * is 'success', 'error', or 'pending').
 */
export function getBootstrapRetryAt(): Date | null {
  if (
    _bootstrapRetryAfter === 0 ||
    _bootstrapRetryAfter === Infinity ||
    !isFinite(_bootstrapRetryAfter)
  ) {
    return null;
  }
  return new Date(_bootstrapRetryAfter);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Seed defaults, prune orphans, and keep metadata current in a single pass:
 *
 * 1. DELETE any `app_config` rows whose (module, key) pair no longer has a
 *    matching entry in APP_CONFIG_DEFAULTS.  These rows were seeded by a
 *    previous call to this function but became orphaned when a developer
 *    renamed or removed the corresponding `getConfig` call.  Without this
 *    step they linger in the DB and show up as stale rows in the admin
 *    Control Panel.
 *
 * 2. INSERT all current defaults with ON CONFLICT DO NOTHING so every live
 *    key appears in the admin UI on first startup and admin overrides (value)
 *    are never clobbered on restart.
 *
 * 3. UPDATE any existing rows whose `label` or `description` have drifted
 *    from APP_CONFIG_DEFAULTS — e.g. when a developer renames a label in
 *    code. The admin-controlled `value` field is intentionally left untouched
 *    so customised settings survive restarts.
 */
/**
 * Returns true when the error looks like a DB connectivity or driver-level
 * failure rather than an unexpected JavaScript error.  These are safe to
 * swallow at startup (the server can still serve requests using hardcoded
 * fallbacks), whereas unexpected errors indicate a code bug that should be
 * visible in the logs.
 *
 * Recognised patterns:
 *  - Node.js network errors: `code` matching /^E[A-Z_]+$/ (ECONNREFUSED, etc.)
 *  - PostgreSQL SQLSTATE codes: 5-char alphanumeric (e.g. "08006", "57P03")
 *  - Common message substrings from pg / Drizzle connectivity failures
 */
function isDbOrConnectivityError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (typeof e.code === "string") {
    if (/^E[A-Z_]+$/.test(e.code)) return true;
    if (/^[0-9][0-9A-Z]{4}$/.test(e.code)) return true;
  }
  if (
    typeof e.message === "string" &&
    /connect|ECONNREF|timeout|terminated|ssl|auth|password|socket/i.test(
      e.message,
    )
  ) {
    return true;
  }
  return false;
}

async function bootstrapDefaults(): Promise<void> {
  try {
    // Step 1 — prune orphaned rows
    if (APP_CONFIG_DEFAULTS.length > 0) {
      const validCompositeKeys = APP_CONFIG_DEFAULTS.map(
        (d) => `${d.module}::${d.key}`,
      );

      // Warn about any rows that are about to be pruned so the deletion is
      // visible in server logs rather than happening silently.
      const orphanedRows = await db
        .select({ module: appConfig.module, key: appConfig.key })
        .from(appConfig)
        .where(
          notInArray(
            sql`(${appConfig.module} || '::' || ${appConfig.key})`,
            validCompositeKeys,
          ),
        );
      if (orphanedRows.length > 0) {
        for (const row of orphanedRows) {
          logger.warn(
            { module: row.module, key: row.key },
            "app-config: orphaned DB row (no matching APP_CONFIG_DEFAULTS entry) — will be pruned",
          );
        }
      }

      await db
        .delete(appConfig)
        .where(
          notInArray(
            sql`(${appConfig.module} || '::' || ${appConfig.key})`,
            validCompositeKeys,
          ),
        );
    }

    // Step 2 — seed missing defaults
    await db
      .insert(appConfig)
      .values(
        APP_CONFIG_DEFAULTS.map((d) => ({
          module: d.module,
          key: d.key,
          value: d.value,
          type: d.type,
          label: d.label,
          description: d.description ?? null,
        })),
      )
      .onConflictDoNothing();

    // Step 3: sync stale label / description on existing rows.
    // Pre-fetch current rows into a Map so the drift check runs in JS rather
    // than inside a SQL WHERE clause.  This keeps rowNeedsLabelSync() testable
    // as a pure function and limits UPDATEs to entries that actually drifted —
    // the admin-controlled `value` column is never touched.
    const currentRows = await db.select().from(appConfig);
    const rowMap = new Map(
      currentRows.map((r) => [`${r.module}::${r.key}`, r]),
    );

    const updates = APP_CONFIG_DEFAULTS.filter((d) => {
      const current = rowMap.get(`${d.module}::${d.key}`);
      return current !== undefined && rowNeedsLabelSync(current, d);
    }).map((d) =>
      db
        .update(appConfig)
        .set({ label: d.label, description: d.description ?? null })
        .where(and(eq(appConfig.module, d.module), eq(appConfig.key, d.key))),
    );

    await Promise.all(updates);

    // Step 4: clear customisedAt for any row whose stored value now matches the
    // current default. This covers the case where a developer changed a default
    // in APP_CONFIG_DEFAULTS to match an admin's previously-customised value —
    // without this pass, customisedAt would remain non-null and the "customised"
    // badge would persist even though the row is no longer diverged from code.
    const clearCustomised = APP_CONFIG_DEFAULTS.map((d) =>
      db
        .update(appConfig)
        .set({ customisedAt: null })
        .where(
          and(
            eq(appConfig.module, d.module),
            eq(appConfig.key, d.key),
            eq(appConfig.value, d.value),
          ),
        ),
    );

    await Promise.all(clearCustomised);
    _bootstrappedAt = new Date();
    _bootstrapStatus = "success";
  } catch (err) {
    if (isDbOrConnectivityError(err)) {
      logger.warn(
        { err },
        "app-config: bootstrap defaults failed — DB unavailable at startup (non-fatal, using hardcoded fallbacks)",
      );
      _bootstrapStatus = "warn";
    } else {
      logger.error(
        { err },
        "app-config: bootstrap defaults failed with unexpected error — stale labels, orphaned rows, or missing defaults may persist until next restart",
      );
      _bootstrapStatus = "error";
    }
  }
}

// ── Internal read ─────────────────────────────────────────────────────────

/**
 * Reconcile customisedAt against the live DB values after every cache miss.
 *
 * bootstrapDefaults() Step 4 clears customisedAt at startup, but a direct-DB
 * edit (e.g. via the Supabase console) bypasses the PUT handler and therefore
 * bypasses both bootstrapDefaults() and updateConfigValue().  That can leave
 * customisedAt in one of two inconsistent states:
 *
 *   • Value reset to default in the DB but customisedAt still non-null
 *     → Control Panel badge shows "customised" even though the row is at its
 *       default — false positive.
 *
 *   • Value changed in the DB but customisedAt left null
 *     → Control Panel badge shows no "customised" indicator even though the
 *       row diverges from the hardcoded default — false negative.
 *
 * This function detects both cases by comparing each freshly-loaded row's
 * value against APP_CONFIG_DEFAULTS and fires UPDATE statements for any rows
 * that need correction.  It is called fire-and-forget on every cache miss so
 * the badge self-heals within one CACHE_TTL_MS (30 s) without requiring a
 * server restart.  The cache is invalidated after any fix so the corrected
 * customisedAt value is visible on the very next request.
 *
 * NOTE: This covers the common "admin edits a value in Supabase" path.  The
 * only scenario it cannot handle is a direct-DB edit AND a read that lands in
 * the same 30-second cache window before this reconciliation completes — in
 * that window the badge may still be stale.  This is an accepted limitation;
 * the alternative (no caching / polling) would be disproportionately expensive
 * for a low-frequency admin surface.
 */
async function reconcileCustomisedAt(
  rows: (typeof appConfig.$inferSelect)[],
): Promise<void> {
  try {
    const now = new Date();
    const fixes = rows.flatMap((row) => {
      const def = APP_CONFIG_DEFAULTS.find(
        (d) => d.module === row.module && d.key === row.key,
      );
      if (!def) return [];

      const isAtDefault = row.value === def.value;

      if (isAtDefault && row.customisedAt !== null) {
        // Direct-DB edit reset the value to the default but left customisedAt
        // set — clear it so the "customised" badge goes away.
        logger.info(
          { module: row.module, key: row.key },
          "app-config: clearing stale customisedAt (value matches default, set via direct DB edit)",
        );
        return [
          db
            .update(appConfig)
            .set({ customisedAt: null })
            .where(
              and(eq(appConfig.module, row.module), eq(appConfig.key, row.key)),
            ),
        ];
      }

      if (!isAtDefault && row.customisedAt === null) {
        // Direct-DB edit changed the value away from the default but left
        // customisedAt null — set it so the "customised" badge appears.
        logger.info(
          { module: row.module, key: row.key, value: row.value },
          "app-config: setting missing customisedAt (value differs from default, set via direct DB edit)",
        );
        return [
          db
            .update(appConfig)
            .set({ customisedAt: now })
            .where(
              and(eq(appConfig.module, row.module), eq(appConfig.key, row.key)),
            ),
        ];
      }

      return [];
    });

    if (fixes.length > 0) {
      await Promise.all(fixes);
      // Invalidate so the next request fetches the corrected customisedAt
      // values from the DB rather than serving the pre-fix cached rows.
      invalidateConfigCache();
    }
  } catch (err) {
    logger.warn(
      { err },
      "app-config: reconcileCustomisedAt failed (non-fatal)",
    );
  }
}

async function getAllRows(): Promise<(typeof appConfig.$inferSelect)[]> {
  if (_cache && _cache.expiresAt > Date.now()) {
    return _cache.rows;
  }

  if (Date.now() >= _bootstrapRetryAfter) {
    await bootstrapDefaults();
    if (_bootstrapStatus === "success") {
      // Clean run — lock bootstrap permanently (don't retry on every cache miss).
      _bootstrapRetryAfter = Infinity;
    } else if (_bootstrapStatus === "warn") {
      // Transient DB connectivity failure — schedule a retry after 60 s so the
      // server self-heals once the DB comes back, without hammering it.
      _bootstrapRetryAfter = Date.now() + BOOTSTRAP_RETRY_MS;
    } else {
      // 'error' — unexpected JS bug, not a transient DB issue.  Requires a code
      // fix + restart; don't retry automatically.
      _bootstrapRetryAfter = Infinity;
    }
  }

  const rows = await db
    .select()
    .from(appConfig)
    .orderBy(appConfig.module, appConfig.key);

  _cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };

  // Fire-and-forget: reconcile customisedAt in the background so the badge
  // self-heals after direct-DB edits within one cache window (see JSDoc above).
  void reconcileCustomisedAt(rows);

  return rows;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Read a single config value. Falls back to `defaultValue` if the row
 * doesn't exist or if parsing fails. The type of `defaultValue` drives
 * how the stored TEXT is coerced.
 */
export async function getConfig(
  module: string,
  key: string,
  defaultValue: number,
): Promise<number>;
export async function getConfig(
  module: string,
  key: string,
  defaultValue: string,
): Promise<string>;
export async function getConfig(
  module: string,
  key: string,
  defaultValue: boolean,
): Promise<boolean>;
export async function getConfig(
  module: string,
  key: string,
  defaultValue: number | string | boolean,
): Promise<number | string | boolean> {
  try {
    const rows = await getAllRows();
    const row = rows.find((r) => r.module === module && r.key === key);
    if (!row) return defaultValue;

    if (typeof defaultValue === "number") {
      const parsed = parseFloat(row.value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    if (typeof defaultValue === "boolean") {
      return row.value === "true";
    }
    return row.value;
  } catch {
    return defaultValue;
  }
}

/**
 * Return config rows, optionally filtered to a single module.
 * Used by the admin UI (no filter → all rows; with filter → one module).
 */
export async function getAllConfig(
  module?: string,
): Promise<(typeof appConfig.$inferSelect)[]> {
  const rows = await getAllRows();
  return module ? rows.filter((r) => r.module === module) : rows;
}

/**
 * Validate a candidate string value against the stored `type` for a config row.
 * Returns `null` on success, or an error message string on failure.
 *
 * Rules:
 *  - integer : must parse as a whole number (no decimal), must be >= 0
 *  - float   : must parse as a valid finite number, must be >= 0
 *  - boolean : must be exactly "true" or "false"
 *  - string  : any non-empty string is accepted
 */
export function validateConfigValue(
  type: AppConfigDefault["type"],
  value: string,
): string | null {
  switch (type) {
    case "integer": {
      if (!/^[0-9]+$/.test(value.trim())) {
        return `Value must be a non-negative integer (got "${value}")`;
      }
      const n = Number(value.trim());
      if (!Number.isFinite(n) || n < 0) {
        return `Value must be a non-negative integer (got "${value}")`;
      }
      return null;
    }
    case "float": {
      const trimmed = value.trim();
      const n = Number(trimmed);
      if (trimmed === "" || isNaN(n) || !Number.isFinite(n)) {
        return `Value must be a valid number (got "${value}")`;
      }
      if (n < 0) {
        return `Value must be non-negative (got "${value}")`;
      }
      return null;
    }
    case "boolean": {
      if (value !== "true" && value !== "false") {
        return `Value must be "true" or "false" (got "${value}")`;
      }
      return null;
    }
    case "string":
    default:
      return null;
  }
}

/**
 * Look up a single row from the cache (or DB) by module + key.
 * Returns null when the key does not exist.
 */
export async function getConfigRow(
  module: string,
  key: string,
): Promise<typeof appConfig.$inferSelect | null> {
  const rows = await getAllRows();
  return rows.find((r) => r.module === module && r.key === key) ?? null;
}

/** Update a single config value (owner-only, enforced in the route). */
export async function updateConfigValue(
  module: string,
  key: string,
  value: string,
): Promise<typeof appConfig.$inferSelect | null> {
  const def = APP_CONFIG_DEFAULTS.find(
    (d) => d.module === module && d.key === key,
  );
  // Set customised_at when the value deliberately differs from the default so
  // the Control Panel badge fires only for intentional overrides. Clear it
  // when the admin resets to the current default (value === def.value).
  const isResetToDefault = def !== undefined && value === def.value;
  const now = new Date();
  const [row] = await db
    .update(appConfig)
    .set({
      value,
      updatedAt: now,
      customisedAt: isResetToDefault ? null : now,
    })
    .where(and(eq(appConfig.module, module), eq(appConfig.key, key)))
    .returning();
  invalidateConfigCache();
  return row ?? null;
}
