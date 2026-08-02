import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks — refs must be created before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockDbWhere,
  mockSendSms,
  mockOpenDmChannel,
  mockPostSlackMessage,
  mockSlackConfigured,
  mockSendAssistantEmail,
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
    mockSendSms: vi.fn(),
    mockOpenDmChannel: vi.fn(),
    mockPostSlackMessage: vi.fn(),
    mockSlackConfigured: vi.fn().mockReturnValue(false),
    mockSendAssistantEmail: vi.fn(),
    MockSmsOptedOutError,
    MockSmsRegistrationPendingError,
  };
});

// continue_in_channel does: await db.select({...}).from(appUsers).where(eq(...))
// — no .limit() call, so the mock chain must be thenable at .where().
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => mockDbWhere(),
      }),
    }),
  },
  appUsers: {},
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
}));

vi.mock("../lib/calls", () => ({
  initiateOutboundCall: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  ilike: vi.fn(),
  lte: vi.fn(),
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
      email: "user@example.com",
      phoneNumber: "+12105559876",
      phoneVerified: true,
      smsConsentAt: new Date("2024-01-01"),
      smsOptedOutAt: null,
      slackUserId: null,
      displayName: "Alice",
      ...overrides,
    },
  ];
}

// ---------------------------------------------------------------------------
// continue_in_channel — common
// ---------------------------------------------------------------------------

describe("continue_in_channel executor — user not found", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWhere.mockResolvedValue([]);
  });

  it("returns 404 when the requesting user row is missing", async () => {
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hello" } as never,
      99,
    );
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// continue_in_channel — Slack path
// ---------------------------------------------------------------------------

describe("continue_in_channel executor — Slack path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockOpenDmChannel.mockResolvedValue("C99");
    mockPostSlackMessage.mockResolvedValue(undefined);
  });

  it("sends via Slack DM and confirms channel:slack on success", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ slackUserId: "U99" }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "slack", message: "Here is the summary." } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(mockOpenDmChannel).toHaveBeenCalledWith("U99");
    expect(mockPostSlackMessage).toHaveBeenCalledWith(
      "C99",
      "Here is the summary.",
    );
    expect((result.body as Record<string, unknown>).result).toMatchObject({
      channel: "slack",
      sent: true,
    });
  });

  it("returns 422 when the user has no Slack account linked", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ slackUserId: null }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "slack", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("Slack");
    expect(mockOpenDmChannel).not.toHaveBeenCalled();
  });

  it("returns 503 when Slack is not configured on this installation", async () => {
    mockSlackConfigured.mockReturnValue(false);
    mockDbWhere.mockResolvedValue(makeUser({ slackUserId: "U99" }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "slack", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(503);
    expect(mockOpenDmChannel).not.toHaveBeenCalled();
  });

  it("returns 500 when the Slack send throws", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ slackUserId: "U99" }));
    mockPostSlackMessage.mockRejectedValue(new Error("slack network error"));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "slack", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// continue_in_channel — SMS path
// ---------------------------------------------------------------------------

describe("continue_in_channel executor — SMS path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(false);
    mockSendSms.mockResolvedValue(undefined);
  });

  it("sends SMS and confirms channel:sms on success", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Text me this." } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledWith("+12105559876", "Text me this.");
    expect((result.body as Record<string, unknown>).result).toMatchObject({
      channel: "sms",
      sent: true,
    });
  });

  it("returns 422 when the user has no phone number on file", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ phoneNumber: null }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("phone number");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 422 when the user's phone is unverified", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ phoneVerified: false }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("verified");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 422 when the user has not given SMS consent", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ smsConsentAt: null }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("consent");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 409 when the user has opted out of SMS (pre-send check)", async () => {
    mockDbWhere.mockResolvedValue(
      makeUser({ smsOptedOutAt: new Date("2024-06-01") }),
    );
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain("opted out");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 409 when sendSms throws SmsOptedOutError (race condition)", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    mockSendSms.mockRejectedValue(new MockSmsOptedOutError());
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain("opted out");
  });

  it("returns 503 when sendSms throws SmsRegistrationPendingError", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    mockSendSms.mockRejectedValue(new MockSmsRegistrationPendingError());
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).toContain("registration");
  });

  it("returns 500 on generic SMS send failure", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    mockSendSms.mockRejectedValue(new Error("network error"));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "sms", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// continue_in_channel — email path
// ---------------------------------------------------------------------------

describe("continue_in_channel executor — email path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendAssistantEmail.mockResolvedValue(undefined);
  });

  it("sends email and confirms channel:email on success", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "email", message: "Email me this." } as never,
      1,
    );
    expect(result.status).toBe(200);
    // sendAssistantEmail is called with the user's email address and the message
    expect(mockSendAssistantEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.any(String),
      "Email me this.",
    );
    expect((result.body as Record<string, unknown>).result).toMatchObject({
      channel: "email",
      sent: true,
    });
  });

  it("sends to the user's own email address (not a hardcoded address)", async () => {
    mockDbWhere.mockResolvedValue(makeUser({ email: "myaddr@example.org" }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "email", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(200);
    const [firstArg] = mockSendAssistantEmail.mock.calls[0]!;
    expect(firstArg).toBe("myaddr@example.org");
  });

  it("returns 500 when the email send throws", async () => {
    mockDbWhere.mockResolvedValue(makeUser());
    mockSendAssistantEmail.mockRejectedValue(new Error("SMTP failure"));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "email", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// continue_in_channel — reply shape / conversation continuity
// ---------------------------------------------------------------------------

describe("continue_in_channel executor — response shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockOpenDmChannel.mockResolvedValue("C1");
    mockPostSlackMessage.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
    mockSendAssistantEmail.mockResolvedValue(undefined);
  });

  it.each([
    ["slack", "U1", makeUser({ slackUserId: "U1" })],
    ["sms", null, makeUser({ slackUserId: null })],
    ["email", null, makeUser({ slackUserId: null })],
  ] as const)(
    "wraps the %s success result under type:continue_in_channel",
    async (channel, _slackId, userRow) => {
      mockDbWhere.mockResolvedValue(userRow);
      const result = await communicationActionExecutors.continue_in_channel(
        { targetChannel: channel, message: "test" } as never,
        1,
      );
      expect(result.status).toBe(200);
      const body = result.body as { type: string; result: unknown };
      expect(body.type).toBe("continue_in_channel");
      expect(body.result).toMatchObject({ channel, sent: true });
    },
  );

  it("does not call any send helper on a 422 (conversation remains open)", async () => {
    mockSlackConfigured.mockReturnValue(false);
    mockDbWhere.mockResolvedValue(makeUser({ slackUserId: null }));
    const result = await communicationActionExecutors.continue_in_channel(
      { targetChannel: "slack", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(mockOpenDmChannel).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockSendAssistantEmail).not.toHaveBeenCalled();
  });
});
