import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks so vi.fn() refs are available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockSelect,
  mockDuplicateSelect,
  mockInsertReturning,
  mockInitiateOutboundCall,
  mockSendSms,
  mockOpenDmChannel,
  mockPostSlackMessage,
  mockSlackConfigured,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  // findDuplicateScheduledReminder() runs its own db.select(...).where(...)
  // (kept as a separate mock so scheduling tests can control resolveContact's
  // result and the duplicate lookup's result independently). Defaults to "no
  // duplicate found" so existing scheduling assertions don't need to know
  // about it.
  mockDuplicateSelect: vi.fn().mockResolvedValue([]),
  mockInsertReturning: vi.fn(),
  mockInitiateOutboundCall: vi.fn(),
  mockSendSms: vi.fn(),
  mockOpenDmChannel: vi.fn(),
  mockPostSlackMessage: vi.fn(),
  mockSlackConfigured: vi.fn().mockReturnValue(false),
}));

// resolveContact() / findDuplicateScheduledReminder() and the appUsers-backed
// direct-await queries (fireCallMe/continue_in_channel) all go through
// db.select(...).from(...)... — distinguish the reminders-table duplicate
// lookup from the appUsers lookups by table identity so scheduling tests can
// mock each independently.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        // .where() is used two ways in communication-actions.ts:
        //   - resolveContact() / findDuplicateScheduledReminder() chain
        //     .limit(...) after it
        //   - fireCallMe()/continue_in_channel() await the .where(...) result
        //     directly with no .limit() call.
        // Support both by returning a thenable that also exposes .limit().
        where: () => ({
          limit: () =>
            table === "reminders-table" ? mockDuplicateSelect() : mockSelect(),
          then: (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => mockSelect().then(resolve, reject),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => mockInsertReturning(),
      }),
    }),
  },
  appUsers: {},
  reminders: "reminders-table",
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
// The mocked db chain below never actually evaluates its `.where(...)`
// argument, but the argument expression itself (and(eq(...), gt(...), ...))
// is still built eagerly by real code before being passed in — so every
// operator communication-actions.ts imports from drizzle-orm needs a stub
// here, or building that expression throws before the mock ever sees it.
vi.mock("drizzle-orm", () => ({
  ilike: vi.fn(),
  and: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  min: vi.fn(),
  count: vi.fn(),
  sql: vi.fn(),
}));

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
// call_me
// ---------------------------------------------------------------------------

function makeSelfUser(
  overrides: Partial<{
    phoneNumber: string | null;
    phoneVerified: boolean;
    smsOptedOutAt: Date | null;
    displayName: string | null;
  }> = {},
) {
  return [
    {
      phoneNumber: "+12105559999",
      phoneVerified: true,
      smsOptedOutAt: null,
      displayName: "Alex",
      ...overrides,
    },
  ];
}

describe("call_me executor — immediate path (no scheduleAt)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitiateOutboundCall.mockResolvedValue({ callId: "call-456" });
  });

  it("returns 404 when the user account isn't found", async () => {
    mockSelect.mockResolvedValue([]);
    const result = await communicationActionExecutors.call_me({} as never, 1);
    expect(result.status).toBe(404);
  });

  it("returns 422 when the user has no phone number on file", async () => {
    mockSelect.mockResolvedValue(makeSelfUser({ phoneNumber: null }));
    const result = await communicationActionExecutors.call_me({} as never, 1);
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("phone number");
    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
  });

  it("returns 422 when the phone isn't verified", async () => {
    mockSelect.mockResolvedValue(makeSelfUser({ phoneVerified: false }));
    const result = await communicationActionExecutors.call_me({} as never, 1);
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("verified");
    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
  });

  it("returns 409 when the user has opted out", async () => {
    mockSelect.mockResolvedValue(
      makeSelfUser({ smsOptedOutAt: new Date("2024-01-01") }),
    );
    const result = await communicationActionExecutors.call_me({} as never, 1);
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain("opted out");
    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
  });

  it("places the call immediately when everything checks out", async () => {
    mockSelect.mockResolvedValue(makeSelfUser());
    const result = await communicationActionExecutors.call_me(
      { greeting: "Hey, it's your reminder!" } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(mockInitiateOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toNumber: "+12105559999",
        initialGreeting: "Hey, it's your reminder!",
      }),
    );
    expect(mockInsertReturning).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain("scheduled");
  });
});

describe("call_me executor — scheduled path (scheduleAt present)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not place a call, instead writes a scheduled reminder row and confirms the resolved time", async () => {
    mockInsertReturning.mockResolvedValue([{ id: 77 }]);
    const result = await communicationActionExecutors.call_me(
      {
        greeting: "Don't forget to pick up the dry cleaning!",
        scheduleAt: "2026-08-20T14:30:00-05:00",
      } as never,
      1,
    );

    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    const body = result.body as {
      result: { scheduled: boolean; scheduledActionId: number };
    };
    expect(body.result.scheduled).toBe(true);
    expect(body.result.scheduledActionId).toBe(77);
  });

  it("enforces guardrails at fire time via fireCallMe, not just at scheduling time", async () => {
    // Scheduling itself never touches appUsers — the guard checks only run
    // when the scheduler later calls fireCallMe(). Verify fireCallMe alone
    // (as the scheduler dispatcher does) still rejects an opted-out user.
    mockSelect.mockResolvedValue(
      makeSelfUser({ smsOptedOutAt: new Date("2024-01-01") }),
    );
    const { fireCallMe } = await import("./communication-actions");
    const result = await fireCallMe(1, "Reminder greeting");
    expect(result.status).toBe(409);
    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Scheduled call_contact / message_contact — duplicate-reminder detection
// ---------------------------------------------------------------------------
//
// Regression coverage for the "confirm via typed text after a card didn't
// render" bug: resubmitting an identical scheduling request used to create
// a second, indistinguishable `reminders` row with no way for the user to
// know a duplicate existed. These tests exercise findDuplicateScheduledReminder
// indirectly through the executors — a near-identical active reminder
// (same contact + message, due time within the match window, created
// recently) must surface a warning in the confirmation message instead of
// silently vanishing into an identical-looking second row.

describe("call_contact executor — scheduled + duplicate detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue(makeContact());
    mockDuplicateSelect.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 7 }]);
  });

  it("schedules normally with no warning when nothing similar exists", async () => {
    const result = await communicationActionExecutors.call_contact(
      {
        contactName: "Jane",
        message: "Reminder to call the vet",
        scheduleAt: "2026-08-20T18:00:00.000Z",
      } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = (result.body as { result: { confirmationMessage: string } })
      .result;
    expect(body.confirmationMessage).not.toContain("Heads up");
    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
  });

  it("surfaces the existing reminder instead of hiding a near-duplicate", async () => {
    const existingDueAt = new Date("2026-08-20T18:05:00.000Z");
    mockDuplicateSelect.mockResolvedValue([{ id: 42, dueAt: existingDueAt }]);
    const result = await communicationActionExecutors.call_contact(
      {
        contactName: "Jane",
        message: "Reminder to call the vet",
        scheduleAt: "2026-08-20T18:00:00.000Z",
      } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = (
      result.body as {
        result: { confirmationMessage: string; duplicateOfReminderId?: number };
      }
    ).result;
    expect(body.confirmationMessage).toContain("Heads up");
    expect(body.confirmationMessage).toContain("#42");
    expect(body.duplicateOfReminderId).toBe(42);
    // The new reminder is still created — the user is informed, not blocked.
    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
  });
});

describe("message_contact executor — scheduled + duplicate detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue(makeContact());
    mockDuplicateSelect.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([{ id: 8 }]);
  });

  it("schedules normally with no warning when nothing similar exists", async () => {
    const result = await communicationActionExecutors.message_contact(
      {
        contactName: "Jane",
        message: "Don't forget trash day",
        channel: "sms",
        scheduleAt: "2026-08-20T18:00:00.000Z",
      } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = (result.body as { result: { confirmationMessage: string } })
      .result;
    expect(body.confirmationMessage).not.toContain("Heads up");
  });

  it("surfaces the existing reminder instead of hiding a near-duplicate", async () => {
    const existingDueAt = new Date("2026-08-20T18:02:00.000Z");
    mockDuplicateSelect.mockResolvedValue([{ id: 99, dueAt: existingDueAt }]);
    const result = await communicationActionExecutors.message_contact(
      {
        contactName: "Jane",
        message: "Don't forget trash day",
        channel: "sms",
        scheduleAt: "2026-08-20T18:00:00.000Z",
      } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = (
      result.body as {
        result: {
          confirmationMessage: string;
          duplicateOfReminderIds?: number[];
        };
      }
    ).result;
    expect(body.confirmationMessage).toContain("Heads up");
    expect(body.confirmationMessage).toContain("#99");
    expect(body.duplicateOfReminderIds).toEqual([99]);
  });
});

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
