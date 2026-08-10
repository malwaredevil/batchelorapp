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
 * Grace period before the heartbeat's very FIRST staleness check. Every
 * in-process scheduler (travels-nudges, gmail-scan, calendar-scan, etc.)
 * fires an unconditional `void run()` on module load, same as the heartbeat
 * itself. On a cold boot after a long autoscale sleep, last_success_at for
 * an hourly task can already be >90min old (server was asleep, not just
 * idle) — so if the heartbeat's own first tick fires before that task's own
 * first-tick catch-up run has finished (a few hundred ms to a few seconds,
 * per the logs), it reads stale DB state and reports a false "gone silent"
 * error, even though the task self-heals a moment later in the same boot.
 * This was confirmed as the cause of recurring NODE-EXPRESS-25/26 Sentry
 * cron-failure alerts. Delaying the first check gives every fallback
 * scheduler's boot-time run room to complete and call
 * recordScheduledTaskSuccess before we look.
 */
const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Every in-process scheduler registers its own `setInterval(fn, N)` with the
 * SAME N it passes to shouldRunScheduledTask() as minIntervalMs (see e.g.
 * reminder-scheduler.ts). The JS timer's clock starts ticking the instant
 * the scheduler module loads, but the DB claim it's compared against
 * (last_run_at) doesn't get written until an async round trip completes —
 * which on a cold boot can trail the timer's start by several seconds while
 * migrations/bucket-provisioning/other schedulers' own startup claims are
 * still in flight. Because both clocks use the literal same duration, that
 * one-time startup lag becomes permanent: every Nth-hour timer tick lands a
 * few seconds BEFORE its claim's `now() - last_run_at > N` becomes true, so
 * the claim is denied, last_run_at doesn't advance, and the task only
 * actually gets to run on alternating ticks (~2N apart) forever — which is
 * both fewer real runs than intended and, once 2N exceeds the shared
 * heartbeat's tolerance window, a recurring false "gone silent" Sentry
 * alert even though nothing is actually broken (confirmed against
 * production logs: a task claimed at T, denied again at T+~(N-12s), then
 * claimed at T+2N with `overdueMs` matching the alternating-skip math).
 * Subtracting a small grace period before comparing means a timer firing
 * essentially on time will always satisfy the claim, restoring the
 * intended once-per-N-ms cadence. `expected_interval_ms` (used by the
 * heartbeat's OWN staleness math) still stores the true, ungraced N.
 */
export const CLAIM_GRACE_MS = 2 * 60 * 1000; // 2 minutes

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
 * starts, so concurrent instances racing the same INSERT ON CONFLICT cannot
 * both claim the same window — PostgreSQL's row-level lock on the conflict
 * target serialises them, and after the first winner sets last_run_at to
 * now() the loser's WHERE clause evaluates against the updated row and fails.
 *
 * The WHERE clause uses two arms to handle crash recovery cleanly:
 *
 *   Arm 1 (normal cadence):  last_run_at is old enough → claim.
 *
 *   Arm 2 (crash recovery):  last_run_at is recent (a deployment restart
 *     killed the previous run before it could call recordScheduledTaskSuccess)
 *     but last_success_at is stale.  We allow a fresh claim once the stale
 *     claim is at least 10 minutes old — well beyond any concurrent-claim
 *     race window (milliseconds) while still within the normal 60-minute
 *     interval, so recovery happens within the same hour.  These lightweight
 *     tasks finish in seconds, so 10 minutes is a safe run-timeout threshold.
 *
 * Also refreshes expected_interval_ms every call (claimed or not) so the
 * shared heartbeat always knows this task's current cadence.
 */
export async function shouldRunScheduledTask(
  taskName: string,
  minIntervalMs: number,
): Promise<boolean> {
  // One retry after a short delay before giving up. Supabase's pooler
  // occasionally drops an idle connection mid-claim ("Connection terminated
  // unexpectedly") — a transient blip lasting well under a second. Without a
  // retry, a single blip made this function fail closed (skip the run), and
  // because the heartbeat's stale tolerance is only max(15min, interval/2),
  // one skipped 30-minute task pushed its next successful run close enough
  // to the tolerance edge to fire a false "gone silent" alert. Retrying once
  // absorbs the blip instead of turning it into a missed run.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await claimScheduledTaskRun(taskName, minIntervalMs);
    } catch (err) {
      if (attempt === 2) {
        // Fail closed on the side of NOT running an expensive AI job if the
        // guard itself is broken (e.g. table missing before bootstrap runs) —
        // better to skip a scheduled scan than to silently disable the cost
        // protection it exists for.
        logger.error(
          { err, taskName },
          "scheduler-guard: failed to check/claim run after retry — skipping this run as a precaution",
        );
        return false;
      }
      logger.warn(
        { err, taskName },
        "scheduler-guard: claim attempt failed, retrying once",
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function claimScheduledTaskRun(
  taskName: string,
  minIntervalMs: number,
): Promise<boolean> {
  // See CLAIM_GRACE_MS doc comment: compare against a slightly shorter
  // window than the nominal interval so a same-duration setInterval tick
  // that lands a few seconds "early" (relative to when the last claim's
  // now() actually committed) still succeeds. expected_interval_ms below
  // still records the true, ungraced minIntervalMs for the heartbeat.
  const claimWindowMs = Math.max(0, minIntervalMs - CLAIM_GRACE_MS);

  // Single-statement upsert that atomically records expected_interval_ms AND
  // conditionally advances last_run_at.  Previously the interval was written
  // in a separate UPDATE after the claim decision, which meant a scheduler
  // whose interval changed between two consecutive denied calls could leave
  // expected_interval_ms out of sync with the interval that drove each
  // claim's WHERE clause.  Folding both writes into one statement removes
  // that window: Postgres evaluates the CASE conditions and records the new
  // interval in the same row-level lock acquisition.
  //
  // Race-safe claim detection via the schema-backed last_claim_granted column:
  //
  //   Using a DO UPDATE … WHERE clause would make RETURNING emit no rows on
  //   deny (a convenient claim sentinel), but it also prevents the
  //   expected_interval_ms column from being refreshed on denied calls.
  //   Removing the WHERE and inferring the outcome from timestamps instead
  //   (e.g. last_run_at >= statement_timestamp()) is not race-safe: a
  //   statement that starts before a concurrent winner can resume after the
  //   winner's lock-and-commit and read the winner's newer timestamp, falsely
  //   reporting itself as claimed.
  //
  //   The only correct approach is to embed the claim decision as a value
  //   computed under the ON CONFLICT row lock from the pre-update row state,
  //   and surface it directly in RETURNING.  last_claim_granted does exactly
  //   that: its CASE expression is evaluated by PostgreSQL against the
  //   original row values under the exclusive conflict lock, before any of
  //   this statement's writes are applied.  This guarantees:
  //
  //     • Fresh INSERT (no conflict): VALUES sets last_claim_granted = true.
  //     • DO UPDATE, claim granted: CASE yields true; last_run_at advances.
  //     • DO UPDATE, claim denied: CASE yields false; last_run_at unchanged.
  //
  //   Concurrent-loser correctness: when statement B loses the row lock to
  //   statement A, B's ON CONFLICT re-evaluates under READ COMMITTED against
  //   A's committed row.  A's last_run_at is too recent → CASE yields false
  //   → last_claim_granted = false → RETURNING sends claimed = false. ✓
  const result = await db.execute<{
    name: string;
    claimed: boolean;
    last_run_at: string;
    last_success_at: string | null;
  }>(sql`
      INSERT INTO scheduler_runs (name, last_run_at, expected_interval_ms, last_claim_granted)
      VALUES (${taskName}, now(), ${minIntervalMs}, true)
      ON CONFLICT (name) DO UPDATE
        SET
          -- Always refresh the interval so the heartbeat's tolerance window
          -- always reflects the interval that drove this claim decision.
          expected_interval_ms = EXCLUDED.expected_interval_ms,
          -- Set last_claim_granted first: its CASE is evaluated against the
          -- pre-update row under the exclusive conflict lock, so it accurately
          -- records whether THIS call grants the claim regardless of concurrent
          -- contenders (see race-safety discussion in the comment above).
          last_claim_granted = CASE
            WHEN (
              -- Arm 1: normal cadence — last claim was long enough ago
              scheduler_runs.last_run_at
                < now() - (${claimWindowMs}::text || ' milliseconds')::interval
            ) OR (
              -- Arm 2: crash recovery — the previous claim never completed
              -- (last_run_at > last_success_at) and enough time has passed to
              -- rule out an active concurrent claim (10 min >> any race window).
              scheduler_runs.last_success_at IS NOT NULL
              AND scheduler_runs.last_run_at > scheduler_runs.last_success_at
              AND scheduler_runs.last_success_at
                < now() - (${claimWindowMs}::text || ' milliseconds')::interval
              AND scheduler_runs.last_run_at < now() - interval '10 minutes'
            )
            THEN true
            ELSE false
          END,
          -- Advance last_run_at iff the claim is granted (same condition).
          last_run_at = CASE
            WHEN (
              scheduler_runs.last_run_at
                < now() - (${claimWindowMs}::text || ' milliseconds')::interval
            ) OR (
              scheduler_runs.last_success_at IS NOT NULL
              AND scheduler_runs.last_run_at > scheduler_runs.last_success_at
              AND scheduler_runs.last_success_at
                < now() - (${claimWindowMs}::text || ' milliseconds')::interval
              AND scheduler_runs.last_run_at < now() - interval '10 minutes'
            )
            THEN now()
            ELSE scheduler_runs.last_run_at
          END
      RETURNING
        name,
        last_claim_granted     AS claimed,
        last_run_at::text      AS last_run_at,
        last_success_at::text  AS last_success_at
    `);

  const row = result.rows[0];
  // INSERT ON CONFLICT DO UPDATE always touches the target row (either inserts
  // or updates), so RETURNING always emits exactly one row.  A missing row
  // would only occur if the DB rejected the statement entirely — which would
  // have already thrown above.
  const claimed = row?.claimed ?? false;

  if (!claimed && row) {
    // Log last_run_at and last_success_at separately so operators can see
    // exactly why the run was denied without querying the DB directly.
    // Using COALESCE would obscure crash-recovery cases: when a process died
    // mid-run, last_run_at is fresh but last_success_at is stale — the deny
    // is driven by last_run_at (Arm 1 cooldown), not by the coalesced value.
    const isActiveClaim =
      row.last_success_at != null &&
      new Date(row.last_run_at) > new Date(row.last_success_at);
    logger.debug(
      {
        taskName,
        lastRunAt: row.last_run_at,
        lastSuccessAt: row.last_success_at,
        intervalMs: minIntervalMs,
        reason: isActiveClaim
          ? "crash-recovery timeout not elapsed"
          : "interval not elapsed since last_run_at",
      },
      `scheduler-guard: skipped — last_run_at ${row.last_run_at}, interval ${Math.round(minIntervalMs / 60_000)}min not elapsed`,
    );
  }

  return claimed;
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
  let startupTimeout: ReturnType<typeof setTimeout> | null = null;
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
      // Same one-retry-after-a-short-delay treatment as claimScheduledTaskRun
      // (see shouldRunScheduledTask doc comment): Supabase's pooler
      // occasionally drops an idle connection mid-query with a transient
      // "Connection terminated unexpectedly" error lasting well under a
      // second. Every OTHER caller of the DB in this codebase polls often
      // enough (60s-5min) that a single blip self-heals silently on the next
      // tick. This heartbeat only runs every 15 minutes, so without a retry
      // here a single transient blip was immediately reported as an "error"
      // check-in to Sentry Cron Monitoring — tripping a real alert for a
      // problem that was already gone by the time anyone looked. Confirmed
      // as the cause of the 2026-08-10 "scheduled-tasks-heartbeat" incident:
      // two consecutive production check-ins failed with the identical
      // "Connection terminated due to connection timeout" error from this
      // exact query.
      let result: Awaited<ReturnType<typeof db.execute<SchedulerRunRow>>>;
      try {
        result = await db.execute<SchedulerRunRow>(sql`
          SELECT name, last_run_at, last_success_at, expected_interval_ms
          FROM scheduler_runs
          WHERE expected_interval_ms IS NOT NULL
        `);
      } catch (err) {
        logger.warn(
          { err },
          "scheduler-heartbeat: health-check query failed, retrying once",
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = await db.execute<SchedulerRunRow>(sql`
          SELECT name, last_run_at, last_success_at, expected_interval_ms
          FROM scheduler_runs
          WHERE expected_interval_ms IS NOT NULL
        `);
      }

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

  logger.info(
    {
      intervalMinutes: HEARTBEAT_INTERVAL_MS / 60_000,
      firstCheckDelayMs: FIRST_CHECK_DELAY_MS,
    },
    "scheduler-heartbeat: started (single shared Sentry Cron Monitor for all schedulers)",
  );
  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    void run();
  }, FIRST_CHECK_DELAY_MS);

  const interval = setInterval(() => void run(), HEARTBEAT_INTERVAL_MS);
  interval.unref();

  return () => {
    if (startupTimeout !== null) {
      clearTimeout(startupTimeout);
      startupTimeout = null;
    }
    clearInterval(interval);
  };
}
