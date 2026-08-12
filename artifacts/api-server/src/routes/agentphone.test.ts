import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { makeEagerSelectBuilder } from "../test-helpers/db-mock";

// Uses PgDialect.sqlToQuery() — drizzle-orm's own public SQL-compilation
// method — to recover the interpolated parameter values passed to
// db.execute(sql`...`), mirroring the pattern in scheduler-guard.test.ts.
function getSqlParamValues(sqlObj: unknown): unknown[] {
  const dialect = new PgDialect();
  const compiled = dialect.sqlToQuery(
    sqlObj as Parameters<typeof dialect.sqlToQuery>[0],
  );
  return compiled.params;
}

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
// nextInsertThrows: simulates a duplicate delivery (claimDelivery returns false)
// nextInsertThrowsDbError: simulates a real DB error (connection refused, etc.)
// These are mutually exclusive; dbError takes priority when both are set.
// claimDelivery now uses db.execute() with ON CONFLICT SQL, so the flags are
// consumed by executeImpl rather than makeInsertBuilder.
let nextInsertThrows = false;
let nextInsertThrowsDbError = false;
const insertCalls: { values: unknown }[] = [];

// executeImpl: backs db.execute() — handles claimDelivery and markDeliveryProcessed.
// The first call per request is claimDelivery; subsequent calls are fire-and-forget
// markDeliveryProcessed which always succeed.
function executeImpl() {
  const shouldThrowDbError = nextInsertThrowsDbError;
  const shouldReturnEmpty = nextInsertThrows;
  nextInsertThrowsDbError = false;
  nextInsertThrows = false;
  if (shouldThrowDbError) throw new Error("ECONNREFUSED");
  if (shouldReturnEmpty) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [{ id: "claimed" }] });
}

function makeInsertBuilder() {
  // Insert is used for getOrCreateAgentphoneConversation, not dedup.
  return {
    values(values: unknown) {
      insertCalls.push({ values });
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
  execute: vi.fn(executeImpl),
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

// Pre-warmed in beforeAll so the first dynamic import completes before any
// test's per-test timeout starts ticking. Without this, the module load
// itself exhausts the default 5 s per-test timeout before the assertion runs.
import type { IRouter } from "express";
let agentphoneRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./agentphone");
  agentphoneRouter = mod.default;
}, 30_000);

function buildApp(): Express {
  const app = express();

  // Mirrors the real app's path-scoped body-parser that captures rawBody.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.use("/api/agentphone", agentphoneRouter);
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
  dbMock.execute.mockImplementation(executeImpl);
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

  it("passes both the content hash and the raw X-Webhook-ID as dedup keys to claimDelivery's query", async () => {
    // Pins the fix for the 2026-08-11 duplicate-SMS bug: AgentPhone can
    // redeliver the same logical message under the same X-Webhook-ID but
    // re-signed with a fresh timestamp (different content hash). The dedup
    // INSERT must include the delivery id as a second key, not just the hash.
    const body = JSON.stringify({ event: "other.event", channel: "sms" });
    const ts = freshTimestamp();
    const deliveryId = "delivery-dualkey-001";
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, body, deliveryId))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const claimCall = (
      dbMock.execute.mock.calls[0] as unknown[] | undefined
    )?.[0];
    const params = getSqlParamValues(claimCall);
    expect(params).toContain(deliveryId);
  });

  it("passes null (not the string '(missing)') as the delivery id when the header is absent", async () => {
    // A missing header must never collide with another missing-header
    // request via a shared sentinel string.
    const body = JSON.stringify({ event: "other.event", channel: "sms" });
    const ts = freshTimestamp();
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set({
        "x-webhook-timestamp": ts,
        "x-webhook-signature": signPayload(ts, body),
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const claimCall = (
      dbMock.execute.mock.calls[0] as unknown[] | undefined
    )?.[0];
    const params = getSqlParamValues(claimCall);
    expect(params).not.toContain("(missing)");
    expect(params).toContain(null);
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
  it("accepts a request with no X-Webhook-ID (dedup now uses content hash, not delivery ID)", async () => {
    // X-Webhook-ID is now logging-only; the dedup key is the SHA-256 of the
    // HMAC-signed material (timestamp + body). A missing ID is acceptable and
    // must not cause a 400 — the request is processed normally.
    const body = JSON.stringify({ event: "other.event" });
    const ts = freshTimestamp();
    const sig = signPayload(ts, body);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/agentphone/webhook")
      .set({
        "x-webhook-timestamp": ts,
        "x-webhook-signature": sig,
        // Deliberately omitting x-webhook-id — should still succeed
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Voice channel tests
//
// These verify that voice webhook calls:
//  1. Respond with NDJSON (Content-Type: application/x-ndjson).
//  2. Include an interim ack as the first line — keeping the call alive so
//     AgentPhone never re-delivers the same turn and the dedup table never
//     rejects a legitimate second message.
//  3. Include the final Elaine reply as the second line.
//  4. Pass `channel: "voice"` to runAgentphoneTurn so the fast chatModel is
//     selected (not the smarter/slower restrictedTextModel used for SMS).
//  5. Gate on phone-number lookup: unrecognized numbers get an immediate
//     rejection + hangup without invoking Elaine at all.
//  6. Return a greeting for an empty transcript without invoking Elaine.
// ---------------------------------------------------------------------------

describe("POST /api/agentphone/webhook — voice channel", () => {
  const FROM = "+10000000001";

  function voiceBody(
    transcript: string,
    from = FROM,
    deliveryId = `voice-delivery-${Date.now()}`,
  ) {
    const raw = JSON.stringify({
      event: "agent.message",
      channel: "voice",
      data: { from, transcript },
    });
    return { raw, deliveryId };
  }

  async function sendVoiceWebhook(
    app: Awaited<ReturnType<typeof buildApp>>,
    transcript: string,
    from = FROM,
    deliveryId?: string,
  ) {
    const { raw, deliveryId: id } = voiceBody(
      transcript,
      from,
      deliveryId ?? `voice-${transcript.slice(0, 8)}-${Date.now()}`,
    );
    const ts = freshTimestamp();
    return request(app)
      .post("/api/agentphone/webhook")
      .set(buildHeaders(ts, raw, id))
      .set("Content-Type", "application/json")
      .send(raw);
  }

  /** Build a db.update() mock chain that satisfies `.set().where().returning()`. */
  function makeVoiceUpdateMock(returnedId: number) {
    return () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: returnedId }]),
        }),
      }),
    });
  }

  it("responds with Content-Type application/x-ndjson for a voice turn", async () => {
    selectQueue.push([{ id: 1 }]); // user lookup
    selectQueue.push([{ id: 100, messages: [], version: 0, userId: 1 }]); // conversation
    dbMock.update.mockImplementation(makeVoiceUpdateMock(100));

    const app = await buildApp();
    const res = await sendVoiceWebhook(app, "What trips do I have coming up?");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
  });

  it("sends an interim ack as the first NDJSON line before the final reply", async () => {
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([{ id: 101, messages: [], version: 0, userId: 1 }]);
    dbMock.update.mockImplementation(makeVoiceUpdateMock(101));

    runAgentphoneTurn.mockResolvedValue({
      replyText: "You have a trip to Paris next week.",
      history: [],
    });

    const app = await buildApp();
    const res = await sendVoiceWebhook(app, "Do I have any trips soon?");

    // Parse NDJSON — two newline-delimited JSON objects
    const lines = (res.text as string)
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    // First line must be an interim ack (keeps AgentPhone from re-delivering)
    expect(lines[0]).toMatchObject({ interim: true });
    expect(typeof lines[0].text).toBe("string");
    expect((lines[0].text as string).length).toBeGreaterThan(0);
    // Second line is the final reply — no `interim` flag
    expect(lines[1].interim).toBeUndefined();
    expect(lines[1].text).toBe("You have a trip to Paris next week.");
  });

  it("flushes the interim ack before the model response arrives (streaming delivery verified)", async () => {
    // Regression guard: a buffered response (one that awaits the model before
    // writing anything) would fail this test because the first HTTP data chunk
    // would arrive AFTER modelResolvedAt.  The test uses a real TCP server and
    // a streaming http.request client so it can observe chunk delivery times
    // independently of when the full response ends — something Supertest cannot
    // do because it buffers the entire body before resolving.
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([{ id: 104, messages: [], version: 0, userId: 1 }]);
    dbMock.update.mockImplementation(makeVoiceUpdateMock(104));

    const DELAY_MS = 150;
    let modelResolvedAt = 0;

    runAgentphoneTurn.mockImplementation(async () => {
      // Simulate a slow LLM call.
      await new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS));
      modelResolvedAt = Date.now();
      return { replyText: "Your Paris trip is next Tuesday.", history: [] };
    });

    const app = buildApp();

    // Spin up a real TCP listener so streaming chunks are observable.
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const transcript = "When is my Paris trip?";
      const bodyStr = JSON.stringify({
        event: "agent.message",
        channel: "voice",
        data: { from: FROM, transcript },
      });
      const ts = freshTimestamp();
      const reqHeaders = buildHeaders(
        ts,
        bodyStr,
        `voice-stream-${Date.now()}`,
      );

      const { firstChunkAt, allText, statusCode, contentType } =
        await new Promise<{
          firstChunkAt: number;
          allText: string;
          statusCode: number;
          contentType: string;
        }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port,
              path: "/api/agentphone/webhook",
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyStr),
                ...reqHeaders,
              },
            },
            (res) => {
              let firstChunkAt = 0;
              const parts: string[] = [];

              res.on("data", (chunk: Buffer) => {
                if (firstChunkAt === 0) firstChunkAt = Date.now();
                parts.push(chunk.toString());
              });

              res.on("end", () => {
                resolve({
                  firstChunkAt,
                  allText: parts.join(""),
                  statusCode: res.statusCode ?? 0,
                  contentType: res.headers["content-type"] ?? "",
                });
              });

              res.on("error", reject);
            },
          );

          req.on("error", reject);
          req.write(bodyStr);
          req.end();
        });

      // ── Streaming-order assertion (the regression this test guards) ────────
      // The first HTTP data chunk must have arrived BEFORE the model resolved.
      // A buffered implementation would send nothing until after modelResolvedAt,
      // making firstChunkAt > modelResolvedAt and failing this assertion.
      expect(modelResolvedAt).toBeGreaterThan(0); // mock actually ran
      expect(firstChunkAt).toBeGreaterThan(0); // at least one chunk received
      expect(firstChunkAt).toBeLessThan(modelResolvedAt);

      // ── Shape assertions ───────────────────────────────────────────────────
      expect(statusCode).toBe(200);
      expect(contentType).toMatch(/application\/x-ndjson/);

      const lines = allText
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);

      // Exactly two lines: interim ack + final reply — no extra error line.
      expect(lines).toHaveLength(2);

      // Line 1 — interim ack (written synchronously before the model call).
      expect(lines[0]).toMatchObject({ interim: true });
      expect(typeof lines[0].text).toBe("string");
      expect((lines[0].text as string).length).toBeGreaterThan(0);
      expect(lines[0].hangup).toBeUndefined();

      // Line 2 — final reply (written after the model resolved).
      expect(lines[1].text).toBe("Your Paris trip is next Tuesday.");
      expect(lines[1].interim).toBeUndefined();
      expect(lines[1].hangup).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sends the fallback error text as the second NDJSON line when the model throws mid-stream", async () => {
    // Regression guard: when runRestrictedTurnAndPersist throws AFTER the
    // interim ack has already been flushed, the caller must still receive a
    // second NDJSON line with a human-readable error message — not silence or
    // a broken/truncated stream.
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([{ id: 105, messages: [], version: 0, userId: 1 }]);
    dbMock.update.mockImplementation(makeVoiceUpdateMock(105));

    const DELAY_MS = 50;
    runAgentphoneTurn.mockImplementation(async () => {
      // Simulate a model call that starts (interim ack has been sent) then fails.
      await new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS));
      throw new Error("Simulated LLM failure mid-stream");
    });

    const app = await buildApp();
    const res = await sendVoiceWebhook(app, "What trips do I have?");

    // Status must be 200 — the header was committed before the error occurred.
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);

    // Parse both NDJSON lines — must be exactly two non-empty lines.
    const lines = (res.text as string)
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines).toHaveLength(2);

    // Line 1 — interim ack written synchronously before the model call.
    expect(lines[0]).toMatchObject({ interim: true });
    expect(typeof lines[0].text).toBe("string");
    expect((lines[0].text as string).length).toBeGreaterThan(0);

    // Line 2 — fallback error text written by the catch block, not silence.
    expect(lines[1].interim).toBeUndefined();
    expect(typeof lines[1].text).toBe("string");
    expect((lines[1].text as string).length).toBeGreaterThan(0);
    // Must contain an apology / "try again" framing so the caller hears
    // something useful rather than dead air.
    expect(lines[1].text as string).toMatch(/sorry|wrong|try again/i);
  });

  it("passes channel='voice' to runAgentphoneTurn so the fast chatModel is selected", async () => {
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([{ id: 102, messages: [], version: 0, userId: 1 }]);
    dbMock.update.mockImplementation(makeVoiceUpdateMock(102));

    const app = await buildApp();
    await sendVoiceWebhook(app, "Any packing list updates?");

    expect(runAgentphoneTurn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "voice" }),
    );
  });

  it("returns a greeting (no Elaine turn) when the transcript is empty", async () => {
    // AgentPhone's configured beginMessage normally handles the greeting;
    // an empty transcript arriving here is a defensive fallback path.
    const app = await buildApp();
    const res = await sendVoiceWebhook(app, "");

    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    // Greeting response must be plain JSON (single object, not NDJSON)
    // because the handler returns immediately before starting the stream.
    const body = res.body as Record<string, unknown>;
    expect(typeof body.text).toBe("string");
    expect((body.text as string).length).toBeGreaterThan(0);
    expect(body.hangup).toBeUndefined(); // greeting does not hang up
  });

  it("returns a rejection + hangup for an unrecognized phone number without invoking Elaine", async () => {
    selectQueue.push([]); // user lookup returns no match
    const app = await buildApp();
    const res = await sendVoiceWebhook(
      app,
      "Tell me about my trips",
      "+19999999999",
      "voice-unrec-number",
    );

    expect(res.status).toBe(200);
    expect(runAgentphoneTurn).not.toHaveBeenCalled();
    const body = res.body as Record<string, unknown>;
    expect(typeof body.text).toBe("string");
    expect(body.hangup).toBe(true);
  });

  it("does not invoke Elaine for a duplicate voice delivery", async () => {
    // The same signed body arriving twice must be deduped: second delivery
    // must return {duplicate:true} and never trigger another Elaine turn.
    const transcript = "What is the weather in Paris?";
    const from = FROM;
    const deliveryId = "voice-dup-001";
    const raw = JSON.stringify({
      event: "agent.message",
      channel: "voice",
      data: { from, transcript },
    });
    const ts = freshTimestamp();
    const headers = buildHeaders(ts, raw, deliveryId);
    const app = await buildApp();

    // First delivery: user lookup + conversation + update succeed normally.
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([{ id: 103, messages: [], version: 0, userId: 1 }]);
    dbMock.update.mockImplementation(makeVoiceUpdateMock(103));

    const first = await request(app)
      .post("/api/agentphone/webhook")
      .set(headers)
      .set("Content-Type", "application/json")
      .send(raw);

    expect(first.status).toBe(200);
    const firstCallCount = runAgentphoneTurn.mock.calls.length;

    // Second delivery: same signed body → same content hash → claimDelivery
    // returns false (duplicate).
    nextInsertThrows = true;

    const second = await request(app)
      .post("/api/agentphone/webhook")
      .set(headers)
      .set("Content-Type", "application/json")
      .send(raw);

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    // Elaine must NOT have been called again on the duplicate delivery.
    expect(runAgentphoneTurn.mock.calls.length).toBe(firstCallCount);
  });
});
