import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock references so vi.fn() refs are available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockChatCreate,
  capturedCreateParams,
  mockGetElaineGlobalConfig,
  mockIsOpenAIResponsesConfigured,
  mockPersistElaineTrace,
  mockCreateElaineTurnTrace,
  mockFinishElaineTurnTrace,
  mockGetRelevantElaineMemory,
  mockGetElaineMemorySummary,
  mockLoadCrossChannelContext,
  mockDbSelect,
  mockDbInsert,
} = vi.hoisted(() => {
  const capturedCreateParams: unknown[] = [];

  const mockChatCreate = vi.fn(async (params: unknown) => {
    capturedCreateParams.push(params);
    // Return a minimal async-iterable stream: one text delta then stop.
    return {
      [Symbol.asyncIterator]: async function* () {
        yield {
          choices: [
            {
              delta: { content: "I checked your scheduled items." },
              finish_reason: null,
            },
          ],
        };
        yield { choices: [{ delta: {}, finish_reason: "stop" }] };
      },
    };
  });

  const mockGetElaineGlobalConfig = vi.fn().mockResolvedValue({
    chatModel: "openai/gpt-4.1",
    subagentModel: "openai/gpt-4.1-mini",
    maxResponseTokens: 2000,
    requestTimeoutMs: 30_000,
    features: {
      enableBuiltinWebSearch: false,
      showReasoningSummary: false,
      enableOpenAIResponsesFallback: false,
    },
    thresholds: { openAIStateMaxAgeDays: 7 },
    timeouts: { openAIResponsesMs: 60_000 },
    // Other config fields accessed in the handler
    replanBudget: 2,
  });

  const mockIsOpenAIResponsesConfigured = vi.fn().mockReturnValue(false);
  const mockPersistElaineTrace = vi.fn().mockResolvedValue(false);
  const mockCreateElaineTurnTrace = vi.fn().mockResolvedValue({ id: 1 });
  const mockFinishElaineTurnTrace = vi.fn().mockResolvedValue(undefined);
  const mockGetRelevantElaineMemory = vi
    .fn()
    .mockResolvedValue({ evidenceBlock: null });
  const mockGetElaineMemorySummary = vi.fn().mockResolvedValue(null);
  const mockLoadCrossChannelContext = vi.fn().mockResolvedValue(null);

  // Per-table DB select results (keyed by the table symbol identity string
  // exported from the mock below).
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn().mockResolvedValue([{ id: 1 }]);

  return {
    capturedCreateParams,
    mockChatCreate,
    mockGetElaineGlobalConfig,
    mockIsOpenAIResponsesConfigured,
    mockPersistElaineTrace,
    mockCreateElaineTurnTrace,
    mockFinishElaineTurnTrace,
    mockGetRelevantElaineMemory,
    mockGetElaineMemorySummary,
    mockLoadCrossChannelContext,
    mockDbSelect,
    mockDbInsert,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// ── @workspace/db ──────────────────────────────────────────────────────────
// Keep the real table objects (needed by getTableColumns at module-load time
// in pottery.ts / quilting.ts etc.) but replace `db` and `pool` with stubs.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();

  // Build a fluent chain that resolves to `rows`.
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    const promise = Promise.resolve(rows);
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.groupBy = () => chain;
    chain.leftJoin = () => chain;
    chain.innerJoin = () => chain;
    // Thenable: `await chain` resolves to rows.
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => promise.then(resolve, reject);
    chain.catch = () => Promise.resolve();
    return chain;
  }

  // Returns rows for the key tables the route reads before reaching the AI
  // call; empty array for everything else (safe for optional lookups).
  function selectChainForTable(table: unknown) {
    if (table === actual.appUsers) {
      return makeChain([
        { displayName: "Test User", email: "test@example.com" },
      ]);
    }
    if (table === actual.elaineHistoryConversations) {
      return makeChain([
        {
          id: 1,
          summary: null,
          summarizedUpToId: null,
          openaiLastResponseId: null,
          openaiStateModel: null,
          openaiStateUpdatedAt: null,
        },
      ]);
    }
    return makeChain([]);
  }

  return {
    ...actual,
    db: {
      select: () => ({
        from: (table: unknown) => selectChainForTable(table),
      }),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 1 }]),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(resolve([{ id: 1 }])),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            catch: () => Promise.resolve(),
          }),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    },
    pool: { on: vi.fn(), query: vi.fn() },
  };
});

// ── drizzle-orm ─────────────────────────────────────────────────────────────
// Use importOriginal so utilities like getTableColumns that are called at
// module-load time (e.g. in pottery.ts) keep working.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    // The operator stubs only need to exist (they are passed into the mocked
    // db's .where() which ignores them), not produce real SQL.
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
    min: vi.fn(),
    max: vi.fn(),
    sum: vi.fn(),
    avg: vi.fn(),
    asc: vi.fn(),
    notInArray: vi.fn(),
  };
});

// ── AI client (the mock under test) ─────────────────────────────────────────
// callModelWithSubagent is called for the main chat round on the OpenRouter
// path. The inner callback receives a fake client whose
// `chat.completions.create` is captured so we can assert `tool_choice`.
vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn().mockResolvedValue(null),
  callModelWithSubagent: vi.fn(
    async (
      _model: unknown,
      _instructions: unknown,
      fn: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const fakeClient = {
        chat: {
          completions: {
            create: mockChatCreate,
          },
        },
      };
      await fn(fakeClient, "test-model", []);
    },
  ),
  HIDDEN_REASONING: {},
}));

// ── Elaine config ─────────────────────────────────────────────────────────
vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: mockGetElaineGlobalConfig,
}));

// ── App config ────────────────────────────────────────────────────────────
vi.mock("../lib/app-config", () => ({
  APP_CONFIG_DEFAULTS: [],
  getAllConfig: vi.fn().mockResolvedValue({}),
  updateConfigValue: vi.fn(),
}));

// ── OpenAI Responses API ──────────────────────────────────────────────────
// Keep the OpenRouter path active (the path that calls callModelWithSubagent).
vi.mock("../lib/openai-responses", () => ({
  isOpenAIResponsesConfigured: mockIsOpenAIResponsesConfigured,
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  isReusableElaineResponseState: vi.fn().mockReturnValue(false),
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue("gpt-4o"),
  streamOpenAIResponseRound: vi.fn(),
  createOpenAIStableIdentifier: vi.fn().mockReturnValue("stub-id"),
  generateOpenAIResponseText: vi.fn(),
  getOpenAIResponsesMetrics: vi.fn().mockReturnValue({}),
  messagesToResponseInput: vi.fn().mockReturnValue([]),
  recordOpenAIResponsesFallback: vi.fn(),
  selectElaineOpenAIRole: vi.fn().mockReturnValue("balanced"),
  OpenAIResponsesUnavailableError: class extends Error {},
}));

// ── Runtime helpers ───────────────────────────────────────────────────────
vi.mock("./runtime", async (importActual) => {
  const actual = await importActual<typeof import("./runtime")>();
  return {
    ...actual,
    // Trace persistence is best-effort; returning false means the handler
    // gracefully degrades (sets tracePersisted = false, sends runtime event).
    persistElaineTraceBestEffort: mockPersistElaineTrace,
    createElaineTurnTrace: mockCreateElaineTurnTrace,
    finishElaineTurnTrace: mockFinishElaineTurnTrace,
    // generateElainePlan is called for non-answer request classes ("show my
    // trips" → "read"). Return a real fallback plan via createFallbackPlan so
    // the ElaineTurnRuntime is initialised with a valid, non-null plan.
    generateElainePlan: vi.fn(
      async ({
        requestClass,
      }: Parameters<typeof actual.generateElainePlan>[0]) => ({
        plan: actual.createFallbackPlan(requestClass),
        source: "fallback" as const,
      }),
    ),
    loadElaineTurnTracesForMessages: vi.fn().mockResolvedValue(new Map()),
  };
});

// ── Elaine memory / cross-channel ────────────────────────────────────────
vi.mock("../lib/elaine-memory", () => ({
  getRelevantElaineMemory: mockGetRelevantElaineMemory,
  getElaineMemorySummary: mockGetElaineMemorySummary,
  rememberElaineMemory: vi.fn(),
  forgetElaineMemory: vi.fn(),
  correctElaineMemory: vi.fn(),
  saveElaineMemorySummary: vi.fn(),
}));
vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: mockLoadCrossChannelContext,
  appendCrossChannelEntry: vi.fn(),
}));

// ── Sentry ────────────────────────────────────────────────────────────────
vi.mock("@sentry/node", () => ({
  setConversationId: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ── Supabase ──────────────────────────────────────────────────────────────
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi
          .fn()
          .mockResolvedValue({ data: { signedUrl: "" }, error: null }),
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
      })),
    },
  })),
}));

// ── Storage / upload ──────────────────────────────────────────────────────
vi.mock("../lib/storage-core", () => ({
  ensureBucketWithPolicy: vi.fn().mockResolvedValue(undefined),
  ELAINE_ATTACHMENTS_BUCKET_POLICY: {},
  buildStorageAdapter: vi.fn(() => ({
    uploadImage: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    getSignedUrl: vi.fn(),
  })),
  IMAGE_ONLY_POLICY: {},
  TRAVELS_BUCKET_POLICY: {},
  ORNAMENTS_BUCKET_POLICY: {},
  QUILTING_BUCKET_POLICY: {},
}));
vi.mock("../lib/upload-limits", () => ({
  multerLimitForPrefix: vi.fn().mockReturnValue({}),
}));
vi.mock("multer", () => {
  // pottery.ts calls multer.memoryStorage() at module-load time, so the
  // default export needs memoryStorage as a static property.
  const memoryStorage = vi.fn().mockReturnValue({});
  const multerFn = Object.assign(
    vi.fn(() => ({
      fields: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
      single: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
      array: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
    })),
    { memoryStorage },
  );
  return { default: multerFn };
});

// ── pdf-parse ─────────────────────────────────────────────────────────────
vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "" }),
}));

// ── Communication / reminder actions (executors that make real DB calls) ──
vi.mock("./communication-actions", async (importActual) => {
  const actual = await importActual<typeof import("./communication-actions")>();
  return {
    ...actual,
    executeListScheduledContacts: vi
      .fn()
      .mockResolvedValue("No scheduled items found."),
  };
});
vi.mock("./reminder-actions", async (importActual) => {
  const actual = await importActual<typeof import("./reminder-actions")>();
  return {
    ...actual,
    executeListRemindersTool: vi.fn().mockResolvedValue("No reminders found."),
  };
});

// ── Other external libs that make real network calls ─────────────────────
vi.mock("../lib/email", () => ({
  sendAssistantEmail: vi.fn(),
  sendTestEmail: vi.fn(),
  resendConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/sms", () => ({
  sendSms: vi.fn(),
  SmsOptedOutError: class extends Error {},
  SmsRegistrationPendingError: class extends Error {},
}));
vi.mock("../lib/calls", () => ({
  initiateOutboundCall: vi.fn(),
  waitForCallOutcome: vi.fn().mockResolvedValue("answered"),
}));
vi.mock("../lib/slack", () => ({
  openDmChannel: vi.fn(),
  postSlackMessage: vi.fn(),
  slackConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/web-search", () => ({
  webSearch: vi.fn().mockResolvedValue({ results: [] }),
  fetchPage: vi.fn().mockResolvedValue(""),
}));
vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/travels/flights", () => ({ lookupFlightPrices: vi.fn() }));
vi.mock("../lib/travels/google-maps", () => ({
  getWeatherForecast: vi.fn(),
  getAirQuality: vi.fn(),
  getPollenForecast: vi.fn(),
  searchPlaces: vi.fn(),
  computeRoute: vi.fn(),
}));
vi.mock("../lib/travels/storage", () => ({ deleteTripPhoto: vi.fn() }));
vi.mock("../lib/travels-storage", () => ({ deleteDocument: vi.fn() }));
vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn(),
  buildEbayQuery: vi.fn(),
}));
vi.mock("../lib/ornaments/hallmark-search", () => ({
  searchHallmark: vi.fn(),
  lookupHallmarkFromDb: vi.fn(),
}));
vi.mock("../lib/ornaments/barcode", () => ({ lookupBarcode: vi.fn() }));
vi.mock("../lib/google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn(),
}));
vi.mock("../routes/travels/documents", () => ({ rescanTripDocument: vi.fn() }));
vi.mock("../routes/admin/integrations-health", () => ({
  getCachedHealthChecks: vi.fn().mockResolvedValue([]),
}));
vi.mock("../routes/travels/ai", () => ({
  generateItineraryForTrip: vi.fn(),
  ItineraryActionError: class extends Error {},
}));
vi.mock("../lib/soft-delete", () => ({ logActivity: vi.fn() }));
vi.mock("../lib/expert-consult", () => ({ consultExperts: vi.fn() }));
vi.mock("../lib/retry", () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock("../lib/ssrf-safe-fetch", () => ({ fetchJsonSafe: vi.fn() }));
vi.mock("../lib/document-parsing", () => ({
  extractDocumentText: vi.fn().mockResolvedValue(""),
  docTypeTagForMime: vi.fn().mockReturnValue("csv"),
}));
vi.mock("../lib/document-generation", () => ({
  buildDocumentBuffer: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  DOCUMENT_MIME_BY_FORMAT: {},
  DOCUMENT_EXTENSION_BY_FORMAT: {},
}));
vi.mock("../lib/elaine-tasks", () => ({
  cancelElaineTaskForUser: vi.fn(),
  getElaineTaskForUser: vi.fn(),
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
}));

// elaine-lessons must be mocked in every test file that drives
// POST /elaine/chat via supertest.  The real getRelevantElaineLessons
// issues an extra db.select() that shifts the selectQueue slots out of
// alignment, silently aborting the SSE response with ECONNRESET before
// headers are ever sent (task #851 / task #875).
vi.mock("../lib/elaine-lessons", () => ({
  ELAINE_LESSON_DOMAINS: [
    "travels",
    "pottery",
    "quilting",
    "ornaments",
    "general",
  ],
  getRelevantElaineLessons: vi
    .fn()
    .mockResolvedValue({ lessons: [], evidenceBlock: "" }),
  recordElaineLesson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("./travel-wishlist-executors", () => ({
  removeWishlistItemExecutor: vi.fn(),
}));
vi.mock("./admin-config", () => ({
  AdminConfigBody: { parse: vi.fn((v: unknown) => v) },
  applyAdminConfigPatch: vi.fn(),
  resetElaineGlobalConfigToDefaults: vi.fn(),
}));
vi.mock("./office-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./office-actions")>();
  return { ...actual, executeOfficeTool: vi.fn() };
});
vi.mock("./household-counts", () => ({
  queryHouseholdData: vi.fn().mockResolvedValue({}),
}));
vi.mock("./household-search", () => ({
  searchHouseholdData: vi.fn().mockResolvedValue([]),
}));
vi.mock("./yardage-math", () => ({ calculateYardage: vi.fn() }));

// ── Auth middleware — bypass for tests ───────────────────────────────────
vi.mock("../middleware/auth", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    // Inject a test session so the handler can read req.session.userId.
    req.session = { userId: 1 };
    next();
  },
}));

// ── Rate limiters ─────────────────────────────────────────────────────────
// Use importOriginal so any limiter referenced at module-load time (e.g.
// supplementalUploadLimiter in pottery.ts) is a passthrough, not undefined.
vi.mock("../middleware/rateLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../middleware/rateLimit")>();
  const passthrough = (_req: unknown, _res: unknown, next: () => void) =>
    next();
  return Object.fromEntries(Object.keys(actual).map((k) => [k, passthrough]));
});

// ── Logger ────────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import router under test — must come AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------

import supertest from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function mountAndPost(message: string): Promise<void> {
  // Import the router lazily inside the test helper so all vi.mock() calls
  // have already been hoisted and registered before this module is loaded.
  const { default: elaineRouter } = await import("./index");

  const app = express();
  app.use(express.json());
  // Inject req.log stub (normally added by pino-http in the real server).
  app.use(
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as unknown as Record<string, unknown>).log = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      next();
    },
  );
  app.use("/elaine", elaineRouter);

  await supertest(app)
    .post("/elaine/chat")
    .set("Content-Type", "application/json")
    .send({ message, appId: "hub" })
    .buffer(true)
    .parse((res, callback) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => callback(null, data));
    });
}

// ---------------------------------------------------------------------------
// Shared beforeEach setup
// ---------------------------------------------------------------------------

function applyDefaultMocks() {
  mockGetElaineGlobalConfig.mockResolvedValue({
    chatModel: "openai/gpt-4.1",
    subagentModel: "openai/gpt-4.1-mini",
    maxResponseTokens: 2000,
    requestTimeoutMs: 30_000,
    features: {
      enableBuiltinWebSearch: false,
      showReasoningSummary: false,
      enableOpenAIResponsesFallback: false,
    },
    thresholds: { openAIStateMaxAgeDays: 7 },
    timeouts: { openAIResponsesMs: 60_000 },
  });
  mockIsOpenAIResponsesConfigured.mockReturnValue(false);
  mockPersistElaineTrace.mockResolvedValue(false);
  mockCreateElaineTurnTrace.mockResolvedValue({ id: 1 });
  mockGetRelevantElaineMemory.mockResolvedValue({ evidenceBlock: null });
  mockGetElaineMemorySummary.mockResolvedValue(null);
  mockLoadCrossChannelContext.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduling-doubt → forced tool_choice on round 0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyDefaultMocks();
  });

  it("forces list_scheduled_contacts tool_choice when the user expresses scheduling doubt", async () => {
    // Use a per-test local array to avoid cross-test contamination from
    // background async work in previous tests.
    const localParams: unknown[] = [];
    mockChatCreate.mockImplementation(async (params: unknown) => {
      localParams.push(params);
      return {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{ delta: { content: "Checked." }, finish_reason: null }],
          };
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        },
      };
    });

    await mountAndPost("I don't see a card");

    // At least one model call must have happened.
    expect(localParams.length).toBeGreaterThan(0);
    // The FIRST outgoing model call (round 0) must force list_scheduled_contacts
    // because isSchedulingDoubtMessage("I don't see a card") === true.
    const firstCallParams = localParams[0] as Record<string, unknown>;
    expect(firstCallParams).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "list_scheduled_contacts" },
      },
    });
  }, 20_000);

  it("does NOT force list_scheduled_contacts for an ordinary non-doubt message", async () => {
    const localParams: unknown[] = [];
    mockChatCreate.mockImplementation(async (params: unknown) => {
      localParams.push(params);
      return {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [
              {
                delta: { content: "Here are your trips." },
                finish_reason: null,
              },
            ],
          };
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        },
      };
    });

    await mountAndPost("show my trips");

    // The model must have been called at least once.
    expect(localParams.length).toBeGreaterThan(0);

    // The scheduling-doubt guard specifically forces list_scheduled_contacts.
    // An ordinary message must never trigger that forcing — though the route
    // may legitimately force OTHER tools (e.g. via the replan mechanism for
    // read-class messages), only list_scheduled_contacts is gated on the
    // scheduling-doubt detector and must never appear here.
    const anyCallForcedScheduledContacts = localParams.some((params) => {
      const p = params as Record<string, unknown>;
      const tc = p.tool_choice as
        | { type?: string; function?: { name?: string } }
        | undefined;
      return (
        tc?.type === "function" &&
        tc?.function?.name === "list_scheduled_contacts"
      );
    });
    expect(anyCallForcedScheduledContacts).toBe(false);
  }, 20_000);
});
