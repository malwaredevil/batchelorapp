/**
 * Tests for the messenger conversations route — specifically the @elaine
 * mention path that must invoke runMessengerElaineTurn (the smart model tier,
 * NOT a fast-model variant).
 *
 * Mirrors the patterns established in elaine-email.test.ts and
 * agentphone.test.ts for the other restricted-channel bridges.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { makeEagerSelectBuilder } from "../../test-helpers/db-mock";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/rateLimit", () => ({
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/env", () => ({
  env: {
    isProduction: false,
    sessionSecret: "test-session",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
  },
}));

// ── DB mock ──────────────────────────────────────────────────────────────────
// selectQueue: each db.select() call eagerly consumes one entry.
// Entries needed per POST /conversations/:id/messages request:
//   1. isParticipant  — db.select().from(...).where(...).limit(1)
//   2. attRows        — db.select().from(...).where(...)   [thenable]
//   3. senderRow      — db.select().from(...).where(...).limit(1)
// When @elaine fires generateElaineReply the runMessengerElaineTurn mock
// intercepts before any additional selects run.
const selectQueue: unknown[][] = [];
const insertCalls: Array<{ values: unknown }> = [];

// A saved message row returned by tx.insert().returning().
const MOCK_MESSAGE_ROW = {
  id: 42,
  conversationId: 1,
  senderId: 1,
  body: "hello @elaine",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  readAt: null,
  deletedAt: null,
  editedAt: null,
  metadata: null,
};

function makeTxInsertBuilder(returningRow: unknown = MOCK_MESSAGE_ROW) {
  return {
    values(values: unknown) {
      insertCalls.push({ values });
      return {
        returning: () => Promise.resolve([returningRow]),
      };
    },
  };
}

function makeRootInsertBuilder() {
  return {
    values(values: unknown) {
      insertCalls.push({ values });
      return {
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
        returning: () => Promise.resolve([]),
      };
    },
  };
}

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn(() => makeRootInsertBuilder()),
  transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      insert: vi.fn(() => makeTxInsertBuilder()),
      select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
    };
    return fn(tx);
  }),
  update: vi.fn(() => ({
    set: () => ({ where: () => Promise.resolve([]) }),
  })),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: dbMock,
  };
});

// ── runMessengerElaineTurn mock ───────────────────────────────────────────────
// Mirrors how other bridge tests mock their respective Elaine turn functions.
const runMessengerElaineTurn = vi.fn().mockResolvedValue({
  replyText: "Mock Elaine reply",
  widgets: [],
});

vi.mock("../../elaine", () => ({
  runMessengerElaineTurn: (...args: unknown[]) =>
    runMessengerElaineTurn(...args),
}));

// ── Messenger storage mock ────────────────────────────────────────────────────
vi.mock("../../lib/messenger/storage", () => ({
  getSignedUrls: vi.fn().mockResolvedValue(new Map()),
}));

// ── Push notification mock ────────────────────────────────────────────────────
vi.mock("./push", () => ({
  fanOutPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

// Pre-warm the module before any test's timeout starts.
import type { IRouter } from "express";
let conversationsRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./conversations");
  conversationsRouter = mod.default;
}, 30_000);

function buildApp(sessionUserId = 1): Express {
  const app = express();
  app.use(express.json());
  // Inject session without requiring the full auth middleware stack.
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: sessionUserId };
    next();
  });
  app.use("/messenger", conversationsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------

/**
 * Push the three db.select() entries consumed by POST /conversations/:id/messages:
 *  1. isParticipant  → participant row found
 *  2. attRows        → no attachments
 *  3. senderRow      → displayName
 */
function queueMessageSendSelects(displayName = "Alice"): void {
  selectQueue.push([{ id: 1 }]); // isParticipant
  selectQueue.push([]); // attRows (no attachments)
  selectQueue.push([{ displayName }]); // senderRow
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectQueue.length = 0;
  insertCalls.length = 0;
  vi.clearAllMocks();

  // Re-wire mocks cleared by clearAllMocks().
  dbMock.select.mockImplementation(() => makeEagerSelectBuilder(selectQueue));
  dbMock.insert.mockImplementation(() => makeRootInsertBuilder());
  dbMock.transaction.mockImplementation(
    (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(() => makeTxInsertBuilder()),
        select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
      };
      return fn(tx);
    },
  );
  runMessengerElaineTurn.mockResolvedValue({
    replyText: "Mock Elaine reply",
    widgets: [],
  });
});

// ---------------------------------------------------------------------------
// Core behaviour: @elaine mention invokes runMessengerElaineTurn
// ---------------------------------------------------------------------------

describe("POST /messenger/conversations/:id/messages — @elaine mention", () => {
  it("calls runMessengerElaineTurn when the message body contains @elaine", async () => {
    queueMessageSendSelects("Bob");

    const app = buildApp();
    const res = await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "hey @elaine what's the weather?" });

    // Route responds 201 before the fire-and-forget Elaine turn completes.
    expect(res.status).toBe(201);

    // Wait for the async generateElaineReply to finish.
    await vi.waitFor(() => {
      expect(runMessengerElaineTurn).toHaveBeenCalledOnce();
    });

    const [callArgs] = runMessengerElaineTurn.mock.calls;
    expect(callArgs[0]).toMatchObject({
      userId: 1,
      conversationId: 1,
      senderName: "Bob",
    });
    // inputText must be the message with the @elaine mention stripped.
    expect((callArgs[0] as { inputText: string }).inputText).not.toMatch(
      /@elaine/i,
    );
  });

  it("calls runMessengerElaineTurn for case-insensitive @Elaine variants", async () => {
    queueMessageSendSelects();

    const app = buildApp();
    await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "@Elaine can you help?" });

    await vi.waitFor(() => {
      expect(runMessengerElaineTurn).toHaveBeenCalledOnce();
    });
  });

  it("does NOT call runMessengerElaineTurn when the message has no @elaine mention", async () => {
    queueMessageSendSelects();

    const app = buildApp();
    const res = await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "Hello everyone, no AI needed here." });

    expect(res.status).toBe(201);

    // Give any stray async work time to settle.
    await new Promise((r) => setImmediate(r));

    expect(runMessengerElaineTurn).not.toHaveBeenCalled();
  });

  it("saves the Elaine reply into messengerMessages after a successful turn", async () => {
    queueMessageSendSelects();

    const app = buildApp();
    await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "@elaine what time is it?" });

    await vi.waitFor(() => {
      expect(runMessengerElaineTurn).toHaveBeenCalledOnce();
    });

    // db.insert should have been called at least twice:
    //  1. tx.insert(messengerMessages) for the user's message (inside transaction)
    //  2. db.insert(messengerMessages) for the Elaine reply
    // The root insert mock (dbMock.insert) handles the Elaine-reply insert.
    expect(dbMock.insert).toHaveBeenCalled();
    // At least one insertCall should carry the Elaine reply body.
    const elaineInsert = insertCalls.find(
      (c) =>
        (c.values as Record<string, unknown>)?.body === "Mock Elaine reply",
    );
    expect(elaineInsert).toBeDefined();
  });

  it("saves the Elaine reply with widgets as metadata when widgets are returned", async () => {
    queueMessageSendSelects();
    const fakeWidget = { type: "trip_card", tripId: 7 };
    runMessengerElaineTurn.mockResolvedValue({
      replyText: "Here's your trip",
      widgets: [fakeWidget],
    });

    const app = buildApp();
    await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "@elaine show my trip" });

    await vi.waitFor(() => {
      expect(runMessengerElaineTurn).toHaveBeenCalledOnce();
    });

    const elaineInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>)?.body === "Here's your trip",
    );
    expect(elaineInsert).toBeDefined();
    expect((elaineInsert!.values as Record<string, unknown>).metadata).toEqual({
      widgets: [fakeWidget],
    });
  });
});

// ---------------------------------------------------------------------------
// Error-fallback behaviour
// ---------------------------------------------------------------------------

describe("POST /messenger/conversations/:id/messages — @elaine error handling", () => {
  it("inserts a friendly fallback reply when runMessengerElaineTurn throws RateLimitError", async () => {
    queueMessageSendSelects();
    runMessengerElaineTurn.mockRejectedValue(
      new OpenAI.RateLimitError(
        429,
        {
          error: {
            message: "rate limited",
            type: "tokens",
            param: null,
            code: null,
          },
        },
        "rate limited",
        new Headers(),
      ),
    );

    const app = buildApp();
    const res = await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "@elaine help please" });

    // 201 is returned before generateElaineReply resolves.
    expect(res.status).toBe(201);

    await vi.waitFor(() => {
      expect(runMessengerElaineTurn).toHaveBeenCalledOnce();
    });

    // A fallback insert must still occur with the user-friendly message.
    await vi.waitFor(() => {
      const rateLimitInsert = insertCalls.find((c) => {
        const body = (c.values as Record<string, unknown>)?.body as string;
        return (
          typeof body === "string" &&
          (body.toLowerCase().includes("overloaded") ||
            body.toLowerCase().includes("moment") ||
            body.toLowerCase().includes("try again"))
        );
      });
      expect(rateLimitInsert).toBeDefined();
    });
  });

  it("does not insert a fallback reply when runMessengerElaineTurn throws a non-rate-limit error", async () => {
    queueMessageSendSelects();
    const { logger } = await import("../../lib/logger");
    runMessengerElaineTurn.mockRejectedValue(
      new Error("unexpected DB failure"),
    );

    const app = buildApp();
    await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "@elaine crash please" });

    await vi.waitFor(() => {
      expect(runMessengerElaineTurn).toHaveBeenCalledOnce();
    });

    // Wait for the .catch() handler to run.
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalled();
    });

    // No Elaine-reply insert should have been attempted.
    const anyElaineReplyInsert = insertCalls.find(
      (c) => (c.values as Record<string, unknown>)?.senderId === null,
    );
    expect(anyElaineReplyInsert).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Participant guard
// ---------------------------------------------------------------------------

describe("POST /messenger/conversations/:id/messages — access control", () => {
  it("returns 403 and does not invoke runMessengerElaineTurn when user is not a participant", async () => {
    // isParticipant returns empty array → user is not a member.
    selectQueue.push([]);

    const app = buildApp();
    const res = await request(app)
      .post("/messenger/conversations/1/messages")
      .set("Content-Type", "application/json")
      .send({ body: "@elaine hello" });

    expect(res.status).toBe(403);
    // Give any stray async work time to settle.
    await new Promise((r) => setImmediate(r));
    expect(runMessengerElaineTurn).not.toHaveBeenCalled();
  });
});
