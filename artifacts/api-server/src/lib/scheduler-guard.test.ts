/**
 * Unit tests for shouldRunScheduledTask()
 *
 * The function's claim logic lives entirely in PostgreSQL's UPSERT WHERE
 * clause — the TypeScript wrapper either sees a returned row (claimed) or an
 * empty result (skipped).  These tests mock db.execute to inject the DB
 * response for each scenario so the function's branching behaviour is
 * verified without a live database.
 *
 * Scenarios:
 *   (a) first run (no row) → INSERT succeeds, returns row → claims
 *   (b) ran and succeeded recently → WHERE fails, no row returned → skips
 *   (c) claimed but killed mid-run (last_run_at fresh, last_success_at stale)
 *       → WHERE succeeds once last_run_at is old enough → claims (the bug scenario)
 *   (d) never succeeded, last_run_at fresh → Arm 1 fails (too soon), Arm 2
 *       skipped (last_success_at IS NULL) → no row → skips
 *   (e) db.execute throws → fail-closed → returns false without throwing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { shouldRunScheduledTask } from "./scheduler-guard";
import { logger } from "./logger";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate the UPSERT returning one row (claim succeeded). */
function claimedResult() {
  return { rows: [{ name: "test-task" }] };
}

/** Simulate the UPSERT returning no rows (WHERE clause rejected the claim). */
function skippedResult() {
  return { rows: [] };
}

/**
 * db.execute is called twice per shouldRunScheduledTask invocation:
 *   1. The INSERT ... ON CONFLICT ... RETURNING name  (claim attempt)
 *   2. UPDATE scheduler_runs SET expected_interval_ms = ...  (always-run housekeeping)
 *
 * The second call's return value is irrelevant to the boolean result, so we
 * set it to an empty result for all scenarios.
 */
function setupExecuteMocks(firstCallResult: { rows: unknown[] }) {
  mockExecute
    .mockResolvedValueOnce(firstCallResult) // claim attempt
    .mockResolvedValueOnce({ rows: [] }); // interval housekeeping
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("shouldRunScheduledTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) first run — no existing row — claims the run", async () => {
    // On the very first run for a task name the INSERT succeeds
    // (no conflict), and the RETURNING clause gives back the new row.
    setupExecuteMocks(claimedResult());

    const result = await shouldRunScheduledTask("new-task", 60 * 60 * 1000);

    expect(result).toBe(true);
  });

  it("(b) ran and succeeded recently — too soon — skips", async () => {
    // The existing row's last_run_at (= last_success_at) is recent.
    // The UPSERT WHERE clause (Arm 1: last_run_at < now() - interval)
    // evaluates to false, so DO UPDATE is not applied and RETURNING
    // returns nothing.
    setupExecuteMocks(skippedResult());

    const result = await shouldRunScheduledTask(
      "recent-success-task",
      60 * 60 * 1000,
    );

    expect(result).toBe(false);
  });

  it("(c) claimed but killed mid-run — last_run_at fresh, last_success_at stale — claims immediately (crash-recovery arm)", async () => {
    // This is the core bug scenario fixed by the COALESCE change.
    //
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
    // → RETURNING gives back the row.
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
    // Arm 2 is skipped: last_success_at IS NULL → the IS NOT NULL guard
    //   prevents Arm 2 from triggering, so there is no crash-recovery
    //   false-positive when a brand-new task is still on its first run.
    // → RETURNING gives back nothing.
    setupExecuteMocks(skippedResult());

    const result = await shouldRunScheduledTask(
      "never-succeeded-task",
      60 * 60 * 1000,
    );

    expect(result).toBe(false);
  });

  it("(e) db.execute throws — fail-closed — returns false without re-throwing", async () => {
    // If the scheduler_runs table is missing (e.g. bootstrap hasn't run yet)
    // or the DB is momentarily unreachable, the guard must not let the
    // expensive AI job through.  It should absorb the error and return false.
    mockExecute.mockRejectedValueOnce(
      new Error("relation scheduler_runs does not exist"),
    );

    const result = await shouldRunScheduledTask("fragile-task", 60 * 60 * 1000);

    expect(result).toBe(false);
  });

  it("claimed run — calls db.execute exactly twice (claim + interval housekeeping)", async () => {
    setupExecuteMocks(claimedResult());

    await shouldRunScheduledTask("housekeeping-task", 30 * 60 * 1000);

    // First call:  INSERT ... ON CONFLICT ... RETURNING name  (claim attempt)
    // Second call: UPDATE ... SET expected_interval_ms = ...  (always-run)
    // No anchor SELECT on a successful claim — that only fires on deny.
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("denied claim — calls db.execute three times and logs last_run_at + last_success_at at debug level", async () => {
    // When the UPSERT WHERE clause denies the claim (too soon), the function
    // makes a follow-up SELECT to retrieve the row timestamps so operators
    // can see exactly why the run was denied without querying the DB.
    //
    // DB call sequence on a denied claim:
    //   1. INSERT ... ON CONFLICT ... RETURNING name  → [] (denied)
    //   2. SELECT last_run_at, last_success_at         → anchor row
    //   3. UPDATE ... SET expected_interval_ms = ...   → always-run housekeeping
    // Normal cadence: last_run_at is recent, last_success_at is even newer
    // (task completed successfully; both arms deny a re-claim).
    // last_success_at >= last_run_at means isActiveClaim is false → the
    // deny is driven by the Arm 1 cooldown on last_run_at, not crash-recovery.
    const lastRunAt = "2026-08-04T07:59:00.000Z";
    const lastSuccessAt = "2026-08-04T07:59:05.000Z"; // task finished 5s after it started

    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // 1. claim denied
      .mockResolvedValueOnce({
        rows: [{ last_run_at: lastRunAt, last_success_at: lastSuccessAt }],
      }) // 2. anchor lookup
      .mockResolvedValueOnce({ rows: [] }); // 3. interval housekeeping

    const result = await shouldRunScheduledTask("recent-task", 60 * 60 * 1000);

    expect(result).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(3);

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
    // (the process was killed mid-run).  The deny reason is the 10-minute
    // run-timeout, not the normal interval.
    const lastRunAt = "2026-08-04T08:05:00.000Z"; // recent (mid-run)
    const lastSuccessAt = "2026-08-04T07:00:00.000Z"; // older (last success)

    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // claim denied
      .mockResolvedValueOnce({
        rows: [{ last_run_at: lastRunAt, last_success_at: lastSuccessAt }],
      })
      .mockResolvedValueOnce({ rows: [] });

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

  it("denied claim with anchor SELECT failure — still returns false, does not throw", async () => {
    // The anchor SELECT is non-fatal: if it throws (e.g. transient DB
    // error), the deny decision is unaffected and no exception escapes.
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // claim denied
      .mockRejectedValueOnce(new Error("transient DB error")) // anchor SELECT fails
      .mockResolvedValueOnce({ rows: [] }); // interval housekeeping

    const result = await shouldRunScheduledTask(
      "fragile-anchor-task",
      60 * 60 * 1000,
    );

    expect(result).toBe(false);
  });
});
