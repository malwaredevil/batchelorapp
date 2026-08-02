import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks so vi.fn() refs are available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockSelect,
  mockInitiateOutboundCall,
  mockSendSms,
  mockOpenDmChannel,
  mockPostSlackMessage,
  mockSlackConfigured,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInitiateOutboundCall: vi.fn(),
  mockSendSms: vi.fn(),
  mockOpenDmChannel: vi.fn(),
  mockPostSlackMessage: vi.fn(),
  mockSlackConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelect(),
        }),
      }),
    }),
  },
  appUsers: {},
}));
vi.mock("../lib/calls", () => ({
  initiateOutboundCall: mockInitiateOutboundCall,
  // waitForCallOutcome is called after every successful call — mock it so
  // tests don't hit the real AgentPhone connector.
  waitForCallOutcome: vi.fn().mockResolvedValue("answered"),
}));
vi.mock("../lib/sms", () => ({
  sendSms: mockSendSms,
  SmsOptedOutError: class SmsOptedOutError extends Error {},
  SmsRegistrationPendingError: class SmsRegistrationPendingError extends Error {},
}));
vi.mock("../lib/slack", () => ({
  openDmChannel: mockOpenDmChannel,
  postSlackMessage: mockPostSlackMessage,
  slackConfigured: mockSlackConfigured,
}));
vi.mock("drizzle-orm", () => ({ ilike: vi.fn() }));

import { communicationActionExecutors } from "./communication-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContact(
  overrides: Partial<{
    id: number;
    displayName: string;
    phoneNumber: string | null;
    slackUserId: string | null;
    phoneVerified: boolean;
    smsConsentAt: Date | null;
    smsOptedOutAt: Date | null;
  }> = {},
) {
  return [
    {
      id: 2,
      displayName: "Jane",
      phoneNumber: "+12105551234",
      slackUserId: null,
      phoneVerified: true,
      smsConsentAt: new Date("2024-01-01"),
      smsOptedOutAt: null,
      ...overrides,
    },
  ];
}

// ---------------------------------------------------------------------------
// call_contact
// ---------------------------------------------------------------------------

describe("call_contact executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitiateOutboundCall.mockResolvedValue({ callId: "call-123" });
  });

  it("returns 404 when contact not found", async () => {
    mockSelect.mockResolvedValue([]);
    const result = await communicationActionExecutors.call_contact(
      { contactName: "Nobody", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(404);
  });

  it("returns 422 when contact has no phone number", async () => {
    mockSelect.mockResolvedValue(makeContact({ phoneNumber: null }));
    const result = await communicationActionExecutors.call_contact(
      { contactName: "Jane", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("phone number");
  });

  it("returns 422 when phone is not verified", async () => {
    mockSelect.mockResolvedValue(makeContact({ phoneVerified: false }));
    const result = await communicationActionExecutors.call_contact(
      { contactName: "Jane", message: "Hi" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("verified");
    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
  });

  it("places the call when phone is verified", async () => {
    mockSelect.mockResolvedValue(makeContact({ phoneVerified: true }));
    const result = await communicationActionExecutors.call_contact(
      { contactName: "Jane", message: "Hi there!" } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(mockInitiateOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({ toNumber: "+12105551234" }),
    );
  });
});

// ---------------------------------------------------------------------------
// message_contact — SMS path
// ---------------------------------------------------------------------------

describe("message_contact executor — SMS path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(false);
    mockSendSms.mockResolvedValue(undefined);
  });

  it("returns 422 when contact has no phone and no Slack", async () => {
    mockSelect.mockResolvedValue(
      makeContact({ phoneNumber: null, slackUserId: null }),
    );
    const result = await communicationActionExecutors.message_contact(
      { contactName: "Jane", message: "Hey", channel: "auto" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 422 when phone is not verified", async () => {
    mockSelect.mockResolvedValue(
      makeContact({
        phoneVerified: false,
        smsConsentAt: new Date("2024-01-01"),
      }),
    );
    const result = await communicationActionExecutors.message_contact(
      { contactName: "Jane", message: "Hey", channel: "sms" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("verified");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 422 when SMS consent is missing", async () => {
    mockSelect.mockResolvedValue(
      makeContact({ phoneVerified: true, smsConsentAt: null }),
    );
    const result = await communicationActionExecutors.message_contact(
      { contactName: "Jane", message: "Hey", channel: "sms" } as never,
      1,
    );
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("consent");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("returns 409 when contact has opted out", async () => {
    mockSelect.mockResolvedValue(
      makeContact({
        phoneVerified: true,
        smsConsentAt: new Date("2024-01-01"),
        smsOptedOutAt: new Date("2024-06-01"),
      }),
    );
    const result = await communicationActionExecutors.message_contact(
      { contactName: "Jane", message: "Hey", channel: "sms" } as never,
      1,
    );
    expect(result.status).toBe(409);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("sends SMS when phone is verified and consented", async () => {
    mockSelect.mockResolvedValue(makeContact());
    const result = await communicationActionExecutors.message_contact(
      { contactName: "Jane", message: "Hey!", channel: "sms" } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledWith("+12105551234", "Hey!");
  });
});

// ---------------------------------------------------------------------------
// message_contact — Slack path (no phone checks required)
// ---------------------------------------------------------------------------

describe("message_contact executor — Slack path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlackConfigured.mockReturnValue(true);
    mockOpenDmChannel.mockResolvedValue("C123");
    mockPostSlackMessage.mockResolvedValue(undefined);
  });

  it("sends via Slack without requiring SMS consent when Slack is linked", async () => {
    mockSelect.mockResolvedValue(
      makeContact({
        slackUserId: "U123",
        phoneVerified: false, // phone not verified — but Slack doesn't care
        smsConsentAt: null,
      }),
    );
    const result = await communicationActionExecutors.message_contact(
      { contactName: "Jane", message: "Slack msg", channel: "auto" } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>).result).toMatchObject({
      channel: "slack",
    });
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});
