/**
 * Tests for the two-strike consecutive-error gate in integrations-health-nudges.
 *
 * Three suites:
 *   A. computeAndStoreIntegrationsHealthNudges — in-process counter + DB persistence
 *   B. primeLastKnownStatus                   — DB state load + counter seeding
 *   C. runScheduledIntegrationsHealthNudges    — stateless cron + DB-backed counter
 *
 * Key invariants tested:
 *   1. A single error reading never fires a failure nudge.
 *   2. The failure nudge fires exactly once when count transitions to 2.
 *   3. At count ≥ 3 no additional failure nudge is enqueued.
 *   4. Recovery nudge fires on the first ok reading after a confirmed failure (≥ 2).
 *   5. No recovery nudge after a transient single-blip (count was 1).
 *   6. Server restart with confirmed failure (DB count ≥ 2) → continued error
 *      does NOT re-emit a duplicate alert.
 *   7. Server restart with confirmed failure (DB count ≥ 2) → recovery DOES
 *      emit a recovery nudge (count primed to ≥ 2 → prevCount ≥ 2 triggers it).
 *
 * call shape: client.query(sql, paramsArray) → mock.calls[i] = [sql, paramsArray]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockRunAllChecks = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...real,
    pool: {
      connect: vi.fn().mockResolvedValue({
        query: mockQuery,
        release: mockRelease,
      }),
    },
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      }),
    },
  };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./scheduler-guard", () => ({
  shouldRunScheduledTask: vi.fn().mockResolvedValue(true),
  recordScheduledTaskSuccess: vi.fn().mockResolvedValue(undefined),
  recordScheduledTaskFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/admin/integrations-health", () => ({
  runAllChecks: mockRunAllChecks,
}));

// ── Subject ───────────────────────────────────────────────────────────────────

import {
  computeAndStoreIntegrationsHealthNudges,
  runScheduledIntegrationsHealthNudges,
  primeLastKnownStatus,
  _resetTestState,
} from "./integrations-health-nudges";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const errCheck = (service: string, detail = "timeout after 15000ms") => ({
  service,
  status: "error" as const,
  detail,
});
const okCheck = (service: string) => ({ service, status: "ok" as const });
const missingKeyCheck = (service: string) => ({
  service,
  status: "missing_key" as const,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

type QueryCall = unknown[];

/** Filter calls whose SQL contains "elaine_nudges" (nudge inserts). */
function nudgeInsertCalls(calls: QueryCall[]): QueryCall[] {
  return calls.filter(
    (c) =>
      typeof c[0] === "string" && (c[0] as string).includes("elaine_nudges"),
  );
}

/** Filter calls whose SQL contains "integrations_health_state" and "INSERT" (state upserts). */
function stateUpsertCalls(calls: QueryCall[]): QueryCall[] {
  return calls.filter(
    (c) =>
      typeof c[0] === "string" &&
      (c[0] as string).includes("integrations_health_state") &&
      (c[0] as string).includes("INSERT"),
  );
}

/** Filter calls whose SQL contains "integrations_health_state" and "SELECT" (state reads). */
function stateSelectCalls(calls: QueryCall[]): QueryCall[] {
  return calls.filter(
    (c) =>
      typeof c[0] === "string" &&
      (c[0] as string).includes("integrations_health_state") &&
      (c[0] as string).includes("SELECT"),
  );
}

/** Extract the params array (2nd arg) from a query call. */
function params(call: QueryCall): unknown[] {
  return call[1] as unknown[];
}

/**
 * Configure mockQuery for a priming run that reads `stateRows` from the DB,
 * then resolves all subsequent inserts/upserts with { rowCount: 1 }.
 *
 * Priming issues one SELECT per call to primeLastKnownStatus.
 */
function mockPrimeState(
  stateRows: { service: string; consecutive_error_count: number }[],
) {
  mockQuery
    .mockResolvedValueOnce({ rows: stateRows, rowCount: stateRows.length })
    .mockResolvedValue({ rows: [], rowCount: 1 });
}

// ── A. In-process path ────────────────────────────────────────────────────────
//
// computeAndStoreIntegrationsHealthNudges uses _consecutiveErrorCount (in-memory)
// and ALSO persists updated counts to DB via integrations_health_state upserts.
// Tests use nudgeInsertCalls / stateUpsertCalls to isolate the assertions.

describe("computeAndStoreIntegrationsHealthNudges — consecutive-error gate", () => {
  beforeEach(() => {
    _resetTestState();
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it("single error then recovery → no failure nudge, no recovery nudge", async () => {
    // Run 1: first error (count → 1, below threshold)
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter")],
    });
    await computeAndStoreIntegrationsHealthNudges();

    const calls1 = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(calls1)).toHaveLength(0);
    // State UPSERT still happens (count=1 persisted)
    expect(stateUpsertCalls(calls1)).toHaveLength(1);
    expect(params(stateUpsertCalls(calls1)[0]!)[1]).toBe(1);

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Run 2: recovery (count was 1, prevCount < 2 → no recovery nudge)
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("OpenRouter")] });
    await computeAndStoreIntegrationsHealthNudges();

    const calls2 = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(calls2)).toHaveLength(0);
    expect(params(stateUpsertCalls(calls2)[0]!)[1]).toBe(0); // reset to 0
  });

  it("two consecutive errors → failure nudge fires exactly on the 2nd run", async () => {
    // Run 1: error (count → 1, no nudge)
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Slack", "connect timeout")],
    });
    await computeAndStoreIntegrationsHealthNudges();
    expect(nudgeInsertCalls(mockQuery.mock.calls as QueryCall[])).toHaveLength(
      0,
    );

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Run 2: error (count → 2, nudge fires)
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Slack", "connect timeout")],
    });
    await computeAndStoreIntegrationsHealthNudges();

    const calls2 = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(calls2);
    expect(nudges).toHaveLength(1);
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_failure:Slack:/,
    );

    const upserts = stateUpsertCalls(calls2);
    expect(upserts).toHaveLength(1);
    expect(params(upserts[0]!)[1]).toBe(2);
  });

  it("three+ consecutive errors → no additional nudge beyond the 2nd run", async () => {
    // Reach confirmed-failure state (count = 2, nudge fired)
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    expect(nudgeInsertCalls(mockQuery.mock.calls as QueryCall[])).toHaveLength(
      1,
    );

    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Run 3: count = 3, gate `newCount === 2` is false → no new nudge
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    const calls3 = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(calls3)).toHaveLength(0);
    expect(params(stateUpsertCalls(calls3)[0]!)[1]).toBe(3);
  });

  it("recovery after confirmed failure → recovery nudge fires", async () => {
    // Reach confirmed-failure state
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Jina AI")] });
    await computeAndStoreIntegrationsHealthNudges();
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Jina AI")] });
    await computeAndStoreIntegrationsHealthNudges();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Recovery run
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("Jina AI")] });
    await computeAndStoreIntegrationsHealthNudges();

    const calls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(calls);
    expect(nudges).toHaveLength(1);
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_recovery:Jina AI:/,
    );
    expect(params(stateUpsertCalls(calls)[0]!)[1]).toBe(0); // reset to 0
  });

  it("recovery after confirmed failure with comma-containing service name → message is sanitised", async () => {
    // Reach confirmed-failure state using a service name that contains a comma.
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Google, Maps")],
    });
    await computeAndStoreIntegrationsHealthNudges();
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Google, Maps")],
    });
    await computeAndStoreIntegrationsHealthNudges();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Recovery run — sanitiseServiceName must strip the comma from the message.
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [okCheck("Google, Maps")],
    });
    await computeAndStoreIntegrationsHealthNudges();

    const calls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(calls);
    expect(nudges).toHaveLength(1);

    const message = params(nudges[0]!)[2] as string;
    // The comma must not appear in the human-readable message body.
    expect(message).not.toContain("Google, Maps");
    // The sanitised name (comma replaced by space) must be present.
    expect(message).toContain("Google Maps");
    // The nudge key uses the raw service string (for dedup identity), not the sanitised name.
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_recovery:Google, Maps:/,
    );
    expect(params(stateUpsertCalls(calls)[0]!)[1]).toBe(0); // count reset to 0
  });

  it("recovery after single blip (count was 1) → no recovery nudge", async () => {
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Apify")] });
    await computeAndStoreIntegrationsHealthNudges();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("Apify")] });
    await computeAndStoreIntegrationsHealthNudges();

    const calls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(calls)).toHaveLength(0);
    expect(params(stateUpsertCalls(calls)[0]!)[1]).toBe(0);
  });

  it("confirmed failure → missing_key → no recovery nudge, count reset to 0", async () => {
    // Reach confirmed-failure state (count = 2)
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Key is removed — must NOT emit a recovery nudge
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [missingKeyCheck("Resend")],
    });
    await computeAndStoreIntegrationsHealthNudges();

    const calls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(calls)).toHaveLength(0); // no recovery nudge
    expect(params(stateUpsertCalls(calls)[0]!)[1]).toBe(0); // count reset
  });
});

// ── B. Priming path ───────────────────────────────────────────────────────────
//
// primeLastKnownStatus() reads integrations_health_state from DB and seeds
// _consecutiveErrorCount from those persisted values.

describe("primeLastKnownStatus — DB state seeding", () => {
  beforeEach(() => {
    _resetTestState();
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it("fresh start (empty DB) with error → one subsequent error run fires the nudge", async () => {
    // Priming: empty DB state → error service primed to count=1
    mockPrimeState([]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter")],
    });
    await primeLastKnownStatus();

    const primingCalls = mockQuery.mock.calls as QueryCall[];
    expect(stateSelectCalls(primingCalls)).toHaveLength(1); // one SELECT during priming
    expect(nudgeInsertCalls(primingCalls)).toHaveLength(0); // priming never inserts nudges
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Post-priming nudge run: still in error (count 1+1=2 → nudge fires)
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter")],
    });
    await computeAndStoreIntegrationsHealthNudges();

    const runCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(runCalls);
    expect(nudges).toHaveLength(1);
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_failure:OpenRouter:/,
    );
  });

  it("fresh start with error → recovery before 2nd run → no nudge of any kind", async () => {
    mockPrimeState([]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Slack")] });
    await primeLastKnownStatus();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Recovers on first nudge run (count was 1, not ≥ 2 → no recovery nudge)
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("Slack")] });
    await computeAndStoreIntegrationsHealthNudges();

    expect(nudgeInsertCalls(mockQuery.mock.calls as QueryCall[])).toHaveLength(
      0,
    );
  });

  it("fresh start with ok → two subsequent errors still required for nudge", async () => {
    mockPrimeState([]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("Resend")] });
    await primeLastKnownStatus();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // First post-priming error (count 0+1=1, no nudge)
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    expect(nudgeInsertCalls(mockQuery.mock.calls as QueryCall[])).toHaveLength(
      0,
    );
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Second consecutive error (count 1+1=2, nudge fires)
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();
    expect(nudgeInsertCalls(mockQuery.mock.calls as QueryCall[])).toHaveLength(
      1,
    );
  });

  // ── Restart scenarios ────────────────────────────────────────────────────────

  it("restart after confirmed failure (DB count 2) + continued error → no duplicate alert", async () => {
    // Priming inherits DB count=2 → _consecutiveErrorCount set to 2
    mockPrimeState([{ service: "OpenRouter", consecutive_error_count: 2 }]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter")],
    });
    await primeLastKnownStatus();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // First post-restart nudge run: prevCount=2, newCount=3, gate 3!==2 → no nudge
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter")],
    });
    await computeAndStoreIntegrationsHealthNudges();

    const runCalls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(runCalls)).toHaveLength(0);
    // Count persisted as 3
    expect(params(stateUpsertCalls(runCalls)[0]!)[1]).toBe(3);
  });

  it("restart after confirmed failure (DB count 2) + recovery → recovery nudge fires", async () => {
    mockPrimeState([{ service: "Resend", consecutive_error_count: 2 }]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Resend")] });
    await primeLastKnownStatus();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Recovery: prevCount=2 ≥ 2 → recovery nudge fires
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("Resend")] });
    await computeAndStoreIntegrationsHealthNudges();

    const runCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(runCalls);
    expect(nudges).toHaveLength(1);
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_recovery:Resend:/,
    );
    expect(params(stateUpsertCalls(runCalls)[0]!)[1]).toBe(0); // reset to 0
  });

  it("restart with count=1 (unconfirmed, error still present) → next error run fires nudge", async () => {
    // DB had count=1 (one observed error, no alert yet). After restart, service
    // is still in error. Primed to max(1, 1)=1. Next error run: 1+1=2, alert fires.
    mockPrimeState([{ service: "Apify", consecutive_error_count: 1 }]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Apify")] });
    await primeLastKnownStatus();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Apify")] });
    await computeAndStoreIntegrationsHealthNudges();

    const runCalls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(runCalls)).toHaveLength(1);
    expect(params(nudgeInsertCalls(runCalls)[0]!)[1] as string).toMatch(
      /^integration_failure:Apify:/,
    );
  });
});

// ── C. Scheduled-deployment path ──────────────────────────────────────────────

describe("runScheduledIntegrationsHealthNudges — DB-backed consecutive-error gate", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  function mockStateRows(
    stateRows: { service: string; consecutive_error_count: number }[],
  ) {
    mockQuery
      .mockResolvedValueOnce({ rows: stateRows, rowCount: stateRows.length })
      .mockResolvedValue({ rows: [], rowCount: 1 });
  }

  it("first error (DB count 0 → 1) → no nudge, state updated to count 1", async () => {
    mockStateRows([]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter")],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(allCalls)).toHaveLength(0);
    const upserts = stateUpsertCalls(allCalls);
    expect(upserts).toHaveLength(1);
    expect(params(upserts[0]!)[0]).toBe("OpenRouter");
    expect(params(upserts[0]!)[1]).toBe(1);
  });

  it("second error (DB count 1 → 2) → failure nudge fires, state updated to count 2", async () => {
    mockStateRows([{ service: "OpenRouter", consecutive_error_count: 1 }]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("OpenRouter", "HTTP 503: Service Unavailable")],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);
    expect(nudges).toHaveLength(1);
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_failure:OpenRouter:/,
    );
    expect(params(stateUpsertCalls(allCalls)[0]!)[1]).toBe(2);
  });

  it("third error (DB count 2 → 3) → no new nudge, state updated to count 3", async () => {
    mockStateRows([{ service: "Slack", consecutive_error_count: 2 }]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [errCheck("Slack")] });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(allCalls)).toHaveLength(0);
    expect(params(stateUpsertCalls(allCalls)[0]!)[1]).toBe(3);
  });

  it("recovery after confirmed failure (DB count 2) → recovery nudge, state reset to 0", async () => {
    mockStateRows([{ service: "Resend", consecutive_error_count: 2 }]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("Resend")] });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);
    expect(nudges).toHaveLength(1);
    expect(params(nudges[0]!)[1] as string).toMatch(
      /^integration_recovery:Resend:/,
    );
    expect(params(stateUpsertCalls(allCalls)[0]!)[1]).toBe(0);
  });

  it("recovery after single blip (DB count 1) → no nudge, state reset to 0", async () => {
    mockStateRows([{ service: "AgentPhone", consecutive_error_count: 1 }]);
    mockRunAllChecks.mockResolvedValueOnce({ checks: [okCheck("AgentPhone")] });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(allCalls)).toHaveLength(0);
    expect(params(stateUpsertCalls(allCalls)[0]!)[1]).toBe(0);
  });

  it("confirmed failure → missing_key → no recovery nudge, count reset to 0", async () => {
    mockStateRows([{ service: "Resend", consecutive_error_count: 2 }]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [missingKeyCheck("Resend")],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    expect(nudgeInsertCalls(allCalls)).toHaveLength(0); // no recovery nudge
    expect(params(stateUpsertCalls(allCalls)[0]!)[1]).toBe(0); // count reset
  });

  it("multiple services: independent counters — only the one at count 2 fires a nudge", async () => {
    mockStateRows([
      { service: "Supabase", consecutive_error_count: 0 }, // first error → count 1
      { service: "Resend", consecutive_error_count: 1 }, // second error → count 2, FAILURE nudge
      { service: "Slack", consecutive_error_count: 2 }, // ok → RECOVERY nudge + reset
    ]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Supabase"), errCheck("Resend"), okCheck("Slack")],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);
    expect(nudges).toHaveLength(2);

    const nudgeKeys = nudges.map((c) => params(c)[1] as string);
    expect(
      nudgeKeys.some((k) => k.startsWith("integration_failure:Resend:")),
    ).toBe(true);
    expect(
      nudgeKeys.some((k) => k.startsWith("integration_recovery:Slack:")),
    ).toBe(true);
    expect(nudgeKeys.some((k) => k.includes("Supabase"))).toBe(false);

    // Three services → three state UPSERTs
    expect(stateUpsertCalls(allCalls)).toHaveLength(3);
  });

  // ── Batch-cap (capFailureNudges) ─────────────────────────────────────────────

  it("4 services fail simultaneously → single consolidated batch nudge, no individual failure keys", async () => {
    // All four services at count=1; this run pushes each to count=2 → all qualify
    // as failure candidates. capFailureNudges should replace the 4 individual
    // candidates with one consolidated message.
    mockStateRows([
      { service: "Supabase", consecutive_error_count: 1 },
      { service: "Resend", consecutive_error_count: 1 },
      { service: "Slack", consecutive_error_count: 1 },
      { service: "OpenRouter", consecutive_error_count: 1 },
    ]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [
        errCheck("Supabase"),
        errCheck("Resend"),
        errCheck("Slack"),
        errCheck("OpenRouter"),
      ],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);

    // Only one consolidated nudge — not four individual ones.
    expect(nudges).toHaveLength(1);

    const key = params(nudges[0]!)[1] as string;
    // Batch key is date-scoped: integration_failure_batch:YYYY-MM-DD
    expect(key).toMatch(/^integration_failure_batch:\d{4}-\d{2}-\d{2}$/);
    // No individual per-service failure key present.
    expect(key.startsWith("integration_failure:")).toBe(false);

    // Message must contain the count (4) and all four service names.
    const message = params(nudges[0]!)[2] as string;
    expect(message).toContain("4");
    expect(message).toContain("Supabase");
    expect(message).toContain("Resend");
    expect(message).toContain("Slack");
    expect(message).toContain("OpenRouter");

    // All 4 per-service state counters still get persisted.
    expect(stateUpsertCalls(allCalls)).toHaveLength(4);
  });

  it("exactly 3 services fail → individual failure keys emitted, no consolidated batch key", async () => {
    // 3 services at count=1 → each reaches count=2 on this run.
    // capFailureNudges only consolidates when count > MAX (3), so 3 stays individual.
    mockStateRows([
      { service: "Supabase", consecutive_error_count: 1 },
      { service: "Resend", consecutive_error_count: 1 },
      { service: "Slack", consecutive_error_count: 1 },
    ]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Supabase"), errCheck("Resend"), errCheck("Slack")],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);

    // 3 individual nudges — not consolidated.
    expect(nudges).toHaveLength(3);
    const keys = nudges.map((c) => params(c)[1] as string);
    expect(keys.every((k) => k.startsWith("integration_failure:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("integration_failure_batch:"))).toBe(
      false,
    );
  });

  it("batch key is scoped to today's UTC date so same-day runs share the same dedup key", async () => {
    mockStateRows([
      { service: "Supabase", consecutive_error_count: 1 },
      { service: "Resend", consecutive_error_count: 1 },
      { service: "Slack", consecutive_error_count: 1 },
      { service: "OpenRouter", consecutive_error_count: 1 },
    ]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [
        errCheck("Supabase"),
        errCheck("Resend"),
        errCheck("Slack"),
        errCheck("OpenRouter"),
      ],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);
    expect(nudges).toHaveLength(1);

    const key = params(nudges[0]!)[1] as string;
    // Extract the date portion and confirm it matches today (UTC).
    const datePart = key.replace("integration_failure_batch:", "");
    const todayUtc = new Date().toISOString().slice(0, 10);
    expect(datePart).toBe(todayUtc);
  });

  it("service name with a comma is sanitised — count is correct and message is well-formed", async () => {
    // "Google, Maps" contains an embedded comma that would break a naive join.
    // After sanitisation the comma is replaced with a space so the list separator
    // is unambiguous and the count in the message matches the number of services.
    mockStateRows([
      { service: "Supabase", consecutive_error_count: 1 },
      { service: "Resend", consecutive_error_count: 1 },
      { service: "Slack", consecutive_error_count: 1 },
      { service: "Google, Maps", consecutive_error_count: 1 }, // embedded comma
    ]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [
        errCheck("Supabase"),
        errCheck("Resend"),
        errCheck("Slack"),
        errCheck("Google, Maps"),
      ],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);

    // One consolidated nudge for 4 services.
    expect(nudges).toHaveLength(1);

    const message = params(nudges[0]!)[2] as string;

    // Count must read "4" — not "5" (which a naive split on ", " would produce
    // by treating the embedded comma as an extra separator).
    expect(message).toContain("4");

    // All four sanitised names must appear in the message.
    expect(message).toContain("Supabase");
    expect(message).toContain("Resend");
    expect(message).toContain("Slack");
    // The embedded comma is replaced with a space, so "Google Maps" appears.
    expect(message).toContain("Google Maps");
  });

  it("comma-containing service name → sanitised in individual failure message (≤3 services, no batch)", async () => {
    // "Google, Maps" has an embedded comma; with only 1 service failing the
    // batch cap does not apply and an individual failure nudge is emitted.
    // The embedded comma must be replaced with a space in the message body so
    // the alert text reads naturally and cannot be mis-parsed as a list.
    mockStateRows([{ service: "Google, Maps", consecutive_error_count: 1 }]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [errCheck("Google, Maps", "HTTP 503")],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);

    // One individual failure nudge — not a consolidated batch.
    expect(nudges).toHaveLength(1);

    const key = params(nudges[0]!)[1] as string;
    // The nudge key embeds the raw service name (used for dedup), not sanitised.
    expect(key).toMatch(/^integration_failure:Google, Maps:/);

    const message = params(nudges[0]!)[2] as string;
    // The embedded comma must NOT appear in the message body — it should be a space.
    expect(message).not.toMatch(/Google,\s*Maps/);
    // The sanitised name "Google Maps" (space, no comma) must appear instead.
    expect(message).toContain("Google Maps");
    // The standard individual-failure wording must be present.
    expect(message).toContain("is returning errors");
  });

  it("4 failures + 1 recovery → consolidated failure nudge + recovery nudge (no individual failure keys)", async () => {
    mockStateRows([
      { service: "Supabase", consecutive_error_count: 1 },
      { service: "Resend", consecutive_error_count: 1 },
      { service: "Slack", consecutive_error_count: 1 },
      { service: "OpenRouter", consecutive_error_count: 1 },
      { service: "AgentPhone", consecutive_error_count: 2 }, // recovering
    ]);
    mockRunAllChecks.mockResolvedValueOnce({
      checks: [
        errCheck("Supabase"),
        errCheck("Resend"),
        errCheck("Slack"),
        errCheck("OpenRouter"),
        okCheck("AgentPhone"),
      ],
    });

    await runScheduledIntegrationsHealthNudges();

    const allCalls = mockQuery.mock.calls as QueryCall[];
    const nudges = nudgeInsertCalls(allCalls);

    // One consolidated failure nudge + one recovery nudge.
    expect(nudges).toHaveLength(2);
    const keys = nudges.map((c) => params(c)[1] as string);
    expect(keys.some((k) => k.startsWith("integration_failure_batch:"))).toBe(
      true,
    );
    expect(
      keys.some((k) => k.startsWith("integration_recovery:AgentPhone:")),
    ).toBe(true);
    // No individual per-service failure key.
    expect(keys.some((k) => k.startsWith("integration_failure:"))).toBe(false);

    // 5 state UPSERTs — one per service.
    expect(stateUpsertCalls(allCalls)).toHaveLength(5);
  });
});
