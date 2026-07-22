import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  daysUntilDue,
  isValidEmailAddress,
  isValidE164PhoneNumber,
  runReminderAlerts,
} from "./reminder-scheduler";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sendReminderAlertEmail = vi.fn().mockResolvedValue(undefined);
const resendConfigured = vi.fn().mockReturnValue(true);
vi.mock("./email", () => ({
  sendReminderAlertEmail: (...args: unknown[]) =>
    sendReminderAlertEmail(...args),
  resendConfigured: () => resendConfigured(),
  alertLabel: vi.fn().mockReturnValue("1 day before"),
}));

const smsConfigured = vi.fn().mockReturnValue(false);
const sendReminderAlertSms = vi.fn().mockResolvedValue(undefined);
vi.mock("./sms", () => ({
  smsConfigured: () => smsConfigured(),
  sendReminderAlertSms: (...args: unknown[]) => sendReminderAlertSms(...args),
}));

const slackConfigured = vi.fn().mockReturnValue(false);
const sendReminderAlertSlack = vi.fn().mockResolvedValue(undefined);
vi.mock("./slack", () => ({
  slackConfigured: () => slackConfigured(),
  sendReminderAlertSlack: (...args: unknown[]) =>
    sendReminderAlertSlack(...args),
}));

vi.mock("../routes/travels/reminders", () => ({
  pullReminderAlertDaysFromCalendar: vi.fn((_id: number, days: number[]) =>
    Promise.resolve(days),
  ),
}));

// ---------------------------------------------------------------------------
// Pool mock — mirrors the raw pg client used by runReminderAlerts
// ---------------------------------------------------------------------------

/** Rows returned by sequential client.query() calls, consumed FIFO. */
const queryQueue: { rows: unknown[] }[] = [];

const mockClient = {
  query: vi.fn(async () => queryQueue.shift() ?? { rows: [] }),
  release: vi.fn(),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    pool: {
      connect: vi.fn(async () => mockClient),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Today as a YYYY-MM-DD string so due-date math is predictable. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Push a candidate row that will be returned by the first client.query(). */
function pushCandidate(
  overrides: Partial<{
    reminder_id: number;
    user_id: number;
    reminder_title: string;
    trip_title: string;
    trip_destination: string;
    due_date: string;
    recipient_emails: string[];
    sms_recipient_user_ids: number[];
    alert_days_before: number[];
  }> = {},
) {
  queryQueue.push({
    rows: [
      {
        reminder_id: 1,
        user_id: 1,
        reminder_title: "Pack bags",
        trip_title: "Paris",
        trip_destination: "Paris",
        due_date: today(),
        recipient_emails: ["user@example.com"],
        sms_recipient_user_ids: [],
        alert_days_before: [0],
        ...overrides,
      },
    ],
  });
  // Second query: travels_reminder_alert_log check — return empty (not already sent)
  queryQueue.push({ rows: [] });
  // Third query (new): travels_reminder_alert_deliveries per-recipient check —
  // return empty so no recipient is considered already delivered.
  queryQueue.push({ rows: [] });
}

// ---------------------------------------------------------------------------
// Tests: daysUntilDue
// ---------------------------------------------------------------------------

describe("daysUntilDue", () => {
  it("returns exactly N for a date N days out, regardless of what time of day 'now' is", () => {
    const dueDate = "2026-07-14"; // 10 days after the fixed "now" below

    const earlyMorning = new Date("2026-07-04T00:05:00Z");
    const lateNight = new Date("2026-07-04T23:55:00Z");
    const midday = new Date("2026-07-04T12:00:00Z");

    expect(daysUntilDue(dueDate, earlyMorning)).toBe(10);
    expect(daysUntilDue(dueDate, lateNight)).toBe(10);
    expect(daysUntilDue(dueDate, midday)).toBe(10);
  });

  it("returns 0 on the due date itself, at any time of day", () => {
    const dueDate = "2026-07-04";

    expect(daysUntilDue(dueDate, new Date("2026-07-04T00:00:01Z"))).toBe(0);
    expect(daysUntilDue(dueDate, new Date("2026-07-04T23:59:59Z"))).toBe(0);
  });

  it("returns a negative value once the due date has passed", () => {
    expect(daysUntilDue("2026-07-01", new Date("2026-07-04T12:00:00Z"))).toBe(
      -3,
    );
  });

  it("matches its configured alertDaysBefore exactly once across every hour of the scheduler day", () => {
    const dueDate = "2026-07-08"; // "1 day before" should only match on 2026-07-07
    const alertDaysBefore = 1;

    let matchCount = 0;
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(
        `2026-07-07T${String(hour).padStart(2, "0")}:00:00Z`,
      );
      if (daysUntilDue(dueDate, now) === alertDaysBefore) matchCount++;
    }

    expect(matchCount).toBe(24);
  });

  it("never double-matches across the day boundary due to time-of-day rounding", () => {
    const dueDate = "2026-07-08";
    const alertDaysBefore = 1;

    const justBeforeMidnight = new Date("2026-07-06T23:59:59Z");
    const justAfterMidnight = new Date("2026-07-07T00:00:01Z");

    expect(daysUntilDue(dueDate, justBeforeMidnight)).toBe(2);
    expect(daysUntilDue(dueDate, justAfterMidnight)).toBe(1);
    expect(daysUntilDue(dueDate, justBeforeMidnight)).not.toBe(alertDaysBefore);
  });
});

// ---------------------------------------------------------------------------
// Tests: isValidEmailAddress
// ---------------------------------------------------------------------------

describe("isValidEmailAddress", () => {
  it("accepts a normal email", () => {
    expect(isValidEmailAddress("user@example.com")).toBe(true);
  });

  it("accepts an email with a + alias", () => {
    expect(isValidEmailAddress("user+tag@example.co.uk")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidEmailAddress("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isValidEmailAddress("   ")).toBe(false);
    expect(isValidEmailAddress("\t")).toBe(false);
  });

  it("rejects a string with no @ sign", () => {
    expect(isValidEmailAddress("notanemail")).toBe(false);
  });

  it("rejects a string missing the domain part", () => {
    expect(isValidEmailAddress("user@")).toBe(false);
  });

  it("rejects a string with spaces around the address", () => {
    // Trim is internal — the surrounding spaces alone don't make it invalid
    // once trimmed, but an address that IS only spaces should fail.
    expect(isValidEmailAddress("  ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: runReminderAlerts — malformed recipient email in the DB
// ---------------------------------------------------------------------------

describe("runReminderAlerts — malformed recipient emails", () => {
  beforeEach(() => {
    queryQueue.length = 0;
    mockClient.query.mockClear();
    mockClient.release.mockClear();
    sendReminderAlertEmail.mockClear();
    resendConfigured.mockReturnValue(true);
    smsConfigured.mockReturnValue(false);
  });

  it("does not attempt to send when recipient_emails contains an empty string", async () => {
    pushCandidate({ recipient_emails: [""] });

    await runReminderAlerts();

    expect(sendReminderAlertEmail).not.toHaveBeenCalled();
  });

  it("does not attempt to send when recipient_emails contains a whitespace-only string", async () => {
    pushCandidate({ recipient_emails: ["   "] });

    await runReminderAlerts();

    expect(sendReminderAlertEmail).not.toHaveBeenCalled();
  });

  it("does not attempt to send when recipient_emails contains a malformed address (no @)", async () => {
    pushCandidate({ recipient_emails: ["notanemail"] });

    await runReminderAlerts();

    expect(sendReminderAlertEmail).not.toHaveBeenCalled();
  });

  it("sends only to valid recipients when the array mixes valid and malformed addresses", async () => {
    pushCandidate({
      recipient_emails: ["", "valid@example.com", "   ", "alsovalid@test.org"],
    });
    // Extra alert-log insert query (succeeds)
    queryQueue.push({ rows: [] });

    await runReminderAlerts();

    expect(sendReminderAlertEmail).toHaveBeenCalledTimes(2);
    const calledWith = sendReminderAlertEmail.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledWith).toContain("valid@example.com");
    expect(calledWith).toContain("alsovalid@test.org");
  });

  it("sends normally to a valid recipient email", async () => {
    pushCandidate({ recipient_emails: ["real@example.com"] });
    queryQueue.push({ rows: [] });

    await runReminderAlerts();

    expect(sendReminderAlertEmail).toHaveBeenCalledTimes(1);
    expect(sendReminderAlertEmail.mock.calls[0][0]).toBe("real@example.com");
  });

  it("does NOT insert an alert-log row when all recipient emails are malformed", async () => {
    // All three emails are invalid — no send will succeed.
    pushCandidate({ recipient_emails: ["", "notanemail", "   "] });

    await runReminderAlerts();

    // No email was sent.
    expect(sendReminderAlertEmail).not.toHaveBeenCalled();

    // Crucially, no INSERT INTO travels_reminder_alert_log should have been
    // executed; if it were, the scheduler would think the alert was delivered
    // and never retry, silently dropping the reminder.
    const insertCalls = mockClient.query.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("INSERT INTO travels_reminder_alert_log"),
    );
    expect(insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: isValidE164PhoneNumber
// ---------------------------------------------------------------------------

describe("isValidE164PhoneNumber", () => {
  it("accepts a standard US E.164 number", () => {
    expect(isValidE164PhoneNumber("+12025551234")).toBe(true);
  });

  it("accepts a UK E.164 number", () => {
    expect(isValidE164PhoneNumber("+447911123456")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidE164PhoneNumber("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isValidE164PhoneNumber("   ")).toBe(false);
  });

  it("rejects a number without a leading +", () => {
    expect(isValidE164PhoneNumber("12025551234")).toBe(false);
  });

  it("rejects a bare + with no digits", () => {
    expect(isValidE164PhoneNumber("+")).toBe(false);
  });

  it("rejects a number that is too short (fewer than 7 digits after +country)", () => {
    expect(isValidE164PhoneNumber("+1234")).toBe(false);
  });

  it("rejects a number with non-digit characters after the +", () => {
    expect(isValidE164PhoneNumber("+1-202-555-1234")).toBe(false);
  });

  it("rejects a number starting with +0 (leading zero after + is not E.164)", () => {
    expect(isValidE164PhoneNumber("+012025551234")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: runReminderAlerts — malformed phone numbers in the DB
// ---------------------------------------------------------------------------

describe("runReminderAlerts — malformed phone numbers in the DB", () => {
  beforeEach(() => {
    queryQueue.length = 0;
    mockClient.query.mockClear();
    mockClient.release.mockClear();
    sendReminderAlertSms.mockClear();
    resendConfigured.mockReturnValue(false);
    smsConfigured.mockReturnValue(true);
  });

  /**
   * Push a candidate with SMS recipients, the alert-log + delivery-rows checks
   * (not sent yet), and then the phone-rows query result — the batch query the
   * scheduler issues to look up verified phone numbers for all sms_recipient_user_ids.
   *
   * The sms_recipient_user_ids on the candidate are derived automatically from the
   * phone rows so the batch phone-lookup query returns them all.
   */
  function pushSmsCandidate(phoneRows: { id: number; phone_number: string }[]) {
    pushCandidate({
      recipient_emails: [],
      sms_recipient_user_ids: phoneRows.map((r) => r.id),
    });
    queryQueue.push({ rows: phoneRows });
  }

  it("does not attempt to send when the phone_number is an empty string", async () => {
    pushSmsCandidate([{ id: 1, phone_number: "" }]);

    await runReminderAlerts();

    expect(sendReminderAlertSms).not.toHaveBeenCalled();
  });

  it("does not attempt to send when the phone_number is a whitespace-only string", async () => {
    pushSmsCandidate([{ id: 1, phone_number: "   " }]);

    await runReminderAlerts();

    expect(sendReminderAlertSms).not.toHaveBeenCalled();
  });

  it("does not attempt to send when the phone_number lacks a leading + (not E.164)", async () => {
    pushSmsCandidate([{ id: 1, phone_number: "12025551234" }]);

    await runReminderAlerts();

    expect(sendReminderAlertSms).not.toHaveBeenCalled();
  });

  it("does not attempt to send when the phone_number contains hyphens (not E.164)", async () => {
    pushSmsCandidate([{ id: 1, phone_number: "+1-202-555-1234" }]);

    await runReminderAlerts();

    expect(sendReminderAlertSms).not.toHaveBeenCalled();
  });

  it("sends successfully to a valid E.164 phone number", async () => {
    pushSmsCandidate([{ id: 1, phone_number: "+12025551234" }]);
    queryQueue.push({ rows: [] });

    await runReminderAlerts();

    expect(sendReminderAlertSms).toHaveBeenCalledTimes(1);
    expect(sendReminderAlertSms.mock.calls[0][0]).toBe("+12025551234");
  });

  it("sends only to valid recipients when the phone-rows mix valid and malformed numbers", async () => {
    pushSmsCandidate([
      { id: 1, phone_number: "" },
      { id: 2, phone_number: "+447911123456" },
      { id: 3, phone_number: "notaphone" },
      { id: 4, phone_number: "+12025551234" },
    ]);
    queryQueue.push({ rows: [] });

    await runReminderAlerts();

    expect(sendReminderAlertSms).toHaveBeenCalledTimes(2);
    const calledWith = sendReminderAlertSms.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledWith).toContain("+447911123456");
    expect(calledWith).toContain("+12025551234");
  });
});
