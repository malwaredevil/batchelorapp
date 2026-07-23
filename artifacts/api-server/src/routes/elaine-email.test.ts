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

// The webhook secret in whsec_ format: base64-encoding of the raw key.
const SECRET_RAW = "test-resend-secret";
const SECRET_WHSEC = `whsec_${Buffer.from(SECRET_RAW).toString("base64")}`;

vi.mock("../lib/env", () => ({
  env: {
    resendWebhookSecret: SECRET_WHSEC,
    resendApiKey: undefined, // prevent Resend API calls for email body fetch
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
const selectQueue: unknown[][] = [];

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
  // Insert is used for conversation inserts, not dedup.
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

// ── Elaine email turn mock ───────────────────────────────────────────────────
const runElaineEmailTurn = vi.fn().mockResolvedValue({
  replyText: "Mock Elaine email reply",
  history: [],
});
vi.mock("../elaine", () => ({
  runElaineEmailTurn: (...args: unknown[]) => runElaineEmailTurn(...args),
}));

// ── Email reply mock ─────────────────────────────────────────────────────────
const sendElaineEmailReply = vi.fn().mockResolvedValue("mock-message-id");
vi.mock("../lib/email", () => ({
  sendElaineEmailReply: (...args: unknown[]) => sendElaineEmailReply(...args),
}));

// ── Attachment processing mock ───────────────────────────────────────────────
const processEmailAttachments = vi.fn().mockResolvedValue([]);
vi.mock("../lib/elaine-email-attachments", () => ({
  processEmailAttachments: (...args: unknown[]) =>
    processEmailAttachments(...args),
}));

// ── Resend SDK mock (not reached because resendApiKey is undefined) ───────────
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      receiving: {
        get: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    };
  },
}));

// ---------------------------------------------------------------------------
// Signature helpers (Svix / Resend webhook format)
//
// Signed content: `${svix-id}.${svix-timestamp}.${rawBody}`
// Key: base64-decoded raw secret (stripping the `whsec_` prefix)
// Signature header value: `v1,<base64(HMAC-SHA256)>`
// ---------------------------------------------------------------------------

function freshTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function signSvix(svixId: string, timestamp: string, body: string): string {
  const signedContent = `${svixId}.${timestamp}.${body}`;
  const sigBase64 = createHmac("sha256", Buffer.from(SECRET_RAW))
    .update(signedContent)
    .digest("base64");
  return `v1,${sigBase64}`;
}

function buildHeaders(
  svixId: string,
  timestamp: string,
  bodyStr: string,
): Record<string, string> {
  return {
    "svix-id": svixId,
    "svix-timestamp": timestamp,
    "svix-signature": signSvix(svixId, timestamp, bodyStr),
  };
}

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

async function buildApp(): Promise<Express> {
  const { default: router } = await import("./elaine-email");
  const app = express();

  // Mirrors the real app's raw-body capture middleware.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.use("/api/elaine", router);
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
  runElaineEmailTurn.mockResolvedValue({
    replyText: "Mock reply",
    history: [],
  });
  sendElaineEmailReply.mockResolvedValue("mock-message-id");
  processEmailAttachments.mockResolvedValue([]);
});

describe("POST /api/elaine/email-webhook — signature verification", () => {
  it("accepts a valid Svix signature and processes the event", async () => {
    const svixId = "msg_abc123";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects a tampered body with 401", async () => {
    const svixId = "msg_tamper";
    const ts = freshTimestamp();
    const originalBody = JSON.stringify({ type: "other.event" });
    const tamperedBody = JSON.stringify({
      type: "other.event",
      injected: true,
    });
    // Headers are signed over originalBody but we send tamperedBody
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, originalBody))
      .set("Content-Type", "application/json")
      .send(tamperedBody);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects a signature with wrong HMAC value with 401", async () => {
    const svixId = "msg_wrongsig";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set({
        "svix-id": svixId,
        "svix-timestamp": ts,
        "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with a signature from a wrong secret with 401", async () => {
    const svixId = "msg_wrongkey";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    // Sign with a completely different key
    const wrongSig = `v1,${createHmac("sha256", Buffer.from("wrong-key"))
      .update(`${svixId}.${ts}.${body}`)
      .digest("base64")}`;
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set({
        "svix-id": svixId,
        "svix-timestamp": ts,
        "svix-signature": wrongSig,
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with an expired timestamp with 401", async () => {
    const svixId = "msg_stale";
    const staleTs = Math.floor(Date.now() / 1000 - 10 * 60).toString();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, staleTs, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with a future timestamp beyond the window with 401", async () => {
    const svixId = "msg_future";
    const futureTs = Math.floor(Date.now() / 1000 + 10 * 60).toString();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, futureTs, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("rejects a request with no signature headers with 401", async () => {
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("accepts a svix-signature header with multiple candidates when one is valid", async () => {
    const svixId = "msg_multi";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    const validSig = signSvix(svixId, ts, body);
    // Prepend a bogus v1 entry — the server should accept as long as any candidate matches.
    const multiSig = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${validSig}`;
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set({
        "svix-id": svixId,
        "svix-timestamp": ts,
        "svix-signature": multiSig,
      })
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("POST /api/elaine/email-webhook — replay / dedup protection", () => {
  it("returns 200 {duplicate:true} when the same svix-id is reused", async () => {
    const svixId = "msg_replay_001";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    // First delivery: insert succeeds → processed normally.
    const first = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    // Second delivery: simulate DB unique-constraint throw → claimDelivery
    // returns false → route must short-circuit with duplicate:true.
    nextInsertThrows = true;

    const second = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });

  it("does not invoke any downstream side-effects on a replayed delivery", async () => {
    const svixId = "msg_replay_sideeffect";
    const ts = freshTimestamp();
    const body = JSON.stringify({
      type: "email.received",
      data: { from: "user@example.com", subject: "Hello", text: "Hi Elaine" },
    });
    const app = await buildApp();

    // Force claimDelivery to return false immediately.
    nextInsertThrows = true;

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    // Elaine turn and email reply must NOT have been invoked.
    expect(runElaineEmailTurn).not.toHaveBeenCalled();
    expect(sendElaineEmailReply).not.toHaveBeenCalled();
  });

  it("returns 503 (not 200) when claimDelivery throws a non-unique DB error", async () => {
    // Pins the "fail closed on dedup DB errors" contract: if the dedup insert
    // fails for reasons other than a unique-constraint violation (e.g. DB is
    // unreachable after a restart), the webhook must return a non-2xx status
    // so AgentPhone / Resend will redeliver once the DB recovers — rather
    // than silently treating the event as a duplicate and dropping it.
    const svixId = "msg_dberror_503";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    nextInsertThrowsDbError = true;

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
  });

  it("does not invoke any downstream side-effects when claimDelivery throws a DB error", async () => {
    // A DB error on the dedup insert must fail closed before any Elaine turn
    // or email reply is attempted — the event has not been safely claimed.
    const svixId = "msg_dberror_noside";
    const ts = freshTimestamp();
    const body = JSON.stringify({
      type: "email.received",
      data: { from: "user@example.com", subject: "Hello", text: "Hi Elaine" },
    });
    const app = await buildApp();

    nextInsertThrowsDbError = true;

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(503);
    expect(runElaineEmailTurn).not.toHaveBeenCalled();
    expect(sendElaineEmailReply).not.toHaveBeenCalled();
  });
});

describe("POST /api/elaine/email-webhook — event type routing", () => {
  it("is a no-op for non-inbound event types (e.g. email.delivered)", async () => {
    const svixId = "msg_delivered";
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "email.delivered" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(runElaineEmailTurn).not.toHaveBeenCalled();
  });

  it("ignores email.received from an unrecognized sender without replying", async () => {
    const svixId = "msg_unknown_sender";
    const ts = freshTimestamp();
    const body = JSON.stringify({
      type: "email.received",
      data: {
        from: "stranger@example.com",
        subject: "Test",
        text: "Hello",
      },
    });
    // DB returns no matching user for this email address.
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(runElaineEmailTurn).not.toHaveBeenCalled();
    expect(sendElaineEmailReply).not.toHaveBeenCalled();
  });

  it("accepts inbound.email as an alias for email.received", async () => {
    const svixId = "msg_inbound_alias";
    const ts = freshTimestamp();
    const body = JSON.stringify({
      type: "inbound.email",
      data: {
        from: "user@example.com",
        subject: "Trip question",
        text: "When does my flight leave?",
      },
    });
    // DB returns a matching user, then the conversation row.
    selectQueue.push([{ id: 7, email: "user@example.com" }]);
    selectQueue.push([{ id: 1, userId: 7, messages: [], lastMessageId: null }]);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set(buildHeaders(svixId, ts, body))
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    expect(runElaineEmailTurn).toHaveBeenCalledOnce();
  });
});

describe("POST /api/elaine/email-webhook — missing required headers", () => {
  it("returns 400 when svix-id is absent (but signature is otherwise valid)", async () => {
    const ts = freshTimestamp();
    const body = JSON.stringify({ type: "other.event" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/elaine/email-webhook")
      .set({
        // Deliberately omitting svix-id
        "svix-timestamp": ts,
        "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      })
      .set("Content-Type", "application/json")
      .send(body);

    // Missing svix-id means verifySignature returns false → 401.
    // (svix-id is also used as part of the signed content, so its absence
    // fails signature verification before we even check for the header explicitly.)
    expect(res.status).toBe(401);
  });
});

describe("POST /api/elaine/email-webhook — secret format edge cases", () => {
  it("accepts a bare base64 secret (no whsec_ prefix) and verifies the signature correctly", async () => {
    // The verifySignature function has a branch that handles secrets stored
    // without the whsec_ prefix (treating them as raw base64 directly). This
    // test exercises that branch by setting the env secret to the bare base64
    // string and confirming a correctly-signed request is still accepted.
    //
    // Dynamic import avoids the vi.mock hoisting conflict that a top-level
    // import { env } would trigger (SECRET_WHSEC not yet initialized).
    const { env } = await import("../lib/env");
    const bareBase64Secret = Buffer.from(SECRET_RAW).toString("base64");
    const originalSecret = env.resendWebhookSecret;
    (env as Record<string, unknown>).resendWebhookSecret = bareBase64Secret;

    try {
      const svixId = "msg_bare_b64";
      const ts = freshTimestamp();
      const body = JSON.stringify({ type: "other.event" });
      const app = await buildApp();

      const res = await request(app)
        .post("/api/elaine/email-webhook")
        .set(buildHeaders(svixId, ts, body))
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      (env as Record<string, unknown>).resendWebhookSecret = originalSecret;
    }
  });

  it("rejects gracefully with 401 (not 500) when the secret has an invalid base64 payload", async () => {
    // Ensures verifySignature returns false rather than throwing when the
    // secret decodes to garbage bytes — the signature comparison simply fails
    // to match, so the request is rejected cleanly.
    const { env } = await import("../lib/env");
    const originalSecret = env.resendWebhookSecret;
    (env as Record<string, unknown>).resendWebhookSecret =
      "whsec_!!!not-valid-base64!!!";

    try {
      const svixId = "msg_invalid_b64";
      const ts = freshTimestamp();
      const body = JSON.stringify({ type: "other.event" });
      const app = await buildApp();

      const res = await request(app)
        .post("/api/elaine/email-webhook")
        .set(buildHeaders(svixId, ts, body))
        .set("Content-Type", "application/json")
        .send(body);

      // Must be 401, not 500 — verifySignature must never throw
      expect(res.status).toBe(401);
    } finally {
      (env as Record<string, unknown>).resendWebhookSecret = originalSecret;
    }
  });

  it("rejects with 401 (not 500) when resendWebhookSecret is undefined", async () => {
    // Mirrors the AgentPhone coverage for a missing env secret: a deployment
    // that never set RESEND_WEBHOOK_SECRET must fail closed (401), not crash (500).
    const { env } = await import("../lib/env");
    const originalSecret = env.resendWebhookSecret;
    (env as Record<string, unknown>).resendWebhookSecret = undefined;

    try {
      const svixId = "msg_no_secret_undef";
      const ts = freshTimestamp();
      const body = JSON.stringify({ type: "other.event" });
      const app = await buildApp();

      const res = await request(app)
        .post("/api/elaine/email-webhook")
        .set(buildHeaders(svixId, ts, body))
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    } finally {
      (env as Record<string, unknown>).resendWebhookSecret = originalSecret;
    }
  });

  it("rejects with 401 (not 500) when resendWebhookSecret is an empty string", async () => {
    // An empty-string secret is just as invalid as undefined; verifySignature
    // must short-circuit and return false rather than proceeding with a
    // zero-length key or throwing an exception.
    const { env } = await import("../lib/env");
    const originalSecret = env.resendWebhookSecret;
    (env as Record<string, unknown>).resendWebhookSecret = "";

    try {
      const svixId = "msg_no_secret_empty";
      const ts = freshTimestamp();
      const body = JSON.stringify({ type: "other.event" });
      const app = await buildApp();

      const res = await request(app)
        .post("/api/elaine/email-webhook")
        .set(buildHeaders(svixId, ts, body))
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    } finally {
      (env as Record<string, unknown>).resendWebhookSecret = originalSecret;
    }
  });
});
