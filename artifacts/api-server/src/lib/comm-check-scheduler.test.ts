import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());
const mockSendSms = vi.hoisted(() => vi.fn());
const mockPostSlackMessage = vi.hoisted(() => vi.fn());
const mockOpenDmChannel = vi.hoisted(() => vi.fn());
const mockResendSend = vi.hoisted(() => vi.fn());
const mockInitiateOutboundCall = vi.hoisted(() => vi.fn());
const { mockReconcileOutboundCallOutcome, MockOutboundCallIndeterminateError } =
  vi.hoisted(() => ({
    mockReconcileOutboundCallOutcome: vi.fn(),
    MockOutboundCallIndeterminateError: class extends Error {},
  }));

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
  reconcileOutboundCallOutcome: mockReconcileOutboundCallOutcome,
  OutboundCallIndeterminateError: MockOutboundCallIndeterminateError,
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
  runChannelCheck,
  isFullCommCheckSuccessful,
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

type ChannelState =
  | "pending"
  | "sending"
  | "sent"
  | "verified"
  | "error"
  | "indeterminate"
  | "unexpected";

function installCommCheckLedger(
  initial?: Partial<Record<string, ChannelState>>,
  phoneNoClaimState?: ChannelState,
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
      // A fresh in-flight phone attempt is not reclaimable.  The production
      // query's stale-time predicate makes this the no-claim path.
      if (channel === "phone" && state.phone === "sending") {
        return { rowCount: 0, rows: [] };
      }
      // Some no-claim paths (for example a legacy/unexpected ledger value)
      // are deliberately represented by a failed conditional update.
      if (channel === "phone" && phoneNoClaimState) {
        state.phone = phoneNoClaimState;
        return { rowCount: 0, rows: [] };
      }
      if (
        state[channel] === "sent" ||
        state[channel] === "verified" ||
        state[channel] === "indeterminate"
      ) {
        return { rowCount: 0, rows: [] };
      }
      state[channel] = "sending";
      lease[channel] = String(params?.[1]);
      return { rowCount: 1, rows: [{ check_date: "2026-09-01" }] };
    }
    if (sql.includes("SELECT phone_status")) {
      return {
        rowCount: 1,
        rows: [{ phone_status: state.phone, phone_error: null }],
      };
    }
    const expectedLease = String(
      sql.includes(`SET ${channel}_status = 'error'`) ||
        sql.includes("phone_error = $3")
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
    } else if (sql.includes(`SET ${channel}_status = 'indeterminate'`)) {
      state[channel] = "indeterminate";
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
  mockReconcileOutboundCallOutcome.mockResolvedValue("answered");
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
  describe("full-run aggregate success", () => {
    const daily = { email: "sent", sms: "sent", slack: "sent" };

    it("rejects a mixed daily error even when the phone lane was sent", () => {
      expect(
        isFullCommCheckSuccessful(
          { ...daily, sms: "error: temporary outage" },
          { phone: "sent" },
        ),
      ).toBe(false);
    });

    it.each([
      ["sent", "sent"],
      ["already sent", "n/a"],
    ])("accepts all daily %s and phone %s", (dailyState, phoneState) => {
      expect(
        isFullCommCheckSuccessful(
          { email: dailyState, sms: dailyState, slack: dailyState },
          { phone: phoneState },
        ),
      ).toBe(true);
    });

    it.each(["unknown: outcome pending", "unknown: call pending"])(
      "rejects an indeterminate phone outcome (%s)",
      (phone) => {
        expect(isFullCommCheckSuccessful(daily, { phone })).toBe(false);
      },
    );

    it("rejects a phone lane that is still sending", () => {
      expect(isFullCommCheckSuccessful(daily, { phone: "sending" })).toBe(
        false,
      );
    });
  });

  it.each([
    ["answered", "sent"],
    ["voicemail", "sent"],
  ])("manual phone marks %s as sent", async (outcome, expected) => {
    const state = installCommCheckLedger();
    mockReconcileOutboundCallOutcome.mockResolvedValueOnce(outcome);
    const result = await runChannelCheck("phone");
    expect(result.result).toBe(expected);
    expect(state.phone).toBe("sent");
  });

  it.each(["no-answer", "error"])(
    "manual phone marks %s as retryable error",
    async (outcome) => {
      const state = installCommCheckLedger();
      mockReconcileOutboundCallOutcome.mockResolvedValueOnce(outcome);
      const result = await runChannelCheck("phone");
      expect(result.result).toMatch(/^error:/);
      expect(state.phone).toBe("error");
    },
  );

  it("manual phone keeps pending calls unknown and non-retryable", async () => {
    const state = installCommCheckLedger();
    mockReconcileOutboundCallOutcome.mockResolvedValueOnce("pending");
    const result = await runChannelCheck("phone");
    expect(result.result).toMatch(/^unknown:/);
    expect(state.phone).toBe("indeterminate");
    expect(mockInitiateOutboundCall).toHaveBeenCalledTimes(1);
  });
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
    expect(mockInitiateOutboundCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: 1,
        openingMessage: expect.stringContaining(
          "daily Batchelor App communications check",
        ),
        callScreeningIdentity: "Elaine from Batchelor App",
        callScreeningPurpose: "daily communications test",
      }),
    );
  });

  it.each([
    ["answered", "sent"],
    ["voicemail", "sent"],
    ["no-answer", "error"],
    ["error", "error"],
    ["pending", "indeterminate"],
  ])("scheduled phone records %s as %s", async (outcome, expected) => {
    const state = installCommCheckLedger();
    mockReconcileOutboundCallOutcome.mockResolvedValueOnce(outcome);
    const result = await runPhoneCommCheck();
    expect(result.phone).toMatch(new RegExp(`^(sent|error|unknown)`));
    expect(state.phone).toBe(expected);
  });

  it("does not reclaim an indeterminate provider acceptance", async () => {
    installCommCheckLedger();
    mockInitiateOutboundCall.mockRejectedValueOnce(
      new MockOutboundCallIndeterminateError("provider response lost"),
    );

    const first = await runPhoneCommCheck();
    expect(first).toMatchObject({
      alreadySent: false,
      phone: "unknown: provider response lost",
    });
    const second = await runPhoneCommCheck();
    expect(second).toMatchObject({
      alreadySent: false,
      phone: "unknown: outcome pending",
    });
    expect(mockInitiateOutboundCall).toHaveBeenCalledTimes(1);
  });

  it.each(["sent", "verified"] as const)(
    "does not call the provider for a confirmed %s phone ledger state",
    async (state) => {
      installCommCheckLedger({ phone: state });

      await expect(runPhoneCommCheck()).resolves.toMatchObject({
        alreadySent: true,
        phone: "n/a",
      });
      expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
    },
  );

  it("does not call the provider when a fresh phone attempt is still sending", async () => {
    installCommCheckLedger({ phone: "sending" });

    await expect(runPhoneCommCheck()).resolves.toMatchObject({
      alreadySent: false,
      phone: "unknown: outcome pending",
    });
    expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
  });

  it.each(["error", "unexpected"] as const)(
    "reports a no-claim %s phone ledger state without calling the provider",
    async (state) => {
      installCommCheckLedger(undefined, state);

      await expect(runPhoneCommCheck()).resolves.toMatchObject({
        alreadySent: false,
        phone: expect.stringMatching(/^error:/),
      });
      expect(mockInitiateOutboundCall).not.toHaveBeenCalled();
    },
  );

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
