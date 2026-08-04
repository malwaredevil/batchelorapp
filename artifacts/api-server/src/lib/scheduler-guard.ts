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
 * Sentry Cron Monitoring check-ins for every in-process scheduler (and the
 * `send-reminder-alerts` Scheduled Deployment script, which calls the same
 * underlying task functions and therefore the same guard). Centralizing this
 * here — rather than in each of the ~6 scheduler files — means every
 * scheduled task gets "did this silently stop running?" alerting for free,
 * with no per-scheduler wiring. Correlating the "in_progress" and "ok"/
 * "error" check-ins only needs an in-memory map because each taskName's
 * claim → finish sequence runs to completion before the next one starts.
 */
const activeCheckIns = new Map<string, string>();

function msToCronSchedule(
  ms: number,
): { value: number; unit: "minute" | "hour" | "day" } {
  if (ms % (24 * 60 * 60 * 1000) === 0) {
    return { value: ms / (24 * 60 * 60 * 1000), unit: "day" };
  }
  if (ms % (60 * 60 * 1000) === 0) {
    return { value: ms / (60 * 60 * 1000), unit: "hour" };
  }
  return { value: Math.max(1, Math.round(ms / (60 * 1000))), unit: "minute" };
}

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
  const checkInId = activeCheckIns.get(taskName);
  if (checkInId) {
    activeCheckIns.delete(taskName);
    Sentry.captureCheckIn({ checkInId, monitorSlug: taskName, status: "ok" });
  }
}

/**
 * Records that a scheduled task's run threw. Call this from the same catch
 * block that already logs the failure — it closes out the Sentry Cron
 * Monitoring check-in as "error" so a broken job surfaces as a Sentry alert
 * instead of only a log line nobody is watching.
 */
export function recordScheduledTaskFailure(taskName: string): void {
  const checkInId = activeCheckIns.get(taskName);
  if (checkInId) {
    activeCheckIns.delete(taskName);
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: taskName,
      status: "error",
    });
  }
}

/**
 * Returns true if at least `minIntervalMs` has elapsed since the last
 * successful claim for `taskName` (or if this task has never run before).
 * Claiming updates the persisted timestamp immediately, before the caller's
 * work even starts, so a slow or failing run doesn't cause runaway retries
 * on every subsequent restart before it's finished.
 */
export async function shouldRunScheduledTask(
  taskName: string,
  minIntervalMs: number,
): Promise<boolean> {
  try {
    const result = await db.execute<{ name: string }>(sql`
      INSERT INTO scheduler_runs (name, last_run_at)
      VALUES (${taskName}, now())
      ON CONFLICT (name) DO UPDATE
        SET last_run_at = now()
        WHERE scheduler_runs.last_run_at
          < now() - (${minIntervalMs}::text || ' milliseconds')::interval
      RETURNING name
    `);
    const claimed = result.rows.length > 0;
    if (claimed) {
      const { value, unit } = msToCronSchedule(minIntervalMs);
      const checkInId = Sentry.captureCheckIn(
        { monitorSlug: taskName, status: "in_progress" },
        {
          schedule: { type: "interval", value, unit },
          checkinMargin: Math.max(
            5,
            Math.round((minIntervalMs / 60_000) * 0.25),
          ),
          maxRuntime: 20,
          timezone: "Etc/UTC",
        },
      );
      activeCheckIns.set(taskName, checkInId);
    }
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
