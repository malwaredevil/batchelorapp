import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks so vi.fn() refs are stable inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockFireCallContact,
  mockFireMessageContact,
  mockFireCallMe,
  mockPoolQuery,
  mockPoolConnect,
  mockDbSelectWhere,
  mockDbSelectLimit,
  mockDbInsertReturning,
  mockRichTextToPlainText,
} = vi.hoisted(() => {
  const mockPoolQuery = vi.fn();
  const mockPoolConnect = vi.fn();
  // Stable refs for Drizzle db mock — used by deliverGenericMessengerReminder
  // mockDbSelectWhere controls what db.select().from().where() returns;
  //   default: the { limit, then } object used by deliverGenericMessengerReminder
  //   override per-test for resolveEntityContextLabel (no .limit() call)
  const mockDbSelectWhere = vi.fn();
  const mockDbSelectLimit = vi.fn().mockResolvedValue([]);
  const mockDbInsertReturning = vi.fn().mockResolvedValue([]);
  const mockRichTextToPlainText = vi.fn().mockReturnValue("");
  return {
    mockFireCallContact: vi.fn(),
    mockFireMessageContact: vi.fn(),
    mockFireCallMe: vi.fn(),
    mockPoolQuery,
    mockPoolConnect,
    mockDbSelectWhere,
    mockDbSelectLimit,
    mockDbInsertReturning,
    mockRichTextToPlainText,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// @workspace/db — same pattern as communication-actions.test.ts
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockPoolQuery,
    connect: mockPoolConnect,
  },
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        // mockDbSelectWhere is reset + given a default in the messenger
        // describe's beforeEach so per-test overrides via mockReturnValueOnce
        // don't leak across tests.  The default returns the { limit, then }
        // chain object; overriding it with a bare thenable lets
        // resolveEntityContextLabel (which awaits .where() directly, no
        // .limit()) return a real trip row.
        where: mockDbSelectWhere,
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        // mockDbInsertReturning is overridden per-test for auto-create
        // scenarios; awaiting values() directly (message insert, no
        // .returning()) resolves via the thenable below.
        returning: mockDbInsertReturning,
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) => Promise.resolve(undefined).then(resolve, reject),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  travelsTrips: {},
  elaineHistoryConversations: {},
  elaineHistoryMessages: {},
}));

// The executors being dispatched to — these are what we're asserting on
vi.mock("../elaine/communication-actions", () => ({
  fireCallContact: mockFireCallContact,
  fireMessageContact: mockFireMessageContact,
  fireCallMe: mockFireCallMe,
}));

// Infrastructure mocks — not exercised by dispatchElaineActionReminder itself
vi.mock("./email", () => ({
  sendGenericReminderAlertEmail: vi.fn(),
  resendConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("./sms", () => ({
  sendGenericReminderAlertSms: vi.fn(),
  smsConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("./slack", () => ({
  sendGenericReminderAlertSlack: vi.fn(),
  slackConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("./calls", () => ({
  callsConfigured: vi.fn().mockReturnValue(false),
  initiateOutboundCall: vi.fn(),
  buildGenericReminderCallScript: vi.fn().mockReturnValue(""),
}));
vi.mock("./scheduler-guard", () => ({
  shouldRunScheduledTask: vi.fn().mockResolvedValue(true),
  recordScheduledTaskSuccess: vi.fn().mockResolvedValue(undefined),
  recordScheduledTaskFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("./google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("./google-calendar", () => ({
  getCalendarEvent: vi.fn(),
}));
vi.mock("./rich-text-plaintext", () => ({
  richTextToPlainText: mockRichTextToPlainText,
  richTextToSpeech: vi.fn().mockReturnValue(""),
}));
vi.mock("./agentphone-conversation", () => ({
  seedOutboundCallContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("drizzle-orm", () => ({
  inArray: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
}));

import {
  dispatchElaineActionReminder,
  claimAndSendDueDeliveries,
  runSchedulerTick,
} from "./reminders-scheduler";

// Re-import the mocked shouldRunScheduledTask so individual tests can
// override its return value without affecting the default (true).
import { shouldRunScheduledTask } from "./scheduler-guard";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatchElaineActionReminder — call_contact branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFireCallContact.mockResolvedValue({ status: 200, body: { ok: true } });
  });

  it("calls fireCallContact with contactName and message from payload", async () => {
    const result = await dispatchElaineActionReminder(
      "call_contact",
      { contactName: "Jane", message: "Time to leave!" },
      42,
    );

    expect(mockFireCallContact).toHaveBeenCalledOnce();
    expect(mockFireCallContact).toHaveBeenCalledWith("Jane", "Time to leave!");
    expect(mockFireMessageContact).not.toHaveBeenCalled();
    expect(mockFireCallMe).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it("coerces missing contactName/message to empty strings (never throws)", async () => {
    await dispatchElaineActionReminder("call_contact", {}, 1);
    expect(mockFireCallContact).toHaveBeenCalledWith("", "");
  });

  it("coerces null payload to empty strings without throwing", async () => {
    await dispatchElaineActionReminder("call_contact", null, 1);
    expect(mockFireCallContact).toHaveBeenCalledWith("", "");
  });

  it("propagates the status returned by fireCallContact (e.g. 404 contact-not-found)", async () => {
    mockFireCallContact.mockResolvedValue({
      status: 404,
      body: { error: "Contact not found" },
    });
    const result = await dispatchElaineActionReminder(
      "call_contact",
      { contactName: "Nobody", message: "Hi" },
      1,
    );
    expect(result.status).toBe(404);
  });
});

describe("dispatchElaineActionReminder — message_contact branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFireMessageContact.mockResolvedValue({
      status: 200,
      body: { ok: true },
    });
  });

  it("calls fireMessageContact with contactName, message, and channel from payload", async () => {
    const result = await dispatchElaineActionReminder(
      "message_contact",
      { contactName: "Bob", message: "Dinner's ready", channel: "sms" },
      7,
    );

    expect(mockFireMessageContact).toHaveBeenCalledOnce();
    expect(mockFireMessageContact).toHaveBeenCalledWith(
      "Bob",
      "Dinner's ready",
      "sms",
    );
    expect(mockFireCallContact).not.toHaveBeenCalled();
    expect(mockFireCallMe).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it('defaults channel to "auto" when omitted from payload', async () => {
    await dispatchElaineActionReminder(
      "message_contact",
      { contactName: "Alice", message: "Hello" },
      1,
    );
    expect(mockFireMessageContact).toHaveBeenCalledWith(
      "Alice",
      "Hello",
      "auto",
    );
  });

  it("coerces missing fields to empty strings without throwing", async () => {
    await dispatchElaineActionReminder("message_contact", {}, 1);
    expect(mockFireMessageContact).toHaveBeenCalledWith("", "", "auto");
  });

  it("propagates a 422 status returned by fireMessageContact", async () => {
    mockFireMessageContact.mockResolvedValue({
      status: 422,
      body: { error: "No phone" },
    });
    const result = await dispatchElaineActionReminder(
      "message_contact",
      { contactName: "Bob", message: "Hi", channel: "sms" },
      1,
    );
    expect(result.status).toBe(422);
  });
});

describe("dispatchElaineActionReminder — call_me branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFireCallMe.mockResolvedValue({ status: 200, body: { ok: true } });
  });

  it("calls fireCallMe with createdByUserId and greeting from payload", async () => {
    const result = await dispatchElaineActionReminder(
      "call_me",
      { greeting: "Hey, this is your reminder!" },
      99,
    );

    expect(mockFireCallMe).toHaveBeenCalledOnce();
    expect(mockFireCallMe).toHaveBeenCalledWith(
      99,
      "Hey, this is your reminder!",
    );
    expect(mockFireCallContact).not.toHaveBeenCalled();
    expect(mockFireMessageContact).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it("threads createdByUserId correctly so the scheduler re-checks the original requester's phone/opt-out status", async () => {
    // The key invariant: whatever createdByUserId arrives from the DB row,
    // it must be forwarded verbatim as the first argument to fireCallMe so
    // guardrails run against the original requester's account, not a
    // hardcoded or default user id.
    await dispatchElaineActionReminder("call_me", { greeting: "Hi" }, 55);
    const [calledUserId] = mockFireCallMe.mock.calls[0]!;
    expect(calledUserId).toBe(55);
  });

  it("passes undefined greeting (not an empty string) when greeting is absent from payload", async () => {
    await dispatchElaineActionReminder("call_me", {}, 1);
    expect(mockFireCallMe).toHaveBeenCalledWith(1, undefined);
  });

  it("passes undefined greeting when payload is null", async () => {
    await dispatchElaineActionReminder("call_me", null, 1);
    expect(mockFireCallMe).toHaveBeenCalledWith(1, undefined);
  });

  it("propagates a 409 (opted-out) status returned by fireCallMe", async () => {
    mockFireCallMe.mockResolvedValue({
      status: 409,
      body: { error: "opted out" },
    });
    const result = await dispatchElaineActionReminder(
      "call_me",
      { greeting: "Reminder" },
      1,
    );
    expect(result.status).toBe(409);
  });

  it("propagates a 422 (no verified phone) status returned by fireCallMe", async () => {
    mockFireCallMe.mockResolvedValue({
      status: 422,
      body: { error: "no verified phone number" },
    });
    const result = await dispatchElaineActionReminder("call_me", {}, 1);
    expect(result.status).toBe(422);
  });
});

describe("dispatchElaineActionReminder — unknown action type", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns status 500 with an error message for an unrecognised action type", async () => {
    const result = await dispatchElaineActionReminder(
      "send_carrier_pigeon",
      { target: "the moon" },
      1,
    );

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain("unknown elaine_action_type");
    expect(JSON.stringify(result.body)).toContain("send_carrier_pigeon");
    expect(mockFireCallContact).not.toHaveBeenCalled();
    expect(mockFireMessageContact).not.toHaveBeenCalled();
    expect(mockFireCallMe).not.toHaveBeenCalled();
  });

  it("returns status 500 (does not throw) when actionType is null", async () => {
    const result = await dispatchElaineActionReminder(null, {}, 1);
    expect(result.status).toBe(500);
    expect(mockFireCallContact).not.toHaveBeenCalled();
    expect(mockFireMessageContact).not.toHaveBeenCalled();
    expect(mockFireCallMe).not.toHaveBeenCalled();
  });

  it("returns status 500 for an empty-string action type", async () => {
    const result = await dispatchElaineActionReminder("", {}, 1);
    expect(result.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// claimAndSendDueDeliveries — elaine_action branch
// ---------------------------------------------------------------------------
//
// These tests exercise the SQL wiring inside claimAndSendDueDeliveries that
// reads elaine_action_type / elaine_action_payload / created_by_user_id from
// the reminders table and hands them to dispatchElaineActionReminder.
// dispatchElaineActionReminder itself is NOT separately mocked here — the
// real function runs and delegates to the already-mocked communication-action
// executors (fireCallContact / fireMessageContact / fireCallMe), giving us
// full integration coverage of the path without touching a live DB.
//
// pool.query call order for a single elaine_action delivery (no sms/call/slack
// recipients means no phone/slack pre-fetch queries):
//   1. recoverStuckSendingDeliveries UPDATE
//   2. SELECT elaine_action_type, elaine_action_payload, created_by_user_id
//   3. UPDATE reminder_deliveries SET status = 'fired' | 'failed'
// ---------------------------------------------------------------------------

describe("claimAndSendDueDeliveries — elaine_action branch", () => {
  /** Build a fake ClaimedDelivery row with the elaine_action channel. */
  function makeElaineActionDelivery(overrides: Record<string, unknown> = {}) {
    return {
      id: 101,
      reminder_id: 55,
      channel: "elaine_action",
      recipient_ref: "42",
      reminder_title: "Call reminder",
      reminder_description: null,
      entity_type: null,
      entity_id: null,
      occurrence_key: "occ0:lead:5minutes",
      ...overrides,
    };
  }

  let mockClaimClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimClient = { query: vi.fn(), release: vi.fn() };
    mockPoolConnect.mockResolvedValue(mockClaimClient);
    mockFireCallContact.mockResolvedValue({ status: 200, body: { ok: true } });
    mockFireMessageContact.mockResolvedValue({
      status: 200,
      body: { ok: true },
    });
    mockFireCallMe.mockResolvedValue({ status: 200, body: { ok: true } });
  });

  it("reads action_type/payload/created_by_user_id from DB and forwards them to dispatchElaineActionReminder", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeElaineActionDelivery()],
      rowCount: 1,
    });

    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // recoverStuckSendingDeliveries
      .mockResolvedValueOnce({
        rows: [
          {
            elaine_action_type: "call_contact",
            elaine_action_payload: {
              contactName: "Jane",
              message: "Time to leave!",
            },
            created_by_user_id: 42,
          },
        ],
      }) // SELECT action fields
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE fired

    const result = await claimAndSendDueDeliveries();

    expect(mockFireCallContact).toHaveBeenCalledOnce();
    expect(mockFireCallContact).toHaveBeenCalledWith("Jane", "Time to leave!");
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
  });

  it("threads created_by_user_id through to the executor (call_me branch)", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeElaineActionDelivery({ id: 202 })],
      rowCount: 1,
    });

    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            elaine_action_type: "call_me",
            elaine_action_payload: { greeting: "Hey, time to go!" },
            created_by_user_id: 7,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await claimAndSendDueDeliveries();

    expect(mockFireCallMe).toHaveBeenCalledOnce();
    const [calledUserId, calledGreeting] = mockFireCallMe.mock.calls[0]!;
    expect(calledUserId).toBe(7);
    expect(calledGreeting).toBe("Hey, time to go!");
  });

  it("records delivery as failed (not silently swallowed) when dispatch returns status >= 400", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeElaineActionDelivery({ id: 303 })],
      rowCount: 1,
    });
    mockFireCallContact.mockResolvedValue({
      status: 404,
      body: { error: "Contact not found" },
    });

    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            elaine_action_type: "call_contact",
            elaine_action_payload: { contactName: "Nobody", message: "Hi" },
            created_by_user_id: 42,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE failed

    const result = await claimAndSendDueDeliveries();

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });

    // The failed-status UPDATE must have been issued with the correct
    // delivery id and an error string derived from the dispatch body.
    // Distinguish from recoverStuckSendingDeliveries which also sets
    // status = 'failed' but has no $1/$2 params (no WHERE id = $1).
    const failedUpdateCall = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("error = $2") &&
        Array.isArray(c[1]),
    );
    expect(failedUpdateCall).toBeDefined();
    expect(failedUpdateCall![1][0]).toBe(303); // delivery.id
    expect(String(failedUpdateCall![1][1])).toContain("Contact not found");
  });

  it("issues the fired-status UPDATE for the correct delivery id on success", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeElaineActionDelivery({ id: 404 })],
      rowCount: 1,
    });

    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            elaine_action_type: "message_contact",
            elaine_action_payload: {
              contactName: "Bob",
              message: "Dinner's ready",
              channel: "sms",
            },
            created_by_user_id: 9,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await claimAndSendDueDeliveries();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    const firedUpdateCall = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("status = 'fired'"),
    );
    expect(firedUpdateCall).toBeDefined();
    expect(firedUpdateCall![1][0]).toBe(404); // delivery.id
  });
});

// ---------------------------------------------------------------------------
// claimAndSendDueDeliveries — pool.connect error propagation
// ---------------------------------------------------------------------------
//
// These tests guard the two invariants described in the task:
//
//   1. A pool.connect() rejection must propagate to the caller — the function
//      must never silently swallow a DB connection failure.
//
//   2. recoverStuckSendingDeliveries() (which uses pool.query) must run
//      BEFORE pool.connect() so that a process restart always cleans up
//      stuck-sending deliveries even when the claim-client connection fails.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// runSchedulerTick — stuck-sending recovery runs even when guard skips
// ---------------------------------------------------------------------------
//
// When shouldRunScheduledTask returns false the in-process tick must still
// issue the recoverStuckSendingDeliveries UPDATE so that deliveries left in
// `sending` status by a crashed process get cleaned up promptly, instead of
// waiting for the next tick that does pass the guard.
// ---------------------------------------------------------------------------

describe("runSchedulerTick — recovery runs when guard says skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues the recoverStuckSendingDeliveries UPDATE when shouldRunScheduledTask returns false", async () => {
    // Guard says skip; recovery must still run so a crashed process can
    // clean up stuck-sending deliveries without waiting for the next
    // eligible tick.
    vi.mocked(shouldRunScheduledTask).mockResolvedValueOnce(false);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 2, rows: [] });

    await runSchedulerTick();

    // pool.query must have been called for the recovery UPDATE.
    expect(mockPoolQuery).toHaveBeenCalledOnce();
    const [sql] = mockPoolQuery.mock.calls[0]!;
    expect(typeof sql).toBe("string");
    expect(sql as string).toContain("status = 'sending'");

    // The claim-client connection must NOT have been opened — the full
    // delivery batch was correctly skipped.
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("does not open a claim connection or issue claim queries when the guard skips", async () => {
    vi.mocked(shouldRunScheduledTask).mockResolvedValueOnce(false);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await runSchedulerTick();

    // Only the one recovery query — no claim UPDATE, no delivery SELECT.
    expect(mockPoolQuery).toHaveBeenCalledOnce();
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("does not throw when recovery fails and the guard skips (recovery is best-effort)", async () => {
    // Guard skips → recovery runs → recovery DB call fails.
    // The tick must absorb the error and resolve cleanly: a transient
    // recovery hiccup must never propagate as an unhandled rejection.
    vi.mocked(shouldRunScheduledTask).mockResolvedValueOnce(false);
    mockPoolQuery.mockRejectedValueOnce(new Error("DB pool error"));

    await expect(runSchedulerTick()).resolves.toBeUndefined();

    // The claim-client connection must still not be opened.
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});

describe("claimAndSendDueDeliveries — pool.connect error propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates a pool.connect rejection and does not swallow the error", async () => {
    const connectError = new Error("DB blip: connection refused");
    // recoverStuckSendingDeliveries runs first via pool.query — let it succeed
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    mockPoolConnect.mockRejectedValue(connectError);

    await expect(claimAndSendDueDeliveries()).rejects.toThrow(
      "DB blip: connection refused",
    );
  });

  it("blocks pool.connect until recoverStuckSendingDeliveries has fully resolved, preventing a claim-before-recovery race", async () => {
    // Use a deferred pool.query so we can inspect state *while* recovery
    // is still in-flight (i.e. the promise hasn't settled yet).
    let resolveRecovery!: (v: unknown) => void;
    const recoveryPromise = new Promise((res) => {
      resolveRecovery = res;
    });

    mockPoolQuery.mockReturnValueOnce(recoveryPromise);
    // pool.connect is only reached after recovery — make it fail so we
    // don't need to wire up a full claim-client mock.
    mockPoolConnect.mockRejectedValue(new Error("connection refused"));

    // Start the call but don't await yet — it's mid-flight.
    const callPromise = claimAndSendDueDeliveries();

    // Yield to the microtask queue so any synchronous/already-resolved
    // promises in claimAndSendDueDeliveries can run.
    await Promise.resolve();

    // Recovery hasn't resolved yet → pool.connect must NOT have been called.
    expect(mockPoolConnect).not.toHaveBeenCalled();

    // Now let recovery complete.
    resolveRecovery({ rowCount: 0, rows: [] });

    // The overall call should now propagate the pool.connect rejection.
    await expect(callPromise).rejects.toThrow("connection refused");

    // After recovery resolved, pool.connect must have been called.
    expect(mockPoolConnect).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// claimAndSendDueDeliveries — recoverStuckSendingDeliveries error handling
// ---------------------------------------------------------------------------
//
// Decision: recovery is best-effort.  A DB error inside
// recoverStuckSendingDeliveries must be swallowed (warn + continue) so that
// a transient error does not halt the entire pending-delivery batch.
// ---------------------------------------------------------------------------

describe("claimAndSendDueDeliveries — recoverStuckSendingDeliveries error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs a warn with the count when recoverStuckSendingDeliveries marks rows failed", async () => {
    // pool.query resolves for recovery with rowCount=2 (two stuck deliveries).
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    // pool.connect fails so we don't need to wire up a full claim-client mock.
    mockPoolConnect.mockRejectedValue(new Error("connection refused"));

    const { logger } = await import("./logger");

    await expect(claimAndSendDueDeliveries()).rejects.toThrow(
      "connection refused",
    );

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("permanently failed 2"),
    );
  });

  it("does not log a warn when recoverStuckSendingDeliveries finds no stuck rows", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    mockPoolConnect.mockRejectedValue(new Error("connection refused"));

    const { logger } = await import("./logger");

    await expect(claimAndSendDueDeliveries()).rejects.toThrow(
      "connection refused",
    );

    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
      expect.stringContaining("permanently failed"),
    );
  });

  it("swallows a pool.query rejection inside recoverStuckSendingDeliveries and continues with the claim batch", async () => {
    // pool.query rejects on the first call (recoverStuckSendingDeliveries).
    mockPoolQuery.mockRejectedValueOnce(new Error("transient DB error"));
    // pool.connect also fails so we can confirm execution reached it without
    // having to wire up a full claim-client mock.
    mockPoolConnect.mockRejectedValue(new Error("connection refused"));

    // The recovery error must NOT propagate — the pool.connect error does.
    await expect(claimAndSendDueDeliveries()).rejects.toThrow(
      "connection refused",
    );

    // pool.connect was reached, proving execution continued past recovery.
    expect(mockPoolConnect).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// claimAndSendDueDeliveries — messenger branch
// ---------------------------------------------------------------------------
//
// These tests drive the "messenger" channel path inside
// claimAndSendDueDeliveries, which calls deliverGenericMessengerReminder.
// That function writes directly into elaineHistoryConversations /
// elaineHistoryMessages via the Drizzle `db` client (no live DB).
//
// pool.query call order for a single messenger delivery (no sms/call/slack
// recipients, entity_type null so no contextLabel pool.query):
//   1. recoverStuckSendingDeliveries UPDATE        (mockPoolQuery call 1)
//   2. SELECT google_event_html_link FROM reminders (mockPoolQuery call 2)
//   3. UPDATE reminder_deliveries SET status = 'fired' | 'failed'
//                                                  (mockPoolQuery call 3)
//
// Drizzle db call order inside deliverGenericMessengerReminder:
//   a. db.select().from().where().limit()  — find existing default conv
//   b. [if not found] db.insert(convs).values().returning()  — create conv
//   c. db.insert(messages).values()        — insert message row
//   d. db.update(convs).set().where()      — bump updatedAt
// ---------------------------------------------------------------------------

describe("claimAndSendDueDeliveries — messenger branch", () => {
  /** Build a fake ClaimedDelivery row with the messenger channel. */
  function makeMessengerDelivery(overrides: Record<string, unknown> = {}) {
    return {
      id: 501,
      reminder_id: 10,
      channel: "messenger",
      recipient_ref: "7", // userId
      reminder_title: "Pack your bags",
      reminder_description: null,
      entity_type: null,
      entity_id: null,
      occurrence_key: "occ0:lead:5minutes",
      ...overrides,
    };
  }

  let mockClaimClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

  /**
   * Default where() return for deliverGenericMessengerReminder's conv lookup
   * (uses .limit() on the where result).  Rebuilt each beforeEach so the
   * limit mock reference stays current after resets.
   */
  function makeWhereChain() {
    return {
      limit: mockDbSelectLimit,
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve([]).then(resolve, reject),
    };
  }

  /** Set up the conv-found path: select returns [{id}], no insert needed. */
  function setupConvFound(convId = 99) {
    mockDbSelectLimit.mockResolvedValueOnce([{ id: convId }]);
  }

  /** Standard pool.query stubs for a single messenger delivery. */
  function stubPoolForMessenger(calendarUrl: string | null = null) {
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // recoverStuck
      .mockResolvedValueOnce({
        rows: [{ google_event_html_link: calendarUrl }],
      }) // SELECT reminders
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE fired/failed
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() resets call records but NOT the mockReturnValueOnce
    // queue. Reset + restore defaults explicitly so per-test queued values
    // from a previous test can't bleed into the next one.
    mockDbSelectLimit.mockReset();
    mockDbSelectLimit.mockResolvedValue([]);
    mockDbInsertReturning.mockReset();
    mockDbInsertReturning.mockResolvedValue([]);
    // Default where() return: the { limit, then } chain for the conv lookup.
    mockDbSelectWhere.mockReset();
    mockDbSelectWhere.mockReturnValue(makeWhereChain());

    mockClaimClient = { query: vi.fn(), release: vi.fn() };
    mockPoolConnect.mockResolvedValue(mockClaimClient);
    mockRichTextToPlainText.mockReturnValue(""); // no description body by default
  });

  // -------------------------------------------------------------------------
  // Message assembly
  // -------------------------------------------------------------------------

  it("uses reminder_title alone when description is empty and no contextLabel or calendar link", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeMessengerDelivery({ reminder_title: "Take your pills" })],
      rowCount: 1,
    });
    stubPoolForMessenger(null);
    setupConvFound();

    await claimAndSendDueDeliveries();

    expect(mockDbInsertReturning).not.toHaveBeenCalled(); // no conv auto-create
    // The values() mock on the message insert must carry the assembled content
    const valuesCall =
      // assert via the insert chain instead: pull the last values() call
      // argument from the insert mock results
      vi.mocked(mockDbSelectWhere).getMockImplementation; // unused — we check the insert mock below
    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    expect(lastInsertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Take your pills" }),
    );
  });

  it("appends plain description to the title when richTextToPlainText returns content", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [
        makeMessengerDelivery({
          reminder_title: "Doctor appointment",
          reminder_description: "<p>Bring your insurance card</p>",
        }),
      ],
      rowCount: 1,
    });
    mockRichTextToPlainText.mockReturnValue("Bring your insurance card");
    stubPoolForMessenger(null);
    setupConvFound();

    await claimAndSendDueDeliveries();

    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    expect(lastInsertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Doctor appointment\n\nBring your insurance card",
      }),
    );
  });

  it("appends contextLabel when entity_type/entity_id resolve to a label", async () => {
    // resolveEntityContextLabel with entity_type="travels_trip" calls
    // db.select().from(travelsTrips).where(inArray(...)) and awaits it
    // directly (no .limit()).  We override mockDbSelectWhere for that first
    // call to return a thenable resolving to a trip row so the label is built.
    // The second where() call (the conv lookup inside
    // deliverGenericMessengerReminder) uses the default chain with .limit().
    mockClaimClient.query.mockResolvedValue({
      rows: [
        makeMessengerDelivery({
          reminder_title: "Flight check-in",
          entity_type: "travels_trip",
          entity_id: 3,
        }),
      ],
      rowCount: 1,
    });
    stubPoolForMessenger(null);

    // Call 1: resolveEntityContextLabel → thenable resolving to a trip row
    mockDbSelectWhere.mockReturnValueOnce({
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) =>
        Promise.resolve([{ title: "Paris Trip", destination: "Paris" }]).then(
          resolve,
          reject,
        ),
    });
    // Call 2: deliverGenericMessengerReminder conv lookup → conv found
    mockDbSelectWhere.mockReturnValueOnce({
      ...makeWhereChain(),
      limit: mockDbSelectLimit,
    });
    mockDbSelectLimit.mockResolvedValueOnce([{ id: 99 }]);

    await claimAndSendDueDeliveries();

    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    const { content } = (
      lastInsertResult.values.mock.calls[0] as [{ content: string }]
    )[0];
    expect(content).toContain("Flight check-in");
    expect(content).toContain("Trip: Paris Trip → Paris");
  });

  it("appends a calendar event line when google_event_html_link is present", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeMessengerDelivery({ reminder_title: "Dentist" })],
      rowCount: 1,
    });
    stubPoolForMessenger("https://calendar.google.com/event?eid=abc123");
    setupConvFound();

    await claimAndSendDueDeliveries();

    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    const { content } = (
      lastInsertResult.values.mock.calls[0] as [{ content: string }]
    )[0];
    expect(content).toContain("Dentist");
    expect(content).toContain(
      "Calendar event: https://calendar.google.com/event?eid=abc123",
    );
  });

  it("assembles all four parts correctly: title + description + contextLabel (travels_trip) + calendar link", async () => {
    // Exercises every branch of the message builder in one delivery:
    // body = title + "\n\n" + description
    // withContext = body + "\n\n" + contextLabel
    // message = withContext + "\n\nCalendar event: " + url
    mockClaimClient.query.mockResolvedValue({
      rows: [
        makeMessengerDelivery({
          reminder_title: "Flight check-in",
          reminder_description: "<p>Bring your passport</p>",
          entity_type: "travels_trip",
          entity_id: 7,
        }),
      ],
      rowCount: 1,
    });
    mockRichTextToPlainText.mockReturnValue("Bring your passport");
    stubPoolForMessenger("https://calendar.google.com/event?eid=full");

    // Call 1: resolveEntityContextLabel (travels_trip) → trip row
    mockDbSelectWhere.mockReturnValueOnce({
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) =>
        Promise.resolve([{ title: "Italy Trip", destination: "Rome" }]).then(
          resolve,
          reject,
        ),
    });
    // Call 2: conv lookup in deliverGenericMessengerReminder → found
    mockDbSelectWhere.mockReturnValueOnce(makeWhereChain());
    mockDbSelectLimit.mockResolvedValueOnce([{ id: 55 }]);

    await claimAndSendDueDeliveries();

    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    const { content } = (
      lastInsertResult.values.mock.calls[0] as [{ content: string }]
    )[0];
    expect(content).toBe(
      "Flight check-in\n\nBring your passport\n\nTrip: Italy Trip → Rome\n\nCalendar event: https://calendar.google.com/event?eid=full",
    );
    // Also confirm the message is stored as an assistant message
    expect(lastInsertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", channel: "web" }),
    );
  });

  it("assembles title + description + calendar correctly (no contextLabel)", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [
        makeMessengerDelivery({
          reminder_title: "Pack",
          reminder_description: "<p>Check the list</p>",
          entity_type: null,
          entity_id: null,
        }),
      ],
      rowCount: 1,
    });
    mockRichTextToPlainText.mockReturnValue("Check the list");
    stubPoolForMessenger("https://cal.example.com/event");
    setupConvFound();

    await claimAndSendDueDeliveries();

    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    const { content } = (
      lastInsertResult.values.mock.calls[0] as [{ content: string }]
    )[0];
    expect(content).toBe(
      "Pack\n\nCheck the list\n\nCalendar event: https://cal.example.com/event",
    );
  });

  // -------------------------------------------------------------------------
  // Conversation lookup & auto-creation
  // -------------------------------------------------------------------------

  it("does not auto-create a conversation when the default conv already exists", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeMessengerDelivery()],
      rowCount: 1,
    });
    stubPoolForMessenger(null);
    setupConvFound(); // conv id=99 returned by limit()

    const result = await claimAndSendDueDeliveries();

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    // returning() is only called when a new conv row is inserted
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it("auto-creates the default conversation when none exists and then delivers", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeMessengerDelivery({ id: 601 })],
      rowCount: 1,
    });
    stubPoolForMessenger(null);

    // Conv not found → auto-create returns id=42
    mockDbSelectLimit.mockResolvedValueOnce([]); // select: not found
    mockDbInsertReturning.mockResolvedValueOnce([{ id: 42 }]); // created

    const result = await claimAndSendDueDeliveries();

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    // returning() must have been called exactly once (for the conv row)
    expect(mockDbInsertReturning).toHaveBeenCalledOnce();

    // The message insert must use the auto-created conv id=42
    const { db } = await import("@workspace/db");
    const lastInsertResult = vi.mocked(db.insert).mock.results.at(-1)!
      .value as { values: ReturnType<typeof vi.fn> };
    expect(lastInsertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 42 }),
    );
  });

  it("records the delivery as failed when the conv insert returns no row (DB error path)", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeMessengerDelivery({ id: 701 })],
      rowCount: 1,
    });
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // recoverStuck
      .mockResolvedValueOnce({ rows: [{ google_event_html_link: null }] }) // SELECT reminders
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE failed

    // Conv not found AND insert returns nothing → throws inside
    // deliverGenericMessengerReminder → delivery marked failed
    mockDbSelectLimit.mockResolvedValueOnce([]); // select: not found
    mockDbInsertReturning.mockResolvedValueOnce([]); // insert returning: empty

    const result = await claimAndSendDueDeliveries();

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });

    const failedUpdate = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("error = $2") &&
        Array.isArray(c[1]),
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate![1][0]).toBe(701); // correct delivery id
    expect(String(failedUpdate![1][1])).toContain(
      "could not find or create conversation",
    );
  });

  // -------------------------------------------------------------------------
  // fired / failed status update wiring
  // -------------------------------------------------------------------------

  it("issues the fired-status UPDATE with the correct delivery id on success", async () => {
    mockClaimClient.query.mockResolvedValue({
      rows: [makeMessengerDelivery({ id: 801 })],
      rowCount: 1,
    });
    stubPoolForMessenger(null);
    setupConvFound();

    const result = await claimAndSendDueDeliveries();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    const firedUpdate = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("status = 'fired'"),
    );
    expect(firedUpdate).toBeDefined();
    expect(firedUpdate![1][0]).toBe(801);
  });
});

// ---------------------------------------------------------------------------
// runSchedulerTick — happy path: guard passes, full pipeline runs
// ---------------------------------------------------------------------------
//
// When shouldRunScheduledTask returns true the tick must run all four phases
// in sequence (syncCalendarLinkedReminders → scheduleDueDeliveries →
// claimAndSendDueDeliveries → advanceCompletedReminders), record success,
// and reach the claim-batch pool.connect() path. A regression that skips any
// phase would silently stop all reminder delivery from the in-process fallback
// scheduler.
//
// pool.query call order for an empty-database run (no active reminders):
//   1. syncCalendarLinkedReminders SELECT calendar-linked reminders → []
//   2. claimAndSendDueDeliveries: recoverStuckSendingDeliveries UPDATE → 0 rows
//   3. advanceCompletedReminders SELECT active reminders → []
//
// pool.connect call order:
//   1. scheduleDueDeliveries: client for the candidates SELECT → []
//   2. claimAndSendDueDeliveries: claim client for the UPDATE … RETURNING → []
// ---------------------------------------------------------------------------

describe("runSchedulerTick — full pipeline runs when guard passes", () => {
  let mockScheduleClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  let mockClaimClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // shouldRunScheduledTask returns true by default (see top-level mock), so
    // no per-test override needed for the guard.

    // scheduleDueDeliveries pool client: SELECT candidates → empty
    mockScheduleClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    // claimAndSendDueDeliveries claim client: UPDATE claim → no rows claimed
    mockClaimClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };

    // pool.connect() is called twice: once for scheduleDueDeliveries, once for
    // claimAndSendDueDeliveries.
    mockPoolConnect
      .mockResolvedValueOnce(mockScheduleClient)
      .mockResolvedValueOnce(mockClaimClient);

    // pool.query is called three times in a no-reminder run:
    //   1. syncCalendarLinkedReminders SELECT
    //   2. recoverStuckSendingDeliveries UPDATE
    //   3. advanceCompletedReminders SELECT
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // syncCalendarLinkedReminders
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // recoverStuckSendingDeliveries
      .mockResolvedValueOnce({ rows: [] }); // advanceCompletedReminders
  });

  it("runs all four delivery phases and records success", async () => {
    // This is the core regression guard: removing ANY phase from
    // runReminderDeliveries() must break at least one of these assertions.
    const { recordScheduledTaskSuccess } = await import("./scheduler-guard");

    await runSchedulerTick();

    // Phase 0 guard: shouldRunScheduledTask was called (already returning true
    // via the default mock — we just confirm it was invoked).
    expect(vi.mocked(shouldRunScheduledTask)).toHaveBeenCalledWith(
      "reminders-scheduler",
      expect.any(Number),
    );

    // Phase 1 — syncCalendarLinkedReminders: pool.query with the
    // travels_connected_calendars JOIN that identifies this query uniquely.
    const syncQuery = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("travels_connected_calendars"),
    );
    expect(syncQuery).toBeDefined();

    // Phase 2 — scheduleDueDeliveries: pool.connect() → schedule client;
    // the client's SELECT identifies this phase via the INTERVAL lookahead
    // clause that only this query contains.
    expect(mockPoolConnect).toHaveBeenCalled();
    const scheduleClientQuery = mockScheduleClient.query.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INTERVAL"),
    );
    expect(scheduleClientQuery).toBeDefined();
    expect(scheduleClientQuery![0]).toContain("status = 'active'");
    expect(scheduleClientQuery![0]).toContain("deleted_at IS NULL");

    // Phase 3 — claimAndSendDueDeliveries: pool.query for
    // recoverStuckSendingDeliveries (status = 'sending' WHERE clause) AND a
    // second pool.connect() call for the claim batch.
    const recoverQuery = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("status = 'sending'"),
    );
    expect(recoverQuery).toBeDefined();
    // Both pool.connect() calls must have happened (schedule + claim).
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);

    // Phase 4 — advanceCompletedReminders: pool.query with
    // recurrence_fired_count, which only this phase selects.
    const advanceQuery = mockPoolQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("recurrence_fired_count"),
    );
    expect(advanceQuery).toBeDefined();

    // Guard record: success (not failure) recorded after a clean run.
    expect(vi.mocked(recordScheduledTaskSuccess)).toHaveBeenCalledOnce();
    expect(vi.mocked(recordScheduledTaskSuccess)).toHaveBeenCalledWith(
      "reminders-scheduler",
    );
  });

  it("does not call recordScheduledTaskFailure on a clean empty-result run", async () => {
    const { recordScheduledTaskFailure } = await import("./scheduler-guard");

    await runSchedulerTick();

    expect(vi.mocked(recordScheduledTaskFailure)).not.toHaveBeenCalled();
  });

  it("calls recordScheduledTaskFailure (not success) when runReminderDeliveries throws", async () => {
    // Make the syncCalendarLinkedReminders pool.query throw to simulate a
    // hard DB failure during the run.
    mockPoolQuery.mockReset();
    mockPoolQuery.mockRejectedValueOnce(new Error("DB failure during sync"));

    const { recordScheduledTaskSuccess, recordScheduledTaskFailure } =
      await import("./scheduler-guard");

    // runSchedulerTick absorbs the error internally (logs it) and resolves
    // rather than propagating — the caller's setInterval must never crash.
    await expect(runSchedulerTick()).resolves.toBeUndefined();

    expect(vi.mocked(recordScheduledTaskFailure)).toHaveBeenCalledWith(
      "reminders-scheduler",
    );
    expect(vi.mocked(recordScheduledTaskSuccess)).not.toHaveBeenCalled();
  });
});
