/**
 * Proactive elAIne nudges for connected service health.
 *
 * Runs every 30 minutes. On the first run where a service transitions from
 * ok → error, an elAIne nudge is inserted for the owner account. Repeated
 * failures for the same service + error produce no additional nudge
 * (ON CONFLICT DO NOTHING on the stable nudge key). When a service recovers
 * (error → ok), an optional recovery nudge is inserted.
 *
 * De-duplication strategy:
 *   failure key:  `integration_failure:<service>:<errorSlug>`
 *   recovery key: `integration_recovery:<service>:<YYYY-MM-DD>`
 *
 * The error slug is the first 60 characters of the error detail, normalised
 * to lowercase so minor wording changes don't trigger a new nudge for what
 * is effectively the same problem.
 *
 * In-process state (`_lastKnownStatus`) tracks per-service status across
 * runs so we can detect the ok→error and error→ok transitions. This map is
 * not persisted, so the very first run after a server start treats every
 * currently-failing service as a new failure and every ok service as a new
 * recovery (handled gracefully: failure nudge key is idempotent, recovery
 * nudge key is date-scoped so at most one fires per calendar day).
 */

import { pool, db, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { shouldRunScheduledTask } from "./scheduler-guard";
import { runAllChecks } from "../routes/admin/integrations-health";
import type { ServiceCheckStatus } from "../routes/admin/integrations-health";

// ---------------------------------------------------------------------------
// In-process state: last known status per service name
// ---------------------------------------------------------------------------
const _lastKnownStatus = new Map<string, ServiceCheckStatus>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable, short string derived from an error message for use in a nudge key. */
function errorSlug(detail: string | undefined): string {
  if (!detail) return "unknown";
  return detail.trim().toLowerCase().slice(0, 60).replace(/\s+/g, "_");
}

/** Today as YYYY-MM-DD (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Core job
// ---------------------------------------------------------------------------

export async function computeAndStoreIntegrationsHealthNudges(): Promise<void> {
  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "integrations-health-nudges: could not connect to DB");
    return null;
  });
  if (!client) return;

  try {
    // 1. Resolve the owner user ID.
    const ownerRows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.isOwner, true))
      .limit(1);
    if (ownerRows.length === 0) {
      logger.info(
        "integrations-health-nudges: no owner account found, skipping",
      );
      return;
    }
    const ownerId = ownerRows[0]!.id;

    // 2. Run all health checks (bypasses the HTTP cache — direct call).
    const { checks } = await runAllChecks();

    // 3. For each service, detect transitions and insert nudges.
    const candidates: { nudgeKey: string; message: string }[] = [];

    for (const check of checks) {
      const prev = _lastKnownStatus.get(check.service);
      const curr = check.status;

      // Transition into error: fire a nudge only on the first run where the
      // service is failing (prev was ok/missing_key/unknown, or this is the
      // first run with no prev state). If the service stays in error on
      // subsequent runs the nudge key is already in the DB, so ON CONFLICT
      // DO NOTHING handles the dedup even if error detail text changes.
      if (curr === "error" && prev !== "error") {
        const slug = errorSlug(check.detail);
        const failureKey = `integration_failure:${check.service}:${slug}`;
        const detail = check.detail ?? "unknown error";
        candidates.push({
          nudgeKey: failureKey,
          message: `⚠️ ${check.service} is returning errors. Detail: ${detail}. You may want to check the Services panel.`,
        });
      }

      // error → ok recovery (only when we have previous state to compare)
      if (curr === "ok" && prev === "error") {
        const recoveryKey = `integration_recovery:${check.service}:${todayUtc()}`;
        candidates.push({
          nudgeKey: recoveryKey,
          message: `✅ ${check.service} has recovered and is responding normally again.`,
        });
      }

      _lastKnownStatus.set(check.service, curr);
    }

    if (candidates.length === 0) {
      logger.info("integrations-health-nudges: no nudge candidates this run");
      return;
    }

    // 4. Bulk-insert nudges, ignoring duplicates via the unique (user_id, nudge_key) index.
    let inserted = 0;
    for (const { nudgeKey, message } of candidates) {
      const result = await client.query(
        `INSERT INTO elaine_nudges (user_id, source_app, nudge_key, message)
         VALUES ($1, 'admin', $2, $3)
         ON CONFLICT (user_id, nudge_key) DO NOTHING`,
        [ownerId, nudgeKey, message],
      );
      inserted += result.rowCount ?? 0;
    }

    logger.info(
      { candidates: candidates.length, inserted },
      "integrations-health-nudges: run complete",
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const IN_PROCESS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Best-effort in-process fallback scheduler — same pattern as
 * `lib/travels-nudges.ts`. Pair with a Replit Scheduled Deployment run of
 * `scripts/send-reminder-alerts.ts` for reliable delivery when the server
 * instance is asleep.
 */
export function startIntegrationsHealthNudgeScheduler(): () => void {
  const run = async (): Promise<void> => {
    if (
      !(await shouldRunScheduledTask(
        "integrations-health-nudges",
        IN_PROCESS_INTERVAL_MS,
      ))
    ) {
      logger.info(
        "integrations-health-nudges: skipped (ran within the last 30 minutes)",
      );
      return;
    }
    const t0 = Date.now();
    logger.info("integrations-health-nudges: run starting");
    try {
      await computeAndStoreIntegrationsHealthNudges();
      logger.info(
        { durationMs: Date.now() - t0 },
        "integrations-health-nudges: run complete",
      );
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "integrations-health-nudges: run failed",
      );
    }
  };

  void run();

  const interval = setInterval(() => void run(), IN_PROCESS_INTERVAL_MS);
  interval.unref();

  logger.info(
    "integrations-health-nudges: started (in-process fallback, runs every 30 minutes)",
  );
  return () => clearInterval(interval);
}
