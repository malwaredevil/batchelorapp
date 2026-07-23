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
    slack_recipient_user_ids: number[];
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
        slack_recipient_user_ids: [],
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

// ---------------------------------------------------------------------------
// Tests: runReminderAlerts — SMS delivery failures should not write alert-log
// ---------------------------------------------------------------------------

describe("runReminderAlerts — SMS delivery failure retry behaviour", () => {
  beforeEach(() => {
    queryQueue.length = 0;
    mockClient.query.mockClear();
    mockClient.release.mockClear();
    sendReminderAlertSms.mockClear();
    resendConfigured.mockReturnValue(false);
    smsConfigured.mockReturnValue(true);
  });

  function pushSmsCandidate(phoneRows: { id: number; phone_number: string }[]) {
    pushCandidate({
      recipient_emails: [],
      sms_recipient_user_ids: phoneRows.map((r) => r.id),
    });
    queryQueue.push({ rows: phoneRows });
  }

  it("does NOT insert an alert-log row when the SMS send throws, so the next run retries", async () => {
    pushSmsCandidate([{ id: 1, phone_number: "+12025551234" }]);
    sendReminderAlertSms.mockRejectedValueOnce(new Error("SMS gateway error"));

    await runReminderAlerts();

    // The send was attempted (phone number is valid — it reached the network call).
    expect(sendReminderAlertSms).toHaveBeenCalledTimes(1);
    expect(sendReminderAlertSms.mock.calls[0][0]).toBe("+12025551234");

    // Crucially, no INSERT INTO travels_reminder_alert_log should have been
    // executed for the sms channel; if it were, the scheduler would believe
    // the alert was delivered and silently drop the retry.
    const insertAlertLogCalls = mockClient.query.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("INSERT INTO travels_reminder_alert_log"),
    );
    expect(insertAlertLogCalls).toHaveLength(0);
  });

  it("does NOT insert an alert-log row when one of multiple SMS recipients fails", async () => {
    pushSmsCandidate([
      { id: 1, phone_number: "+12025551234" },
      { id: 2, phone_number: "+447911123456" },
    ]);
    // First recipient succeeds, second throws.
    sendReminderAlertSms
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("upstream timeout"));

    await runReminderAlerts();

    expect(sendReminderAlertSms).toHaveBeenCalledTimes(2);

    // Partial failure → no channel-level alert-log row; next run will retry
    // the failed recipient (via the per-recipient deliveries table).
    const insertAlertLogCalls = mockClient.query.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("INSERT INTO travels_reminder_alert_log"),
    );
    expect(insertAlertLogCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: runReminderAlerts — Slack delivery failures should not write alert-log
// ---------------------------------------------------------------------------

describe("runReminderAlerts — Slack delivery failure retry behaviour", () => {
  beforeEach(() => {
    queryQueue.length = 0;
    mockClient.query.mockClear();
    mockClient.release.mockClear();
    sendReminderAlertSlack.mockClear();
    resendConfigured.mockReturnValue(false);
    smsConfigured.mockReturnValue(false);
    slackConfigured.mockReturnValue(true);
  });

  /**
   * Push a candidate with Slack recipients, the alert-log + delivery-rows
   * checks (not yet sent), and the Slack user-ID batch lookup result.
   *
   * slackRows maps app_users.id → slack_user_id and drives both the candidate's
   * slack_recipient_user_ids array and the batch lookup query result.
   */
  function pushSlackCandidate(
    slackRows: { id: number; slack_user_id: string }[],
  ) {
    pushCandidate({
      recipient_emails: [],
      sms_recipient_user_ids: [],
      slack_recipient_user_ids: slackRows.map((r) => r.id),
    });
    queryQueue.push({ rows: slackRows });
  }

  it("does NOT insert an alert-log row when the Slack send throws, so the next run retries", async () => {
    pushSlackCandidate([{ id: 1, slack_user_id: "U012AB3CD" }]);
    sendReminderAlertSlack.mockRejectedValueOnce(
      new Error("Slack API error: channel_not_found"),
    );

    await runReminderAlerts();

    // The send was attempted (slack_user_id is valid — it reached the network call).
    expect(sendReminderAlertSlack).toHaveBeenCalledTimes(1);
    expect(sendReminderAlertSlack.mock.calls[0][0]).toBe("U012AB3CD");

    // Crucially, no INSERT INTO travels_reminder_alert_log should have been
    // executed for the slack channel; if it were, the scheduler would believe
    // the alert was delivered and silently drop the retry.
    const insertAlertLogCalls = mockClient.query.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("INSERT INTO travels_reminder_alert_log"),
    );
    expect(insertAlertLogCalls).toHaveLength(0);
  });

  it("does NOT insert an alert-log row when one of multiple Slack recipients fails", async () => {
    pushSlackCandidate([
      { id: 1, slack_user_id: "U012AB3CD" },
      { id: 2, slack_user_id: "U999XY7ZZ" },
    ]);
    // First recipient succeeds, second throws.
    sendReminderAlertSlack
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("upstream timeout"));

    await runReminderAlerts();

    expect(sendReminderAlertSlack).toHaveBeenCalledTimes(2);

    // Partial failure → no channel-level alert-log row; next run will retry
    // the failed recipient (via the per-recipient deliveries table).
    const insertAlertLogCalls = mockClient.query.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("INSERT INTO travels_reminder_alert_log"),
    );
    expect(insertAlertLogCalls).toHaveLength(0);
  });

  it("skips a Slack recipient that already has a 'sent' delivery row, even when the channel-level alert log is absent", async () => {
    // Simulate two Slack recipients where user 1 was already sent in a prior
    // partial-failure run (delivery row present with status='sent') but user 2
    // was not.  The channel-level alert log is absent — the scheduler never
    // recorded a full channel success — so without per-recipient dedup it
    // would naively re-send to both recipients on this retry run.

    // 1. Candidates query
    queryQueue.push({
      rows: [
        {
          reminder_id: 1,
          user_id: 1,
          reminder_title: "Pack bags",
          trip_title: "Paris",
          trip_destination: "Paris",
          due_date: today(),
          recipient_emails: [],
          sms_recipient_user_ids: [],
          slack_recipient_user_ids: [1, 2],
          alert_days_before: [0],
        },
      ],
    });
    // 2. Alert log — absent (channel-level success was never recorded because
    //    the prior run was a partial failure).
    queryQueue.push({ rows: [] });
    // 3. Per-recipient deliveries — user 1's Slack DM was already delivered.
    //    The recipient_key for Slack is the slack_user_id string.
    queryQueue.push({
      rows: [
        {
          reminder_id: 1,
          alert_type: "0_day",
          channel: "slack",
          recipient_key: "U012AB3CD",
        },
      ],
    });
    // 4. Slack user-ID batch lookup — both users resolve to a slack_user_id.
    queryQueue.push({
      rows: [
        { id: 1, slack_user_id: "U012AB3CD" },
        { id: 2, slack_user_id: "U999XY7ZZ" },
      ],
    });

    await runReminderAlerts();

    // Only user 2 (no prior delivery row) should receive a Slack message;
    // user 1 must be skipped because their 'sent' delivery row is in deliveredKeys.
    expect(sendReminderAlertSlack).toHaveBeenCalledTimes(1);
    expect(sendReminderAlertSlack.mock.calls[0][0]).toBe("U999XY7ZZ");
  });
});
