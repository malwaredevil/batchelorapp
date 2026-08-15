/**
 * Tests for the Sentry error-nudge dedup / consolidation logic.
 *
 * Key invariants:
 *   1. Not configured → no DB access, no nudges, no throw.
 *   2. A never-seen unresolved issue is announced once and recorded in the
 *      seen ledger.
 *   3. An already-seen (unresolved) issue is never announced again.
 *   4. A seen issue reported resolved by Sentry flips its ledger row; when it
 *      later reappears unresolved (reopened) it IS announced again.
 *   5. Several new issues in one run produce exactly ONE consolidated nudge.
 *   6. A failed AI suggestion never blocks the alert (message still inserted).
 *
 * call shape: client.query(sql, paramsArray) → mock.calls[i] = [sql, params]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockListSentryIssues = vi.hoisted(() => vi.fn());
const mockIsConfigured = vi.hoisted(() => vi.fn());
const mockCallModel = vi.hoisted(() => vi.fn());

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./scheduler-guard", () => ({
  shouldRunScheduledTask: vi.fn().mockResolvedValue(true),
  recordScheduledTaskSuccess: vi.fn().mockResolvedValue(undefined),
  recordScheduledTaskFailure: vi.fn(),
}));

vi.mock("./sentry-issues", () => ({
  listSentryIssues: mockListSentryIssues,
  isSentryIssuesConfigured: mockIsConfigured,
}));

vi.mock("./ai-client", () => ({
  callModel: mockCallModel,
  getModels: vi.fn().mockResolvedValue({ subagentWorker: "test/model" }),
}));

// ── Subject ───────────────────────────────────────────────────────────────────

import {
  computeAndStoreSentryErrorNudges,
  buildNudgeMessage,
  generateFixSuggestion,
  RESOLVED_RETENTION_DAYS,
} from "./sentry-error-nudges";
import type { SentryIssue } from "./sentry-issues";

// ── Fixtures / helpers ────────────────────────────────────────────────────────

function issue(id: string, overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id,
    shortId: `APP-${id}`,
    title: `Error ${id}`,
    culprit: `lib/mod${id}.ts`,
    level: "error",
    count: 7,
    userCount: 1,
    firstSeen: "2026-08-14T00:00:00Z",
    lastSeen: "2026-08-15T00:00:00Z",
    permalink: `https://sentry.io/x/${id}`,
    status: "unresolved",
    ...overrides,
  };
}

function setSentryLists(
  unresolved: SentryIssue[],
  resolved: SentryIssue[] = [],
) {
  mockListSentryIssues.mockImplementation(
    (opts: { query?: string }): Promise<unknown> =>
      Promise.resolve({
        configured: true,
        issues: opts.query === "is:resolved" ? resolved : unresolved,
      }),
  );
}

type LedgerRow = {
  issue_id: string;
  last_status: string;
  alert_generation?: number;
};

/** Configure the DB mock: first SELECT returns the seen-ledger rows. */
function setSeenLedger(rows: LedgerRow[]) {
  mockQuery.mockImplementation((sqlText: string) => {
    if (sqlText.includes("SELECT issue_id, last_status")) {
      return Promise.resolve({
        rows: rows.map((r) => ({ alert_generation: 1, ...r })),
        rowCount: rows.length,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

/**
 * Stateful in-memory fake DB modelling the REAL uniqueness behaviour of both
 * tables: elaine_nudges has a (user_id, nudge_key) unique constraint with
 * ON CONFLICT DO NOTHING (duplicate insert → rowCount 0), and
 * sentry_seen_issues upserts by issue_id. Lets tests run several consecutive
 * scheduler passes against persistent state.
 */
function installStatefulDb() {
  const nudges: { key: string; message: string }[] = [];
  const ledger = new Map<
    string,
    { last_status: string; alert_generation: number }
  >();

  mockQuery.mockImplementation((sqlText: string, params?: unknown[]) => {
    if (sqlText.includes("SELECT issue_id, last_status")) {
      return Promise.resolve({
        rows: [...ledger.entries()].map(([issue_id, r]) => ({
          issue_id,
          ...r,
        })),
        rowCount: ledger.size,
      });
    }
    if (sqlText.includes("elaine_nudges")) {
      const key = String(params![1]);
      if (nudges.some((n) => n.key === key)) {
        // ON CONFLICT (user_id, nudge_key) DO NOTHING
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      nudges.push({ key, message: String(params![2]) });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sqlText.includes("sentry_seen_issues") && sqlText.includes("INSERT")) {
      ledger.set(String(params![0]), {
        last_status: "unresolved",
        alert_generation: Number(params![1]),
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (
      sqlText.includes("UPDATE sentry_seen_issues") &&
      sqlText.includes("last_status = 'resolved'")
    ) {
      const row = ledger.get(String(params![0]));
      if (row) row.last_status = "resolved";
      return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
    }
    if (
      sqlText.includes("DELETE FROM sentry_seen_issues") &&
      sqlText.includes("last_status = 'resolved'")
    ) {
      // Prune old resolved rows — nothing to remove in the in-memory fake.
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });

  return { nudges, ledger };
}

function nudgeInsertCalls(): unknown[][] {
  return mockQuery.mock.calls.filter(
    (c) =>
      typeof c[0] === "string" && (c[0] as string).includes("elaine_nudges"),
  );
}

function ledgerUpsertCalls(): unknown[][] {
  return mockQuery.mock.calls.filter(
    (c) =>
      typeof c[0] === "string" &&
      (c[0] as string).includes("sentry_seen_issues") &&
      (c[0] as string).includes("INSERT"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  // Default: AI suggestion generation fails (rejects) — alerts must not block.
  mockCallModel.mockRejectedValue(new Error("model down"));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeAndStoreSentryErrorNudges", () => {
  it("does nothing (and does not throw) when Sentry is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await computeAndStoreSentryErrorNudges();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockListSentryIssues).not.toHaveBeenCalled();
  });

  it("announces a never-seen issue once and records it in the ledger", async () => {
    setSentryLists([issue("100")]);
    setSeenLedger([]);
    await computeAndStoreSentryErrorNudges();

    const inserts = nudgeInsertCalls();
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0]! as [string, unknown[]];
    expect(params[0]).toBe(1); // owner id
    expect(String(params[1])).toContain("100"); // nudge key includes issue id
    expect(String(params[2])).toContain("Error 100");
    expect(String(params[2])).toContain("7 times");

    const upserts = ledgerUpsertCalls();
    expect(upserts).toHaveLength(1);
    expect((upserts[0]![1] as unknown[])[0]).toBe("100");
  });

  it("stays silent for an issue already recorded as unresolved", async () => {
    setSentryLists([issue("100")]);
    setSeenLedger([{ issue_id: "100", last_status: "unresolved" }]);
    await computeAndStoreSentryErrorNudges();
    expect(nudgeInsertCalls()).toHaveLength(0);
    expect(ledgerUpsertCalls()).toHaveLength(0);
  });

  it("flips the ledger to resolved when Sentry reports an issue resolved", async () => {
    setSentryLists([], [issue("100", { status: "resolved" })]);
    setSeenLedger([{ issue_id: "100", last_status: "unresolved" }]);
    await computeAndStoreSentryErrorNudges();

    const updates = mockQuery.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("UPDATE sentry_seen_issues") &&
        (c[0] as string).includes("last_status = 'resolved'"),
    );
    expect(updates).toHaveLength(1);
    expect((updates[0]![1] as unknown[])[0]).toBe("100");
    expect(nudgeInsertCalls()).toHaveLength(0);
  });

  it("re-announces an issue that reopened after being resolved", async () => {
    setSentryLists([issue("100")]);
    setSeenLedger([{ issue_id: "100", last_status: "resolved" }]);
    await computeAndStoreSentryErrorNudges();

    expect(nudgeInsertCalls()).toHaveLength(1);
    // Ledger flips back to unresolved with a bumped generation.
    const upserts = ledgerUpsertCalls();
    expect(upserts).toHaveLength(1);
    expect((upserts[0]![1] as unknown[])[0]).toBe("100");
    expect((upserts[0]![1] as unknown[])[1]).toBe(2);
  });

  it("announce → resolve → SAME-DAY reopen delivers a second nudge despite the unique-key constraint", async () => {
    // Integration-style: persistent fake DB that enforces the real
    // (user_id, nudge_key) ON CONFLICT DO NOTHING semantics across runs.
    const state = installStatefulDb();

    // Run 1: brand-new issue → first alert (generation 1).
    setSentryLists([issue("100")]);
    await computeAndStoreSentryErrorNudges();
    expect(state.nudges).toHaveLength(1);

    // Run 2: Sentry reports it resolved → ledger flips, no nudge.
    setSentryLists([], [issue("100", { status: "resolved" })]);
    await computeAndStoreSentryErrorNudges();
    expect(state.nudges).toHaveLength(1);
    expect(state.ledger.get("100")!.last_status).toBe("resolved");

    // Run 3 (same UTC day): it reopens → SECOND nudge must be delivered.
    setSentryLists([issue("100")]);
    await computeAndStoreSentryErrorNudges();
    expect(state.nudges).toHaveLength(2);
    expect(state.nudges[0]!.key).not.toBe(state.nudges[1]!.key);
    expect(state.ledger.get("100")).toEqual({
      last_status: "unresolved",
      alert_generation: 2,
    });

    // Run 4: still unresolved → stays quiet.
    await computeAndStoreSentryErrorNudges();
    expect(state.nudges).toHaveLength(2);
  });

  it("issues a DELETE for old resolved rows on every run", async () => {
    setSentryLists([]);
    setSeenLedger([]);
    await computeAndStoreSentryErrorNudges();

    const pruneCalls = mockQuery.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("DELETE FROM sentry_seen_issues") &&
        (c[0] as string).includes("last_status = 'resolved'"),
    );
    expect(pruneCalls).toHaveLength(1);
    // The SQL must reference the correct retention window.
    expect(pruneCalls[0]![0] as string).toContain(
      `${RESOLVED_RETENTION_DAYS} days`,
    );
  });

  it("consolidates several new issues into a single nudge", async () => {
    setSentryLists([issue("1"), issue("2"), issue("3")]);
    setSeenLedger([]);
    await computeAndStoreSentryErrorNudges();

    const inserts = nudgeInsertCalls();
    expect(inserts).toHaveLength(1);
    const message = String((inserts[0]![1] as unknown[])[2]);
    expect(message).toContain("3 new production errors");
    expect(message).toContain("Error 1");
    expect(message).toContain("Error 2");
    expect(message).toContain("Error 3");
    // All three recorded in the ledger.
    expect(ledgerUpsertCalls()).toHaveLength(3);
  });

  it("still inserts the alert when suggestion generation fails", async () => {
    // mockCallModel rejects by default (beforeEach).
    setSentryLists([issue("55")]);
    setSeenLedger([]);
    await computeAndStoreSentryErrorNudges();
    const inserts = nudgeInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(String((inserts[0]![1] as unknown[])[2])).not.toContain(
      "Possible fix",
    );
  });

  it("includes the suggestion, labelled as unverified, when generation succeeds", async () => {
    mockCallModel.mockResolvedValue({
      choices: [{ message: { content: "Add a null check in mod55." } }],
    });
    setSentryLists([issue("55")]);
    setSeenLedger([]);
    await computeAndStoreSentryErrorNudges();
    const message = String((nudgeInsertCalls()[0]![1] as unknown[])[2]);
    expect(message).toContain("Possible fix");
    expect(message).toContain("unverified");
    expect(message).toContain("Add a null check in mod55.");
  });
});

describe("generateFixSuggestion", () => {
  it("returns null when the model replies NONE", async () => {
    mockCallModel.mockResolvedValue({
      choices: [{ message: { content: "NONE" } }],
    });
    expect(await generateFixSuggestion(issue("1"))).toBeNull();
  });

  it("returns null (not throw) when the model call fails", async () => {
    mockCallModel.mockRejectedValue(new Error("boom"));
    expect(await generateFixSuggestion(issue("1"))).toBeNull();
  });
});

describe("buildNudgeMessage", () => {
  it("caps detailed lines and summarises the remainder", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      issue: issue(String(i)),
      suggestion: null,
    }));
    const msg = buildNudgeMessage(many);
    expect(msg).toContain("8 new production errors");
    expect(msg).toContain("…and 3 more new issues.");
  });
});
