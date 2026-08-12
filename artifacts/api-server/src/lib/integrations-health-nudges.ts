/**
 * Proactive elAIne nudges for connected service health.
 *
 * TWO execution paths — use the right one for each context:
 *
 * ┌─ In-process scheduler (startIntegrationsHealthNudgeScheduler) ─────────┐
 * │  Runs every 30 minutes within the live web-server process.              │
 * │  Maintains _lastKnownStatus and _consecutiveErrorCount in memory.       │
 * │  A failure nudge fires only after 2 consecutive "error" readings (~30   │
 * │  minutes) so a single-interval network blip never triggers an alert.    │
 * │  On startup: primes the maps from a live health check (no nudges), then │
 * │  waits STARTUP_DELAY_MS before the first nudge-generating run so cold-  │
 * │  start timeouts don't look like genuine new failures.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Scheduled deployment (runScheduledIntegrationsHealthNudges) ──────────┐
 * │  One-shot cron run in a fresh process.                                  │
 * │  Persists per-service consecutive-error counts in the                   │
 * │  `integrations_health_state` DB table so the same two-strike gate       │
 * │  applies even across cold-start cron invocations.                       │
 * │  Failure nudge: fires on the 2nd consecutive error run.                 │
 * │  Recovery nudge: fires on the first ok run after a confirmed failure.   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * De-duplication strategy:
 *   failure key:  `integration_failure:<service>:<errorSlug>`
 *   recovery key: `integration_recovery:<service>:<YYYY-MM-DD>`
 *   batch key:    `integration_failure_batch:<YYYY-MM-DD>`
 *
 * The error slug is the first 60 characters of the error detail, normalised
 * to lowercase. A different slug (e.g. a new error type) generates a new key
 * and fires a new nudge even for a service with a prior failure row.
 */

import { pool, db, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  shouldRunScheduledTask,
  recordScheduledTaskSuccess,
  recordScheduledTaskFailure,
} from "./scheduler-guard";
import { runAllChecks } from "../routes/admin/integrations-health";
import type { ServiceCheckStatus } from "../routes/admin/integrations-health";

// ---------------------------------------------------------------------------
// In-process state: last known status per service name (in-process path only)
// ---------------------------------------------------------------------------
const _lastKnownStatus = new Map<string, ServiceCheckStatus>();

/**
 * Consecutive error count per service (in-process path only).
 *
 * A failure nudge is only emitted on the 2nd consecutive "error" reading so
 * that a single-interval network blip (all services timeout at once and
 * recover by the next run) never generates an alert. The counter is reset to
 * zero on any non-error result.
 *
 * Recovery nudges are only emitted when the count was ≥ 2 (i.e. a confirmed
 * failure that already generated a nudge) to avoid spurious "recovered" noise
 * for transient blips that were never reported as failures.
 */
const _consecutiveErrorCount = new Map<string, number>();

/** @internal Reset in-process state maps between tests. */
export function _resetTestState(): void {
  _lastKnownStatus.clear();
  _consecutiveErrorCount.clear();
}

// Max individual failure nudges before switching to a consolidated message.
const MAX_FAILURE_NUDGES_PER_RUN = 3;

// Startup delay (ms) between the priming run and the first nudge run.
const STARTUP_DELAY_MS = 90_000; // 90 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable, short string derived from an error message for use in a nudge key. */
function errorSlug(detail: string | undefined): string {
  if (!detail) return "unknown";
  return detail.trim().toLowerCase().slice(0, 60).replace(/\s+/g, "_");
}

/**
 * Normalise a service name for safe embedding in a comma-separated list.
 * Trims whitespace and replaces commas, newlines, and carriage returns with a
 * single space so a name like "Google, Maps" doesn't split the list or garble
 * the reader's count.
 */
function sanitiseServiceName(name: string): string {
  return name
    .trim()
    .replace(/[,\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Today as YYYY-MM-DD (UTC). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Apply the batch cap. If there are more than MAX_FAILURE_NUDGES_PER_RUN
 * candidates, replace them with a single consolidated daily nudge instead of
 * flooding the owner with individual messages. The consolidated key is date-
 * scoped (no count, no slug) so it deduplicates across multiple same-day runs.
 */
function capFailureNudges(
  failureCandidates: { nudgeKey: string; message: string; service: string }[],
): { nudgeKey: string; message: string }[] {
  if (failureCandidates.length <= MAX_FAILURE_NUDGES_PER_RUN) {
    return failureCandidates;
  }
  const count = failureCandidates.length;
  const names = failureCandidates.map((c) => sanitiseServiceName(c.service));
  const consolidatedKey = `integration_failure_batch:${todayUtc()}`;
  logger.info(
    { count, names, consolidatedKey },
    "integrations-health-nudges: capped batch — emitting consolidated nudge",
  );
  return [
    {
      nudgeKey: consolidatedKey,
      message: `⚠️ ${count} services are reporting errors (${names.join(", ")}). Check the Services panel for details.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Resolve owner ID (shared helper)
// ---------------------------------------------------------------------------

async function resolveOwnerId(): Promise<number | null> {
  const ownerRows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.isOwner, true))
    .limit(1);
  if (ownerRows.length === 0) {
    logger.info("integrations-health-nudges: no owner account found, skipping");
    return null;
  }
  return ownerRows[0]!.id;
}

// ---------------------------------------------------------------------------
// SCHEDULED-DEPLOYMENT PATH
//
// One-shot cron run in a fresh process. Persists per-service consecutive-error
// counts in `integrations_health_state` so the two-strike alert gate (≥ 2
// consecutive errors before a nudge) applies even across cold-start runs.
//
// Failure nudge:  fires on the 2nd consecutive error run for a service.
// Recovery nudge: fires on the first ok run after a confirmed failure
//                 (count ≥ 2), so the owner learns when things clear up.
// ---------------------------------------------------------------------------

export async function runScheduledIntegrationsHealthNudges(): Promise<void> {
  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "integrations-health-nudges: could not connect to DB");
    return null;
  });
  if (!client) return;

  try {
    const ownerId = await resolveOwnerId();
    if (ownerId === null) return;

    // Load persisted consecutive-error counts from the DB.
    const stateResult = await client.query<{
      service: string;
      consecutive_error_count: number;
    }>(
      `SELECT service, consecutive_error_count FROM integrations_health_state`,
    );
    const dbCounts = new Map(
      stateResult.rows.map((r) => [r.service, r.consecutive_error_count]),
    );

    const { checks } = await runAllChecks();

    const rawFailureCandidates: {
      nudgeKey: string;
      message: string;
      service: string;
    }[] = [];
    const otherCandidates: { nudgeKey: string; message: string }[] = [];
    const updatedCounts = new Map<string, number>();

    for (const check of checks) {
      const prevCount = dbCounts.get(check.service) ?? 0;

      if (check.status === "error") {
        const newCount = prevCount + 1;
        updatedCounts.set(check.service, newCount);

        // Fire a failure nudge only on the 2nd consecutive error reading so
        // a transient single-interval blip never generates an alert.
        if (newCount === 2) {
          const safeName = sanitiseServiceName(check.service);
          rawFailureCandidates.push({
            nudgeKey: `integration_failure:${check.service}:${errorSlug(check.detail)}`,
            message: `⚠️ ${safeName} is returning errors. Detail: ${check.detail ?? "unknown error"}. You may want to check the Services panel.`,
            service: check.service,
          });
        }
      } else {
        // Service is ok or missing_key.
        //
        // Recovery nudge: only when status is explicitly "ok" AND a confirmed
        // failure (prevCount ≥ 2) has cleared. "missing_key" means the secret
        // is absent — the service is not being monitored, not that it is healthy.
        // Emitting a recovery nudge for missing_key would misinform the owner.
        if (check.status === "ok" && prevCount >= 2) {
          const safeName = sanitiseServiceName(check.service);
          otherCandidates.push({
            nudgeKey: `integration_recovery:${check.service}:${todayUtc()}`,
            message: `✅ ${safeName} has recovered and is responding normally again.`,
          });
        }
        // Reset the consecutive-error counter regardless of whether the status is
        // "ok" or "missing_key": in both cases no error is being observed, so the
        // streak is broken. This avoids accumulating a stale count for a service
        // whose key is removed and later re-added.
        updatedCounts.set(check.service, 0);
      }
    }

    const candidates = [
      ...capFailureNudges(rawFailureCandidates),
      ...otherCandidates,
    ];

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

    // Persist updated consecutive-error counts so the next cron run can apply
    // the same two-strike gate without in-memory state.
    for (const [service, count] of updatedCounts) {
      await client.query(
        `INSERT INTO integrations_health_state (service, consecutive_error_count, last_updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (service) DO UPDATE SET
           consecutive_error_count = EXCLUDED.consecutive_error_count,
           last_updated_at         = NOW()`,
        [service, count],
      );
    }

    logger.info(
      {
        candidates: candidates.length,
        inserted,
        servicesChecked: checks.length,
      },
      "integrations-health-nudges (scheduled): run complete",
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// IN-PROCESS PATH — transition detection
//
// Uses _lastKnownStatus for ok→error and error→ok transition detection.
// Requires a priming run before the first nudge-generating run.
// ---------------------------------------------------------------------------

/**
 * Run all health checks and store results in the in-process state maps WITHOUT
 * generating any nudges. Primes _lastKnownStatus and _consecutiveErrorCount so
 * the next nudge run only fires for genuinely new transitions.
 *
 * Loads persisted consecutive-error counts from `integrations_health_state` so
 * a server restart inherits the accumulated outage state:
 *   - Error service with DB count ≥ 2  → primed to DB count (confirmed failure
 *     preserved; the next run may immediately emit a recovery nudge if the
 *     service clears, and will not re-emit a duplicate failure alert).
 *   - Error service with DB count 0–1  → primed to max(1, dbCount) (one error
 *     reading already seen; the next error run reaches 2 and fires the alert).
 *   - Ok/missing service               → primed to 0.
 *
 * Safe to call fire-and-forget — never throws.
 */
export async function primeLastKnownStatus(): Promise<void> {
  try {
    // Load persisted consecutive-error counts from DB. If the DB is unavailable
    // or the table is empty the counts stay at their defaults (0 or 1 below),
    // which is safe — just slightly less accurate on the first post-restart run.
    let dbCounts = new Map<string, number>();
    const stateClient = await pool.connect().catch(() => null);
    if (stateClient) {
      try {
        const stateResult = await stateClient.query<{
          service: string;
          consecutive_error_count: number;
        }>(
          `SELECT service, consecutive_error_count FROM integrations_health_state`,
        );
        dbCounts = new Map(
          stateResult.rows.map((r) => [r.service, r.consecutive_error_count]),
        );
      } catch {
        // DB read failure is non-fatal — fallback to defaults.
      } finally {
        stateClient.release();
      }
    }

    const { checks } = await runAllChecks();
    for (const check of checks) {
      _lastKnownStatus.set(check.service, check.status);
      if (check.status === "error") {
        const dbCount = dbCounts.get(check.service) ?? 0;
        // Inherit DB count to preserve confirmed-failure state (count ≥ 2)
        // across restarts; ensure at least 1 so the very next error reading
        // reaches count 2 and fires the alert.
        _consecutiveErrorCount.set(check.service, Math.max(1, dbCount));
      } else {
        _consecutiveErrorCount.set(check.service, 0);
      }
    }
    logger.info(
      { services: checks.length },
      "integrations-health-nudges: state maps primed from live health checks",
    );
  } catch (err) {
    logger.warn(
      { err },
      "integrations-health-nudges: priming run failed (non-fatal)",
    );
  }
}

export async function computeAndStoreIntegrationsHealthNudges(): Promise<void> {
  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "integrations-health-nudges: could not connect to DB");
    return null;
  });
  if (!client) return;

  try {
    const ownerId = await resolveOwnerId();
    if (ownerId === null) return;

    const { checks } = await runAllChecks();

    const rawFailureCandidates: {
      nudgeKey: string;
      message: string;
      service: string;
    }[] = [];
    const otherCandidates: { nudgeKey: string; message: string }[] = [];
    // Track the new count for every service so we can persist it to DB below.
    const updatedCounts = new Map<string, number>();

    for (const check of checks) {
      const curr = check.status;
      const prevCount = _consecutiveErrorCount.get(check.service) ?? 0;

      if (curr === "error") {
        const newCount = prevCount + 1;
        _consecutiveErrorCount.set(check.service, newCount);
        updatedCounts.set(check.service, newCount);

        // Only fire a failure nudge on the 2nd consecutive error reading.
        // A single-interval blip (count reaches 1 then recovers) produces no
        // alert; a genuine sustained outage (count reaches 2) does.
        if (newCount === 2) {
          const safeName = sanitiseServiceName(check.service);
          rawFailureCandidates.push({
            nudgeKey: `integration_failure:${check.service}:${errorSlug(check.detail)}`,
            message: `⚠️ ${safeName} is returning errors. Detail: ${check.detail ?? "unknown error"}. You may want to check the Services panel.`,
            service: check.service,
          });
        }
      } else {
        // Service is ok or missing_key.
        //
        // Recovery nudge: only when status is explicitly "ok" AND a confirmed
        // failure (prevCount ≥ 2) has cleared. "missing_key" means the required
        // secret is absent — the service is not being monitored, not that it is
        // healthy. Emitting a recovery nudge for missing_key would misinform the
        // owner and discard confirmed-outage state when configuration is broken.
        if (check.status === "ok" && prevCount >= 2) {
          const safeName = sanitiseServiceName(check.service);
          otherCandidates.push({
            nudgeKey: `integration_recovery:${check.service}:${todayUtc()}`,
            message: `✅ ${safeName} has recovered and is responding normally again.`,
          });
        }
        // Reset the consecutive-error counter regardless of "ok" vs "missing_key":
        // in both cases no error is observed, so the streak is broken. This avoids
        // accumulating a stale count for a service whose key is removed and later
        // re-added.
        _consecutiveErrorCount.set(check.service, 0);
        updatedCounts.set(check.service, 0);
      }

      _lastKnownStatus.set(check.service, curr);
    }

    const candidates = [
      ...capFailureNudges(rawFailureCandidates),
      ...otherCandidates,
    ];

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

    // Persist updated consecutive-error counts to DB so they survive a server
    // restart. Both the in-process and scheduled paths share the same
    // `integrations_health_state` table as the authoritative state source;
    // primeLastKnownStatus() reads it on startup to inherit accumulated counts.
    // Concurrent in-process / scheduled writes are last-write-wins; the overlap
    // window is small and both paths derive counts from the same DB snapshot, so
    // this is acceptable.
    for (const [service, count] of updatedCounts) {
      await client.query(
        `INSERT INTO integrations_health_state (service, consecutive_error_count, last_updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (service) DO UPDATE SET
           consecutive_error_count = EXCLUDED.consecutive_error_count,
           last_updated_at         = NOW()`,
        [service, count],
      );
    }

    if (candidates.length === 0) {
      logger.info("integrations-health-nudges: no nudge candidates this run");
    } else {
      logger.info(
        { candidates: candidates.length, inserted },
        "integrations-health-nudges: run complete",
      );
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// IN-PROCESS SCHEDULER
// ---------------------------------------------------------------------------

const IN_PROCESS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Best-effort in-process fallback scheduler — same pattern as
 * `lib/travels-nudges.ts`. Pair with a Replit Scheduled Deployment run of
 * `scripts/send-reminder-alerts.ts` for reliable delivery when the server
 * instance is asleep.
 *
 * Returns a cleanup function that cancels both the startup timeout and the
 * recurring interval.
 */
export function startIntegrationsHealthNudgeScheduler(): () => void {
  let stopped = false;
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;

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
      await recordScheduledTaskSuccess("integrations-health-nudges");
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "integrations-health-nudges: run failed",
      );
      recordScheduledTaskFailure("integrations-health-nudges");
    }
  };

  // Prime _lastKnownStatus from live checks, then schedule the first nudge run
  // after STARTUP_DELAY_MS. The `stopped` guard ensures cleanup called before
  // the priming promise resolves doesn't leak a deferred timer.
  void primeLastKnownStatus().then(() => {
    if (stopped) return;
    logger.info(
      { delayMs: STARTUP_DELAY_MS },
      "integrations-health-nudges: first nudge run deferred (startup delay)",
    );
    startupTimeout = setTimeout(() => {
      startupTimeout = null;
      void run();
    }, STARTUP_DELAY_MS);
  });

  const interval = setInterval(() => void run(), IN_PROCESS_INTERVAL_MS);
  interval.unref();

  logger.info(
    "integrations-health-nudges: started (in-process fallback, runs every 30 minutes)",
  );

  return () => {
    stopped = true;
    if (startupTimeout !== null) {
      clearTimeout(startupTimeout);
      startupTimeout = null;
    }
    clearInterval(interval);
  };
}
