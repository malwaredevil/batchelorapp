import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createHmac } from "node:crypto";
import { makeEagerSelectBuilder } from "../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Rate-limit middleware uses a PostgresRateLimitStore that requires a live DB
// connection. Replace it with a passthrough in tests so the store never runs.
vi.mock("../middleware/rateLimit", () => ({
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const TEST_SECRET = "test-agentphone-secret";

vi.mock("../lib/env", () => ({
  env: {
    agentphoneWebhookSecret: TEST_SECRET,
    isProduction: false,
    sessionSecret: "test-session",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
  },
}));

// ── DB mock ──────────────────────────────────────────────────────────────────
// nextInsertThrows: simulates a unique-constraint violation (duplicate delivery)
// nextInsertThrowsDbError: simulates a real DB error (connection refused, etc.)
// These are mutually exclusive; dbError takes priority when both are set.
let nextInsertThrows = false;
let nextInsertThrowsDbError = false;
const insertCalls: { values: unknown }[] = [];

function makeInsertBuilder() {
  const shouldThrowDbError = nextInsertThrowsDbError;
  const shouldThrowDuplicate = nextInsertThrows;
  nextInsertThrowsDbError = false;
  nextInsertThrows = false;
  return {
    values(values: unknown) {
      insertCalls.push({ values });
      if (shouldThrowDbError) throw new Error("ECONNREFUSED");
      if (shouldThrowDuplicate) throw new Error("unique_violation");
      return {
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        returning: () => Promise.resolve([]),
      };
    },
  };
}

function makeUpdateBuilder() {
  const builder: Record<string, () => unknown> = {
    set() {
      return builder;
    },
    where() {
      return Promise.resolve([]);
    },
  };
  return builder;
}

const selectQueue: unknown[][] = [];

const dbMock = {
  insert: vi.fn(() => makeInsertBuilder()),
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  update: vi.fn(() => makeUpdateBuilder()),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: dbMock,
  };
});

// ── Elaine turn mock ─────────────────────────────────────────────────────────
const runAgentphoneTurn = vi.fn().mockResolvedValue({
  replyText: "Mock Elaine reply",
  history: [],
});
vi.mock("../elaine", () => ({
  runAgentphoneTurn: (...args: unknown[]) => runAgentphoneTurn(...args),
}));

// ── SMS mock ─────────────────────────────────────────────────────────────────
const sendSms = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/sms", () => ({
  sendSms: (...args: unknown[]) => sendSms(...args),
  SmsOptedOutError: class SmsOptedOutError extends Error {},
}));

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

function freshTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function signPayload(timestamp: string, body: string): string {
  const signedString = `${timestamp}.${body}`;
  const hex = createHmac("sha256", TEST_SECRET)
    .update(signedString)
    .digest("hex");
  return `sha256=${hex}`;
}

function buildHeaders(
  timestamp: string,
  bodyStr: string,
  deliveryId = "delivery-001",
): Record<string, string> {
  return {
    "x-webhook-id": deliveryId,
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": signPayload(timestamp, bodyStr),
  };
}

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

async function buildApp(): Promise<Express> {
  const { default: router } = await import("./agentphone");
  const app = express();

  // Mirrors the real app's path-scoped body-parser that captures rawBody.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.use("/api/agentphone", router);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectQueue.length = 0;
  insertCalls.length = 0;
  nextInsertThrows = false;
  nextInsertThrowsDbError = false;
  vi.clearAllMocks();
  dbMock.insert.mockImplementation(() => makeInsertBuilder());
  dbMock.select.mockImplementation(() => makeEagerSelectBuilder(selectQueue));
  dbMock.update.mockImplementation(() => makeUpdateBuilder());
  runAgentphoneTurn.mockResolvedValue({ replyText: "Mock reply", history: [] });
  sendSms.mockResolvedValue(undefined);
});

describe("POST /api/agentphone/webhook — signature verification", () => {
  it("accepts a valid signature and processes the event", async () => {
    const body = JSON.stringify({ event: "other.event", channel: "sms" });
    const ts = freshTimestamp();
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects a tampered body with 401", async () => {
    const originalBody = JSON.stringify({ event: "other.event" });
    const tamperedBody = JSON.stringify({
      event: "other.event",
      injected: true,
    });
    const ts = freshTimestamp();
    // Headers are signed over originalBody but we send tamperedBody
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, originalBody))
      .set("Content-Type", "application/json")
      .send(tamperedBody);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects a signature with wrong HMAC value with 401", async () => {
    const body = JSON.stringify({ event: "other.event" });
    const ts = freshTimestamp();
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set({
        "x-webhook-id": "delivery-bad-hmac",
        "x-webhook-timestamp": ts,
        "x-webhook-signature": "sha256=deadbeefdeadbeefdeadbeefdeadbeef",
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with an expired timestamp with 401", async () => {
    const body = JSON.stringify({ event: "other.event" });
    // Timestamp 10 minutes in the past — well outside the 5-minute window.
    const staleTs = Math.floor(Date.now() / 1000 - 10 * 60).toString();
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(staleTs, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with a future timestamp beyond the window with 401", async () => {
    const body = JSON.stringify({ event: "other.event" });
    const futureTs = Math.floor(Date.now() / 1000 + 10 * 60).toString();
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(futureTs, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with no signature header with 401", async () => {
    const body = JSON.stringify({ event: "other.event" });
    const ts = freshTimestamp();
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set({ "x-webhook-id": "delivery-nosig", "x-webhook-timestamp": ts })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("returns 401 (not 500) when env.agentphoneWebhookSecret is undefined", async () => {
    // Verifies the short-circuit guard in verifySignature fires cleanly when
    // the secret is absent from the environment (misconfigured deployment),
    // rather than throwing and yielding a 500.
    // Dynamic import avoids the vi.mock hoisting conflict a top-level import
    // would trigger (the module mock isn't fully initialized at that point).
    const { env } = await import("../lib/env");
    const originalSecret = env.agentphoneWebhookSecret;
    (env as Record<string, unknown>).agentphoneWebhookSecret = undefined;

    try {
      const body = JSON.stringify({ event: "other.event" });
      const ts = freshTimestamp();
      const app = await buildApp();

      const res = await request(app)
        .post("/api/agentphone/webhook")
        .set(buildHeaders(ts, body))
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    } finally {
      (env as Record<string, unknown>).agentphoneWebhookSecret = originalSecret;
    }
  });

  it("returns 401 (not 500) when env.agentphoneWebhookSecret is an empty string", async () => {
    // Empty string is falsy in JS, so the same short-circuit guard applies.
    const { env } = await import("../lib/env");
    const originalSecret = env.agentphoneWebhookSecret;
    (env as Record<string, unknown>).agentphoneWebhookSecret = "";

    try {
      const body = JSON.stringify({ event: "other.event" });
      const ts = freshTimestamp();
      const app = await buildApp();

      const res = await request(app)
        .post("/api/agentphone/webhook")
        .set(buildHeaders(ts, body))
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    } finally {
      (env as Record<string, unknown>).agentphoneWebhookSecret = originalSecret;
    }
  });
});

describe("POST /api/agentphone/webhook — replay / dedup protection", () => {
  it("returns 200 {duplicate:true} when the same delivery id is reused", async () => {
    const body = JSON.stringify({ event: "other.event", channel: "sms" });
    const ts = freshTimestamp();
    const deliveryId = "delivery-replay-001";
    const app = await buildApp();

    // First delivery: insert succeeds → processed normally.
    const first = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body, deliveryId))
      .set("Content-Type", "application/json")
      .send(body);

    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    // Second delivery: simulate DB throwing (unique constraint) so claimDelivery
    // returns false — the route must short-circuit without re-processing.
    nextInsertThrows = true;

    const second = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body, deliveryId))
      .set("Content-Type", "application/json")
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });

  it("does not invoke any downstream side-effects on a replayed delivery", async () => {
    const body = JSON.stringify({ event: "agent.message", channel: "sms" });
    const ts = freshTimestamp();
    const app = await buildApp();

    // Pre-claim the delivery so claimDelivery will throw on the next call.
    nextInsertThrows = true;

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body, "delivery-dup-sideeffect"))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    // Elaine turn must NOT have been invoked.
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    // SMS must NOT have been sent.
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("returns 503 (not 200) when claimDelivery throws a non-unique DB error", async () => {
    // Pins the "fail closed on dedup DB errors" contract: if the dedup insert
    // fails for reasons other than a unique-constraint violation (e.g. DB is
    // unreachable after a server restart), the webhook must return a non-2xx
    // status so AgentPhone will redeliver once the DB recovers — rather than
    // silently treating the event as a duplicate and dropping it.
    const body = JSON.stringify({ event: "other.event", channel: "sms" });
    const ts = freshTimestamp();
    const app = await buildApp();

    nextInsertThrowsDbError = true;

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body, "delivery-dberror-503"))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
  });

  it("does not invoke any downstream side-effects when claimDelivery throws a DB error", async () => {
    // A DB error on the dedup insert must fail closed before any Elaine turn
    // or SMS is attempted — the event has not been safely claimed.
    const body = JSON.stringify({ event: "agent.message", channel: "sms" });
    const ts = freshTimestamp();
    const app = await buildApp();

    nextInsertThrowsDbError = true;

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body, "delivery-dberror-noside"))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(503);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("POST /api/agentphone/webhook — 10DLC keyword handling", () => {
  // ── helpers ──────────────────────────────────────────────────────────────

  const FROM = "+10000000000";

  function smsBody(message: string, deliveryId = `delivery-${message}`) {
    return {
      raw: JSON.stringify({
        event: "agent.message",
        channel: "sms",
        data: { from: FROM, message },
      }),
      deliveryId,
    };
  }

  async function sendSmsWebhook(
    app: Awaited<ReturnType<typeof buildApp>>,
    message: string,
    deliveryId?: string,
  ) {
    const { raw, deliveryId: id } = smsBody(message, deliveryId);
    const ts = freshTimestamp();
    return request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, raw, id))
      .set("Content-Type", "application/json")
      .send(raw);
  }

  // ── STOP ─────────────────────────────────────────────────────────────────

  it("handles STOP from an unrecognized number without querying Elaine", async () => {
    selectQueue.push([]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "STOP", "stop-unrec");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("unsubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("handles STOP from a recognized user: sets smsOptedOutAt and sends reply", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: null }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "STOP", "stop-rec");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("unsubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  // ── HELP ─────────────────────────────────────────────────────────────────

  it("handles HELP from an unrecognized number: sends help text, no Elaine", async () => {
    selectQueue.push([]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "HELP", "help-unrec");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("STOP to unsubscribe"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("handles HELP from a recognized user: sends help text, no Elaine", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: null }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "HELP", "help-rec");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("STOP to unsubscribe"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("handles INFO (HELP alias) from an unrecognized number", async () => {
    selectQueue.push([]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "INFO", "info-unrec");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("STOP to unsubscribe"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  // ── START ─────────────────────────────────────────────────────────────────

  it("handles START from an unrecognized number: sends confirmation, no Elaine", async () => {
    selectQueue.push([]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "START", "start-unrec");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("resubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("handles START from an opted-out user: clears smsOptedOutAt and sends confirmation", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: new Date() }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "START", "start-rec-optout");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    // DB update must have been called to clear the opt-out
    expect(dbMock.update).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("resubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("handles YES (START alias) from an opted-out user", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: new Date() }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "YES", "yes-rec-optout");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("resubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  // ── Opted-out user: compliance keywords still work ──────────────────────

  it("opted-out user sending STOP still receives the unsubscribe confirmation", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: new Date() }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "STOP", "stop-already-out");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("unsubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("opted-out user sending HELP still receives the help text", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: new Date() }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "HELP", "help-opted-out");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("STOP to unsubscribe"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it("opted-out user sending a regular message is silenced (no Elaine, no SMS)", async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: new Date() }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(
      app,
      "What time is my flight?",
      "normal-opted-out",
    );
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  // ── Keyword normalisation ─────────────────────────────────────────────────

  it('normalizes lowercase "stop" to STOP', async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: null }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "stop", "stop-lower");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("unsubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it('normalizes "Stop." (mixed case + trailing punctuation) to STOP', async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: null }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "Stop.", "stop-punct");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("unsubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it('normalizes "  STOP  " (leading/trailing whitespace) to STOP', async () => {
    selectQueue.push([{ id: 1, smsOptedOutAt: null }]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "  STOP  ", "stop-spaces");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("unsubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it('normalizes "help!" to HELP', async () => {
    selectQueue.push([]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "help!", "help-lower-punct");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("STOP to unsubscribe"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });

  it('normalizes "Start." to START', async () => {
    selectQueue.push([]);
    const app = await buildApp();
    const res = await sendSmsWebhook(app, "Start.", "start-mixed-punct");
    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining("resubscribed"),
      expect.objectContaining({ bypassOptOutCheck: true }),
    );
  });
});

describe("POST /api/agentphone/webhook — missing required headers", () => {
  it("returns 400 when X-Webhook-ID is absent (but signature is otherwise valid)", async () => {
    const body = JSON.stringify({ event: "other.event" });
    const ts = freshTimestamp();
    const sig = signPayload(ts, body);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set({
        "x-webhook-timestamp": ts,
        "x-webhook-signature": sig,
        // Deliberately omitting x-webhook-id
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(400);
  });
});
