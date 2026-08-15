/**
 * Route-level tests for the widget → full-app maximize handoff flow.
 *
 * These tests exercise the TWO PRODUCTION ROUTE HANDLERS mounted in
 * artifacts/api-server/src/elaine/index.ts:
 *
 *   POST /api/elaine/chat/turns/:turnId/handoff
 *     Called by the widget just before its maximize navigation drops the SSE
 *     connection.  Sets the handoff flag on the live turn so the /chat
 *     handler's `res.on("close")` skips the abort-on-disconnect branch and
 *     generation continues.  Returns 404 for unknown or non-owned turns.
 *
 *   GET /api/elaine/chat/turns/:turnId/stream
 *     Attaches the full Elaine app to a live or recently-finished turn.
 *     Replays every buffered SSE event (including terminal `done`/`error` when
 *     the turn is already complete — the done-replay dedup path), then follows
 *     live events until the turn finishes.  Returns 404 for unknown/expired
 *     turns, signalling the client to fall back to persisted history.
 *
 * The turn registry is in-process, so registering turns directly from test
 * code and accessing them via the routes exercises real ownership enforcement
 * without any DB interaction.
 *
 * The "real disconnect" scenario uses Node's `http` module to open a genuine
 * SSE connection and then destroy the socket, so the server-side
 * `res.on("close")` cleanup path is exercised through a real socket teardown,
 * not just a mocked response object.
 *
 * Mock scaffold follows the conventions established in chat-reminder-doubt.test.ts
 * and scheduling-doubt-tool-forcing.test.ts; all AI/DB/Sentry dependencies are
 * stubbed so the router can be imported without real network calls.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import http from "node:http";
import { buildRuntimeMock } from "./test-helpers/runtime-mock";
import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";
import {
  barcodeMockFactory,
  documentGenerationMockFactory,
  documentParsingMockFactory,
  ebayMarketValueMockFactory,
  elaineLessonsMockFactory,
  elaineTasksMockFactory,
  emailMockFactory,
  expertConsultMockFactory,
  googleCalendarTokensMockFactory,
  hallmarkSearchMockFactory,
  integrationsHealthMockFactory,
  loggerMockFactory,
  multerMockFactory,
  openaiMockFactory,
  openrouterModelsMockFactory,
  pdfParseMockFactory,
  rateLimitMockFactory,
  retryMockFactory,
  sentryMockFactory,
  smsMockFactory,
  softDeleteMockFactory,
  ssrfSafeFetchMockFactory,
  storageCoreMockFactory,
  supabaseMockFactory,
  travelAiMockFactory,
  travelDocumentsMockFactory,
  travelFlightsMockFactory,
  travelGoogleMapsMockFactory,
  travelStorageMockFactory,
  travelWishlistExecutorsMockFactory,
  travelsStorageMockFactory,
  uploadLimitsMockFactory,
  webSearchMockFactory,
} from "./test-helpers/standard-mock-scaffold";
import {
  registerElaineTurn,
  publishElaineTurnEvent,
  completeElaineTurn,
  __resetElaineTurnRegistryForTests,
} from "./turn-registry";

// ---------------------------------------------------------------------------
// Module mocks — must all appear before any import of ./index
// ---------------------------------------------------------------------------

vi.mock("@sentry/node", () => sentryMockFactory());
vi.mock("../lib/logger", () => loggerMockFactory());
vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

// Auth: checks req.session?.userId (set by buildApp's session middleware).
// Returns 401 when absent; calls next() when present so the route handlers
// can read req.session.userId!.
vi.mock("../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    next();
  },
  requireOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/env", () => ({
  env: {
    isProduction: false,
    sessionSecret: "test-session",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
    databaseUrl: "postgresql://mock:mock@localhost/mock",
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 1 }]),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve(undefined) }),
      }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    pool: { on: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn((...args: unknown[]) => args),
    eq: vi.fn(),
    desc: vi.fn(),
    isNull: vi.fn(),
    count: vi.fn(),
    inArray: vi.fn(),
    sql: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    lt: vi.fn(),
    gt: vi.fn(),
    lte: vi.fn(),
    gte: vi.fn(),
    ne: vi.fn(),
    asc: vi.fn(),
    notInArray: vi.fn(),
  };
});

vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn().mockResolvedValue(""),
  callModelWithSubagent: vi.fn(
    async (
      _model: unknown,
      _instructions: unknown,
      fn: (client: unknown, model: string, tools: unknown[]) => Promise<void>,
    ) => {
      const fakeClient = {
        chat: {
          completions: {
            create: vi.fn().mockReturnValue(
              (async function* () {
                yield { choices: [{ delta: {}, finish_reason: "stop" }] };
              })(),
            ),
          },
        },
      };
      await fn(fakeClient, "mock-model", []);
    },
  ),
  HIDDEN_REASONING: {},
}));

vi.mock("../lib/openai", () => openaiMockFactory());

vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn().mockResolvedValue({
    enabled: true,
    chatModel: "mock-model",
    subagentModel: "mock-subagent-model",
    maxResponseTokens: 1000,
    requestTimeoutMs: 30_000,
    features: {
      showReasoningSummary: false,
      enableOpenAIResponsesFallback: false,
      enableBuiltinWebSearch: false,
    },
    timeouts: { openAIResponsesMs: 60_000 },
    thresholds: { openAIStateMaxAgeDays: 7 },
    chatWindowSize: "comfortable",
    actionConfirmationMode: "one_by_one",
  }),
  invalidateElaineGlobalConfigCache: vi.fn(),
}));

vi.mock("../lib/openai-responses", () => ({
  generateOpenAIResponseText: vi.fn(),
  getOpenAIResponsesMetrics: vi.fn().mockResolvedValue({}),
  isOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  messagesToResponseInput: vi.fn().mockReturnValue([]),
  OpenAIResponsesUnavailableError: class extends Error {},
  recordOpenAIResponsesFallback: vi.fn(),
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue("gpt-4o"),
  streamOpenAIResponseRound: vi.fn(),
  createOpenAIStableIdentifier: vi.fn().mockReturnValue("mock-id"),
  isReusableElaineResponseState: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/app-config", () => ({
  APP_CONFIG_DEFAULTS: [],
  getAllConfig: vi.fn().mockResolvedValue([]),
  updateConfigValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/openrouter-models", () => openrouterModelsMockFactory());

vi.mock("@supabase/supabase-js", () => supabaseMockFactory());
vi.mock("../lib/storage-core", () => storageCoreMockFactory());
vi.mock("../lib/upload-limits", () => uploadLimitsMockFactory());
vi.mock("multer", () => multerMockFactory());
vi.mock("pdf-parse", () => pdfParseMockFactory());

vi.mock("../lib/email", () => emailMockFactory());
vi.mock("../lib/sms", () => smsMockFactory());
vi.mock("../lib/calls", () => ({
  initiateOutboundCall: vi.fn(),
  waitForCallOutcome: vi.fn().mockResolvedValue("answered"),
}));
vi.mock("../lib/slack", () => ({
  openDmChannel: vi.fn(),
  postSlackMessage: vi.fn(),
  slackConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/web-search", () => webSearchMockFactory());
vi.mock("../lib/travels/flights", () => travelFlightsMockFactory());
vi.mock("../lib/travels/google-maps", () => travelGoogleMapsMockFactory());
vi.mock("../lib/travels/storage", () => travelStorageMockFactory());
vi.mock("../lib/travels-storage", () => travelsStorageMockFactory());
vi.mock("../lib/pottery/ebay-market-value", () => ebayMarketValueMockFactory());
vi.mock("../lib/ornaments/hallmark-search", () => hallmarkSearchMockFactory());
vi.mock("../lib/ornaments/barcode", () => barcodeMockFactory());
vi.mock("../lib/google-calendar-tokens", () =>
  googleCalendarTokensMockFactory(),
);
vi.mock("../routes/travels/documents", () => travelDocumentsMockFactory());
vi.mock("../routes/admin/integrations-health", () =>
  integrationsHealthMockFactory(),
);
vi.mock("../routes/travels/ai", () => travelAiMockFactory());
vi.mock("../lib/soft-delete", () => softDeleteMockFactory());
vi.mock("../lib/expert-consult", () => expertConsultMockFactory());
vi.mock("../lib/retry", () => retryMockFactory());
vi.mock("../lib/ssrf-safe-fetch", () => ssrfSafeFetchMockFactory());
vi.mock("../lib/document-parsing", () => documentParsingMockFactory());
vi.mock("../lib/document-generation", () => documentGenerationMockFactory());
vi.mock("../lib/elaine-tasks", () => elaineTasksMockFactory());
vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());
vi.mock("./travel-wishlist-executors", () =>
  travelWishlistExecutorsMockFactory(),
);

vi.mock("../lib/elaine-memory", () => ({
  correctElaineMemory: vi.fn().mockResolvedValue(undefined),
  forgetElaineMemory: vi.fn().mockResolvedValue(undefined),
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  getRelevantElaineMemory: vi.fn().mockResolvedValue({ evidenceBlock: "" }),
  rememberElaineMemory: vi.fn().mockResolvedValue(undefined),
  saveElaineMemorySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue([]),
  appendCrossChannelEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./pottery-actions", () => ({
  potteryActionSchemas: [],
  potteryActionExecutors: {},
  potteryActionTools: [],
  buildPotteryActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./quilting-actions", () => ({
  quiltingActionSchemas: [],
  quiltingActionExecutors: {},
  quiltingActionTools: [],
  buildQuiltingActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./ornaments-actions", () => ({
  ornamentActionSchemas: [],
  ornamentActionExecutors: {},
  ornamentActionTools: [],
  buildOrnamentActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./universal-actions", () => ({
  universalActionSchemas: [],
  universalActionExecutors: {},
  universalActionTools: [],
  buildUniversalActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./adaptive-actions", () => ({
  adaptiveActionSchemas: [],
  adaptiveActionExecutors: {},
  adaptiveActionTools: [],
  buildAdaptiveActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./app-operation-tools", () => ({
  appOperationActionSchemas: [],
  appOperationActionTools: [],
  appOperationReadTools: [],
  buildAppOperationActionLabel: vi.fn().mockResolvedValue(""),
  DISCOVER_APP_OPERATIONS_TOOL_NAME: "discover_app_operations",
  discoverAppOperations: vi.fn().mockResolvedValue([]),
  executeAppOperation: vi.fn().mockResolvedValue({ status: 200, body: {} }),
  executeAppOperationAction: vi
    .fn()
    .mockResolvedValue({ status: 200, body: {} }),
  EXECUTE_APP_OPERATION_TOOL_NAME: "execute_app_operation",
  READ_APP_OPERATION_TOOL_NAME: "read_app_operation",
}));

vi.mock("./communication-actions", () => ({
  communicationActionSchemas: [],
  communicationActionExecutors: {},
  communicationActionTools: [],
  buildCommunicationActionLabel: vi.fn().mockResolvedValue(""),
  executeListContactChannels: vi.fn().mockResolvedValue([]),
  executeListScheduledContacts: vi
    .fn()
    .mockResolvedValue("No pending scheduled calls or messages."),
  listContactChannelsTool: {
    type: "function",
    function: { name: "list_contact_channels", parameters: {} },
  },
  listScheduledContactsTool: {
    type: "function",
    function: {
      name: "list_scheduled_contacts",
      parameters: { type: "object", properties: {} },
    },
  },
  LIST_CONTACT_CHANNELS_TOOL_NAME: "list_contact_channels",
  LIST_SCHEDULED_CONTACTS_TOOL_NAME: "list_scheduled_contacts",
}));

vi.mock("./reminder-actions", () => ({
  reminderActionSchemas: [],
  reminderActionExecutors: {},
  buildReminderActionLabel: vi.fn().mockResolvedValue(""),
  LIST_REMINDERS_TOOL_NAME: "list_reminders",
  executeListRemindersTool: vi
    .fn()
    .mockResolvedValue('{"reminders":[],"returned":0}'),
  reminderReadTools: [],
  reminderActionTools: [],
}));

vi.mock("./universal-read-tools", () => ({
  GET_ELAINE_TASK_TOOL_NAME: "get_elaine_task",
  GET_NOTE_TOOL_NAME: "get_note",
  GET_NOTIFICATION_COUNTS_TOOL_NAME: "get_notification_counts",
  GET_NOTIFICATION_PREFERENCES_TOOL_NAME: "get_notification_preferences",
  LIST_ELAINE_MEMORIES_TOOL_NAME: "list_elaine_memories",
  LIST_ELAINE_TASKS_TOOL_NAME: "list_elaine_tasks",
  LIST_NOTES_TOOL_NAME: "list_notes",
  LIST_NOTIFICATIONS_TOOL_NAME: "list_notifications",
  universalReadTools: [],
  executeUniversalReadTool: vi.fn().mockResolvedValue("{}"),
}));

vi.mock("./office-actions", () => ({
  officeActionTools: [],
  executeOfficeTool: vi.fn().mockResolvedValue("{}"),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

vi.mock("./capability-registry", () => ({
  buildElaineCapabilityRegistry: vi.fn().mockReturnValue({ capabilities: [] }),
  buildPlannerCatalogFromCapabilities: vi.fn().mockReturnValue([]),
  ELAINE_TOOL_POLICIES: {},
  NARROW_READ_CHANNEL_JUSTIFICATIONS: {},
}));

vi.mock("./planner-tool-catalog", () =>
  buildPlannerToolCatalogMock({ ACTION_TOOL_NAMES: new Set<string>([]) }),
);

vi.mock("./runtime", () => buildRuntimeMock());

vi.mock("./admin-config", () => ({
  AdminConfigBody: { parse: vi.fn((v: unknown) => v) },
  applyAdminConfigPatch: vi.fn(),
  resetElaineGlobalConfigToDefaults: vi.fn(),
}));

vi.mock("./household-counts", () => ({
  queryHouseholdData: vi.fn().mockResolvedValue({}),
}));

vi.mock("./household-search", () => ({
  searchHouseholdData: vi.fn().mockResolvedValue([]),
}));

vi.mock("./yardage-math", () => ({ calculateYardage: vi.fn() }));

vi.mock("../lib/elaine-code-diagnosis", () => ({
  diagnoseRecurringFailureInBackground: vi.fn(),
  maybeDiagnoseRecurringFailure: vi.fn().mockResolvedValue(null),
  listElaineCodeSuggestions: vi.fn().mockResolvedValue([]),
  decideElaineCodeSuggestion: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Router bootstrap — loaded once after all vi.mock() calls are in place.
// ---------------------------------------------------------------------------

import type { IRouter } from "express";

let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 42;
const OTHER_USER_ID = 99;

const silentLog = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Builds a test Express app that mounts the real Elaine router and injects a
 * session with the specified userId.  The mocked requireAuth middleware just
 * checks req.session?.userId is non-null and calls next(), so passing a
 * different userId here changes which turns are visible to the route handlers.
 */
function buildApp(sessionUserId = TEST_USER_ID): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        session: { userId: number };
        log: typeof silentLog;
      }
    ).session = { userId: sessionUserId };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

/** Parse a raw SSE response body into typed event objects. */
function parseSse(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      let event = "message";
      let rawData = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) rawData = line.slice(6);
      }
      return { event, data: JSON.parse(rawData) };
    });
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  __resetElaineTurnRegistryForTests();
});

// ---------------------------------------------------------------------------
// POST /api/elaine/chat/turns/:turnId/handoff
// ---------------------------------------------------------------------------

describe("POST /api/elaine/chat/turns/:turnId/handoff", () => {
  it("returns 404 for an unknown turn id", async () => {
    const res = await request(buildApp()).post(
      "/api/elaine/chat/turns/nonexistent/handoff",
    );
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/turn not found/i);
  });

  it("returns 404 when the turn belongs to a different user", async () => {
    // Register a turn for OWNER, then request as OTHER — ownership check fails.
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 1,
    });

    const res = await request(buildApp(OTHER_USER_ID)).post(
      `/api/elaine/chat/turns/${turn.turnId}/handoff`,
    );
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/turn not found/i);
  });

  it("returns { ok: true } for the owning user and sets the handoff flag", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 2,
    });
    expect(turn.handoff).toBe(false);

    const res = await request(buildApp()).post(
      `/api/elaine/chat/turns/${turn.turnId}/handoff`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // The flag must be set on the in-process registry entry — this is what the
    // /chat handler's res.on("close") listener reads to decide whether to abort.
    expect(turn.handoff).toBe(true);
  });

  it("is idempotent: a second handoff call on the same turn still returns { ok: true }", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 3,
    });

    await request(buildApp()).post(
      `/api/elaine/chat/turns/${turn.turnId}/handoff`,
    );
    const res = await request(buildApp()).post(
      `/api/elaine/chat/turns/${turn.turnId}/handoff`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(turn.handoff).toBe(true);
  });

  it("prevents the /chat close listener from aborting generation after a successful handoff", async () => {
    // Simulates the decision branch in the /chat handler:
    //   if (!liveTurn.handoff) abortController.abort();
    // A successful handoff call must make this branch skip, so generation
    // continues even after the widget's SSE socket closes.
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 4,
    });

    await request(buildApp()).post(
      `/api/elaine/chat/turns/${turn.turnId}/handoff`,
    );

    const wouldAbortGeneration = !turn.handoff;
    expect(wouldAbortGeneration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/elaine/chat/turns/:turnId/stream — 404 and SSE header paths
// ---------------------------------------------------------------------------

describe("GET /api/elaine/chat/turns/:turnId/stream — 404 paths", () => {
  it("returns 404 for an unknown turn id", async () => {
    const res = await request(buildApp()).get(
      "/api/elaine/chat/turns/nonexistent/stream",
    );
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/turn not found/i);
  });

  it("returns 404 when the turn belongs to a different user", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 5,
    });
    publishElaineTurnEvent(turn, "done", { content: "hi" });
    completeElaineTurn(turn);

    const res = await request(buildApp(OTHER_USER_ID)).get(
      `/api/elaine/chat/turns/${turn.turnId}/stream`,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/elaine/chat/turns/:turnId/stream — SSE headers", () => {
  it("sets the required SSE headers even for an already-done turn", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 6,
    });
    publishElaineTurnEvent(turn, "done", { content: "" });
    completeElaineTurn(turn);

    const res = await request(buildApp()).get(
      `/api/elaine/chat/turns/${turn.turnId}/stream`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.headers["cache-control"]).toMatch(/no-cache/);
    expect(res.headers["x-accel-buffering"]).toBe("no");
  });
});

// ---------------------------------------------------------------------------
// GET /api/elaine/chat/turns/:turnId/stream — already-done turn
//
// This is the "done-replay dedup" path: the full Elaine app calls GET /stream
// after the turn has already completed (common when maximize happens just as
// the reply finishes, or when the app load is slow).  The route must replay
// every buffered event including the terminal `done`, then close immediately.
// The client deduplicates the `done` payload's message IDs against what it
// may already have displayed during the pre-maximize widget view.
// ---------------------------------------------------------------------------

describe("GET /api/elaine/chat/turns/:turnId/stream — done-turn replay (done-replay dedup path)", () => {
  it("replays all buffered events in order and closes the response", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 10,
    });
    publishElaineTurnEvent(turn, "turn", {
      turnId: turn.turnId,
      conversationId: 10,
    });
    publishElaineTurnEvent(turn, "status", { message: "Planning…" });
    publishElaineTurnEvent(turn, "delta", { text: "Hello" });
    publishElaineTurnEvent(turn, "delta", { text: " world" });
    publishElaineTurnEvent(turn, "done", {
      content: "Hello world",
      conversationId: 10,
      messageId: 42,
    });
    completeElaineTurn(turn);

    const res = await request(buildApp()).get(
      `/api/elaine/chat/turns/${turn.turnId}/stream`,
    );

    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual([
      "turn",
      "status",
      "delta",
      "delta",
      "done",
    ]);
  });

  it("includes the terminal done event so the client can reconcile persisted message IDs", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 11,
    });
    publishElaineTurnEvent(turn, "done", {
      content: "final answer",
      messageId: 99,
    });
    completeElaineTurn(turn);

    const res = await request(buildApp()).get(
      `/api/elaine/chat/turns/${turn.turnId}/stream`,
    );

    const events = parseSse(res.text);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent!.data as { messageId: number }).messageId).toBe(99);
  });

  it("handles a turn with no buffered events gracefully (no crash, no SSE events)", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 12,
    });
    completeElaineTurn(turn);

    const res = await request(buildApp()).get(
      `/api/elaine/chat/turns/${turn.turnId}/stream`,
    );

    expect(res.status).toBe(200);
    expect(parseSse(res.text)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/elaine/chat/turns/:turnId/stream — live turn (maximize while streaming)
//
// The full maximize-while-streaming UX: the user clicks maximize while Elaine
// is mid-reasoning.  The widget has called POST /handoff, navigated away, and
// now the full Elaine app calls GET /stream.  The route must:
//   1. Replay every event buffered so far (shows partial reply / reasoning).
//   2. Attach a live listener and keep streaming until the terminal event.
//
// Supertest awaits the full response body; for a live (non-done) turn the
// response stays open until res.end() is called by the terminal-event listener.
// We use `.end(callback)` to start the HTTP request without blocking, yield to
// the event loop so the route handler can attach its listener, then publish the
// terminal event from the test.
// ---------------------------------------------------------------------------

describe("GET /api/elaine/chat/turns/:turnId/stream — live turn (maximize while streaming)", () => {
  it("replays pre-attach events AND delivers live events up to done", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 20,
    });

    // Events buffered before the full app attaches — must be replayed.
    publishElaineTurnEvent(turn, "turn", {
      turnId: turn.turnId,
      conversationId: 20,
    });
    publishElaineTurnEvent(turn, "status", { message: "Planning…" });
    publishElaineTurnEvent(turn, "delta", { text: "Part 1 " });

    const received = await new Promise<string>((resolve, reject) => {
      request(buildApp())
        .get(`/api/elaine/chat/turns/${turn.turnId}/stream`)
        .buffer(true)
        .end((err, res) => {
          if (err) reject(err);
          else resolve(res.text);
        });

      // Yield to the event loop so Express processes the request and the route
      // handler attaches its live listener before we publish more events.
      setImmediate(() => {
        publishElaineTurnEvent(turn, "delta", { text: "Part 2" });
        publishElaineTurnEvent(turn, "done", {
          content: "Part 1 Part 2",
          conversationId: 20,
          messageId: 55,
        });
        completeElaineTurn(turn);
      });
    });

    const events = parseSse(received);
    // 3 pre-attach events + 2 live events = 5 total.
    expect(events.map((e) => e.event)).toEqual([
      "turn",
      "status",
      "delta",
      "delta",
      "done",
    ]);

    const deltaTexts = events
      .filter((e) => e.event === "delta")
      .map((e) => (e.data as { text: string }).text);
    expect(deltaTexts).toEqual(["Part 1 ", "Part 2"]);

    expect(
      (events.find((e) => e.event === "done")!.data as { messageId: number })
        .messageId,
    ).toBe(55);
  });

  it("streams an error terminal event and closes the response", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 21,
    });
    publishElaineTurnEvent(turn, "turn", {
      turnId: turn.turnId,
      conversationId: 21,
    });

    const received = await new Promise<string>((resolve, reject) => {
      request(buildApp())
        .get(`/api/elaine/chat/turns/${turn.turnId}/stream`)
        .buffer(true)
        .end((err, res) => {
          if (err) reject(err);
          else resolve(res.text);
        });

      setImmediate(() => {
        publishElaineTurnEvent(turn, "error", { message: "model timed out" });
        completeElaineTurn(turn);
      });
    });

    const events = parseSse(received);
    expect(events.at(-1)?.event).toBe("error");
    expect((events.at(-1)!.data as { message: string }).message).toMatch(
      /timed out/,
    );
  });

  it("attaches exactly one listener — live events are not duplicated", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 22,
    });
    publishElaineTurnEvent(turn, "turn", {
      turnId: turn.turnId,
      conversationId: 22,
    });

    const received = await new Promise<string>((resolve, reject) => {
      request(buildApp())
        .get(`/api/elaine/chat/turns/${turn.turnId}/stream`)
        .buffer(true)
        .end((err, res) => {
          if (err) reject(err);
          else resolve(res.text);
        });

      setImmediate(() => {
        publishElaineTurnEvent(turn, "delta", { text: "A" });
        publishElaineTurnEvent(turn, "delta", { text: "B" });
        publishElaineTurnEvent(turn, "done", { content: "AB" });
        completeElaineTurn(turn);
      });
    });

    const events = parseSse(received);
    // Exactly 2 delta events (not 4) — single listener, no duplication.
    expect(events.filter((e) => e.event === "delta")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// GET /api/elaine/chat/turns/:turnId/stream — real client disconnect
//
// Verifies the `res.on("close")` listener cleanup path using a genuine TCP
// socket teardown.  Supertest cannot simulate an abrupt disconnect, so we
// use Node's `http` module to open a real connection and then destroy the
// socket before the turn completes.  The route's `res.on("close")` handler
// must remove the listener from the registry so it does not accumulate
// indefinitely across turns.
// ---------------------------------------------------------------------------

describe("GET /api/elaine/chat/turns/:turnId/stream — real client disconnect cleanup", () => {
  it("detaches the live listener when the client disconnects before done", async () => {
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 30,
    });
    // Pre-buffer one event so the route has something to write, which causes
    // the response to flush and signals that the listener is now attached.
    publishElaineTurnEvent(turn, "turn", {
      turnId: turn.turnId,
      conversationId: 30,
    });

    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(buildApp());

      server.listen(0, () => {
        const { port } = server.address() as { port: number };

        const req = http.get(
          `http://localhost:${port}/api/elaine/chat/turns/${turn.turnId}/stream`,
        );

        req.on("response", (res) => {
          // Wait for the first data chunk — this confirms the route has replayed
          // the buffered event and attached its live listener.
          res.once("data", () => {
            // At this point the listener is attached.
            expect(turn.listeners.size).toBe(1);

            // Destroy the socket to simulate the client navigating away or
            // closing the tab.  The server's res.on("close") handler should
            // fire and call detachElaineTurnListener.
            req.destroy();

            // Allow the close event to propagate through the socket layer.
            setTimeout(() => {
              expect(turn.listeners.size).toBe(0);
              server.close(() => resolve());
            }, 50);
          });

          res.on("error", () => {}); // ignore read errors from destroyed socket
        });

        req.on("error", () => {}); // ignore ECONNRESET from req.destroy()
      });

      server.on("error", reject);
    });
  });
});

// ---------------------------------------------------------------------------
// Combined: handoff + stream — the full maximize-while-streaming scenario
// ---------------------------------------------------------------------------

describe("handoff + stream together — full maximize-while-streaming flow", () => {
  it("POST /handoff then GET /stream delivers all events without restarting generation", async () => {
    // 1. A turn is registered (as if by the /chat handler) and some events
    //    are emitted before the user clicks maximize.
    const turn = registerElaineTurn({
      userId: TEST_USER_ID,
      conversationId: 40,
    });
    publishElaineTurnEvent(turn, "turn", {
      turnId: turn.turnId,
      conversationId: 40,
    });
    publishElaineTurnEvent(turn, "status", { message: "Thinking…" });

    // 2. Widget calls POST /handoff before navigating away.
    const handoffRes = await request(buildApp()).post(
      `/api/elaine/chat/turns/${turn.turnId}/handoff`,
    );
    expect(handoffRes.status).toBe(200);
    expect(turn.handoff).toBe(true);

    // 3. Widget socket closes — verify the /chat close-handler decision.
    //    With handoff=true, the handler should NOT abort generation.
    expect(!turn.handoff).toBe(false);

    // 4. Full Elaine app calls GET /stream — receives all events.
    const received = await new Promise<string>((resolve, reject) => {
      request(buildApp())
        .get(`/api/elaine/chat/turns/${turn.turnId}/stream`)
        .buffer(true)
        .end((err, res) => {
          if (err) reject(err);
          else resolve(res.text);
        });

      setImmediate(() => {
        // Generation finishes while the full app is listening.
        publishElaineTurnEvent(turn, "delta", { text: "Here is my answer." });
        publishElaineTurnEvent(turn, "done", {
          content: "Here is my answer.",
          conversationId: 40,
          messageId: 77,
        });
        completeElaineTurn(turn);
      });
    });

    const events = parseSse(received);
    expect(events.map((e) => e.event)).toEqual([
      "turn",
      "status",
      "delta",
      "done",
    ]);
    expect(
      (events.find((e) => e.event === "done")!.data as { messageId: number })
        .messageId,
    ).toBe(77);
  });
});
