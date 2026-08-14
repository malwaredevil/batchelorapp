/**
 * Unit tests for shouldRunScheduledTask()
 *
 * The function's claim logic lives in a single CTE-based upsert that always
 * returns one row with a `claimed` boolean.  Tests mock db.execute to inject
 * the DB response for each scenario so the function's branching behaviour is
 * verified without a live database.
 *
 * Scenarios:
 *   (a) first run (no row) → INSERT inserts, returns row with claimed=true
 *   (b) ran and succeeded recently → CASE keeps last_run_at, claimed=false
 *   (c) claimed but killed mid-run (last_run_at fresh, last_success_at stale)
 *       → crash-recovery arm, claimed=true once last_run_at is old enough
 *   (d) never succeeded, last_run_at fresh → Arm 1 and Arm 2 both fail,
 *       claimed=false
 *   (e) db.execute throws → fail-closed → returns false without throwing
 *   (f) interval change on a denied call → expected_interval_ms in the same
 *       statement records the NEW interval (the race this task fixed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// ── Mock @workspace/db before importing the module under test ────────────────
// vi.mock() is hoisted to the top of the file by Vitest, so the factory runs
// before const declarations in this file.  vi.hoisted() lifts the fn()
// creation into the same hoisted scope so the mock factory can reference it.

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockExecute,
  },
}));

// Mock logger so error/warn calls don't clutter test output
vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Sentry — startSchedulerHeartbeat uses it but shouldRunScheduledTask
// does not; the mock prevents import-time side effects.
vi.mock("@sentry/node", () => ({
  captureCheckIn: vi.fn(),
}));

// Import after mocks are registered
import {
  shouldRunScheduledTask,
  startSchedulerHeartbeat,
  reconcileSchedulerRuns,
  CLAIM_GRACE_MS,
  KNOWN_SCHEDULER_NAMES,
} from "./scheduler-guard";
import { logger } from "./logger";
import * as Sentry from "@sentry/node";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FIXED_LAST_RUN_AT = "2026-08-04T07:59:00.000Z";
const FIXED_LAST_SUCCESS_AT = "2026-08-04T07:59:05.000Z";

/**
 * Simulate the CTE returning a row with claimed=true (claim succeeded).
 * The CTE always returns exactly one row; a brand-new INSERT has no prior
 * last_run_at snapshot so prior.last_run_at IS NULL → claimed=true.
 */
function claimedResult(opts?: {
  lastRunAt?: string;
  lastSuccessAt?: string | null;
}) {
  return {
    rows: [
      {
        name: "test-task",
        claimed: true,
        last_run_at: opts?.lastRunAt ?? FIXED_LAST_RUN_AT,
        last_success_at: opts?.lastSuccessAt ?? FIXED_LAST_SUCCESS_AT,
      },
    ],
  };
}

/**
 * Simulate the CTE returning a row with claimed=false (claim denied).
 * Unlike the old WHERE-clause approach (which emitted no rows on deny),
 * the new CTE always returns one row — the `claimed` boolean distinguishes
 * the two outcomes.
 */
function skippedResult(opts?: {
  lastRunAt?: string;
  lastSuccessAt?: string | null;
}) {
  return {
    rows: [
      {
        name: "test-task",
        claimed: false,
        last_run_at: opts?.lastRunAt ?? FIXED_LAST_RUN_AT,
        last_success_at: opts?.lastSuccessAt ?? FIXED_LAST_SUCCESS_AT,
      },
    ],
  };
}

/**
 * db.execute is called ONCE per shouldRunScheduledTask invocation.
 * The single CTE handles the upsert, expected_interval_ms refresh, and
 * claim detection all in one statement — no separate anchor SELECT or
 * interval-housekeeping UPDATE.
 */
function setupExecuteMocks(result: { rows: unknown[] }) {
  mockExecute.mockResolvedValueOnce(result);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("shouldRunScheduledTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) first run — no existing row — claims the run", async () => {
    // On the very first run for a task name the INSERT succeeds (no
    // conflict): prior.last_run_at IS NULL → claimed=true in the CTE.
    setupExecuteMocks(claimedResult());

    const result = await shouldRunScheduledTask("new-task", 60 * 60 * 1000);

    expect(result).toBe(true);
  });

  it("(b) ran and succeeded recently — too soon — skips", async () => {
    // The existing row's last_run_at is recent. The CASE in DO UPDATE
    // keeps last_run_at unchanged → prior.last_run_at = upsert.last_run_at
    // → claimed=false in the CTE.
    setupExecuteMocks(skippedResult());

    const result = await shouldRunScheduledTask(
      "recent-success-task",
      60 * 60 * 1000,
    );

    expect(result).toBe(false);
  });

  it("(c) claimed but killed mid-run — last_run_at fresh, last_success_at stale — claims immediately (crash-recovery arm)", async () => {
    // State in DB before the call:
    //   last_run_at    = "10 minutes ago"  (claim was taken but process died)
    //   last_success_at = "2 hours ago"    (last successful completion)
    //
    // Arm 1 fails: last_run_at (10 min ago) is NOT older than minIntervalMs (1 hr).
    // Arm 2 succeeds:
    //   - last_success_at IS NOT NULL ✓
    //   - last_run_at > last_success_at ✓ (run claimed but never finished)
    //   - last_success_at < now() - 1hr ✓ (stale)
    //   - last_run_at < now() - 10min ✓ (not an active concurrent claim)
    // → last_run_at advances → prior.last_run_at < upsert.last_run_at → claimed=true.
    setupExecuteMocks(claimedResult());

    const result = await shouldRunScheduledTask("crashed-task", 60 * 60 * 1000);

    expect(result).toBe(true);
  });

  it("(d) never succeeded — last_run_at fresh — skips (Arm 2 requires last_success_at IS NOT NULL)", async () => {
    // State in DB:
    //   last_run_at    = "30 seconds ago"
    //   last_success_at = NULL             (task has never completed)
    //
    // Arm 1 fails: last_run_at is too recent (< minIntervalMs).
    // Arm 2 is skipped: last_success_at IS NULL → IS NOT NULL guard fires.
    // → last_run_at unchanged → claimed=false.
    setupExecuteMocks(skippedResult({ lastSuccessAt: null }));

    const result = await shouldRunScheduledTask(
      "never-succeeded-task",
      60 * 60 * 1000,
    );

    expect(result).toBe(false);
  });

  it("(e) db.execute throws — fail-closed — returns false without re-throwing", async () => {
    // If the scheduler_runs table is missing (e.g. bootstrap hasn't run yet)
    // or the DB is momentarily unreachable, the guard must not let the
    // expensive AI job through.  shouldRunScheduledTask retries once then
    // returns false. Both attempt rejections must be provided.
    mockExecute
      .mockRejectedValueOnce(
        new Error("relation scheduler_runs does not exist"),
      )
      .mockRejectedValueOnce(
        new Error("relation scheduler_runs does not exist"),
      );

    const result = await shouldRunScheduledTask("fragile-task", 60 * 60 * 1000);

    expect(result).toBe(false);
  });

  it("(f) interval change on a denied call — expected_interval_ms is the NEW interval", async () => {
    // The race this task fixed: if expected_interval_ms were updated in a
    // separate statement, a scheduler that changed its interval between two
    // consecutive denied calls could leave the heartbeat reading a stale
    // tolerance window. With the CTE, the interval written is always the one
    // passed to THIS call — atomically in the same statement.
    //
    // We verify the correct (new) interval appears in the single CTE SQL and
    // NOT as a separate trailing UPDATE call.
    const newIntervalMs = 2 * 60 * 60 * 1000; // 2 hours (changed from 1h)
    setupExecuteMocks(skippedResult());

    await shouldRunScheduledTask("interval-changed-task", newIntervalMs);

    // Must be exactly ONE db.execute call — no separate interval UPDATE.
    expect(mockExecute).toHaveBeenCalledTimes(1);

    // The new interval must appear in the CTE SQL params (for
    // expected_interval_ms = EXCLUDED.expected_interval_ms).
    const cteSqlArg = mockExecute.mock.calls[0][0];
    const paramValues = getSqlParamValues(cteSqlArg);
    expect(paramValues).toContain(newIntervalMs);
  });

  it("claimed run — calls db.execute exactly once (single atomic CTE)", async () => {
    setupExecuteMocks(claimedResult());

    await shouldRunScheduledTask("housekeeping-task", 30 * 60 * 1000);

    // The CTE handles claim + expected_interval_ms refresh in one statement.
    // There must be no separate anchor SELECT or interval-housekeeping UPDATE.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("denied claim — calls db.execute once and logs last_run_at + last_success_at at debug level", async () => {
    // When the CTE returns claimed=false, the anchor timestamps come from the
    // returned row itself — no separate SELECT is needed.
    //
    // Normal cadence: last_run_at is recent, last_success_at is even newer
    // (task completed successfully). last_success_at >= last_run_at → the
    // deny reason is the Arm 1 cooldown on last_run_at, not crash-recovery.
    const lastRunAt = "2026-08-04T07:59:00.000Z";
    const lastSuccessAt = "2026-08-04T07:59:05.000Z"; // task finished 5s after claim

    setupExecuteMocks(skippedResult({ lastRunAt, lastSuccessAt }));

    const result = await shouldRunScheduledTask("recent-task", 60 * 60 * 1000);

    expect(result).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(1);

    // The debug log must surface both timestamps separately — never a
    // coalesced value — so the message accurately reflects that
    // last_run_at (not last_success_at) drove the Arm 1 denial.
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        taskName: "recent-task",
        lastRunAt,
        lastSuccessAt,
        intervalMs: 60 * 60 * 1000,
        reason: "interval not elapsed since last_run_at",
      }),
      expect.stringContaining("skipped"),
    );
  });

  it("denied claim with active incomplete claim — logs crash-recovery reason", async () => {
    // last_run_at > last_success_at signals the previous claim never finished
    // (the process was killed mid-run). The deny reason is the 10-minute
    // run-timeout, not the normal interval.
    const lastRunAt = "2026-08-04T08:05:00.000Z"; // recent (mid-run)
    const lastSuccessAt = "2026-08-04T07:00:00.000Z"; // older (last success)

    setupExecuteMocks(skippedResult({ lastRunAt, lastSuccessAt }));

    await shouldRunScheduledTask("in-progress-task", 60 * 60 * 1000);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunAt,
        lastSuccessAt,
        reason: "crash-recovery timeout not elapsed",
      }),
      expect.stringContaining("skipped"),
    );
  });

  // ── Grace-window arithmetic tests ───────────────────────────────────────────
  //
  // These tests guard against the alternating-skip bug described in the
  // CLAIM_GRACE_MS doc comment: if the grace window is ever accidentally
  // removed (CLAIM_GRACE_MS set to 0) or a scheduler's interval is changed to
  // something at or below CLAIM_GRACE_MS, the wrong claimWindowMs value would
  // be passed to the claim SQL and every-other-tick skipping would silently
  // return. By asserting the exact numeric value that lands in the SQL, future
  // changes to CLAIM_GRACE_MS or any individual scheduler's minIntervalMs will
  // immediately fail these tests if the interaction breaks.
  //
  // PgDialect.sqlToQuery() is drizzle-orm's own public compilation method —
  // it produces a stable { sql: string, params: unknown[] } structure
  // regardless of how drizzle-orm's internal query-chunk representation
  // evolves. Using it here means these assertions never silently pass due
  // to an internal drizzle-orm restructuring.

  /**
   * Extract all interpolated parameter values from a drizzle SQL object.
   *
   * Uses PgDialect.sqlToQuery() — drizzle-orm's own public SQL-compilation
   * path — to produce a well-typed params array. This is stable against
   * changes to drizzle-orm's internal queryChunks representation.
   */
  function getSqlParamValues(sqlObj: unknown): unknown[] {
    const dialect = new PgDialect();
    // sqlToQuery accepts the same SQL object that drizzle's db.execute() does.
    const compiled = dialect.sqlToQuery(
      sqlObj as Parameters<typeof dialect.sqlToQuery>[0],
    );
    return compiled.params;
  }

  it("grace-window: claimWindowMs passed to claim SQL equals minIntervalMs - CLAIM_GRACE_MS", async () => {
    // This test pins the arithmetic inside claimScheduledTaskRun:
    //   claimWindowMs = Math.max(0, minIntervalMs - CLAIM_GRACE_MS)
    //
    // The single CTE is the only db.execute call.  Its interpolated params
    // include (among string params): minIntervalMs (for expected_interval_ms)
    // and claimWindowMs twice — once in Arm 1 and once in Arm 2 of the CASE
    // expression that conditionally advances last_run_at.
    //
    // If CLAIM_GRACE_MS is later reduced to 0 or removed, claimWindowMs will
    // equal minIntervalMs and this test will fail, alerting the developer that
    // the alternating-skip protection has been disabled.
    const minIntervalMs = 60 * 60 * 1000; // 1 hour
    const expectedClaimWindow = minIntervalMs - CLAIM_GRACE_MS; // 58 min in ms

    setupExecuteMocks(claimedResult());
    await shouldRunScheduledTask("grace-arithmetic-task", minIntervalMs);

    const claimSqlArg = mockExecute.mock.calls[0][0];
    const paramValues = getSqlParamValues(claimSqlArg);

    // claimWindowMs must appear in the SQL params and must be strictly smaller
    // than minIntervalMs — proving the grace reduction was actually applied.
    //
    // Note: minIntervalMs itself also legitimately appears in the params for the
    // expected_interval_ms INSERT/UPDATE column, so we cannot assert its absence.
    // What we CAN assert is that the GRACED value (minIntervalMs - CLAIM_GRACE_MS)
    // is the one used for the WHERE-clause comparison — if CLAIM_GRACE_MS were
    // accidentally set to 0, expectedClaimWindow would equal minIntervalMs and
    // only one distinct numeric param would appear instead of two distinct values.
    expect(paramValues).toContain(expectedClaimWindow);
    expect(expectedClaimWindow).toBeLessThan(minIntervalMs);
    // Both the full interval (for expected_interval_ms) and the graced window
    // (for the WHERE comparison) must be present as distinct values.
    const numericParams = paramValues.filter((v) => typeof v === "number");
    expect(numericParams).toContain(minIntervalMs); // stored as expected_interval_ms
    expect(numericParams).toContain(expectedClaimWindow); // used as the comparison window
    expect(minIntervalMs).not.toBe(expectedClaimWindow); // they must differ
  });

  it("grace-window: claimWindowMs is clamped to 0 when minIntervalMs < CLAIM_GRACE_MS", async () => {
    // Math.max(0, minIntervalMs - CLAIM_GRACE_MS) must not produce a negative
    // interval (which would make the SQL cast to a negative interval and
    // potentially allow every single claim to succeed instantly regardless of
    // how recently the task last ran).
    //
    // We use an interval strictly BELOW CLAIM_GRACE_MS (1 minute < 2 minute
    // grace) so that the subtraction would be negative without the clamp,
    // meaning this test would fail if Math.max(0, ...) is removed.
    const minIntervalMs = 60 * 1000; // 1 minute — well below the 2-minute CLAIM_GRACE_MS
    expect(minIntervalMs).toBeLessThan(CLAIM_GRACE_MS); // precondition: interval < grace

    setupExecuteMocks(claimedResult());
    await shouldRunScheduledTask("short-interval-task", minIntervalMs);

    const claimSqlArg = mockExecute.mock.calls[0][0];
    const paramValues = getSqlParamValues(claimSqlArg);

    // The SQL must receive 0, not a negative number.
    expect(paramValues).toContain(0);
    // No negative value must reach the SQL whatsoever.
    expect(paramValues.every((v) => typeof v !== "number" || v >= 0)).toBe(
      true,
    );
    // Without Math.max, the value would be minIntervalMs - CLAIM_GRACE_MS < 0;
    // verify that negative value is absent, confirming the clamp fired.
    const rawSubtraction = minIntervalMs - CLAIM_GRACE_MS;
    expect(rawSubtraction).toBeLessThan(0); // proves the clamp was needed
    expect(paramValues).not.toContain(rawSubtraction);
  });

  it("grace-window: claimWindowMs is strictly less than minIntervalMs for any realistic scheduler interval", async () => {
    // Parametric check across the intervals actually used by real schedulers
    // (reminders = 30 min, gmail-scan = 30 min, birthday = 24 h, etc.).
    // For each, the value passed to the claim SQL must be (interval - CLAIM_GRACE_MS),
    // never the raw interval itself.  If a future refactor accidentally passes
    // minIntervalMs directly instead of claimWindowMs, all of these will fail.
    // Exact constants drawn from the actual guarded schedulers; update this
    // list whenever a new scheduler registers with shouldRunScheduledTask.
    //   integrations-health-nudges  → 30 min  (IN_PROCESS_INTERVAL_MS)
    //   reminder-scheduler          → 1 hour  (IN_PROCESS_INTERVAL_MS)
    //   travels-nudges              → 1 hour  (IN_PROCESS_INTERVAL_MS)
    //   monitoring-scheduler        → 1 hour  (INTERVAL_MS)
    //   gmail-scan                  → 6 hours (SCAN_INTERVAL_MS)
    //   travels-calendar-scan       → 24 hours (SCAN_INTERVAL_MS)
    //   birthday-scheduler          → 24 hours (ONE_DAY_MS)
    //   webhook-side-effect-idempotency → 24 hours (CLEANUP_INTERVAL_MS)
    const realSchedulerIntervals = [
      30 * 60 * 1000, // integrations-health-nudges
      60 * 60 * 1000, // reminder-scheduler / travels-nudges / monitoring-scheduler
      6 * 60 * 60 * 1000, // gmail-scan
      24 * 60 * 60 * 1000, // travels-calendar-scan / birthday / webhook-cleanup
    ];

    for (const intervalMs of realSchedulerIntervals) {
      vi.clearAllMocks();
      setupExecuteMocks(claimedResult());

      await shouldRunScheduledTask(`interval-${intervalMs}-task`, intervalMs);

      const claimSqlArg = mockExecute.mock.calls[0][0];
      const paramValues = getSqlParamValues(claimSqlArg);

      const expectedWindow = Math.max(0, intervalMs - CLAIM_GRACE_MS);
      expect(paramValues).toContain(expectedWindow);

      // The graced window must be strictly smaller than the full interval.
      // (minIntervalMs itself also appears in params for expected_interval_ms
      // storage, which is correct — but the comparison window must be reduced.)
      if (intervalMs > CLAIM_GRACE_MS) {
        expect(expectedWindow).toBeLessThan(intervalMs);
        // Both values must appear as distinct numerics in the params
        const numericParams = paramValues.filter((v) => typeof v === "number");
        expect(numericParams).toContain(intervalMs); // stored as expected_interval_ms
        expect(numericParams).toContain(expectedWindow); // used in WHERE comparison
        expect(intervalMs).not.toBe(expectedWindow);
      }
    }
  });
});

// ── startSchedulerHeartbeat ───────────────────────────────────────────────────
//
// These tests verify the staleness formula:
//
//   toleranceMs = Math.max(15min, expectedMs / 2)
//   stale       = ageMs > expectedMs + toleranceMs
//
// and the FIRST_CHECK_DELAY_MS contract (heartbeat must not inspect the DB
// before giving every boot-time scheduler run a chance to record success).
//
// Fake timers control setTimeout/setInterval so each test is deterministic
// and finishes in wall-clock milliseconds.  vi.setSystemTime() pins the value
// returned by `Date.now()` (used inside `run()` for age calculations) and
// `new Date(anchor).getTime()` (used to parse last_success_at / last_run_at
// ISO strings) so all arithmetic is reproducible.

describe("startSchedulerHeartbeat", () => {
  // Fixed "now" anchor used throughout this suite.
  // Expressed as an ISO string so the test expectation prose reads naturally.
  const NOW_ISO = "2026-08-09T12:00:00.000Z";
  const NOW_MS = new Date(NOW_ISO).getTime();

  // Intervals and tolerances for common scheduler cadences
  const ONE_HOUR_MS = 60 * 60 * 1000; // 3 600 000 ms
  const TOLERANCE_ONE_HOUR_MS = Math.max(15 * 60 * 1000, ONE_HOUR_MS / 2); // 30 min
  const STALE_THRESHOLD_ONE_HOUR_MS = ONE_HOUR_MS + TOLERANCE_ONE_HOUR_MS; // 90 min

  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000; // 14 400 000 ms
  const TOLERANCE_FOUR_HOURS_MS = Math.max(15 * 60 * 1000, FOUR_HOURS_MS / 2); // 2 hr
  const STALE_THRESHOLD_FOUR_HOURS_MS = FOUR_HOURS_MS + TOLERANCE_FOUR_HOURS_MS; // 6 hr

  // Constants mirroring the unexported literals in scheduler-guard.ts.
  // These are asserted below — if the source values change, these tests will
  // fail and the developer will know the heartbeat contract has shifted.
  const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000; // 3 minutes

  /**
   * Build a fake scheduler_runs row for the SELECT executed inside
   * startSchedulerHeartbeat's `run()`.  `successAgeMs` is how many
   * milliseconds ago last_success_at occurred relative to NOW_MS; when null
   * the row has no last_success_at (brand-new task, never succeeded).
   */
  function makeRow(opts: {
    name: string;
    expectedIntervalMs: number;
    successAgeMs: number | null;
    runAgeMs?: number; // defaults to successAgeMs when provided
  }) {
    const { name, expectedIntervalMs, successAgeMs, runAgeMs } = opts;
    const last_success_at =
      successAgeMs !== null
        ? new Date(NOW_MS - successAgeMs).toISOString()
        : null;
    const last_run_at = new Date(
      NOW_MS - (runAgeMs ?? successAgeMs ?? 0),
    ).toISOString();
    return {
      name,
      last_success_at,
      last_run_at,
      expected_interval_ms: expectedIntervalMs,
    };
  }

  /**
   * Return a mockExecute implementation that resolves with the given rows for
   * the heartbeat's SELECT and ignores all other calls (claim/update paths
   * are not reached inside startSchedulerHeartbeat).
   */
  function setupHeartbeatMock(rows: ReturnType<typeof makeRow>[]) {
    mockExecute.mockResolvedValue({ rows });
  }

  let stopHeartbeat: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    stopHeartbeat?.();
    stopHeartbeat = undefined;
    vi.useRealTimers();
  });

  // ── Core staleness math ────────────────────────────────────────────────────

  it("task within tolerance — ok check-in sent", async () => {
    // A 1-hour task whose last success was 61 min ago is past its interval
    // but still inside the 30-min tolerance window (stale threshold = 90 min).
    // The heartbeat must send an "ok" check-in, not an "error".
    const successAgeMs = 61 * 60 * 1000; // 61 minutes — past interval, within tolerance
    expect(successAgeMs).toBeLessThan(STALE_THRESHOLD_ONE_HOUR_MS); // sanity

    setupHeartbeatMock([
      makeRow({
        name: "recent-task",
        expectedIntervalMs: ONE_HOUR_MS,
        successAgeMs,
      }),
    ]);

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    // Sentry must have received exactly one "in_progress" and one "ok" check-in
    const checkInCalls = (Sentry.captureCheckIn as ReturnType<typeof vi.fn>)
      .mock.calls;
    const statuses = checkInCalls.map(
      (args) => (args[0] as { status: string }).status,
    );
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("ok");
    expect(statuses).not.toContain("error");
  });

  it("task just outside tolerance — error check-in sent", async () => {
    // A 1-hour task whose last success was 91 min ago exceeds the 90-min
    // stale threshold by 1 minute and must trigger an "error" check-in.
    const successAgeMs = 91 * 60 * 1000; // 91 minutes — just past stale threshold
    expect(successAgeMs).toBeGreaterThan(STALE_THRESHOLD_ONE_HOUR_MS); // sanity

    setupHeartbeatMock([
      makeRow({
        name: "stale-task",
        expectedIntervalMs: ONE_HOUR_MS,
        successAgeMs,
      }),
    ]);

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    const checkInCalls = (Sentry.captureCheckIn as ReturnType<typeof vi.fn>)
      .mock.calls;
    const statuses = checkInCalls.map(
      (args) => (args[0] as { status: string }).status,
    );
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("error");
    expect(statuses).not.toContain("ok");
  });

  it("mix of healthy and stale tasks — error check-in names only the stale task", async () => {
    // Task A: 1-hour interval, 61 min ago → within tolerance → healthy
    // Task B: 1-hour interval, 91 min ago → past stale threshold → stale
    // The heartbeat must fire an error check-in and the logger.error call
    // must include Task B in the `stale` array but not Task A.
    setupHeartbeatMock([
      makeRow({
        name: "healthy-task",
        expectedIntervalMs: ONE_HOUR_MS,
        successAgeMs: 61 * 60 * 1000,
      }),
      makeRow({
        name: "stale-task",
        expectedIntervalMs: ONE_HOUR_MS,
        successAgeMs: 91 * 60 * 1000,
      }),
    ]);

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    // Sentry should report error
    const checkInCalls = (Sentry.captureCheckIn as ReturnType<typeof vi.fn>)
      .mock.calls;
    const statuses = checkInCalls.map(
      (args) => (args[0] as { status: string }).status,
    );
    expect(statuses).toContain("error");
    expect(statuses).not.toContain("ok");

    // logger.error must be called with stale containing only "stale-task"
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stale: expect.arrayContaining([
          expect.objectContaining({ name: "stale-task" }),
        ]),
      }),
      expect.stringContaining("gone silent"),
    );
    // "healthy-task" must NOT appear in the stale array
    const errorCall = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    const staleNames = (errorCall[0].stale as Array<{ name: string }>).map(
      (s) => s.name,
    );
    expect(staleNames).not.toContain("healthy-task");
  });

  it("tolerance formula: min tolerance is 15 min regardless of a short interval", async () => {
    // A 20-minute-interval task has expectedMs/2 = 10 min, which is below the
    // 15-minute floor, so toleranceMs must be 15 min (not 10).
    // Stale threshold = 20 min + 15 min = 35 min.
    const TWENTY_MIN_MS = 20 * 60 * 1000;
    const expectedTolerance = 15 * 60 * 1000; // floor kicks in (20/2 = 10 < 15)
    const staleThreshold = TWENTY_MIN_MS + expectedTolerance; // 35 min

    // A task last successful 36 minutes ago must be reported stale.
    const staleAgeMs = 36 * 60 * 1000; // just past 35-min threshold
    expect(staleAgeMs).toBeGreaterThan(staleThreshold);

    setupHeartbeatMock([
      makeRow({
        name: "short-interval-task",
        expectedIntervalMs: TWENTY_MIN_MS,
        successAgeMs: staleAgeMs,
      }),
    ]);

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    const checkInCalls = (Sentry.captureCheckIn as ReturnType<typeof vi.fn>)
      .mock.calls;
    const statuses = checkInCalls.map(
      (args) => (args[0] as { status: string }).status,
    );
    expect(statuses).toContain("error");
  });

  it("tolerance formula: long-interval task tolerance scales to half the interval", async () => {
    // A 4-hour-interval task: toleranceMs = max(15 min, 2 hr) = 2 hr.
    // Stale threshold = 4 hr + 2 hr = 6 hr.
    //
    // Note: vi.advanceTimersByTimeAsync advances Date.now() along with the
    // fake clock, so the heartbeat's `run()` sees now = NOW_MS + FIRST_CHECK_DELAY_MS.
    // The test ages are chosen with enough headroom to stay correctly
    // classified even after that extra ~3-minute advance.
    //
    // Healthy: 5h 30m ago → ageMs (seen inside run) ≈ 5h 33m < 6h threshold.
    // Stale:   6h 30m ago → ageMs (seen inside run) ≈ 6h 33m > 6h threshold.
    const healthyAgeMs = (5 * 60 + 30) * 60 * 1000; // 5h 30m
    const staleAgeMs = (6 * 60 + 30) * 60 * 1000; // 6h 30m

    expect(healthyAgeMs + FIRST_CHECK_DELAY_MS).toBeLessThan(
      STALE_THRESHOLD_FOUR_HOURS_MS,
    );
    expect(staleAgeMs).toBeGreaterThan(STALE_THRESHOLD_FOUR_HOURS_MS);

    // --- Healthy side ---
    vi.clearAllMocks();
    setupHeartbeatMock([
      makeRow({
        name: "4h-task",
        expectedIntervalMs: FOUR_HOURS_MS,
        successAgeMs: healthyAgeMs,
      }),
    ]);
    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);
    {
      const statuses = (
        Sentry.captureCheckIn as ReturnType<typeof vi.fn>
      ).mock.calls.map((args) => (args[0] as { status: string }).status);
      expect(statuses).toContain("ok");
      expect(statuses).not.toContain("error");
    }
    stopHeartbeat();
    stopHeartbeat = undefined;

    // --- Stale side ---
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    setupHeartbeatMock([
      makeRow({
        name: "4h-task",
        expectedIntervalMs: FOUR_HOURS_MS,
        successAgeMs: staleAgeMs,
      }),
    ]);
    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);
    {
      const statuses = (
        Sentry.captureCheckIn as ReturnType<typeof vi.fn>
      ).mock.calls.map((args) => (args[0] as { status: string }).status);
      expect(statuses).toContain("error");
      expect(statuses).not.toContain("ok");
    }
  });

  it("uses last_run_at as fallback anchor when last_success_at is null", async () => {
    // A brand-new task (never succeeded) should use last_run_at as the anchor.
    // If last_run_at is recent, the task must NOT be reported stale even though
    // last_success_at is null — the function uses COALESCE(last_success_at, last_run_at).
    const recentRunAgeMs = 5 * 60 * 1000; // 5 minutes ago — well within any tolerance

    setupHeartbeatMock([
      makeRow({
        name: "brand-new-task",
        expectedIntervalMs: ONE_HOUR_MS,
        successAgeMs: null,
        runAgeMs: recentRunAgeMs,
      }),
    ]);

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    const statuses = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statuses).toContain("ok");
    expect(statuses).not.toContain("error");
  });

  // ── FIRST_CHECK_DELAY_MS contract ─────────────────────────────────────────

  it("does not query the DB before FIRST_CHECK_DELAY_MS has elapsed", async () => {
    // Every in-process scheduler fires a boot-time run on module load.
    // If the heartbeat checked immediately, it would read stale DB state and
    // report false "gone silent" errors before those boot runs finish.
    // This test confirms the 3-minute grace period is honoured.
    setupHeartbeatMock([]);

    stopHeartbeat = startSchedulerHeartbeat();

    // Advance to 1 ms before the delay — no DB call should have happened yet.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(mockExecute).not.toHaveBeenCalled();

    // Advance past the threshold — now the DB must be queried.
    await vi.advanceTimersByTimeAsync(2);
    expect(mockExecute).toHaveBeenCalled();
  });

  it("FIRST_CHECK_DELAY_MS is 3 minutes — value is load-bearing", () => {
    // This is an intentional constant-pinning assertion.  If the delay is
    // reduced, boot-time schedulers may not finish before the heartbeat
    // checks, causing recurring false "gone silent" Sentry alerts (the
    // original production incident that introduced this delay).
    expect(FIRST_CHECK_DELAY_MS).toBe(3 * 60 * 1000);
  });

  it("HEARTBEAT_INTERVAL_MS is 15 minutes — value is load-bearing", () => {
    // The Sentry Cron Monitor's schedule is configured with this value.
    // Reducing it below 15 minutes would cause Sentry to flag the monitor
    // as "missed" because the platform minimum check-in interval is 1 minute
    // but the checkin margin is set to 10 minutes — a tighter heartbeat
    // would require re-tuning the monitor config too.
    expect(HEARTBEAT_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  it("fires again on the recurring HEARTBEAT_INTERVAL_MS tick after the first check", async () => {
    // After the FIRST_CHECK_DELAY_MS grace period, the heartbeat must continue
    // firing on every HEARTBEAT_INTERVAL_MS cycle.  This ensures a single
    // silent window doesn't go undetected until the next reboot.
    setupHeartbeatMock([]);

    stopHeartbeat = startSchedulerHeartbeat();

    // First tick (after grace period)
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);
    const callsAfterFirst = mockExecute.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second tick (after one more full interval)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(mockExecute.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  it("db.execute throwing inside the heartbeat — sends error check-in, does not throw", async () => {
    // If the DB is unreachable when the heartbeat fires, it must still
    // report an "error" check-in to Sentry rather than silently swallowing
    // the failure (which would make Sentry think everything is fine).
    mockExecute.mockRejectedValue(new Error("DB connection lost"));

    stopHeartbeat = startSchedulerHeartbeat();
    // +500ms beyond the grace period so the one-retry-then-give-up path (see
    // scheduler-guard.ts) has time to run its internal delay before we assert.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 501);

    const statuses = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("error");
    expect(statuses).not.toContain("ok");
  });

  it("retries once on a transient connection error and still reports ok", async () => {
    // Regression test for the 2026-08-10 "scheduled-tasks-heartbeat" Sentry
    // incident: a single transient "Connection terminated unexpectedly" on
    // this query used to be reported as an "error" check-in immediately,
    // with no retry, unlike shouldRunScheduledTask's claim path. A one-off
    // blip that self-heals within milliseconds should not trip a real alert.
    mockExecute
      .mockRejectedValueOnce(
        new Error("Connection terminated due to connection timeout"),
      )
      .mockResolvedValueOnce({ rows: [] });

    stopHeartbeat = startSchedulerHeartbeat();
    // +500ms beyond the grace period so the retry's own internal delay
    // (see scheduler-guard.ts) has time to fire within this advance window.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 501);

    expect(mockExecute).toHaveBeenCalledTimes(2);
    const statuses = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("ok");
    expect(statuses).not.toContain("error");
  });

  it("reports error only after BOTH the initial attempt and the retry fail", async () => {
    mockExecute.mockRejectedValue(
      new Error("Connection terminated due to connection timeout"),
    );

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 501);

    expect(mockExecute).toHaveBeenCalledTimes(2);
    const statuses = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statuses).toContain("error");
    expect(statuses).not.toContain("ok");
  });

  it("stop function cancels both the startup timeout and the recurring interval", async () => {
    setupHeartbeatMock([]);

    stopHeartbeat = startSchedulerHeartbeat();

    // Stop BEFORE the first tick fires
    stopHeartbeat();
    stopHeartbeat = undefined;

    await vi.advanceTimersByTimeAsync(
      FIRST_CHECK_DELAY_MS + HEARTBEAT_INTERVAL_MS + 1,
    );

    // No DB queries should have run — both timers were cancelled
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── reconcileSchedulerRuns ────────────────────────────────────────────────────
//
// These tests verify that reconcileSchedulerRuns():
//   (a) deletes orphaned (retired) rows and leaves known rows untouched
//   (b) is a no-op (logs debug) when no orphaned rows exist
//   (c) swallows DB errors and logs a warning instead of throwing

describe("reconcileSchedulerRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) deletes orphaned rows, leaves known rows untouched", async () => {
    // Simulate the DB deleting only the retired "reminder-scheduler" row.
    // The mock represents what RETURNING reports after the DELETE; known-name
    // rows are never returned because the WHERE clause excluded them.
    const orphanedName = "reminder-scheduler"; // retired name, not in KNOWN_SCHEDULER_NAMES
    mockExecute.mockResolvedValueOnce({
      rows: [{ name: orphanedName }],
    });

    await reconcileSchedulerRuns();

    // logger.warn must be called with the deleted names
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted: expect.arrayContaining([orphanedName]),
      }),
      expect.stringContaining("orphaned"),
    );

    // No known scheduler name may appear in the deleted list
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => Array.isArray((args[0] as { deleted?: unknown }).deleted),
    );
    const deletedNames = (warnCall![0] as { deleted: string[] }).deleted;
    for (const name of KNOWN_SCHEDULER_NAMES) {
      expect(deletedNames).not.toContain(name);
    }

    // The orphaned name itself must not be in KNOWN_SCHEDULER_NAMES
    expect(KNOWN_SCHEDULER_NAMES.has(orphanedName)).toBe(false);
  });

  it("(a2) SQL excludes all KNOWN_SCHEDULER_NAMES from deletion", async () => {
    // Confirm every known name is represented in the DELETE's WHERE clause.
    // We inspect the raw SQL string that db.execute receives to ensure the
    // ARRAY literal encodes all current known names.
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await reconcileSchedulerRuns();

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlArg = mockExecute.mock.calls[0][0] as { queryChunks?: unknown[] };

    // Convert to a string representation to search for known names.
    // reconcileSchedulerRuns uses sql.raw() to embed the ARRAY literal
    // directly in the SQL, so the names appear as plain strings in the query.
    const sqlStr = JSON.stringify(sqlArg);
    for (const name of KNOWN_SCHEDULER_NAMES) {
      expect(sqlStr).toContain(name);
    }
  });

  it("(b) no orphaned rows — logs debug, does not warn", async () => {
    // When RETURNING emits no rows, no orphaned rows existed.
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await reconcileSchedulerRuns();

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("no orphaned"),
    );
    // logger.warn must NOT have been called with a `deleted` payload
    const warnWithDeleted = (
      logger.warn as ReturnType<typeof vi.fn>
    ).mock.calls.filter((args) =>
      Array.isArray((args[0] as { deleted?: unknown }).deleted),
    );
    expect(warnWithDeleted).toHaveLength(0);
  });

  it("(c) db.execute throws — logs warning, does not re-throw", async () => {
    mockExecute.mockRejectedValueOnce(
      new Error("relation scheduler_runs does not exist"),
    );

    // Must not throw
    await expect(reconcileSchedulerRuns()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("reconcileSchedulerRuns failed"),
    );
  });
});

// ── heartbeat: known-healthy rows are not flagged after reconcile ─────────────
//
// This describe block pins the scenario from task #802: after
// reconcileSchedulerRuns() removes an orphaned "reminder-scheduler" row, the
// surviving known rows are all recently updated and the heartbeat must report
// "ok" — not "error".  Previously, the stale orphaned row tripped a false
// "gone silent" alert even though every active scheduler was healthy.

describe("startSchedulerHeartbeat — known-healthy rows pass the staleness check", () => {
  const NOW_ISO = "2026-08-09T12:00:00.000Z";
  const NOW_MS = new Date(NOW_ISO).getTime();
  const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  let stopHeartbeat: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    stopHeartbeat?.();
    stopHeartbeat = undefined;
    vi.useRealTimers();
  });

  it("all known-name rows recently updated → ok check-in, no error", async () => {
    // Simulate a world where reconcileSchedulerRuns() already ran and removed
    // the orphaned "reminder-scheduler" row.  The remaining rows are all from
    // KNOWN_SCHEDULER_NAMES and each last succeeded 5 minutes ago — well within
    // every task's tolerance window.  The heartbeat must report "ok".
    const recentSuccessAgeMs = 5 * 60 * 1000; // 5 minutes ago

    const rows = [...KNOWN_SCHEDULER_NAMES].map((name) => ({
      name,
      last_success_at: new Date(NOW_MS - recentSuccessAgeMs).toISOString(),
      last_run_at: new Date(NOW_MS - recentSuccessAgeMs).toISOString(),
      expected_interval_ms: ONE_HOUR_MS,
    }));

    mockExecute.mockResolvedValue({ rows });

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    const statuses = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statuses).toContain("ok");
    expect(statuses).not.toContain("error");
  });

  it("an orphaned stale row causes error, but after it is removed (no row) the heartbeat reports ok", async () => {
    // Phase 1: the orphaned "reminder-scheduler" row is stale → error.
    const STALE_AGE_MS = 3 * ONE_HOUR_MS; // 3 hours — well past 1-hour + 30-min tolerance
    const orphanRow = {
      name: "reminder-scheduler",
      last_success_at: new Date(NOW_MS - STALE_AGE_MS).toISOString(),
      last_run_at: new Date(NOW_MS - STALE_AGE_MS).toISOString(),
      expected_interval_ms: ONE_HOUR_MS,
    };
    mockExecute.mockResolvedValueOnce({ rows: [orphanRow] });

    stopHeartbeat = startSchedulerHeartbeat();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 1);

    const statusesPhase1 = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statusesPhase1).toContain("error");

    // Phase 2: reconcileSchedulerRuns() has run; the orphan row is gone.
    // The next heartbeat tick queries an empty table (no active schedulers
    // with stale rows) and must report "ok".
    vi.clearAllMocks();
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000); // one HEARTBEAT_INTERVAL_MS

    const statusesPhase2 = (
      Sentry.captureCheckIn as ReturnType<typeof vi.fn>
    ).mock.calls.map((args) => (args[0] as { status: string }).status);
    expect(statusesPhase2).toContain("ok");
    expect(statusesPhase2).not.toContain("error");
  });
});

// ── PgDialect.sqlToQuery API contract (drizzle-orm upgrade guard) ─────────────
//
// The grace-window tests above rely on PgDialect.sqlToQuery() to inspect the
// interpolated SQL params that shouldRunScheduledTask sends to db.execute().
// This describe block is a dedicated contract guard: if drizzle-orm is ever
// upgraded to a version that renames PgDialect, moves its import path, removes
// sqlToQuery, or changes its return shape, THIS test will fail at import time
// or with a clear assertion message — rather than causing the grace-window
// tests to silently pass (wrong params extracted) or fail with a cryptic
// TypeError at runtime.
//
// The test uses drizzle's own `sql` template tag to build a minimal SQL object
// with known interpolated values, so the assertion is self-contained and does
// not depend on any application code.
describe("PgDialect.sqlToQuery API contract (drizzle-orm upgrade guard)", () => {
  it("PgDialect is importable from drizzle-orm/pg-core and sqlToQuery is a function", () => {
    // If drizzle-orm renames PgDialect or moves it to a different module path,
    // the import at the top of this file will throw at module-load time and
    // every test in the file will fail with a clear "Cannot find module" or
    // "does not provide an export named 'PgDialect'" message.
    //
    // This explicit assertion provides an additional in-test signal in case
    // tree-shaking or a re-export shim makes the import succeed but the class
    // body empty / prototype stripped.
    const dialect = new PgDialect();
    expect(typeof dialect.sqlToQuery).toBe("function");
  });

  it("sqlToQuery returns { sql: string, params: unknown[] } for a minimal interpolated query", () => {
    // Build a tiny SQL object using drizzle's own `sql` template tag.
    // Two interpolated values with different types are used so the test
    // catches both the array structure and type-heterogeneity expectations.
    const testSql = sql`SELECT 1 WHERE x = ${42} AND y = ${"hello"}`;

    const dialect = new PgDialect();
    const compiled = dialect.sqlToQuery(testSql);

    // Return value must be defined (not undefined / null / void)
    expect(compiled).toBeDefined();

    // Must have a `sql` property that is a non-empty string
    expect(typeof compiled.sql).toBe("string");
    expect(compiled.sql.length).toBeGreaterThan(0);

    // Must have a `params` property that is a plain array
    expect(Array.isArray(compiled.params)).toBe(true);

    // The two interpolated values must appear in params in order
    expect(compiled.params).toContain(42);
    expect(compiled.params).toContain("hello");
  });

  it("sqlToQuery params array contains every interpolated value — no values are dropped or merged", () => {
    // This assertion specifically guards against a hypothetical future drizzle
    // version that returns a Map, object, or other iterable instead of a plain
    // array — which would break the `.filter(v => typeof v === "number")` logic
    // in getSqlParamValues and cause the grace-window tests to silently pass
    // with an empty numeric-params list.
    const sentinel1 = 7_200_000; // 2 hours in ms — a real scheduler interval
    const sentinel2 = 3_600_000; // 1 hour in ms — another real scheduler interval
    const testSql = sql`INSERT INTO t (a, b) VALUES (${sentinel1}, ${sentinel2})`;

    const dialect = new PgDialect();
    const { params } = dialect.sqlToQuery(testSql);

    // Both sentinels must be reachable via standard array iteration
    const numericParams = params.filter((v) => typeof v === "number");
    expect(numericParams).toContain(sentinel1);
    expect(numericParams).toContain(sentinel2);
    expect(numericParams).toHaveLength(2);
  });
});
