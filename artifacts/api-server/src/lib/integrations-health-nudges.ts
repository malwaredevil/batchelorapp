/**
 * Proactive elAIne nudges for connected service health.
 *
 * TWO execution paths — use the right one for each context:
 *
 * ┌─ In-process scheduler (startIntegrationsHealthNudgeScheduler) ─────────┐
 * │  Runs every 30 minutes within the live web-server process.              │
 * │  Maintains _lastKnownStatus across runs for transition detection.       │
 * │  On startup: primes the map from a live health check (no nudges), then  │
 * │  waits STARTUP_DELAY_MS before the first nudge-generating run so cold-  │
 * │  start timeouts don't look like genuine new failures.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Scheduled deployment (runScheduledIntegrationsHealthNudges) ──────────┐
 * │  One-shot cron run in a fresh process (no in-memory state).            │
 * │  Stateless: runs health checks, inserts failure nudges for every        │
 * │  currently-failing service using stable per-error nudge keys.           │
 * │  ON CONFLICT DO NOTHING deduplicates nudges for already-known failures, │
 * │  and only fires for genuinely new ones. Recovery nudges are omitted     │
 * │  (the in-process scheduler handles error→ok transitions when warm).     │
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
import { shouldRunScheduledTask } from "./scheduler-guard";
import { runAllChecks } from "../routes/admin/integrations-health";
import type { ServiceCheckStatus } from "../routes/admin/integrations-health";

// ---------------------------------------------------------------------------
// In-process state: last known status per service name (in-process path only)
// ---------------------------------------------------------------------------
const _lastKnownStatus = new Map<string, ServiceCheckStatus>();

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
  const names = failureCandidates.map((c) => c.service);
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
// Stateless — safe to call from a fresh process that has no in-memory status
// history. Inserts failure nudges for all currently-failing services using
// stable per-error slug keys. ON CONFLICT DO NOTHING deduplicates nudges for
// failures the owner already knows about. Recovery nudges are omitted; the
// in-process scheduler handles error→ok transitions when the server is warm.
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

    const { checks } = await runAllChecks();

    // Build failure candidates for every currently-failing service.
    // No transition tracking — ON CONFLICT DO NOTHING handles dedup.
    const rawCandidates = checks
      .filter((c) => c.status === "error")
      .map((c) => ({
        nudgeKey: `integration_failure:${c.service}:${errorSlug(c.detail)}`,
        message: `⚠️ ${c.service} is returning errors. Detail: ${c.detail ?? "unknown error"}. You may want to check the Services panel.`,
        service: c.service,
      }));

    const candidates = capFailureNudges(rawCandidates);
    if (candidates.length === 0) {
      logger.info(
        "integrations-health-nudges (scheduled): no failing services, nothing to insert",
      );
      return;
    }

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
 * Run all health checks and store results in _lastKnownStatus WITHOUT
 * generating any nudges. Primes the transition-detection map so the next
 * nudge run only fires for genuinely new transitions (not every service that
 * happens to be in error when the server starts).
 *
 * Safe to call fire-and-forget — never throws.
 */
export async function primeLastKnownStatus(): Promise<void> {
  try {
    const { checks } = await runAllChecks();
    for (const check of checks) {
      _lastKnownStatus.set(check.service, check.status);
    }
    logger.info(
      { services: checks.length },
      "integrations-health-nudges: _lastKnownStatus primed from live health checks",
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

    for (const check of checks) {
      const prev = _lastKnownStatus.get(check.service);
      const curr = check.status;

      if (curr === "error" && prev !== "error") {
        rawFailureCandidates.push({
          nudgeKey: `integration_failure:${check.service}:${errorSlug(check.detail)}`,
          message: `⚠️ ${check.service} is returning errors. Detail: ${check.detail ?? "unknown error"}. You may want to check the Services panel.`,
          service: check.service,
        });
      }

      if (curr === "ok" && prev === "error") {
        otherCandidates.push({
          nudgeKey: `integration_recovery:${check.service}:${todayUtc()}`,
          message: `✅ ${check.service} has recovered and is responding normally again.`,
        });
      }

      _lastKnownStatus.set(check.service, curr);
    }

    const candidates = [
      ...capFailureNudges(rawFailureCandidates),
      ...otherCandidates,
    ];

    if (candidates.length === 0) {
      logger.info("integrations-health-nudges: no nudge candidates this run");
      return;
    }

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
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "integrations-health-nudges: run failed",
      );
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
