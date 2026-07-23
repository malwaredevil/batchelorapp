/**
 * Tests for the job-queue worker infrastructure (#308).
 *
 * Covers:
 *   - claimJob SQL includes stale 'running' jobs with expired leases so a
 *     crashed-worker's in-flight job is retried automatically.
 *   - markFailed transitions to 'retry_wait' when attempt_count < max_attempts
 *     and to 'dead_letter' when attempts are exhausted.
 *
 * Strategy: fake all timers BEFORE importing/starting the worker, then use
 * vi.advanceTimersByTimeAsync() to fire the 5-second poll interval and flush
 * the async processOne chain in one step.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — refs available inside vi.mock factories (hoisted before imports)
// ---------------------------------------------------------------------------
const { capturedQueries, mockQueryFn, mockHandlerFn } = vi.hoisted(() => {
  const capturedQueries: { sql: string; params: unknown[] }[] = [];

  // Default implementation: return a claimed job row for the UPDATE…RETURNING
  // query and empty rows for everything else.
  const defaultJob = {
    id: 1,
    type: "slack.turn",
    payload: {
      userId: 7,
      slackEventId: "Ev001",
      inputText: "Hi",
      channelId: "D999",
    },
    attempt_count: 1,
    max_attempts: 3,
  };
  const mockQueryFn = vi.fn(async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("RETURNING id, type, payload")) {
      return { rows: [defaultJob] };
    }
    return { rows: [], rowCount: 0 };
  });

  const mockHandlerFn = vi.fn().mockResolvedValue(undefined);

  return { capturedQueries, mockQueryFn, mockHandlerFn };
});

// ---------------------------------------------------------------------------
// Mocks — must be declared before any static imports that reference them.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) =>
      mockQueryFn(...(args as [string, unknown[]])),
  },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Minimal registry mock: keep the real shape but replace the handler so tests
// don't pull in the full Elaine engine.  registry.ts only imports "zod" at
// the top level so importOriginal is safe here (no @workspace/db chain).
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  const minimalDef = {
    ...actual.JOB_REGISTRY_BY_TYPE.get("slack.turn")!,
    handler: mockHandlerFn,
  };
  return {
    ...actual,
    JOB_REGISTRY_BY_TYPE: new Map([
      ...actual.JOB_REGISTRY_BY_TYPE,
      ["slack.turn", minimalDef],
    ]),
  };
});

vi.mock("./queue", () => ({
  updateProgress: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trigger exactly one processOne cycle:
 *   1. Start the worker with fake timers already active.
 *   2. Advance fake time past the 5 000 ms poll interval.
 *   3. vi.advanceTimersByTimeAsync() fires the setInterval callback AND
 *      awaits all promise microtasks that it spawns, so claimJob / handler /
 *      markSucceeded/markFailed all complete before this function returns.
 *   4. Stop the worker and let tests assert on capturedQueries.
 */
async function runOneWorkerCycle(queue = "slack"): Promise<void> {
  const { startJobWorker, stopJobWorker } = await import("./worker");
  startJobWorker(queue);
  await vi.advanceTimersByTimeAsync(5_001);
  await stopJobWorker(queue);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("worker — stale running-job lease recovery", () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers(); // fake timers BEFORE worker starts / imports happen

    // Restore the default: claim query returns a job, everything else empty.
    const defaultJob = {
      id: 1,
      type: "slack.turn",
      payload: {
        userId: 7,
        slackEventId: "Ev001",
        inputText: "Hi",
        channelId: "D999",
      },
      attempt_count: 1,
      max_attempts: 3,
    };
    mockQueryFn.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        capturedQueries.push({ sql, params });
        if (sql.includes("RETURNING id, type, payload")) {
          return { rows: [defaultJob] };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    mockHandlerFn.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("claimJob SQL claims stale running jobs with expired leases", async () => {
    await runOneWorkerCycle();

    const claimQuery = capturedQueries.find((q) =>
      q.sql.includes("RETURNING id, type, payload"),
    );
    expect(claimQuery, "claimJob must have fired").toBeDefined();

    // The WHERE clause must include the stale running-job recovery branch so
    // a job stuck in 'running' (worker died mid-turn) is automatically reclaimed.
    expect(claimQuery!.sql).toContain("'running'");
    expect(claimQuery!.sql).toContain("lease_expires_at < now()");

    // Normal statuses must still be present.
    expect(claimQuery!.sql).toContain("'queued'");
    expect(claimQuery!.sql).toContain("'retry_wait'");
  });

  it("markFailed transitions to retry_wait when attempts remain", async () => {
    // Make the handler throw so markFailed runs.
    mockHandlerFn.mockRejectedValueOnce(new Error("transient error"));

    await runOneWorkerCycle();

    const failQuery = capturedQueries.find(
      (q) =>
        q.sql.includes("SET status = $2") && q.params.includes("retry_wait"),
    );
    expect(failQuery, "markFailed must set status = retry_wait").toBeDefined();
  });

  it("markFailed transitions to dead_letter when max attempts are exhausted", async () => {
    // Return a job already at max_attempts so the next failure becomes dead_letter.
    const exhaustedJob = {
      id: 2,
      type: "slack.turn",
      payload: {
        userId: 7,
        slackEventId: "Ev002",
        inputText: "Hi",
        channelId: "D999",
      },
      attempt_count: 3, // == max_attempts → dead_letter
      max_attempts: 3,
    };
    mockQueryFn.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        capturedQueries.push({ sql, params });
        if (sql.includes("RETURNING id, type, payload")) {
          return { rows: [exhaustedJob] };
        }
        return { rows: [], rowCount: 0 };
      },
    );
    mockHandlerFn.mockRejectedValueOnce(new Error("final failure"));

    await runOneWorkerCycle();

    const deadLetterQuery = capturedQueries.find(
      (q) =>
        q.sql.includes("SET status = $2") && q.params.includes("dead_letter"),
    );
    expect(
      deadLetterQuery,
      "markFailed must set status = dead_letter when attempts exhausted",
    ).toBeDefined();
  });
});
