/**
 * Unit tests for sendSms() opt-out enforcement.
 *
 * WHY: The opt-out check lives inside sendSms() — the single choke point for
 * all outbound SMS in the app. A regression that moves or bypasses this check
 * (e.g. calling connectors.proxy directly) would silently send messages to
 * users who've texted STOP, violating A2P 10DLC carrier compliance.
 *
 * These tests verify:
 *   1. sendSms throws SmsOptedOutError when the recipient has opted out.
 *   2. No connector call is made for opted-out numbers.
 *   3. sendSms does NOT throw for a non-opted-out user (happy path).
 *   4. The bypassOptOutCheck option skips the opt-out check (STOP/HELP
 *      compliance replies must still go out regardless of opt-out state).
 *
 * Uses vi.mock for the DB and connector to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Connector mock ───────────────────────────────────────────────────────────

const mockProxy = vi.fn();

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: vi.fn(() => ({
    proxy: mockProxy,
  })),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

const selectQueue: Array<Array<Record<string, unknown>>> = [];

function makeSelectBuilder() {
  // Drizzle query chain: db.select().from().where().limit(n) → Promise<row[]>
  // `.from()` and `.where()` return intermediate builder; `.limit()` is terminal.
  const terminal = () => {
    const row = selectQueue.shift() ?? [];
    return Promise.resolve(row);
  };
  const whereResult = { limit: terminal };
  const builder = {
    from() {
      return builder;
    },
    where() {
      return whereResult;
    },
    limit: terminal,
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
  update: vi.fn(() => ({
    set() {
      return this;
    },
    where() {
      return Promise.resolve();
    },
  })),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sendSms() — opt-out enforcement", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    vi.clearAllMocks();
    // Mock the number-list call used by getFromNumber() on first send.
    mockProxy.mockResolvedValue(
      makeOkResponse({ data: [{ phoneNumber: "+15550001111" }] }),
    );
  });

  it("throws SmsOptedOutError when the recipient has opted out", async () => {
    // Simulate an opted-out user row.
    selectQueue.push([{ smsOptedOutAt: new Date(), smsFirstOutboundSentAt: new Date() }]);

    const { sendSms, SmsOptedOutError } = await import("./sms");

    await expect(sendSms("+15559990000", "Hello")).rejects.toBeInstanceOf(
      SmsOptedOutError,
    );
  });

  it("does not call the connector when the recipient has opted out", async () => {
    selectQueue.push([{ smsOptedOutAt: new Date(), smsFirstOutboundSentAt: new Date() }]);

    const { sendSms } = await import("./sms");

    await expect(sendSms("+15559990000", "Hello")).rejects.toThrow();
    // proxy should only be called once (the number-list prefetch for getFromNumber
    // is NOT reached because we throw before sending).
    expect(mockProxy).not.toHaveBeenCalledWith(
      "agentphone",
      "/v1/messages",
      expect.anything(),
    );
  });

  it("does not throw when the recipient has NOT opted out", async () => {
    // Opted-in user (smsOptedOutAt is null, first message already sent).
    selectQueue.push([{ smsOptedOutAt: null, smsFirstOutboundSentAt: new Date() }]);
    // getFromNumber() call — return a number list.
    mockProxy
      .mockResolvedValueOnce(
        makeOkResponse({ data: [{ phoneNumber: "+15550001111" }] }),
      )
      .mockResolvedValueOnce(makeOkResponse({})); // message send

    const { sendSms } = await import("./sms");
    await expect(sendSms("+15551234567", "Hello")).resolves.not.toThrow();
  });

  it("skips the opt-out check when bypassOptOutCheck is true", async () => {
    // No DB row needed — bypass skips the select entirely.
    // getFromNumber + message send:
    mockProxy
      .mockResolvedValueOnce(
        makeOkResponse({ data: [{ phoneNumber: "+15550001111" }] }),
      )
      .mockResolvedValueOnce(makeOkResponse({}));

    const { sendSms } = await import("./sms");
    await expect(
      sendSms("+15559990000", "STOP received", { bypassOptOutCheck: true }),
    ).resolves.not.toThrow();

    // DB was NOT queried (no select call for opted-out check).
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});
