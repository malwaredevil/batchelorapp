/**
 * Route-level tests for the Elaine chat turn loop's dropped-action handling.
 *
 * Coverage:
 *   Scenario A — runtime veto (schedule.allowed = false): the model emits a
 *     create_trip action tool call but ElaineTurnRuntime.registerToolCalls
 *     returns allowed:false.  The corrective sentence must appear in the SSE
 *     delta stream and no "action" event must be emitted.
 *
 *   Scenario B — tryBuildAction failure (malformed JSON): the model emits a
 *     create_trip call whose arguments string is not valid JSON, so
 *     tryBuildAction returns null.  The corrective sentence must appear and no
 *     "action" event must be emitted.
 *
 *   Scenario C — happy path: the model emits a valid create_trip call that the
 *     scheduler allows.  An "action" SSE event must be emitted and the
 *     corrective sentence must NOT appear.
 *
 * Approach: drive POST /api/elaine/chat via supertest with all AI/DB/sentry
 * dependencies mocked.  callModelWithSubagent is configured to invoke its
 * streaming callback with an async-iterable chunk sequence that contains one
 * tool-call delta; ElaineTurnRuntime.registerToolCalls is configured per test
 * to allow or veto that call.
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
import express, { type Express } from "express";
import request from "supertest";
import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";
import {
  elaineLessonsMockFactory,
  loggerMockFactory,
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";
import { buildRuntimeMock } from "./test-helpers/runtime-mock";
import {
  __listElaineTurnsForTests,
  __resetElaineTurnRegistryForTests,
} from "./turn-registry";

// ── Hoisted mock controls ────────────────────────────────────────────────────
// These must be hoisted before any vi.mock() factory references them.
const {
  mockRegisterToolCalls,
  mockRecordModelRound,
  mockVerify,
  mockSnapshot,
  mockComplete,
  mockSetTraceAvailable,
  mockMarkFailedReadStepsAdjusted,
  mockRecordObservation,
  mockCallModelWithSubagent,
  mockCallModel,
  mockDetectClaimedCheckWithoutToolCall,
  mockRecordElaineLesson,
  mockBuildSelfHealLessonInput,
} = vi.hoisted(() => {
  const MOCK_TRACE = {
    version: 1 as const,
    traceId: "test-trace-id",
    requestClass: { type: "conversational" as const, scope: "none" as const },
    goal: "Answer the user",
    plan: {
      goal: "Answer the user",
      steps: [] as Array<{
        id: string;
        label: string;
        toolName?: string;
        dependsOn: string[];
      }>,
      assumptions: [] as string[],
      completionCriteria: ["User receives a helpful reply"] as string[],
    },
    observations: [] as unknown[],
    events: [] as Array<{ type: string; at: string; message: string }>,
    verification: null,
    status: "running" as const,
    traceAvailable: true,
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: null,
    usage: { modelRounds: 0, toolCalls: 0, replans: 0, elapsedMs: 0 },
  };

  return {
    mockRegisterToolCalls: vi.fn(),
    mockRecordModelRound: vi.fn().mockReturnValue(true),
    mockVerify: vi.fn().mockReturnValue({
      shouldReplan: false,
      instruction: undefined,
      verification: {
        status: "satisfied",
        satisfiedCriteria: [],
        unsatisfiedCriteria: [],
        summary: "Done",
      },
    }),
    mockSnapshot: vi.fn().mockReturnValue(MOCK_TRACE),
    mockComplete: vi.fn().mockReturnValue({
      ...MOCK_TRACE,
      status: "completed" as const,
    }),
    mockSetTraceAvailable: vi.fn(),
    mockMarkFailedReadStepsAdjusted: vi.fn(),
    mockRecordObservation: vi.fn(),
    mockCallModelWithSubagent: vi.fn(),
    mockCallModel: vi.fn().mockResolvedValue(""),
    mockDetectClaimedCheckWithoutToolCall: vi.fn().mockReturnValue(
      null as null | {
        kind:
          | "claimed_check_without_tool_call"
          | "claimed_action_outcome_without_tool_call";
        claimedPhrase: string;
      },
    ),
    mockRecordElaineLesson: vi
      .fn()
      .mockResolvedValue({ id: 1, occurrenceCount: 0 }),
    mockBuildSelfHealLessonInput: vi.fn().mockReturnValue({
      outcome: "mistake" as const,
      domain: "general" as const,
      situation: "Test situation",
      takeaway: "Test takeaway",
      tags: ["self-heal", "ungrounded-claim"],
    }),
  };
});

// ── vi.mock() declarations ────────────────────────────────────────────────────

vi.mock("@sentry/node", () => sentryMockFactory());

vi.mock("../lib/logger", () => loggerMockFactory());

vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

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

vi.mock("../lib/ai-client", () => ({
  callModel: mockCallModel,
  callModelWithSubagent: mockCallModelWithSubagent,
  HIDDEN_REASONING: {},
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue([]),
}));

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
    runtimeBudget: {
      maxModelRounds: 8,
      maxToolCalls: 24,
      maxReplans: 10,
      maxElapsedMs: 240_000,
    },
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

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/travels/storage", () => ({
  deleteTripPhoto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/soft-delete", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/travels-storage", () => ({
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("../routes/travels/documents", () => ({
  rescanTripDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/admin/integrations-health", () => ({
  getCachedHealthChecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../routes/travels/reminders", () => ({
  getReminderSyncTarget: vi.fn().mockResolvedValue(null),
  syncReminderCalendarEvents: vi.fn().mockResolvedValue(undefined),
  deleteAllReminderCalendarEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/travels/ai", () => ({
  generateItineraryForTrip: vi.fn().mockResolvedValue([]),
  ItineraryActionError: class extends Error {},
}));

vi.mock("../lib/email", () => ({
  sendAssistantEmail: vi.fn().mockResolvedValue(undefined),
  sendTestEmail: vi.fn().mockResolvedValue(undefined),
  resendConfigured: vi.fn().mockReturnValue(false),
  sendElaineEmailReply: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/sms", () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
  smsConfigured: vi.fn().mockReturnValue(false),
  SmsRegistrationPendingError: class extends Error {},
  SmsOptedOutError: class extends Error {},
}));

vi.mock("../lib/web-search", () => ({
  webSearch: vi.fn().mockResolvedValue([]),
  fetchPage: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn().mockResolvedValue(null),
  buildEbayQuery: vi.fn().mockReturnValue(""),
}));

vi.mock("../lib/ornaments/hallmark-search", () => ({
  searchHallmark: vi.fn().mockResolvedValue([]),
  lookupHallmarkFromDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/ornaments/barcode", () => ({
  lookupBarcode: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/travels/flights", () => ({
  lookupFlightPrices: vi.fn().mockResolvedValue([]),
}));

vi.mock("./travel-wishlist-executors", () => ({
  removeWishlistItemExecutor: vi
    .fn()
    .mockResolvedValue({ status: 200, body: {} }),
}));

vi.mock("../lib/ssrf-safe-fetch", () => ({
  fetchJsonSafe: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/expert-consult", () => ({
  consultExperts: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/travels/google-maps", () => ({
  getWeatherForecast: vi.fn().mockResolvedValue(null),
  getAirQuality: vi.fn().mockResolvedValue(null),
  getPollenForecast: vi.fn().mockResolvedValue(null),
  searchPlaces: vi.fn().mockResolvedValue([]),
  computeRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock("./pottery-actions", () => ({
  potteryActionSchemas: [],
  potteryActionExecutors: {},
  buildPotteryActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./quilting-actions", () => ({
  quiltingActionSchemas: [],
  quiltingActionExecutors: {},
  buildQuiltingActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./ornaments-actions", () => ({
  ornamentActionSchemas: [],
  ornamentActionExecutors: {},
  buildOrnamentActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./universal-actions", () => ({
  universalActionSchemas: [],
  universalActionExecutors: {},
  buildUniversalActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./app-operation-tools", () => ({
  appOperationActionSchemas: [],
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

vi.mock("./adaptive-actions", () => ({
  adaptiveActionSchemas: [],
  adaptiveActionExecutors: {},
  buildAdaptiveActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./communication-actions", () => ({
  communicationActionSchemas: [],
  communicationActionExecutors: {},
  buildCommunicationActionLabel: vi.fn().mockResolvedValue(""),
  executeListContactChannels: vi.fn().mockResolvedValue([]),
  executeListScheduledContacts: vi.fn().mockResolvedValue([]),
  listContactChannelsTool: {
    type: "function",
    function: { name: "list_contact_channels", parameters: {} },
  },
  LIST_CONTACT_CHANNELS_TOOL_NAME: "list_contact_channels",
  LIST_SCHEDULED_CONTACTS_TOOL_NAME: "list_scheduled_contacts",
}));

vi.mock("./reminder-actions", () => ({
  reminderActionSchemas: [],
  reminderActionExecutors: {},
  buildReminderActionLabel: vi.fn().mockResolvedValue(""),
  LIST_REMINDERS_TOOL_NAME: "list_reminders",
  executeListRemindersTool: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue([]),
  appendCrossChannelEntry: vi.fn().mockResolvedValue(undefined),
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
  executeUniversalReadTool: vi.fn().mockResolvedValue({}),
}));

vi.mock("../lib/elaine-memory", () => ({
  correctElaineMemory: vi.fn().mockResolvedValue(undefined),
  forgetElaineMemory: vi.fn().mockResolvedValue(undefined),
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  getRelevantElaineMemory: vi.fn().mockResolvedValue({ evidenceBlock: "" }),
  rememberElaineMemory: vi.fn().mockResolvedValue(undefined),
  saveElaineMemorySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-tasks", () => ({
  cancelElaineTaskForUser: vi.fn().mockResolvedValue(false),
  getElaineTaskForUser: vi.fn().mockResolvedValue(null),
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
}));

// elaine-lessons is not mocked in the original file — the real
// getRelevantElaineLessons makes a db.select() call that consumes an
// extra selectQueue slot and leaves the SSE response connection in an
// unresolvable state before headers are sent.  Mock it out so the
// queue stays aligned with primeDbForFreshChat's 5-slot layout.
vi.mock("../lib/elaine-lessons", () => ({
  ...elaineLessonsMockFactory(),
  maybeScheduleExplicitLessonDiagnosis: vi.fn(),
  recordElaineLesson: mockRecordElaineLesson,
}));

vi.mock("../lib/elaine-code-diagnosis", () => ({
  diagnoseRecurringFailureInBackground: vi.fn(),
}));

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn().mockResolvedValue({}),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

vi.mock("./runtime", () =>
  buildRuntimeMock({
    // Self-heal detector — controlled per-test via mockDetectClaimedCheckWithoutToolCall.
    detectClaimedCheckWithoutToolCall: mockDetectClaimedCheckWithoutToolCall,
    buildSelfHealLessonInput: mockBuildSelfHealLessonInput,
    ElaineTurnRuntime: class {
      registerToolCalls = mockRegisterToolCalls;
      recordModelRound = mockRecordModelRound;
      snapshot = mockSnapshot;
      verify = mockVerify;
      complete = mockComplete;
      setTraceAvailable = mockSetTraceAvailable;
      markFailedReadStepsAdjusted = mockMarkFailedReadStepsAdjusted;
      recordObservation = mockRecordObservation;
    },
  }),
);

vi.mock("./capability-registry", () => ({
  buildElaineCapabilityRegistry: vi.fn().mockReturnValue({ capabilities: [] }),
  buildPlannerCatalogFromCapabilities: vi.fn().mockReturnValue([]),
  ELAINE_TOOL_POLICIES: {},
  NARROW_READ_CHANNEL_JUSTIFICATIONS: {},
}));

vi.mock("./admin-config", () => ({
  AdminConfigBody: { parse: vi.fn() },
  applyAdminConfigPatch: vi.fn().mockResolvedValue(undefined),
  resetElaineGlobalConfigToDefaults: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./restricted-channel-config", () => ({
  RESTRICTED_EXCLUDED_ACTION_TYPES: new Set<string>(),
  RESTRICTED_SOFT_TOOL_NAMES: new Set<string>(),
}));

// ACTION_TOOL_NAMES includes both "create_trip" (Scenarios A–D) and
// "update_trip_status" (Scenario E — auto_run executor failure).
vi.mock("./planner-tool-catalog", () =>
  buildPlannerToolCatalogMock({
    ACTION_TOOL_NAMES: new Set<string>(["create_trip", "update_trip_status"]),
  }),
);

vi.mock("./household-counts", () => ({
  queryHouseholdData: vi.fn().mockResolvedValue(""),
}));

vi.mock("./household-search", () => ({
  searchHouseholdData: vi.fn().mockResolvedValue([]),
}));

vi.mock("./yardage-math", () => ({
  calculateYardage: vi.fn().mockReturnValue({
    backingYards: 4,
    backingPanels: 1,
    bindingYards: 0.5,
    bindingStrips: 4,
  }),
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
  ensureBucketWithPolicy: vi.fn().mockResolvedValue(undefined),
  ELAINE_ATTACHMENTS_BUCKET_POLICY: {
    name: "elaine-attachments",
    allowedMimeTypes: [],
  },
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "" }),
}));

vi.mock("../lib/retry", () => ({
  withRetry: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../lib/document-generation", () => ({
  buildDocumentBuffer: vi.fn().mockResolvedValue(Buffer.from("")),
  DOCUMENT_MIME_BY_FORMAT: {},
  DOCUMENT_EXTENSION_BY_FORMAT: {},
}));

vi.mock("../lib/document-parsing", () => ({
  extractDocumentText: vi.fn().mockResolvedValue(""),
  docTypeTagForMime: vi.fn().mockReturnValue(""),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────

const selectQueue: unknown[][] = [];

/**
 * A chainable Drizzle-style select builder that pulls its result from the
 * front of selectQueue.  Supports all termination styles the chat route uses:
 *   .limit(n)       — resolves immediately
 *   .orderBy(...)   — returns the builder itself (thenable via .then())
 *   .then(f, r)     — await builder / await builder.where()
 */
function makeQueuedSelectBuilder(queue: unknown[][]) {
  const result = queue.shift() ?? [];
  const p = Promise.resolve(result);

  const builder: Record<string, (...args: unknown[]) => unknown> & {
    then: <T, U = never>(
      f?: ((v: unknown) => T | PromiseLike<T>) | null,
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
      f?: ((v: unknown) => T | PromiseLike<T>) | null,
      r?: ((e: unknown) => U | PromiseLike<U>) | null,
    ) => p.then(f as (v: unknown[]) => T, r) as Promise<T | U>,
  };
  return builder;
}

function makeInsertBuilder(returnVal: unknown[]) {
  return {
    values: () => ({
      returning: () => Promise.resolve(returnVal),
      onConflictDoUpdate: (_opts: unknown) => ({
        returning: () => Promise.resolve(returnVal),
      }),
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(returnVal),
      }),
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

// Per-test insert return value (configured in each test case).
let insertReturnVal: unknown[] = [];

const dbMock = {
  select: vi.fn(() => makeQueuedSelectBuilder(selectQueue)),
  insert: vi.fn(() => makeInsertBuilder(insertReturnVal)),
  update: vi.fn(() => makeUpdateBuilder()),
  delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: dbMock,
    pool: {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      on: vi.fn(),
    },
  };
});

// ── App bootstrap ─────────────────────────────────────────────────────────────

import type { IRouter } from "express";
let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER_ID = 42;

const silentLog = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as { session: { userId: number }; log: typeof silentLog }
    ).session = {
      userId: TEST_USER_ID,
    };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

/**
 * Returns an async generator that yields one tool-call SSE chunk for the
 * given tool name and argument string, then a terminating empty delta.
 * This is the shape callModelWithSubagent's streaming callback receives.
 */
async function* makeToolCallStream(
  toolName: string,
  argsJson: string,
): AsyncGenerator<{ choices: { delta: unknown }[] }> {
  yield {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "tc-test-1",
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
      },
    ],
  };
}

/**
 * Configures callModelWithSubagent to invoke its streaming callback exactly
 * once with a mock OpenAI-style client whose stream yields the given tool call.
 */
function setUpStreamingToolCall(toolName: string, argsJson: string) {
  mockCallModelWithSubagent.mockImplementation(
    async (
      _model: string,
      _instructions: string,
      callback: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const mockClient = {
        chat: {
          completions: {
            create: vi
              .fn()
              .mockReturnValue(makeToolCallStream(toolName, argsJson)),
          },
        },
      };
      await callback(mockClient, "mock-model", []);
    },
  );
}

/**
 * Primes the select queue for a fresh widget-default conversation with no
 * existing history.  Call this before each test that drives POST /chat.
 *
 * Queue entries consumed in order:
 *   1. appUsers lookup          → one user row
 *   2. elaineHistoryConversations widget-default lookup → [] (not found)
 *      (insert is handled by the insertReturnVal mock, not the select queue)
 *   3. Promise.all[0]: elaineHistoryConversations row load → [] (null convRow)
 *   4. Promise.all[1]: elaineHistoryMessages load         → [] (no history)
 *   5. elaineSettings lookup    → [] (default one_by_one)
 */
function primeDbForFreshChat() {
  selectQueue.length = 0;
  selectQueue.push([{ displayName: "Tester", email: "tester@example.com" }]); // 1
  selectQueue.push([]); // 2 — widget-default conv not found
  selectQueue.push([]); // 3 — convRow null (new conv)
  selectQueue.push([]); // 4 — no history messages
  selectQueue.push([]); // 5 — no elaineSettings row
  // Insert mock: widget-default conv creation → [{id: 100}];
  // then elaineHistoryMessages bulk insert → [{id:1,role:"user"},{id:2,role:"assistant"}]
  // We sequence these via the insertReturnVal variable, switched per insert call.
  let insertCall = 0;
  dbMock.insert.mockImplementation(() => {
    insertCall++;
    const val =
      insertCall === 1
        ? [{ id: 100 }] // conv creation
        : [
            { id: 1, role: "user" },
            { id: 2, role: "assistant" },
          ]; // message persistence
    return makeInsertBuilder(val);
  });
}

/**
 * Parses the raw SSE body from a supertest response and returns the
 * concatenated text of all "delta" events plus a list of all event type names.
 */
function parseSseResponse(body: string): {
  allDeltaText: string;
  eventTypes: string[];
} {
  const blocks = body.split(/\n\n+/).filter(Boolean);
  const eventTypes: string[] = [];
  const deltaTexts: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) continue;

    const eventType = eventLine.slice("event:".length).trim();
    eventTypes.push(eventType);

    if (eventType === "delta") {
      try {
        const parsed = JSON.parse(dataLine.slice("data:".length).trim()) as {
          text?: string;
        };
        if (parsed.text) deltaTexts.push(parsed.text);
      } catch {
        // ignore malformed events
      }
    }
  }

  return { allDeltaText: deltaTexts.join(""), eventTypes };
}

/**
 * Returns an async generator that yields one text-content SSE chunk, then
 * stops — no tool calls.  Mirrors makeToolCallStream but for plain text output
 * so self-heal tests can inject a claim phrase into rawContent.
 */
async function* makeContentStream(
  text: string,
): AsyncGenerator<{ choices: { delta: unknown }[] }> {
  yield { choices: [{ delta: { content: text } }] };
}

/**
 * Configures callModelWithSubagent to produce a plain text content delta
 * (no tool calls) containing the given text.
 */
function setUpStreamingContent(text: string) {
  mockCallModelWithSubagent.mockImplementation(
    async (
      _model: string,
      _instructions: string,
      callback: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockReturnValue(makeContentStream(text)),
          },
        },
      };
      await callback(mockClient, "mock-model", []);
    },
  );
}

/**
 * Primes the select queue for an auto_run chat turn where the executor will
 * encounter a 404 (trip not found) — produces a non-2xx status and triggers
 * the droppedActionAttempts corrective path.
 *
 * Queue entries consumed in order:
 *   1. appUsers lookup          → one user row
 *   2. elaineHistoryConversations widget-default lookup → [] (not found)
 *   3. Promise.all[0]: elaineHistoryConversations row load → [] (new conv)
 *   4. Promise.all[1]: elaineHistoryMessages load         → [] (no history)
 *   5. elaineSettings lookup    → [{actionConfirmationMode: "auto_run"}]
 *   6. buildActionLabel → getTripLabelInfo(99) → [] (label falls back to "this trip")
 *   7. update_trip_status executor: travelsTrips select   → [] (not found → 404)
 */
function primeDbForAutoRunChat() {
  selectQueue.length = 0;
  selectQueue.push([{ displayName: "Tester", email: "tester@example.com" }]); // 1
  selectQueue.push([]); // 2
  selectQueue.push([]); // 3
  selectQueue.push([]); // 4
  selectQueue.push([{ actionConfirmationMode: "auto_run" }]); // 5
  selectQueue.push([]); // 6 — buildActionLabel getTripLabelInfo: not found
  selectQueue.push([]); // 7 — executor trip lookup: not found → 404

  let insertCall = 0;
  dbMock.insert.mockImplementation(() => {
    insertCall++;
    const val =
      insertCall === 1
        ? [{ id: 100 }]
        : [
            { id: 1, role: "user" },
            { id: 2, role: "assistant" },
          ];
    return makeInsertBuilder(val);
  });
}

/**
 * Asserts that every selectQueue slot added by primeDb* was consumed during
 * the test.  A leftover slot means the handler issued fewer db.select() calls
 * than the queue was primed for — the primeDb* helper is out of date.  A
 * slot deficit (ECONNRESET / wrong-data during the test) means the handler
 * gained a new db.select() call that was not added to primeDb*.
 *
 * Call this in afterEach so drift is surfaced with a clear failure message
 * rather than a cryptic ECONNRESET or mismatched data in a later test.
 */
function assertSelectQueueDrained() {
  expect(
    selectQueue.length,
    `selectQueue has ${selectQueue.length} unconsumed slot(s) after the test — ` +
      `update primeDbForFreshChat / primeDbForAutoRunChat to match the ` +
      `current db.select() call order in the chat handler (index.ts)`,
  ).toBe(0);
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults cleared by clearAllMocks
  mockRecordModelRound.mockReturnValue(true);
  mockVerify.mockReturnValue({
    shouldReplan: false,
    instruction: undefined,
    verification: {
      status: "satisfied",
      satisfiedCriteria: [],
      unsatisfiedCriteria: [],
      summary: "Done",
    },
  });
  const MOCK_TRACE = {
    version: 1 as const,
    traceId: "test-trace-id",
    requestClass: { type: "conversational" as const, scope: "none" as const },
    goal: "Answer the user",
    plan: {
      goal: "Answer the user",
      steps: [] as Array<{
        id: string;
        label: string;
        toolName?: string;
        dependsOn: string[];
      }>,
      assumptions: [] as string[],
      completionCriteria: ["User receives a helpful reply"],
    },
    observations: [] as unknown[],
    events: [] as Array<{ type: string; at: string; message: string }>,
    verification: null,
    status: "running" as const,
    traceAvailable: true,
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: null,
    usage: { modelRounds: 0, toolCalls: 0, replans: 0, elapsedMs: 0 },
  };
  mockSnapshot.mockReturnValue(MOCK_TRACE);
  mockComplete.mockReturnValue({ ...MOCK_TRACE, status: "completed" as const });
  mockCallModel.mockResolvedValue("");
  // Default: self-heal detector is a no-op and lesson mock returns a safe value
  mockDetectClaimedCheckWithoutToolCall.mockReturnValue(null);
  mockRecordElaineLesson.mockResolvedValue({ id: 1, occurrenceCount: 0 });
  mockBuildSelfHealLessonInput.mockReturnValue({
    outcome: "mistake" as const,
    domain: "general" as const,
    situation: "Test situation",
    takeaway: "Test takeaway",
    tags: ["self-heal", "ungrounded-claim"],
  });

  // Default: callModelWithSubagent produces no tool calls (empty round)
  mockCallModelWithSubagent.mockImplementation(
    async (
      _model: string,
      _instructions: string,
      callback: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockReturnValue((async function* () {})()),
          },
        },
      };
      await callback(mockClient, "mock-model", []);
    },
  );
});

afterEach(() => {
  assertSelectQueueDrained();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — dropped-action corrective text", () => {
  it("Scenario A: runtime veto (schedule.allowed=false) → corrective sentence in SSE delta, no action event", async () => {
    primeDbForFreshChat();
    setUpStreamingToolCall(
      "create_trip",
      JSON.stringify({ title: "Test Trip", destination: "Paris" }),
    );
    mockRegisterToolCalls.mockReturnValue([
      {
        id: "tc-test-1",
        name: "create_trip",
        allowed: false,
        stepId: null,
        reason: "Budget exhausted for this turn",
        consequential: true,
        confirmationRequired: true,
      },
    ]);
    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Create a trip to Paris", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(res.text);

    expect(allDeltaText).toContain(
      "I wasn't actually able to prepare that as a confirmable action just now",
    );
    expect(allDeltaText).toContain("nothing was scheduled or changed");
    expect(eventTypes).not.toContain("action");
  }, 15_000);

  it("Scenario B: tryBuildAction null (malformed JSON args) → corrective sentence in SSE delta, no action event", async () => {
    primeDbForFreshChat();
    setUpStreamingToolCall("create_trip", "NOT_VALID_JSON{{{");
    mockRegisterToolCalls.mockReturnValue([
      {
        id: "tc-test-1",
        name: "create_trip",
        allowed: true,
        stepId: "step-1",
        consequential: true,
        confirmationRequired: true,
      },
    ]);

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Create a trip to Paris", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(res.text);

    expect(allDeltaText).toContain(
      "I wasn't actually able to prepare that as a confirmable action just now",
    );
    expect(allDeltaText).toContain("nothing was scheduled or changed");
    expect(eventTypes).not.toContain("action");
  }, 15_000);

  it("Scenario D: two create_trip calls both vetoed → plural corrective sentence in SSE delta, no action event", async () => {
    primeDbForFreshChat();

    mockCallModelWithSubagent.mockImplementation(
      async (
        _model: string,
        _instructions: string,
        callback: (
          client: unknown,
          model: string,
          serverTools: unknown[],
        ) => Promise<void>,
      ) => {
        const mockClient = {
          chat: {
            completions: {
              create: vi.fn().mockReturnValue(
                (async function* () {
                  // First tool call (index 0)
                  yield {
                    choices: [
                      {
                        delta: {
                          tool_calls: [
                            {
                              index: 0,
                              id: "tc-multi-1",
                              function: {
                                name: "create_trip",
                                arguments: JSON.stringify({
                                  title: "Trip One",
                                  destination: "Paris",
                                }),
                              },
                            },
                          ],
                        },
                      },
                    ],
                  };
                  // Second tool call (index 1)
                  yield {
                    choices: [
                      {
                        delta: {
                          tool_calls: [
                            {
                              index: 1,
                              id: "tc-multi-2",
                              function: {
                                name: "create_trip",
                                arguments: JSON.stringify({
                                  title: "Trip Two",
                                  destination: "Tokyo",
                                }),
                              },
                            },
                          ],
                        },
                      },
                    ],
                  };
                })(),
              ),
            },
          },
        };
        await callback(mockClient, "mock-model", []);
      },
    );

    mockRegisterToolCalls.mockReturnValue([
      {
        id: "tc-multi-1",
        name: "create_trip",
        allowed: false,
        stepId: null,
        reason: "Budget exhausted",
        consequential: true,
        confirmationRequired: true,
      },
      {
        id: "tc-multi-2",
        name: "create_trip",
        allowed: false,
        stepId: null,
        reason: "Budget exhausted",
        consequential: true,
        confirmationRequired: true,
      },
    ]);

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Create two trips", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(res.text);

    expect(allDeltaText).toContain(
      "I wasn't actually able to prepare some of those as confirmable actions just now",
    );
    expect(allDeltaText).toContain("nothing was scheduled or changed for them");
    expect(eventTypes).not.toContain("action");
  }, 15_000);

  it("Scenario C: valid tool call, scheduler allows it → action SSE event emitted, NO corrective text", async () => {
    primeDbForFreshChat();
    setUpStreamingToolCall(
      "create_trip",
      JSON.stringify({ title: "Test Trip", destination: "Paris" }),
    );
    mockRegisterToolCalls.mockReturnValue([
      {
        id: "tc-test-1",
        name: "create_trip",
        allowed: true,
        stepId: "step-1",
        consequential: true,
        confirmationRequired: true,
      },
    ]);

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Create a trip to Paris", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(res.text);

    expect(eventTypes).toContain("action");
    expect(allDeltaText).not.toContain(
      "I wasn't actually able to prepare that as a confirmable action just now",
    );
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario E — auto_run executor failure
// ─────────────────────────────────────────────────────────────────────────────
// When actionConfirmationMode is "auto_run" and the executor returns a non-2xx
// status (e.g. 404 trip not found), the route must still stream a corrective
// delta noting that nothing was done — it must NOT silently pass the
// already-streamed "done" narrative through uncorrected.
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — auto_run executor failure corrective text", () => {
  it("Scenario E: auto_run action executor returns non-2xx → corrective delta streams, no action event", async () => {
    primeDbForAutoRunChat();

    setUpStreamingToolCall(
      "update_trip_status",
      JSON.stringify({ tripId: 99, status: "active" }),
    );
    mockRegisterToolCalls.mockReturnValue([
      {
        id: "tc-test-1",
        name: "update_trip_status",
        allowed: true,
        stepId: "step-1",
        consequential: true,
        confirmationRequired: false,
      },
    ]);

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Mark my trip as active", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(res.text);

    expect(allDeltaText).toContain(
      "I wasn't actually able to prepare that as a confirmable action just now",
    );
    expect(allDeltaText).toContain("nothing was scheduled or changed");
    expect(eventTypes).not.toContain("action");
  }, 15_000);
});

describe("POST /api/elaine/chat — self-heal corrective text and lesson write", () => {
  it("Scenario F: reply claims a check with no tool calls → self-heal delta streamed and lesson written with source self_heal", async () => {
    primeDbForFreshChat();

    // Model produces a plain text reply that claims to have checked something —
    // no tool calls, so there are no observations to ground the claim.
    const claimText = "I checked and your reminder looks all set!";
    setUpStreamingContent(claimText);

    // Detector must fire for this scenario: mock it to return a mismatch.
    mockDetectClaimedCheckWithoutToolCall.mockReturnValueOnce({
      kind: "claimed_check_without_tool_call" as const,
      claimedPhrase: "I checked",
    });

    // recordElaineLesson must be callable (real buildSelfHealLessonInput still
    // mocked, so lesson payload construction is stable).
    mockRecordElaineLesson.mockResolvedValue({ id: 9, occurrenceCount: 1 });

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Did you check my reminder?", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText } = parseSseResponse(res.text);

    expect(allDeltaText).toContain(
      "Actually, I need to be careful here — I haven't actually verified that yet",
    );
    expect(mockRecordElaineLesson).toHaveBeenCalledTimes(1);
    expect(mockRecordElaineLesson).toHaveBeenCalledWith(
      expect.objectContaining({ source: "self_heal" }),
    );
  }, 15_000);

  it("Scenario H: grounded claim (detector returns null) → NO self-heal delta, NO lesson written", async () => {
    primeDbForFreshChat();

    // Model produces text, but the detector finds the claim is grounded.
    setUpStreamingContent("I checked your calendar and it looks clear.");
    // Default: detectClaimedCheckWithoutToolCall returns null (no mismatch).

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Did you check my reminder?", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText } = parseSseResponse(res.text);

    expect(allDeltaText).not.toContain("Actually, I need to be careful here");
    expect(mockRecordElaineLesson).not.toHaveBeenCalled();
  }, 15_000);

  it("Scenario I: real detector fires on CLAIMED_CHECK_RE phrase with empty observations → self-heal delta and lesson written (real detector, not mocked)", async () => {
    // Bypass the module-level mock for detectClaimedCheckWithoutToolCall so
    // the actual CLAIMED_CHECK_RE / CLAIMED_ACTION_OUTCOME_RE regex logic is
    // exercised through the full route, not a stub return value.  The rest of
    // the ./runtime mock (ElaineTurnRuntime, classify, etc.) stays in place.
    const { detectClaimedCheckWithoutToolCall: realDetect } =
      await vi.importActual<typeof import("./runtime/self-heal-policy")>(
        "./runtime/self-heal-policy",
      );
    mockDetectClaimedCheckWithoutToolCall.mockImplementation(realDetect);

    primeDbForFreshChat();

    // A phrase that genuinely matches CLAIMED_CHECK_RE:
    //   /\bi(?:'ve| have)?\s+(?:just\s+|already\s+)?(?:checked|...)\b/gi
    // The default MOCK_TRACE has observations: [] so nothing grounds the claim.
    const claimText = "I checked and your reminder looks all set!";
    setUpStreamingContent(claimText);

    // recordElaineLesson must be callable (real buildSelfHealLessonInput still
    // mocked, so lesson payload construction is stable).
    mockRecordElaineLesson.mockResolvedValue({ id: 9, occurrenceCount: 1 });

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Did you check my reminder?", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const { allDeltaText } = parseSseResponse(res.text);

    // The real CLAIMED_CHECK_RE regex matches "I checked" in claimText, and
    // the empty observation list means the claim is ungrounded, so the route
    // must stream the corrective self-heal sentence.
    expect(allDeltaText).toContain(
      "Actually, I need to be careful here — I haven't actually verified that yet",
    );

    // A lesson row must be written with source "self_heal".
    expect(mockRecordElaineLesson).toHaveBeenCalledTimes(1);
    expect(mockRecordElaineLesson).toHaveBeenCalledWith(
      expect.objectContaining({ source: "self_heal" }),
    );
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Maximize handoff — turn id surfacing, handoff signal, resume stream
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — maximize handoff for a brand-new conversation", () => {
  beforeEach(() => {
    __resetElaineTurnRegistryForTests();
  });

  /** Extracts the first `turn` event payload from a raw SSE body. */
  function parseTurnEvent(
    body: string,
  ): { turnId: string; conversationId: number | null } | null {
    const match = body.match(/event: turn\ndata: (.+)\n/);
    if (!match?.[1]) return null;
    return JSON.parse(match[1]) as {
      turnId: string;
      conversationId: number | null;
    };
  }

  it("emits a `turn` event carrying the NEWLY-CREATED conversation id, and the resume stream replays the full turn", async () => {
    // Fresh chat with no existing widget-default conversation: the handler
    // creates conversation id 100 mid-request. The `turn` SSE event must
    // carry that id (not null) — it is what the widget puts in the maximize
    // URL when the user maximizes during their very first message.
    primeDbForFreshChat();
    setUpStreamingContent("Hello from a brand-new conversation!");

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "Hi Elaine!", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    const turn = parseTurnEvent(res.text);
    expect(turn).not.toBeNull();
    expect(turn!.turnId).toMatch(/[0-9a-f-]{36}/);
    expect(turn!.conversationId).toBe(100);

    // The handoff signal must be accepted for the owning user…
    const handoffRes = await request(app).post(
      `/api/elaine/chat/turns/${turn!.turnId}/handoff`,
    );
    expect(handoffRes.status).toBe(200);

    // …and the resume stream must replay everything, including the terminal
    // done event with the same conversation id, so the full app can hydrate.
    const resumeRes = await request(app)
      .get(`/api/elaine/chat/turns/${turn!.turnId}/stream`)
      .buffer(true);
    expect(resumeRes.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(resumeRes.text);
    expect(allDeltaText).toContain("Hello from a brand-new conversation!");
    expect(eventTypes).toContain("turn");
    expect(eventTypes).toContain("done");
    const doneMatch = resumeRes.text.match(/event: done\ndata: (.+)\n/);
    expect(doneMatch?.[1]).toBeDefined();
    const done = JSON.parse(doneMatch![1]!) as { conversationId: number };
    expect(done.conversationId).toBe(100);
  }, 15_000);

  it("live handoff: original client disconnects mid-generation after handoff → generation is NOT aborted, and a pre-attached resume stream receives the later deltas and terminal done", async () => {
    // This exercises the real timing, not a buffered replay:
    //   1. The model stream is gated — it emits a first delta then blocks.
    //   2. The turn id is discovered server-side (registry), mimicking a
    //      maximize that happens before the browser receives the `turn` SSE
    //      event (the widget's beginHandoff waits for the id, then signals).
    //   3. Handoff is signaled, a resume client attaches while generation is
    //      still pending, and the ORIGINAL connection is aborted — the
    //      navigation's disconnect.
    //   4. Only then is the gate released. If the disconnect had aborted the
    //      model call, the second delta and the `done` event could never
    //      reach the resume client.
    primeDbForFreshChat();

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseGate = resolve));
    mockCallModelWithSubagent.mockImplementation(
      async (
        _model: string,
        _instructions: string,
        callback: (
          client: unknown,
          model: string,
          serverTools: unknown[],
        ) => Promise<void>,
      ) => {
        const mockClient = {
          chat: {
            completions: {
              create: vi.fn().mockReturnValue(
                (async function* () {
                  yield { choices: [{ delta: { content: "First half… " } }] };
                  await gate;
                  yield { choices: [{ delta: { content: "second half." } }] };
                })(),
              ),
            },
          },
        };
        await callback(mockClient, "mock-model", []);
      },
    );

    const app = buildApp();
    // Dispatch the original streaming request (do not await — it's live).
    const original = request(app)
      .post("/api/elaine/chat")
      .send({ message: "Hi Elaine!", appId: "hub" })
      .buffer(true);
    const originalSettled = original.then(
      (r) => r,
      (e) => e, // the abort below makes this reject — that's expected
    );

    // Discover the turn server-side while generation is blocked on the gate.
    let turnId: string | null = null;
    for (let i = 0; i < 300 && turnId === null; i++) {
      const [turn] = __listElaineTurnsForTests();
      if (turn) turnId = turn.turnId;
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(turnId).not.toBeNull();

    // Signal the handoff while the turn is mid-generation…
    const handoffRes = await request(app).post(
      `/api/elaine/chat/turns/${turnId!}/handoff`,
    );
    expect(handoffRes.status).toBe(200);

    // …attach a resume client while the turn is still pending…
    const resumePromise = request(app)
      .get(`/api/elaine/chat/turns/${turnId!}/stream`)
      .buffer(true)
      .then((r) => r);

    // …and drop the ORIGINAL connection (the maximize navigation).
    original.abort();
    await new Promise((r) => setTimeout(r, 100));

    // Generation must still be alive: release the gate and the resume client
    // must receive the post-disconnect delta and the terminal done event.
    releaseGate();
    const resumeRes = await resumePromise;
    await originalSettled;

    expect(resumeRes.status).toBe(200);
    const { allDeltaText, eventTypes } = parseSseResponse(resumeRes.text);
    expect(allDeltaText).toContain("First half");
    expect(allDeltaText).toContain("second half.");
    expect(eventTypes).toContain("done");

    const [turn] = __listElaineTurnsForTests();
    expect(turn?.handoff).toBe(true);
    expect(turn?.done).toBe(true);
  }, 15_000);

  it("rejects handoff and resume for an unknown turn id with 404", async () => {
    const app = buildApp();
    const handoffRes = await request(app).post(
      "/api/elaine/chat/turns/00000000-0000-0000-0000-000000000000/handoff",
    );
    expect(handoffRes.status).toBe(404);
    const resumeRes = await request(app).get(
      "/api/elaine/chat/turns/00000000-0000-0000-0000-000000000000/stream",
    );
    expect(resumeRes.status).toBe(404);
  });
});
