import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());
const mockSendSms = vi.hoisted(() => vi.fn());
const mockPostSlackMessage = vi.hoisted(() => vi.fn());
const mockOpenDmChannel = vi.hoisted(() => vi.fn());
const mockResendSend = vi.hoisted(() => vi.fn());
const mockInitiateOutboundCall = vi.hoisted(() => vi.fn());
const mockWaitForCallOutcome = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...real,
    pool: { query: mockPoolQuery },
    db: { select: mockDbSelect },
  };
});

vi.mock("./sms", () => ({ sendSms: mockSendSms }));
vi.mock("./slack", () => ({
  slackConfigured: vi.fn(() => true),
  openDmChannel: mockOpenDmChannel,
  postSlackMessage: mockPostSlackMessage,
}));
vi.mock("./calls", () => ({
  callsConfigured: vi.fn(() => true),
  initiateOutboundCall: mockInitiateOutboundCall,
  waitForCallOutcome: mockWaitForCallOutcome,
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockResendSend };
  },
}));

import {
  getCommCheckScheduleDecision,
  runDailyCommCheck,
  runPhoneCommCheck,
} from "./comm-check-scheduler";

function installOwnerSelect(timezone = "Europe/Berlin") {
  mockDbSelect.mockImplementation((selection: Record<string, unknown>) => ({
    from: () => ({
      where: () => ({
        limit: async () =>
          "timezone" in selection
            ? [{ timezone }]
            : [
                {
                  id: 1,
                  email: "owner@example.test",
                  phoneNumber: "+491234",
                  slackUserId: "U123",
                },
              ],
      }),
    }),
  }));
}

type ChannelState = "pending" | "sending" | "sent" | "verified" | "error";

function installCommCheckLedger(
  initial?: Partial<Record<string, ChannelState>>,
) {
  const state: Record<string, ChannelState> = {
    email: initial?.email ?? "pending",
    sms: initial?.sms ?? "pending",
    slack: initial?.slack ?? "pending",
    phone: initial?.phone ?? "pending",
  };
  const lease: Partial<Record<string, string>> = {};

  mockPoolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO comm_checks")) {
      return { rowCount: 1, rows: [] };
    }
    const channel = (["email", "sms", "slack", "phone"] as const).find((name) =>
      sql.includes(`${name}_status`),
    );
    if (!channel) return { rowCount: 1, rows: [] };

    if (sql.includes("RETURNING check_date")) {
      if (state[channel] === "sent" || state[channel] === "verified") {
        return { rowCount: 0, rows: [] };
      }
      state[channel] = "sending";
      lease[channel] = String(params?.[1]);
      return { rowCount: 1, rows: [{ check_date: "2026-09-01" }] };
    }
    const expectedLease = String(
      sql.includes(`SET ${channel}_status = 'error'`)
        ? params?.[2]
        : params?.[1],
    );
    if (
      sql.includes(`${channel}_status = 'sending'`) &&
      lease[channel] !== expectedLease
    ) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes(`SET ${channel}_status = 'sent'`)) {
      state[channel] = "sent";
      delete lease[channel];
    } else if (sql.includes(`SET ${channel}_status = 'error'`)) {
      state[channel] = "error";
      delete lease[channel];
    }
    return { rowCount: 1, rows: [] };
  });

  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "test-resend-key";
  installOwnerSelect();
  mockResendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
  mockSendSms.mockResolvedValue(undefined);
  mockOpenDmChannel.mockResolvedValue("D123");
  mockPostSlackMessage.mockResolvedValue(undefined);
  mockInitiateOutboundCall.mockResolvedValue({ callId: "call-1" });
  mockWaitForCallOutcome.mockResolvedValue("answered");
});

describe("comm-check owner-local schedule decisions", () => {
  const schedule = {
    dailyTime: "09:30",
    dailyDays: "tue",
    phoneTime: "19:00",
    phoneDays: "tue",
  };

  it("uses the Europe/Berlin owner-local weekday and catches up after the configured time", () => {
    const before = getCommCheckScheduleDecision(
      new Date("2026-09-01T07:29:00.000Z"),
      "Europe/Berlin",
      schedule,
    );
    const after = getCommCheckScheduleDecision(
      new Date("2026-09-01T10:45:00.000Z"),
      "Europe/Berlin",
      schedule,
    );

    expect(before).toMatchObject({
      date: "2026-09-01",
      weekday: "tue",
      minuteOfDay: 9 * 60 + 29,
      dailyDue: false,
    });
    expect(after).toMatchObject({
      weekday: "tue",
      minuteOfDay: 12 * 60 + 45,
      dailyDue: true,
      phoneDue: false,
    });
    expect(
      getCommCheckScheduleDecision(
        new Date("2026-09-01T18:05:00.000Z"),
        "Europe/Berlin",
        schedule,
      ),
    ).toMatchObject({
      weekday: "tue",
      minuteOfDay: 20 * 60 + 5,
      dailyDue: true,
      phoneDue: true,
    });
  });

  it("remains owner-local and DST-safe across the Europe/Berlin spring boundary", () => {
    const decision = getCommCheckScheduleDecision(
      new Date("2026-03-29T07:30:00.000Z"),
      "Europe/Berlin",
      {
        ...schedule,
        dailyTime: "09:30",
        dailyDays: "sun",
      },
    );
    expect(decision).toMatchObject({
      date: "2026-03-29",
      weekday: "sun",
      minuteOfDay: 9 * 60 + 30,
      dailyDue: true,
    });
  });
});

describe("comm-check per-channel retries", () => {
  it("retries only a failed channel and never duplicates confirmed successes", async () => {
    const state = installCommCheckLedger();
    mockSendSms.mockRejectedValueOnce(new Error("temporary SMS outage"));

    const first = await runDailyCommCheck();
    expect(first).toMatchObject({
      alreadyRan: false,
      email: "sent",
      sms: "error: temporary SMS outage",
      slack: "sent",
    });
    expect(state).toMatchObject({
      email: "sent",
      sms: "error",
      slack: "sent",
    });

    mockSendSms.mockResolvedValueOnce(undefined);
    const second = await runDailyCommCheck();
    expect(second).toMatchObject({
      alreadyRan: false,
      email: "already sent",
      sms: "sent",
      slack: "already sent",
    });
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockSendSms).toHaveBeenCalledTimes(2);
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);

    const third = await runDailyCommCheck();
    expect(third.alreadyRan).toBe(true);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockSendSms).toHaveBeenCalledTimes(2);
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("allows daily lanes to run when the phone lane already created the date row", async () => {
    installCommCheckLedger({ phone: "sent" });
    const result = await runDailyCommCheck();
    expect(result).toMatchObject({
      alreadyRan: false,
      email: "sent",
      sms: "sent",
      slack: "sent",
    });
  });

  it("uses a recoverable stale sending claim rather than consuming the day forever", async () => {
    installCommCheckLedger({ email: "sending" });
    await runDailyCommCheck();
    const emailClaim = mockPoolQuery.mock.calls.find(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("email_status = 'sending'") &&
        sql.includes("RETURNING check_date"),
    );
    expect(emailClaim?.[0]).toContain(
      "email_sent_at < NOW() - INTERVAL '15 minutes'",
    );
  });

  it("retries a failed phone check but does not duplicate a confirmed call", async () => {
    installCommCheckLedger();
    mockInitiateOutboundCall.mockRejectedValueOnce(
      new Error("temporary phone outage"),
    );

    expect(await runPhoneCommCheck()).toMatchObject({
      alreadySent: false,
      phone: "error: temporary phone outage",
    });
    expect(await runPhoneCommCheck()).toMatchObject({
      alreadySent: false,
      phone: "sent",
    });
    expect(await runPhoneCommCheck()).toMatchObject({
      alreadySent: true,
      phone: "n/a",
    });
    expect(mockInitiateOutboundCall).toHaveBeenCalledTimes(2);
  });

  it("does not let an expired worker overwrite a newer stale-reclaim attempt", async () => {
    const state = installCommCheckLedger();
    let rejectFirstSms!: (reason: Error) => void;
    const firstSms = new Promise<void>((_, reject) => {
      rejectFirstSms = reject;
    });
    mockSendSms
      .mockImplementationOnce(() => firstSms)
      .mockResolvedValueOnce(undefined);

    const firstRun = runDailyCommCheck();
    await vi.waitFor(() => expect(mockSendSms).toHaveBeenCalledTimes(1));

    // The stateful fake treats a second "sending" claim as a stale reclaim and
    // replaces the lease token, matching the SQL's timeout branch.
    const secondRun = runDailyCommCheck();
    await vi.waitFor(() => expect(mockSendSms).toHaveBeenCalledTimes(2));
    await secondRun;
    rejectFirstSms(new Error("old worker failed after its lease expired"));
    await firstRun;

    expect(state.sms).toBe("sent");
    await runDailyCommCheck();
    expect(mockSendSms).toHaveBeenCalledTimes(2);

    const smsTerminalUpdates = mockPoolQuery.mock.calls.filter(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("sms_status = 'sending'") &&
        !sql.includes("RETURNING check_date"),
    );
    expect(smsTerminalUpdates).toHaveLength(2);
    expect(smsTerminalUpdates[0]?.[1]?.[1]).not.toBe(
      smsTerminalUpdates[1]?.[1]?.[2],
    );
  });
});
