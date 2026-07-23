/**
 * Tests for the Slack route after the job-queue refactor (#308).
 *
 * Covers:
 *   - Enqueue-on-receipt: a valid inbound DM event calls enqueueJob
 *   - Idempotent delivery: a duplicate event_id is a no-op (returns 200 ok)
 *   - Worker claim + reply: the slack.turn job handler runs the turn and
 *     posts the result to the correct channel
 *   - Reply failure retry: when the Elaine turn throws, the handler re-throws
 *     so the worker marks the job for retry
 *   - Per-user serialisation: advisory lock is acquired before reading history
 *     and released (even on failure) so concurrent same-user jobs can't
 *     interleave conversation state
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from "vitest";
import supertest from "supertest";
import { makeEagerSelectBuilder } from "../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// vi.hoisted — initialise spy references before vi.mock factories run.
// vi.mock factories are hoisted before module-level variable declarations,
// so any `const foo = vi.fn()` placed after a vi.mock() call is still
// `undefined` when the factory executes. vi.hoisted() runs its callback
// before factory hoisting, making the refs available in factories.
// ---------------------------------------------------------------------------
const {
  mockEnqueueJob,
  mockRunElaineSlackTurn,
  mockPostSlackMessage,
  mockPostSlashCommandResponse,
  mockPoolClientQuery,
  mockPoolClientRelease,
  insertShouldDuplicate,
  selectQueue,
} = vi.hoisted(() => {
  const mockPoolClientQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockPoolClientRelease = vi.fn();
  return {
    mockEnqueueJob: vi.fn().mockResolvedValue(42),
    mockRunElaineSlackTurn: vi.fn().mockResolvedValue({
      replyText: "Mock Elaine reply",
      history: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "Mock Elaine reply" },
      ],
    }),
    mockPostSlackMessage: vi.fn().mockResolvedValue(undefined),
    mockPostSlashCommandResponse: vi.fn().mockResolvedValue(undefined),
    mockPoolClientQuery,
    mockPoolClientRelease,
    insertShouldDuplicate: { value: false },
    selectQueue: [] as unknown[][],
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock("../lib/env", () => ({
  env: {
    isProduction: false,
    slackSigningSecret: "test-signing-secret",
    slackBotToken: "xoxb-mock",
    sessionSecret: "test-session",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-key",
  },
}));

vi.mock("../middleware/rateLimit", () => ({
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/jobs/queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

vi.mock("../elaine", () => ({
  runElaineSlackTurn: (...args: unknown[]) => mockRunElaineSlackTurn(...args),
  default: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

vi.mock("../lib/slack", () => ({
  verifySlackSignature: vi.fn().mockReturnValue(true),
  postSlackMessage: (...args: unknown[]) => mockPostSlackMessage(...args),
  postSlashCommandResponse: (...args: unknown[]) =>
    mockPostSlashCommandResponse(...args),
  getSlackUserEmail: vi.fn().mockResolvedValue("user@example.com"),
}));

// ── DB mock — fully static, no importOriginal ─────────────────────────────
// We never need the real @workspace/db internals because all db.* calls are
// intercepted by the mock. Avoiding importOriginal prevents the native ESM
// resolver from hitting lib/db/src/index.ts's directory import (`./schema`)
// before Vite's transformer can handle it.

const mockConversationRow = {
  id: 1,
  userId: 7,
  slackUserId: "U123",
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeInsertBuilder() {
  return {
    values(_values: unknown) {
      if (insertShouldDuplicate.value) {
        throw new Error("duplicate key value violates unique constraint");
      }
      return {
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
        returning: () => Promise.resolve([]),
      };
    },
  };
}

function makeUpdateBuilder() {
  return {
    set(_set: unknown) {
      return {
        where: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      };
    },
  };
}

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn(() => makeInsertBuilder()),
  update: vi.fn(() => makeUpdateBuilder()),
};

vi.mock("@workspace/db", () => ({
  db: dbMock,
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: (...args: unknown[]) => mockPoolClientQuery(...args),
      release: (...args: unknown[]) => mockPoolClientRelease(...args),
    }),
  },
  // Table references — passed to db.* calls but irrelevant since db is mocked.
  appUsers: { id: "id", email: "email", slackUserId: "slackUserId" },
  elaineSlackConversations: {
    id: "id",
    userId: "userId",
    slackUserId: "slackUserId",
    messages: "messages",
  },
  slackWebhookDeliveries: { id: "id" },
}));

// ---------------------------------------------------------------------------
// Imports that depend on mocks being in place
// ---------------------------------------------------------------------------

import { verifySlackSignature } from "../lib/slack";

const mockVerify = verifySlackSignature as MockedFunction<
  typeof verifySlackSignature
>;

// ---------------------------------------------------------------------------
// Test-app factory — signature verification is fully mocked so rawBody is
// not required; we just parse JSON/form normally.
// ---------------------------------------------------------------------------

async function getApp() {
  const { default: router } = await import("./slack");
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/slack", router);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dmEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    event_id: "Ev001",
    event: {
      type: "message",
      channel_type: "im",
      user: "U123",
      channel: "D456",
      text: "Hello Elaine",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — webhook route
// ---------------------------------------------------------------------------

describe("Slack webhook — job-queue path (#308)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertShouldDuplicate.value = false;
    selectQueue.length = 0;
    mockVerify.mockReturnValue(true);
    mockEnqueueJob.mockResolvedValue(42);
    // Pre-seed: appUsers lookup returns one matched user.
    selectQueue.push([{ id: 7, email: "user@example.com" }]);
  });

  it("enqueues a slack.turn job for a valid inbound DM and returns 200", async () => {
    const app = await getApp();

    const res = await supertest(app)
      .post("/slack/webhook")
      .set("Content-Type", "application/json")
      .send(dmEvent());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockEnqueueJob).toHaveBeenCalledOnce();
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "slack.turn",
        payload: expect.objectContaining({
          userId: 7,
          slackEventId: "Ev001",
          inputText: "Hello Elaine",
          channelId: "D456",
        }),
        idempotencyKey: "Ev001",
      }),
    );
  });

  it("does NOT call enqueueJob for a duplicate event_id (no-op, returns 200)", async () => {
    insertShouldDuplicate.value = true;
    const app = await getApp();

    const res = await supertest(app)
      .post("/slack/webhook")
      .set("Content-Type", "application/json")
      .send(dmEvent());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 401 when signature verification fails", async () => {
    mockVerify.mockReturnValue(false);
    const app = await getApp();

    const res = await supertest(app)
      .post("/slack/webhook")
      .set("Content-Type", "application/json")
      .send(dmEvent());

    expect(res.status).toBe(401);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("ignores bot messages and does not enqueue", async () => {
    const app = await getApp();

    const res = await supertest(app)
      .post("/slack/webhook")
      .set("Content-Type", "application/json")
      .send(
        dmEvent({
          event: {
            type: "message",
            channel_type: "im",
            user: "U123",
            channel: "D456",
            text: "bot says hi",
            bot_id: "B001",
          },
        }),
      );

    expect(res.status).toBe(200);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("answers url_verification challenge without enqueueing", async () => {
    const app = await getApp();

    const res = await supertest(app)
      .post("/slack/webhook")
      .set("Content-Type", "application/json")
      .send({ type: "url_verification", challenge: "abc123" });

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe("abc123");
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — slack.turn job handler (unit-level, no HTTP)
// ---------------------------------------------------------------------------

describe("slack.turn job handler — worker execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    mockRunElaineSlackTurn.mockResolvedValue({
      replyText: "Mock Elaine reply",
      history: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "Mock Elaine reply" },
      ],
    });
    mockPostSlackMessage.mockResolvedValue(undefined);
    mockPostSlashCommandResponse.mockResolvedValue(undefined);
    // Advisory lock/unlock calls resolve by default (already set via
    // mockPoolClientQuery.mockResolvedValue({ rows: [] }) in vi.hoisted).
  });

  async function getHandler() {
    const { JOB_REGISTRY_BY_TYPE } = await import("../lib/jobs/registry");
    const def = JOB_REGISTRY_BY_TYPE.get("slack.turn");
    if (!def) throw new Error("slack.turn not registered");
    return def.handler;
  }

  function makeContext() {
    return {
      jobId: 1,
      attempt: 1,
      signal: new AbortController().signal,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("calls runElaineSlackTurn and posts to channelId on success", async () => {
    selectQueue.push([mockConversationRow]);
    const handler = await getHandler();

    await handler(
      {
        userId: 7,
        slackEventId: "Ev001",
        inputText: "Hello Elaine",
        channelId: "D456",
      },
      makeContext(),
    );

    expect(mockRunElaineSlackTurn).toHaveBeenCalledWith({
      userId: 7,
      inputText: "Hello Elaine",
      history: [],
    });
    expect(mockPostSlackMessage).toHaveBeenCalledWith(
      "D456",
      "Mock Elaine reply",
    );
    expect(mockPostSlashCommandResponse).not.toHaveBeenCalled();
  });

  it("posts to responseUrl for slash-command payloads", async () => {
    selectQueue.push([mockConversationRow]);
    const handler = await getHandler();

    await handler(
      {
        userId: 7,
        slackEventId: "slash:U123:12345",
        inputText: "What trips do I have?",
        responseUrl: "https://hooks.slack.com/response/TOKEN",
      },
      makeContext(),
    );

    expect(mockPostSlashCommandResponse).toHaveBeenCalledWith(
      "https://hooks.slack.com/response/TOKEN",
      "Mock Elaine reply",
    );
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  it("re-throws when runElaineSlackTurn fails so the worker can retry", async () => {
    selectQueue.push([mockConversationRow]);
    mockRunElaineSlackTurn.mockRejectedValueOnce(new Error("LLM timeout"));
    const handler = await getHandler();

    await expect(
      handler(
        {
          userId: 7,
          slackEventId: "Ev002",
          inputText: "Hello",
          channelId: "D456",
        },
        makeContext(),
      ),
    ).rejects.toThrow("LLM timeout");

    // Handler must re-throw — no reply sent, worker marks job for retry.
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  // ── Per-user serialisation: advisory lock tests ────────────────────────

  it("acquires an advisory lock keyed by userId before reading history", async () => {
    selectQueue.push([mockConversationRow]);
    const handler = await getHandler();

    await handler(
      { userId: 7, slackEventId: "Ev003", inputText: "Hi", channelId: "D456" },
      makeContext(),
    );

    // pool.connect() must be called to get a dedicated client for the lock.
    const { pool } = await import("@workspace/db");
    expect(pool.connect).toHaveBeenCalledOnce();

    // First advisory lock call must be pg_advisory_lock with (classId, userId).
    const lockCall = mockPoolClientQuery.mock.calls.find((args) =>
      String(args[0]).includes("pg_advisory_lock("),
    );
    expect(lockCall).toBeDefined();
    expect(lockCall![1]).toEqual([42001, 7]);
  });

  it("releases the advisory lock and pool client even when the Elaine turn throws", async () => {
    selectQueue.push([mockConversationRow]);
    mockRunElaineSlackTurn.mockRejectedValueOnce(new Error("turn failed"));
    const handler = await getHandler();

    await expect(
      handler(
        {
          userId: 7,
          slackEventId: "Ev004",
          inputText: "Hi",
          channelId: "D456",
        },
        makeContext(),
      ),
    ).rejects.toThrow("turn failed");

    // pg_advisory_unlock must be called in the finally block.
    const unlockCall = mockPoolClientQuery.mock.calls.find((args) =>
      String(args[0]).includes("pg_advisory_unlock("),
    );
    expect(unlockCall).toBeDefined();
    expect(unlockCall![1]).toEqual([42001, 7]);

    // Pool client must be returned to the pool regardless of turn outcome.
    expect(mockPoolClientRelease).toHaveBeenCalledOnce();
  });

  it("releases the advisory lock and pool client on a successful turn too", async () => {
    selectQueue.push([mockConversationRow]);
    const handler = await getHandler();

    await handler(
      { userId: 7, slackEventId: "Ev005", inputText: "Hi", channelId: "D456" },
      makeContext(),
    );

    const unlockCall = mockPoolClientQuery.mock.calls.find((args) =>
      String(args[0]).includes("pg_advisory_unlock("),
    );
    expect(unlockCall).toBeDefined();
    expect(mockPoolClientRelease).toHaveBeenCalledOnce();
  });

  // ── Idempotent retry: Slack reply failure must not duplicate the LLM call ─

  it("does NOT re-run Elaine when the same slackEventId was already processed (idempotent retry)", async () => {
    // Simulate state after a first attempt: Elaine ran, history was written
    // with the eventId tag, but postSlackMessage then failed and the job was
    // retried. On the retry the handler must use the cached reply and skip the
    // Elaine turn entirely.
    const conversationWithCachedReply = {
      ...mockConversationRow,
      messages: [
        { role: "user", content: "Hello Elaine", eventId: "Ev006" },
        {
          role: "assistant",
          content: "Cached reply from first attempt",
          eventId: "Ev006",
        },
      ],
    };
    selectQueue.push([conversationWithCachedReply]);
    const handler = await getHandler();

    await handler(
      {
        userId: 7,
        slackEventId: "Ev006",
        inputText: "Hello Elaine",
        channelId: "D456",
      },
      makeContext(),
    );

    // Elaine must NOT be called again for an already-processed event.
    expect(mockRunElaineSlackTurn).not.toHaveBeenCalled();
    // The cached reply must be re-posted to Slack.
    expect(mockPostSlackMessage).toHaveBeenCalledWith(
      "D456",
      "Cached reply from first attempt",
    );
    // No DB write should happen — history is already correct.
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
