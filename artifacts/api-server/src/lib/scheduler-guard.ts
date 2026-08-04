/**
 * Persisted last-run guard for in-process schedulers.
 *
 * Every in-process scheduler in this codebase (hallmark events scan, gmail
 * scan, calendar trip scan, travels nudges, reminders) fires an unconditional
 * `void run()` immediately on module load, with no check for whether it just
 * ran. During active development the API server workflow restarts on every
 * code change — sometimes dozens of times per hour — so each restart used to
 * re-trigger a full AI-calling run with zero cooldown. For schedulers that
 * call multiple AI models per run (web search + multi-model consensus, or an
 * AI classification pass over every connected calendar's event window) this
 * turned "restart the server 20 times while iterating" into "pay for 20 full
 * scans," which is how a single dev session can quietly burn a large AI
 * spend without any single request looking abusive on its own.
 *
 * shouldRunScheduledTask() closes that gap with an atomic, DB-persisted
 * "claim the run" check: it only returns true (permission to run) if the
 * last successful run for this task name was more than `minIntervalMs` ago,
 * and it updates the timestamp in the same statement so two racing calls
 * (e.g. two instances waking up at once) can't both claim the same run.
 * Persisting in Postgres — not in-process memory — is the whole point: it
 * must survive the exact restarts that caused the problem.
 */
import { sql } from "drizzle-orm";
import * as Sentry from "@sentry/node";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Sentry Cron Monitoring: Sentry's free/Developer plan allows exactly ONE
 * Cron Monitor for the whole organization (confirmed via the "Cron Monitors
 * budget consumed: 1/1" quota email after this originally shipped as one
 * monitor per scheduler — see startSchedulerHeartbeat below for the fix).
 * Per-taskName check-ins are intentionally NOT sent from here anymore; only
 * the single shared heartbeat monitor reports to Sentry. This function still
 * does the real work — the atomic DB-persisted claim — which is unrelated to
 * Sentry and unaffected by the quota.
 */
const HEARTBEAT_MONITOR_SLUG = "scheduled-tasks-heartbeat";
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Records that a scheduled task completed successfully.
 * Call this after the task's work finishes without error so that
 * scheduler_runs.last_success_at is kept up to date for observability.
 * Non-fatal: a recording failure logs a warning but does not throw.
 */
export async function recordScheduledTaskSuccess(
  taskName: string,
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE scheduler_runs
      SET last_success_at = now()
      WHERE name = ${taskName}
    `);
  } catch (err) {
    logger.warn(
      { err, taskName },
      "scheduler-guard: failed to record task success — continuing",
    );
  }
}

/**
 * Records that a scheduled task's run threw. Call this from the same catch
 * block that already logs the failure. Deliberately a no-op beyond that log
 * line: last_success_at simply won't advance, which is exactly what the
 * shared heartbeat (below) uses to detect a stuck/failing task — no separate
 * failure bookkeeping needed.
 */
export function recordScheduledTaskFailure(_taskName: string): void {
  // Intentionally a no-op: absence of a fresh last_success_at IS the signal.
  // Kept as a named export so call sites read clearly and can gain real
  // behavior later without touching every scheduler file again.
}

/**
 * Returns true if at least `minIntervalMs` has elapsed since the last
 * successful run for `taskName` (or if this task has never run before).
 * Claiming updates last_run_at immediately, before the caller's work even
 * starts, so two racing instances can't both claim the same run window.
 *
 * The interval check uses COALESCE(last_success_at, last_run_at) — not
 * last_run_at alone. The distinction matters when a server is killed
 * mid-run: last_run_at stays at the time of the killed claim while
 * last_success_at stays at the previous successful run. With last_run_at
 * alone, a deployment restart during an in-progress run would block the
 * next deployment from running the task for the full minIntervalMs (because
 * the killed claim looks "fresh"). Using last_success_at as the interval
 * anchor instead means a new deployment can claim immediately — the killed
 * run's stale claim is ignored. Both tasks guarded here are idempotent so
 * the tiny concurrent-claim window during a deployment transition is safe.
 *
 * Also refreshes expected_interval_ms every call (claimed or not) so the
 * shared heartbeat always knows this task's current cadence.
 */
export async function shouldRunScheduledTask(
  taskName: string,
  minIntervalMs: number,
): Promise<boolean> {
  try {
    const result = await db.execute<{ name: string }>(sql`
      INSERT INTO scheduler_runs (name, last_run_at, expected_interval_ms)
      VALUES (${taskName}, now(), ${minIntervalMs})
      ON CONFLICT (name) DO UPDATE
        SET last_run_at = now()
        WHERE COALESCE(scheduler_runs.last_success_at, scheduler_runs.last_run_at)
          < now() - (${minIntervalMs}::text || ' milliseconds')::interval
      RETURNING name
    `);
    const claimed = result.rows.length > 0;
    // Keep expected_interval_ms current even on an unclaimed (too-soon) call
    // — the row is guaranteed to exist by this point (inserted above or
    // pre-existing), so this is a plain, always-run update.
    await db.execute(sql`
      UPDATE scheduler_runs
      SET expected_interval_ms = ${minIntervalMs}
      WHERE name = ${taskName}
    `);
    return claimed;
  } catch (err) {
    // Fail closed on the side of NOT running an expensive AI job if the
    // guard itself is broken (e.g. table missing before bootstrap runs) —
    // better to skip a scheduled scan than to silently disable the cost
    // protection it exists for.
    logger.error(
      { err, taskName },
      "scheduler-guard: failed to check/claim run — skipping this run as a precaution",
    );
    return false;
  }
}

type SchedulerRunRow = {
  name: string;
  last_run_at: string | Date;
  last_success_at: string | Date | null;
  expected_interval_ms: number | null;
};

/**
 * Starts the single, shared Sentry Cron Monitor for every in-process
 * scheduler. Sentry's free/Developer plan grants exactly one Cron Monitor
 * per org, so instead of one monitor per taskName (which silently hit the
 * quota after the very first one was created), this ticks on its own fixed
 * cadence and inspects every row in scheduler_runs to decide whether ANY
 * task has gone quiet for longer than its own expected interval allows.
 *
 * A task counts as stale once `now - COALESCE(last_success_at, last_run_at)`
 * exceeds `expected_interval_ms + tolerance` (tolerance = the larger of 15
 * minutes or half the task's own interval). Using last_run_at as the
 * fallback when last_success_at is null means a brand-new task gets one
 * full interval + tolerance of grace before it can be flagged, instead of
 * being reported stale the instant it's first claimed.
 *
 * Per-task detail (which task, how overdue) goes to a structured
 * logger.error/info line — already flowing into Sentry Logs via the pino
 * integration — while Sentry Cron Monitoring itself only ever sees one
 * ok/error check-in for the whole subsystem.
 */
export function startSchedulerHeartbeat(): () => void {
  const run = async (): Promise<void> => {
    const checkInId = Sentry.captureCheckIn(
      { monitorSlug: HEARTBEAT_MONITOR_SLUG, status: "in_progress" },
      {
        schedule: {
          type: "interval",
          value: HEARTBEAT_INTERVAL_MS / 60_000,
          unit: "minute",
        },
        checkinMargin: 10,
        maxRuntime: 5,
        timezone: "Etc/UTC",
      },
    );

    try {
      const result = await db.execute<SchedulerRunRow>(sql`
        SELECT name, last_run_at, last_success_at, expected_interval_ms
        FROM scheduler_runs
        WHERE expected_interval_ms IS NOT NULL
      `);

      const now = Date.now();
      const stale: Array<{ name: string; overdueMs: number }> = [];
      for (const row of result.rows) {
        const expectedMs = row.expected_interval_ms;
        if (!expectedMs) continue;
        const anchor = row.last_success_at ?? row.last_run_at;
        const anchorMs = new Date(anchor).getTime();
        const toleranceMs = Math.max(15 * 60 * 1000, expectedMs / 2);
        const ageMs = now - anchorMs;
        if (ageMs > expectedMs + toleranceMs) {
          stale.push({ name: row.name, overdueMs: ageMs - expectedMs });
        }
      }

      if (stale.length > 0) {
        logger.error(
          { stale },
          "scheduler-heartbeat: one or more scheduled tasks have gone silent",
        );
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: HEARTBEAT_MONITOR_SLUG,
          status: "error",
        });
      } else {
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: HEARTBEAT_MONITOR_SLUG,
          status: "ok",
        });
      }
    } catch (err) {
      logger.warn(
        { err },
        "scheduler-heartbeat: failed to evaluate scheduler health — reporting error check-in",
      );
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: HEARTBEAT_MONITOR_SLUG,
        status: "error",
      });
    }
  };

  void run();
  const interval = setInterval(() => void run(), HEARTBEAT_INTERVAL_MS);
  interval.unref();

  logger.info(
    { intervalMinutes: HEARTBEAT_INTERVAL_MS / 60_000 },
    "scheduler-heartbeat: started (single shared Sentry Cron Monitor for all schedulers)",
  );
  return () => clearInterval(interval);
}
