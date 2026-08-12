import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks — refs must be created before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockDbWhere,
  broadcastLog,
  mockSendSms,
  mockOpenDmChannel,
  mockPostSlackMessage,
  mockSlackConfigured,
  mockSendAssistantEmail,
  mockResendConfigured,
  MockSmsOptedOutError,
  MockSmsRegistrationPendingError,
} = vi.hoisted(() => {
  class MockSmsOptedOutError extends Error {
    constructor() {
      super("opted out");
    }
  }
  class MockSmsRegistrationPendingError extends Error {
    constructor() {
      super("registration pending");
    }
  }
  return {
    mockDbWhere: vi.fn(),
    // In-memory store that mirrors the elaine_broadcast_log table. Each entry
    // is the Date the broadcast was reserved. Tests use unique userIds so
    // entries from different tests never collide.
    broadcastLog: new Map<number, Date[]>(),
    mockSendSms: vi.fn(),
    mockOpenDmChannel: vi.fn(),
    mockPostSlackMessage: vi.fn(),
    mockSlackConfigured: vi.fn().mockReturnValue(true),
    mockSendAssistantEmail: vi.fn(),
    mockResendConfigured: vi.fn().mockReturnValue(true),
    MockSmsOptedOutError,
    MockSmsRegistrationPendingError,
  };
});

// The DB mock supports two access patterns used by broadcast_message:
//
// 1. db.transaction(callback) — atomic rate-limit check + insert.
//    The mock implements pg_advisory_xact_lock via tx.execute, which captures
//    the userId from the sql template's interpolated values. tx.select counts
//    in-memory broadcastLog entries; tx.insert appends to it.
//
// 2. db.select().from(appUsers).where() — user lookup, delegates to mockDbWhere.
//
// Each userId is unique per test scenario so broadcastLog entries never leak
// between unrelated tests.
vi.mock("@workspace/db", () => ({
  db: {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      let capturedUserId = 0;
      const WINDOW_MS = 60 * 60 * 1000;

      const tx = {
        // pg_advisory_xact_lock(userId::bigint) — extract userId from the
        // sql template's interpolated values array.
        execute: vi
          .fn()
          .mockImplementation((sqlObj: { _values?: unknown[] }) => {
            capturedUserId = Number(sqlObj?._values?.[0] ?? 0);
            return Promise.resolve([]);
          }),

        // Rate-limit count + min query on elaine_broadcast_log.
        select: (_fields: unknown) => ({
          from: (_table: unknown) => ({
            where: (_cond: unknown) => {
              const now = Date.now();
              const cutoff = now - WINDOW_MS;
              const entries = (broadcastLog.get(capturedUserId) ?? []).filter(
                (ts) => ts.getTime() > cutoff,
              );
              const oldest = entries.length > 0 ? (entries[0] ?? null) : null;
              return Promise.resolve([{ total: entries.length, oldest }]);
            },
          }),
        }),

        // Insert a reservation row.
        insert: (_table: unknown) => ({
          values: (data: { userId: number }) => {
            const log = broadcastLog.get(data.userId) ?? [];
            log.push(new Date());
            broadcastLog.set(data.userId, log);
            return Promise.resolve();
          },
        }),
      };

      return callback(tx);
    }),

    // User-lookup path: db.select().from(appUsers).where()
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => mockDbWhere(),
      }),
    }),
  },
  appUsers: {},
  elaineBroadcastLog: {},
  reminders: {},
}));

vi.mock("../lib/sms", () => ({
  sendSms: mockSendSms,
  SmsOptedOutError: MockSmsOptedOutError,
  SmsRegistrationPendingError: MockSmsRegistrationPendingError,
}));

vi.mock("../lib/slack", () => ({
  openDmChannel: mockOpenDmChannel,
  postSlackMessage: mockPostSlackMessage,
  slackConfigured: mockSlackConfigured,
}));

vi.mock("../lib/email", () => ({
  sendAssistantEmail: mockSendAssistantEmail,
  resendConfigured: mockResendConfigured,
}));

vi.mock("../lib/calls", () => ({
  initiateOutboundCall: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// drizzle-orm: sql is used as a tagged template literal; we return an object
// exposing the interpolated values so the tx.execute mock can extract userId.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  ilike: vi.fn(),
  lte: vi.fn(),
  gt: vi.fn(),
  count: vi.fn().mockReturnValue("count_field"),
  min: vi.fn().mockReturnValue("min_field"),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    _strings: strings,
    _values: values,
  }),
  inArray: vi.fn(),
}));

import { communicationActionExecutors } from "./communication-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(
  overrides: Partial<{
    email: string;
    phoneNumber: string | null;
    phoneVerified: boolean;
    smsConsentAt: Date | null;
    smsOptedOutAt: Date | null;
    slackUserId: string | null;
    displayName: string | null;
  }> = {},
) {
  return [
    {
      email: "alice@example.com",
      phoneNumber: "+12105559876",
      phoneVerified: true,
      smsConsentAt: new Date("2024-01-01"),
      smsOptedOutAt: null,
      slackUserId: "U100",
      displayName: "Alice",
      ...overrides,
    },
  ];
}

// ---------------------------------------------------------------------------
// broadcast_message — happy path (all three channels succeed)
// ---------------------------------------------------------------------------

describe("broadcast_message executor — happy path (all channels)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockResendConfigured.mockReturnValue(true);
    mockOpenDmChannel.mockResolvedValue("C100");
    mockPostSlackMessage.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
    mockSendAssistantEmail.mockResolvedValue(undefined);
  });

  it("returns 200 with confirmationMessage listing all three channels", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello from Elaine!" } as never,
      // Use a high userId to avoid colliding with rate-limit tests
      1001,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      type: string;
      result: {
        sent: string[];
        skipped: string[];
        confirmationMessage: string;
      };
    };
    expect(body.type).toBe("broadcast_message");
    expect(body.result.sent).toContain("Slack ✓");
    expect(body.result.sent).toContain("SMS ✓");
    expect(body.result.sent).toContain("Email ✓");
    expect(body.result.skipped).toHaveLength(0);
    expect(body.result.confirmationMessage).toContain("Slack ✓");
    expect(body.result.confirmationMessage).toContain("SMS ✓");
    expect(body.result.confirmationMessage).toContain("Email ✓");
  });

  it("fans out to all three send helpers exactly once", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    await communicationActionExecutors.broadcast_message(
      { message: "Broadcast!" } as never,
      1002,
    );
    expect(mockOpenDmChannel).toHaveBeenCalledTimes(1);
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendAssistantEmail).toHaveBeenCalledTimes(1);
  });

  it("delivers the broadcast message text to every channel", async () => {
    const msg = "Team dinner at 7pm tonight";
    mockDbWhere.mockResolvedValue(makeUser());
    await communicationActionExecutors.broadcast_message(
      { message: msg } as never,
      1003,
    );
    expect(mockPostSlackMessage).toHaveBeenCalledWith("C100", msg);
    expect(mockSendSms).toHaveBeenCalledWith("+12105559876", msg);
    expect(mockSendAssistantEmail).toHaveBeenCalledWith(
      "alice@example.com",
      expect.any(String),
      msg,
    );
  });
});

// ---------------------------------------------------------------------------
// broadcast_message — Slack skipped (no slackUserId)
// ---------------------------------------------------------------------------

describe("broadcast_message executor — Slack skipped (not connected)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockResendConfigured.mockReturnValue(true);
    mockSendSms.mockResolvedValue(undefined);
    mockSendAssistantEmail.mockResolvedValue(undefined);
  });

  it("skips Slack with '(not connected)' when user has no slackUserId", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ slackUserId: null }));
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1004,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      type: string;
      result: {
        sent: string[];
        skipped: string[];
        confirmationMessage: string;
      };
    };
    expect(body.result.skipped).toContain("Slack (not connected)");
    expect(body.result.sent).not.toContain("Slack ✓");
    expect(mockOpenDmChannel).not.toHaveBeenCalled();
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  it("skips Slack with '(not connected)' when slackConfigured() is false", async () => {
    mockSlackConfigured.mockReturnValue(false);
    mockDbWhere.mockResolvedValue(makeUser());
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1005,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { skipped: string[] };
    };
    expect(body.result.skipped).toContain("Slack (not connected)");
    expect(mockOpenDmChannel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// broadcast_message — SMS skipped (opted out)
// ---------------------------------------------------------------------------

describe("broadcast_message executor — SMS skipped (opted out)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockResendConfigured.mockReturnValue(true);
    mockOpenDmChannel.mockResolvedValue("C100");
    mockPostSlackMessage.mockResolvedValue(undefined);
    mockSendAssistantEmail.mockResolvedValue(undefined);
  });

  it("skips SMS with '(opted out)' when smsOptedOutAt is set", async () => {
    mockDbWhere.mockResolvedValue(
      makeUser({ smsOptedOutAt: new Date("2024-06-01") }),
    );
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1006,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { sent: string[]; skipped: string[] };
    };
    expect(body.result.skipped).toContain("SMS (opted out)");
    expect(body.result.sent).not.toContain("SMS ✓");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("skips SMS with '(opted out)' when smsConsentAt is null", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ smsConsentAt: null }));
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1007,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { skipped: string[] };
    };
    expect(body.result.skipped).toContain("SMS (opted out)");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("skips SMS with '(no verified phone)' when phone number is missing", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ phoneNumber: null }));
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1008,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { skipped: string[] };
    };
    expect(body.result.skipped).toContain("SMS (no verified phone)");
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// broadcast_message — Email skipped (not configured)
// ---------------------------------------------------------------------------

describe("broadcast_message executor — Email skipped (not configured)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockResendConfigured.mockReturnValue(false);
    mockOpenDmChannel.mockResolvedValue("C100");
    mockPostSlackMessage.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
  });

  it("skips Email with '(not configured)' when resendConfigured() is false", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1009,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { sent: string[]; skipped: string[] };
    };
    expect(body.result.skipped).toContain("Email (not configured)");
    expect(body.result.sent).not.toContain("Email ✓");
    expect(mockSendAssistantEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// broadcast_message — all three skipped → 422
// ---------------------------------------------------------------------------

describe("broadcast_message executor — all channels skipped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Disable all channels
    mockSlackConfigured.mockReturnValue(false);
    mockResendConfigured.mockReturnValue(false);
  });

  it("returns 422 with an actionable error when nothing can be delivered", async () => {
    // No phone, no Slack, no email — nothing goes through
    mockDbWhere.mockResolvedValue(
      makeUser({
        slackUserId: null,
        phoneNumber: null,
        smsConsentAt: null,
      }),
    );
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1010,
    );
    expect(result.status).toBe(422);
    const body = result.body as { error: string };
    // Error should mention connecting channels / account settings
    expect(body.error).toMatch(/connect|settings/i);
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockOpenDmChannel).not.toHaveBeenCalled();
    expect(mockSendAssistantEmail).not.toHaveBeenCalled();
  });

  it("includes the skipped channel names in the 422 error", async () => {
    mockDbWhere.mockResolvedValue(
      makeUser({
        slackUserId: null,
        phoneNumber: "+15555550000",
        phoneVerified: true,
        smsConsentAt: null,
        smsOptedOutAt: null,
      }),
    );
    const result = await communicationActionExecutors.broadcast_message(
      { message: "Hello!" } as never,
      1011,
    );
    expect(result.status).toBe(422);
    const errorText = (result.body as { error: string }).error;
    // At least one skip reason must appear in the error
    expect(errorText).toContain("not connected");
  });
});

// ---------------------------------------------------------------------------
// broadcast_message — rate limit (3 per hour)
// ---------------------------------------------------------------------------

// Each test must use a unique userId because the rate-limit window is
// module-level state that persists across tests within the same vitest worker.
// Start at 8000 and increment per test so quota is always fresh.
let _rateLimitUserCounter = 8000;
function nextRateLimitUserId() {
  return _rateLimitUserCounter++;
}

describe("broadcast_message executor — rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Happy-path setup so the first 3 calls succeed and consume the quota
    mockSlackConfigured.mockReturnValue(true);
    mockResendConfigured.mockReturnValue(true);
    mockOpenDmChannel.mockResolvedValue("C200");
    mockPostSlackMessage.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
    mockSendAssistantEmail.mockResolvedValue(undefined);
    mockDbWhere.mockResolvedValue(makeUser());
  });

  it("allows exactly 3 broadcasts within an hour, blocks the 4th with 429", async () => {
    const userId = nextRateLimitUserId();
    const payload = { message: "Rate limit test" } as never;

    const r1 = await communicationActionExecutors.broadcast_message(
      payload,
      userId,
    );
    expect(r1.status).toBe(200);

    const r2 = await communicationActionExecutors.broadcast_message(
      payload,
      userId,
    );
    expect(r2.status).toBe(200);

    const r3 = await communicationActionExecutors.broadcast_message(
      payload,
      userId,
    );
    expect(r3.status).toBe(200);

    // 4th call must be rate-limited
    const r4 = await communicationActionExecutors.broadcast_message(
      payload,
      userId,
    );
    expect(r4.status).toBe(429);
    const body = r4.body as { error: string };
    // Error must tell the user when they can try again
    expect(body.error).toMatch(/minute/i);
    // Should not have attempted any channel sends on the 4th call
    // (3 successful calls × 3 mock posts = 3 total)
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(3);
  });

  it("includes the time-until-reset in the 429 message", async () => {
    const userId = nextRateLimitUserId();
    const payload = { message: "Rate limit timing check" } as never;

    // Burn through the quota
    await communicationActionExecutors.broadcast_message(payload, userId);
    await communicationActionExecutors.broadcast_message(payload, userId);
    await communicationActionExecutors.broadcast_message(payload, userId);

    const r4 = await communicationActionExecutors.broadcast_message(
      payload,
      userId,
    );
    expect(r4.status).toBe(429);
    const error = (r4.body as { error: string }).error;
    // The message should contain a duration like "60 minutes" or "59 minutes"
    expect(error).toMatch(/\d+\s*minute/i);
  });
});
