/**
 * Route-level tests for Elaine's conversation pagination endpoints.
 *
 * Coverage:
 *   GET /conversation — first-page shape, hasMore false/true, no-conversation path
 *   GET /conversations/:id/messages — invalid-id 400, ownership 404, first-page
 *     shape, hasMore boundary, before-cursor preceding-page
 *
 * Uses supertest + vitest.  All DB and heavy-dependency modules are mocked so
 * no live database is required.  The DB mock's makeQueuedSelectBuilder handles
 * every query chain the pagination helpers use:
 *   • .from().where()                   → thenable resolve
 *   • .from().where().limit()           → resolves
 *   • .from().where().orderBy()         → resolves
 *   • .from().where().orderBy().limit() → resolves
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";
import { buildRuntimeMock } from "./test-helpers/runtime-mock";
import {
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fully chainable Drizzle-style select builder.  Every method returns the
 * builder itself so any chain of .from()/.where()/.orderBy()/.limit() works.
 * Terminal resolution happens via:
 *   - .limit(n)   — returns the pending promise directly
 *   - .then(...)  — thenable: `await builder` / `await builder.where(cond)`
 * Both paths resolve to the same pre-shifted queue slot.
 */
function makeQueuedSelectBuilder(queue: unknown[][]) {
  const result = queue.shift() ?? [];
  const p = Promise.resolve(result);

  const builder: Record<string, (...args: unknown[]) => unknown> & {
    then: <T, U = never>(
      f?: ((v: unknown[]) => T | PromiseLike<T>) | null,
      r?: ((e: unknown) => U | PromiseLike<U>) | null,
    ) => Promise<T | U>;
  } = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    groupBy: () => builder,
    limit: () => p,
    then: <T, U = never>(
      f?: ((v: unknown[]) => T | PromiseLike<T>) | null,
      r?: ((e: unknown) => U | PromiseLike<U>) | null,
    ) => p.then(f, r) as Promise<T | U>,
  };
  return builder;
}

function makeInsertReturningBuilder(returnVal: unknown[]) {
  return {
    values: () => ({
      returning: () => Promise.resolve(returnVal),
      onConflictDoNothing: () => Promise.resolve([]),
    }),
  };
}

function makeUpdateBuilder() {
  const b: Record<string, () => unknown> = {
    set: () => b,
    where: () => Promise.resolve(undefined),
  };
  return b;
}

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any vi.mock() factories that
// reference them.
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];

const dbMock = {
  select: vi.fn(() => makeQueuedSelectBuilder(selectQueue)),
  insert: vi.fn(() => makeInsertReturningBuilder([])),
  update: vi.fn(() => makeUpdateBuilder()),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
  delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
};
const poolQuery = vi.fn();

// ---------------------------------------------------------------------------
// vi.mock() declarations — all hoisted to the top of the module by vitest.
// Heavy modules that are not exercised by the pagination routes are stubbed
// with minimal empty factories so the 8 000-line index.ts can be imported.
// ---------------------------------------------------------------------------

vi.mock("@sentry/node", () => sentryMockFactory());

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

vi.mock("../lib/env", () => ({
  env: {
    isProduction: false,
    sessionSecret: "test-secret",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-service-key",
    openrouterApiKey: "mock-openrouter",
    resendApiKey: undefined,
    agentphoneWebhookSecret: "mock",
    slackSigningSecret: "mock",
    vapidPrivateKey: undefined,
    vapidPublicKey: undefined,
    devScreenshotToken: undefined,
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: dbMock,
    pool: { connect: vi.fn(), query: poolQuery },
  };
});

vi.mock("../middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth")>();
  return {
    ...actual,
    requireAuth: (req: Request, res: Response, next: NextFunction): void => {
      if (
        !(req as Request & { session?: { userId?: number } }).session?.userId
      ) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      next();
    },
  };
});

vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn(),
  callModelWithSubagent: vi.fn(),
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue([]),
  generateImage: vi.fn(),
}));

vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn().mockResolvedValue({ enabled: true }),
  invalidateElaineGlobalConfigCache: vi.fn(),
}));

vi.mock("../lib/openai-responses", () => ({
  generateOpenAIResponseText: vi.fn(),
  getOpenAIResponsesMetrics: vi.fn(),
  isOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  OpenAIResponsesUnavailableError: class extends Error {},
  recordOpenAIResponsesFallback: vi.fn(),
  resolveOpenAIResponsesModel: vi.fn(),
  streamOpenAIResponseRound: vi.fn(),
  createOpenAIStableIdentifier: vi.fn(),
  isReusableElaineResponseState: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/app-config", () => ({
  APP_CONFIG_DEFAULTS: {},
  getAllConfig: vi.fn().mockResolvedValue({}),
  updateConfigValue: vi.fn(),
}));

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/travels/storage", () => ({
  deleteTripPhoto: vi.fn(),
}));

vi.mock("../lib/soft-delete", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../lib/travels-storage", () => ({
  deleteDocument: vi.fn(),
}));

vi.mock("../lib/google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn(),
}));

vi.mock("../routes/travels/documents", () => ({
  rescanTripDocument: vi.fn(),
}));

vi.mock("../routes/admin/integrations-health", () => ({
  getCachedHealthChecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../routes/travels/reminders", () => ({
  getReminderSyncTarget: vi.fn(),
  syncReminderCalendarEvents: vi.fn(),
  deleteAllReminderCalendarEvents: vi.fn(),
}));

vi.mock("../routes/travels/ai", () => ({
  generateItineraryForTrip: vi.fn(),
  ItineraryActionError: class extends Error {},
}));

vi.mock("../lib/email", () => ({
  sendAssistantEmail: vi.fn(),
  sendTestEmail: vi.fn(),
  resendConfigured: vi.fn().mockReturnValue(false),
  sendElaineEmailReply: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("../lib/sms", () => ({
  sendSms: vi.fn(),
  smsConfigured: vi.fn().mockReturnValue(false),
  SmsRegistrationPendingError: class extends Error {},
  SmsOptedOutError: class extends Error {},
}));

vi.mock("../lib/web-search", () => ({
  webSearch: vi.fn().mockResolvedValue([]),
  fetchPage: vi.fn(),
}));

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn(),
  buildEbayQuery: vi.fn(),
}));

vi.mock("../lib/ornaments/hallmark-search", () => ({
  searchHallmark: vi.fn(),
}));

vi.mock("../lib/ornaments/barcode", () => ({
  lookupBarcode: vi.fn(),
}));

vi.mock("../lib/travels/flights", () => ({
  lookupFlightPrices: vi.fn(),
}));

vi.mock("./travel-wishlist-executors", () => ({
  removeWishlistItemExecutor: vi.fn(),
}));

vi.mock("../lib/ssrf-safe-fetch", () => ({
  fetchJsonSafe: vi.fn(),
}));

vi.mock("../lib/expert-consult", () => ({
  consultExperts: vi.fn(),
}));

vi.mock("../lib/travels/google-maps", () => ({
  getWeatherForecast: vi.fn(),
  getAirQuality: vi.fn(),
  getPollenForecast: vi.fn(),
  searchPlaces: vi.fn(),
  computeRoute: vi.fn(),
}));

vi.mock("./pottery-actions", () => ({
  potteryActionSchemas: [],
  potteryActionExecutors: {},
  buildPotteryActionLabel: vi.fn(),
}));

vi.mock("./quilting-actions", () => ({
  quiltingActionSchemas: [],
  quiltingActionExecutors: {},
  buildQuiltingActionLabel: vi.fn(),
}));

vi.mock("./ornaments-actions", () => ({
  ornamentActionSchemas: [],
  ornamentActionExecutors: {},
  buildOrnamentActionLabel: vi.fn(),
}));

vi.mock("./universal-actions", () => ({
  universalActionSchemas: [],
  universalActionExecutors: {},
  buildUniversalActionLabel: vi.fn(),
}));

vi.mock("./app-operation-tools", () => ({
  appOperationActionSchemas: [],
  buildAppOperationActionLabel: vi.fn(),
  DISCOVER_APP_OPERATIONS_TOOL_NAME: "discover_app_operations",
  discoverAppOperations: vi.fn(),
  executeAppOperation: vi.fn(),
  executeAppOperationAction: vi.fn(),
  EXECUTE_APP_OPERATION_TOOL_NAME: "execute_app_operation",
  READ_APP_OPERATION_TOOL_NAME: "read_app_operation",
}));

vi.mock("./adaptive-actions", () => ({
  adaptiveActionSchemas: [],
  adaptiveActionExecutors: {},
  buildAdaptiveActionLabel: vi.fn(),
}));

vi.mock("./communication-actions", () => ({
  communicationActionSchemas: [],
  communicationActionExecutors: {},
  buildCommunicationActionLabel: vi.fn(),
  executeListContactChannels: vi.fn(),
  executeListScheduledContacts: vi.fn(),
  listContactChannelsTool: {},
  LIST_CONTACT_CHANNELS_TOOL_NAME: "list_contact_channels",
  LIST_SCHEDULED_CONTACTS_TOOL_NAME: "list_scheduled_contacts",
}));

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue([]),
  appendCrossChannelEntry: vi.fn(),
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
  executeUniversalReadTool: vi.fn(),
}));

vi.mock("../lib/elaine-memory", () => ({
  correctElaineMemory: vi.fn(),
  forgetElaineMemory: vi.fn(),
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  getRelevantElaineMemory: vi.fn().mockResolvedValue([]),
  rememberElaineMemory: vi.fn(),
  saveElaineMemorySummary: vi.fn(),
}));

vi.mock("../lib/elaine-tasks", () => ({
  cancelElaineTaskForUser: vi.fn(),
  getElaineTaskForUser: vi.fn(),
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
}));

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn(),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

vi.mock("./runtime", () =>
  buildRuntimeMock({
    buildElaineSourceRoute: vi.fn().mockReturnValue("web"),
    completedActionAcknowledgement: vi.fn().mockReturnValue("Done."),
    // The key mock for pagination tests: never throws, returns an empty Map
    // so mapHistoryMessageRows completes without touching real Sentry or DB.
    loadElaineTurnTracesForMessages: vi.fn().mockResolvedValue(new Map()),
    preparedActionAcknowledgement: vi.fn().mockReturnValue("Preparing…"),
    provenanceForTool: vi.fn().mockReturnValue("direct"),
    ElaineTurnRuntime: class {},
  }),
);

vi.mock("./capability-registry", () => ({
  buildElaineCapabilityRegistry: vi.fn().mockReturnValue({ capabilities: [] }),
  buildPlannerCatalogFromCapabilities: vi.fn().mockReturnValue([]),
  ELAINE_TOOL_POLICIES: {},
}));

vi.mock("./planner-tool-catalog", () => buildPlannerToolCatalogMock());

vi.mock("./household-counts", () => ({
  queryHouseholdData: vi.fn().mockResolvedValue("0 items"),
}));

vi.mock("./household-search", () => ({
  searchHouseholdData: vi.fn().mockResolvedValue([]),
}));

vi.mock("multer", () => {
  const multerFactory = (_opts?: unknown) => ({
    single: () => (_r: unknown, _s: unknown, n: () => void) => n(),
    array: () => (_r: unknown, _s: unknown, n: () => void) => n(),
    fields: () => (_r: unknown, _s: unknown, n: () => void) => n(),
  });
  multerFactory.memoryStorage = () => ({});
  return { default: multerFactory };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({
          data: { publicUrl: "https://mock.example.com/file.jpg" },
        }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: "https://signed.example.com/file.jpg" },
          error: null,
        }),
      }),
    },
  }),
}));

vi.mock("../lib/upload-limits", () => ({
  multerLimitForPrefix: vi.fn().mockReturnValue({ fileSize: 5 * 1024 * 1024 }),
}));

vi.mock("../lib/storage-core", () => ({
  buildStorageAdapter: vi.fn(() => ({
    uploadImage: vi.fn(),
    downloadImageBuffer: vi.fn(),
    deleteImage: vi.fn(),
    invalidateImageCache: vi.fn(),
  })),
  IMAGE_ONLY_POLICY: {},
  ensureBucketWithPolicy: vi.fn().mockResolvedValue(undefined),
  ELAINE_ATTACHMENTS_BUCKET_POLICY: {},
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "" }),
}));

vi.mock("../lib/retry", () => ({
  withRetry: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

// ---------------------------------------------------------------------------
// Build app (lazy — imported after all mocks are in place)
// ---------------------------------------------------------------------------

import type { IRouter } from "express";
let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

// Helper: build an Express app that injects `req.session.userId` for auth.
type FakeSession = { userId?: number };
function buildApp(session: FakeSession): Express {
  const app = express();
  app.use(express.json());
  // Inject a fake session so requireAuth passes.
  // `as unknown as` is needed because express-session's Session type has many
  // required fields that aren't relevant in tests — the mocked requireAuth only
  // reads `session.userId`, so a plain object is sufficient.
  app.use((req, _res, next) => {
    (req as unknown as { session: FakeSession }).session = session;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Shared test data helpers
// ---------------------------------------------------------------------------

/** A minimal history-conversation row returned by the DB existence check. */
const CONV_ROW = { id: 7 };

/** Build a fake elaineHistoryMessages row (as returned by the DB select). */
function makeMessageRow(id: number, role: "user" | "assistant" = "user") {
  return {
    id,
    role,
    content: `Message ${id}`,
    attachmentUrls: null,
    reasoningSummary: null,
    createdAt: new Date("2025-01-01T12:00:00Z"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Asserts that every selectQueue slot pushed by a test was consumed during the
 * request.  A leftover slot means the handler issued fewer db.select() calls
 * than the queue was primed for — the test setup is out of date.  A slot
 * deficit (wrong data / ECONNRESET mid-test) means the handler gained a new
 * db.select() call that was not added to the queue.
 *
 * Called in afterEach so drift is surfaced with a clear failure message rather
 * than a cryptic data-mismatch in a later test.
 */
function assertSelectQueueDrained() {
  expect(
    selectQueue.length,
    `selectQueue has ${selectQueue.length} unconsumed slot(s) after the test — ` +
      `update the test's selectQueue pushes to match the current db.select() ` +
      `call order in the conversation-pagination handlers (index.ts)`,
  ).toBe(0);
}

beforeEach(() => {
  selectQueue.length = 0;
  vi.clearAllMocks();
  dbMock.select.mockImplementation(() => makeQueuedSelectBuilder(selectQueue));
  dbMock.insert.mockImplementation(() =>
    makeInsertReturningBuilder([{ id: 7 }]),
  );
  dbMock.update.mockImplementation(() => makeUpdateBuilder());
});

afterEach(() => {
  assertSelectQueueDrained();
});

// ── GET /conversation ────────────────────────────────────────────────────────

describe("GET /api/elaine/conversation", () => {
  it("returns an empty first page when no widget-default conversation exists", async () => {
    // resolveWidgetDefaultConversationId: no existing conversation → insert new one
    // The .where().limit() select returns [] (no existing conv)
    selectQueue.push([]); // elaineHistoryConversations.where().limit() → not found
    // insert().values().returning() → new conv id via dbMock.insert factory (id: 7)

    // applyUnseenNudges: elaineNudges select → empty
    selectQueue.push([]); // elaineNudges.where().orderBy() → no nudges

    // fetchConversationMessagePage: elaineHistoryMessages.where().orderBy().limit() → 0 rows
    selectQueue.push([]); // messages page → empty

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversation");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conversationId: 7,
      hasMore: false,
      messages: [],
    });
  });

  it("returns the first page of messages with hasMore: false when ≤ limit rows exist", async () => {
    // resolveWidgetDefaultConversationId: existing conversation found
    selectQueue.push([{ id: 7 }]); // .where().limit() → found
    // applyUnseenNudges: no unseen nudges
    selectQueue.push([]); // elaineNudges → empty

    // fetchConversationMessagePage: DB query uses ORDER BY id DESC so we push
    // rows newest-first; the route handler then reverses them to oldest-first
    // before returning.  hasMore = (rows.length > limit) = (3 > 30) = false.
    const rows = [
      makeMessageRow(3, "assistant"),
      makeMessageRow(2),
      makeMessageRow(1),
    ];
    selectQueue.push(rows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversation");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.messages).toHaveLength(3);
    // After the handler's .reverse(), oldest message is first in the response
    expect(res.body.messages[0]).toMatchObject({ id: 1, role: "user" });
    expect(res.body.messages[2]).toMatchObject({ id: 3, role: "assistant" });
    expect(res.body.conversationId).toBe(7);
  });

  it("returns hasMore: true when DB returns limit+1 rows (more exist beyond this page)", async () => {
    selectQueue.push([{ id: 7 }]); // resolveWidgetDefaultConversationId found
    selectQueue.push([]); // applyUnseenNudges no nudges

    // DB returns 31 rows newest-first (DESC order); the handler slices to 30
    // and reverses to oldest-first.  hasMore = (31 > 30) = true.
    const rows = Array.from({ length: 31 }, (_, i) => makeMessageRow(31 - i));
    selectQueue.push(rows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversation");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    // Only 30 messages in the response (the extra one was the probe)
    expect(res.body.messages).toHaveLength(30);
  });

  it("respects a ?limit= query parameter (clamped to max 100)", async () => {
    selectQueue.push([{ id: 7 }]);
    selectQueue.push([]); // nudges

    // DB returns 6 rows newest-first; hasMore = (6 > 5) = true
    const rows = Array.from({ length: 6 }, (_, i) => makeMessageRow(6 - i));
    selectQueue.push(rows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversation?limit=5");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.messages).toHaveLength(5);
  });
});

// ── GET /conversations/:id/messages ─────────────────────────────────────────

describe("GET /api/elaine/conversations/:id/messages", () => {
  it("returns 400 for a non-numeric conversation ID", async () => {
    const app = buildApp({ userId: 1 });
    const res = await request(app).get(
      "/api/elaine/conversations/abc/messages",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid conversation ID");
  });

  it("returns 400 for id = 0", async () => {
    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations/0/messages");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid conversation ID");
  });

  it("returns 404 when the conversation does not belong to the requesting user", async () => {
    // Ownership check: DB returns empty (conversation not found for this userId)
    selectQueue.push([]);

    const app = buildApp({ userId: 99 });
    const res = await request(app).get("/api/elaine/conversations/7/messages");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Conversation not found");
  });

  it("returns the first page with hasMore: false when few messages exist", async () => {
    selectQueue.push([CONV_ROW]); // ownership check passes
    // DB returns newest-first; handler reverses to oldest-first in response
    const rows = [makeMessageRow(11, "assistant"), makeMessageRow(10, "user")];
    selectQueue.push(rows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations/7/messages");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toMatchObject({
      id: 10,
      role: "user",
      content: "Message 10",
    });
    expect(res.body.messages[1]).toMatchObject({ id: 11, role: "assistant" });
  });

  it("returns hasMore: true when DB returns limit+1 rows (boundary check)", async () => {
    selectQueue.push([CONV_ROW]);

    // DB returns 31 rows newest-first; hasMore = (31 > 30) = true
    const rows = Array.from({ length: 31 }, (_, i) => makeMessageRow(130 - i));
    selectQueue.push(rows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations/7/messages");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.messages).toHaveLength(30);
    // Rows are DESC-sorted: [130,129,...,100]. The 31st (probe) row is id=100
    // and must be dropped; the 30-item response covers ids 101..130.
    expect(
      res.body.messages.find((m: { id: number }) => m.id === 100),
    ).toBeUndefined();
    expect(
      res.body.messages.find((m: { id: number }) => m.id === 130),
    ).toBeDefined();
  });

  it("returns the preceding page when a 'before' cursor is supplied", async () => {
    selectQueue.push([CONV_ROW]); // ownership

    // Simulates: oldest visible message has id=50; loading the page before it.
    // DB returns ids < 50 in newest-first (DESC) order; handler reverses to
    // oldest-first before returning.
    const olderRows = [
      makeMessageRow(49),
      makeMessageRow(48),
      makeMessageRow(47),
    ];
    selectQueue.push(olderRows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get(
      "/api/elaine/conversations/7/messages?before=50",
    );

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.messages).toHaveLength(3);
    // After the handler's .reverse(): oldest first → ids 47, 48, 49
    expect(res.body.messages[0]).toMatchObject({ id: 47 });
    expect(res.body.messages[2]).toMatchObject({ id: 49 });
  });

  it("hasMore is true for a 'before' page that has still older messages", async () => {
    selectQueue.push([CONV_ROW]);

    // With default limit=30, returning 31 rows before=50 means there are
    // even older messages → hasMore=true, response contains 30.
    const olderRows = Array.from({ length: 31 }, (_, i) =>
      makeMessageRow(49 - i),
    );
    selectQueue.push(olderRows);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get(
      "/api/elaine/conversations/7/messages?before=50",
    );

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.messages).toHaveLength(30);
  });

  it("returns 401 when the user is not authenticated", async () => {
    const app = buildApp({}); // no userId
    const res = await request(app).get("/api/elaine/conversations/7/messages");
    expect(res.status).toBe(401);
  });
});

// ── GET /conversations ────────────────────────────────────────────────────────
//
// DB query chains used by this endpoint:
//   Main list:    .from().leftJoin().where().groupBy().orderBy().limit()
//   Preview:      .from().where().orderBy()           (thenable)
//   Search title: .from().where()                     (thenable)
//   Search body:  .from().innerJoin().where()          (thenable)

/** Minimal conversation row as the DB would return from the main list query. */
function makeConvRow(id: number, title = `Conversation ${id}`) {
  return {
    id,
    title,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-02T00:00:00Z"),
    messageCount: 3,
  };
}

/** Preview message row (first user message) for a conversation. */
function makePreviewRow(conversationId: number, content = "Hello") {
  return { conversationId, content };
}

describe("GET /api/elaine/conversations", () => {
  it("returns first page of conversations with hasMore: false when ≤ limit rows exist", async () => {
    // Main list query (terminates at .limit())
    selectQueue.push([
      makeConvRow(1, "Paris trip"),
      makeConvRow(2, "Packing list"),
    ]);
    // Preview snippets query (terminates at .orderBy() thenable)
    selectQueue.push([
      makePreviewRow(1, "Help me plan Paris"),
      makePreviewRow(2, "What should I pack?"),
    ]);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.conversations).toHaveLength(2);
    expect(res.body.conversations[0]).toMatchObject({
      id: 1,
      title: "Paris trip",
      messageCount: 3,
    });
    // Preview snippet populated from the preview query
    expect(res.body.conversations[0].preview).toBe("Help me plan Paris");
    expect(res.body.conversations[1].preview).toBe("What should I pack?");
    // ISO timestamp fields present
    expect(typeof res.body.conversations[0].createdAt).toBe("string");
    expect(typeof res.body.conversations[0].updatedAt).toBe("string");
  });

  it("returns hasMore: true when DB returns limit+1 rows (boundary check)", async () => {
    // Default limit=30; push 31 rows → hasMore=true, response contains 30
    const rows = Array.from({ length: 31 }, (_, i) => makeConvRow(i + 1));
    selectQueue.push(rows);
    // Preview query — one preview per conversation in the page (30 convs)
    const previews = Array.from({ length: 30 }, (_, i) =>
      makePreviewRow(i + 1, `Message from conv ${i + 1}`),
    );
    selectQueue.push(previews);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations");

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.conversations).toHaveLength(30);
    // The 31st (probe) row must not appear
    expect(
      res.body.conversations.find((c: { id: number }) => c.id === 31),
    ).toBeUndefined();
  });

  it("returns the next page when a before= cursor is supplied", async () => {
    // Simulate: user has already seen conversations updated after 2025-02-01.
    // ?before=<ISO> filters to updatedAt < that date (applied by the mock via
    // whatever rows we push — the mock doesn't enforce the filter, but the
    // route correctly sets up the cursorCondition and passes it to the DB).
    selectQueue.push([
      makeConvRow(5, "Older trip"),
      makeConvRow(6, "Even older"),
    ]);
    selectQueue.push([]); // no previews for these

    const app = buildApp({ userId: 1 });
    const cursor = new Date("2025-02-01T00:00:00Z").toISOString();
    const res = await request(app).get(
      `/api/elaine/conversations?before=${encodeURIComponent(cursor)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.conversations).toHaveLength(2);
    expect(res.body.conversations[0]).toMatchObject({ id: 5 });
  });

  it("search returns all matching conversations (no hasMore, no cursor needed)", async () => {
    // Title matches
    selectQueue.push([{ id: 3 }, { id: 7 }]);
    // Content matches (none extra beyond title)
    selectQueue.push([]);
    // Main query (fetches matching IDs with limit=500)
    selectQueue.push([
      makeConvRow(3, "Paris planning"),
      makeConvRow(7, "Tokyo ideas"),
    ]);
    // Preview snippets
    selectQueue.push([
      makePreviewRow(3, "Let's plan Paris"),
      makePreviewRow(7, "Tokyo cherry blossoms"),
    ]);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations?q=paris");

    expect(res.status).toBe(200);
    // Search never paginates — hasMore is always false
    expect(res.body.hasMore).toBe(false);
    expect(res.body.conversations).toHaveLength(2);
    expect(res.body.conversations[0]).toMatchObject({
      id: 3,
      title: "Paris planning",
    });
  });

  it("search with no matches returns empty conversations immediately", async () => {
    // Title matches → none
    selectQueue.push([]);
    // Content matches → none
    selectQueue.push([]);
    // Route short-circuits: no main query or preview query fired

    const app = buildApp({ userId: 1 });
    const res = await request(app).get(
      "/api/elaine/conversations?q=xyznonexistent",
    );

    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it("conversation with no preview message returns preview: null", async () => {
    selectQueue.push([makeConvRow(10, "Silent chat")]);
    // Preview query returns nothing for conv 10
    selectQueue.push([]);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations");

    expect(res.status).toBe(200);
    expect(res.body.conversations[0].preview).toBeNull();
  });

  it("composite cursor (before + beforeId) avoids skipping conversations that share a timestamp", async () => {
    // Scenario: page 1 returned conversations with ids [10, 9, 8, 7] all with
    // updatedAt="2025-06-01T10:00:00Z". The client sends the composite cursor
    // before=2025-06-01T10:00:00Z&beforeId=7.
    //
    // The server must use:
    //   (updatedAt < '2025-06-01T10:00:00Z')
    //   OR (updatedAt = '2025-06-01T10:00:00Z' AND id < 7)
    //
    // so conversations 6, 5, 4 (same timestamp, lower ids) appear on page 2,
    // rather than being dropped because the simpler (updatedAt < before) alone
    // would skip them entirely.
    //
    // The mock doesn't enforce the SQL predicate — it returns whatever we push —
    // but by asserting the response shape we verify the route parses both params,
    // does NOT short-circuit or error, and returns the expected page of results.
    const sameTsRows = [makeConvRow(6, "Conv 6"), makeConvRow(5, "Conv 5")];
    selectQueue.push(sameTsRows); // main query result (correct DB would include id < 7)
    selectQueue.push([]); // no previews

    const app = buildApp({ userId: 1 });
    const cursor = encodeURIComponent("2025-06-01T10:00:00.000Z");
    const res = await request(app).get(
      `/api/elaine/conversations?before=${cursor}&beforeId=7`,
    );

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.conversations).toHaveLength(2);
    expect(res.body.conversations[0]).toMatchObject({ id: 6, title: "Conv 6" });
    expect(res.body.conversations[1]).toMatchObject({ id: 5, title: "Conv 5" });
  });

  it("falls back to timestamp-only cursor when beforeId is absent (backwards compat)", async () => {
    // Older clients that don't send beforeId still get a valid (though slightly
    // unstable) first page — the server should not error or return 400.
    selectQueue.push([makeConvRow(3, "Legacy page")]);
    selectQueue.push([]); // no previews

    const app = buildApp({ userId: 1 });
    const cursor = encodeURIComponent("2025-06-01T10:00:00.000Z");
    const res = await request(app).get(
      `/api/elaine/conversations?before=${cursor}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp({});
    const res = await request(app).get("/api/elaine/conversations");
    expect(res.status).toBe(401);
  });
});

describe("Hub aggregate counts", () => {
  it("returns every saved conversation count instead of the 30-row history page length", async () => {
    selectQueue.push([{ total: "75" }]);

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/conversations/count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 75 });
  });

  it("returns every actionable task count instead of the 50-row task page length", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ open_count: "51" }] });

    const app = buildApp({ userId: 1 });
    const res = await request(app).get("/api/elaine/tasks/count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openCount: 51 });
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "status IN ('queued', 'scheduled', 'retry_wait', 'running')",
      ),
      [1],
    );
  });
});
