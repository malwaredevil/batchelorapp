/**
 * Regression test: start_new_chat soft tool → SSE done event contains
 * newChatRequested: true.
 *
 * Scenario A — model emits a start_new_chat tool call: the terminal SSE
 *   "done" event must have newChatRequested: true.
 *
 * Scenario B — model emits no tool call: the "done" event must NOT have
 *   newChatRequested at all (the field is omitted when false to keep the
 *   payload lean).
 *
 * Approach: drive POST /api/elaine/chat via supertest with all AI/DB/Sentry
 * dependencies mocked — identical scaffold to chat-dropped-action.test.ts.
 * callModelWithSubagent is configured to yield (or not yield) a start_new_chat
 * tool-call chunk before the model produces its text reply.
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

// ── Hoisted mock controls ─────────────────────────────────────────────────────

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
  mockGetElaineGlobalConfig,
  mockIsOpenAIResponsesConfigured,
  mockStreamOpenAIResponseRound,
  mockHardToolNames,
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

  return {
    mockRegisterToolCalls: vi.fn().mockReturnValue({ allowed: true }),
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
    mockGetElaineGlobalConfig: vi.fn(),
    mockIsOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
    mockStreamOpenAIResponseRound: vi.fn(),
    mockHardToolNames: new Set<string>(),
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
  getElaineGlobalConfig: mockGetElaineGlobalConfig,
  invalidateElaineGlobalConfigCache: vi.fn(),
}));

vi.mock("../lib/openai-responses", () => ({
  generateOpenAIResponseText: vi.fn(),
  getOpenAIResponsesMetrics: vi.fn().mockResolvedValue({}),
  isOpenAIResponsesConfigured: mockIsOpenAIResponsesConfigured,
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  messagesToResponseInput: vi.fn().mockReturnValue([]),
  OpenAIResponsesUnavailableError: class extends Error {},
  recordOpenAIResponsesFallback: vi.fn(),
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue("gpt-4o"),
  streamOpenAIResponseRound: mockStreamOpenAIResponseRound,
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
  discoverAppOperations: vi.fn().mockReturnValue("Available operations: none."),
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
    MODEL_VISIBLE_HARD_TOOL_NAMES: mockHardToolNames,
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
      getBudgetStatus = vi.fn().mockReturnValue({
        exhausted: false,
        hitLimits: [],
        usage: { modelRounds: 0, toolCalls: 0, replans: 0, elapsedMs: 0 },
        budget: {
          maxModelRounds: 4,
          maxToolCalls: 16,
          maxReplans: 2,
          maxElapsedMs: 120_000,
        },
      });
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

vi.mock("./planner-tool-catalog", () =>
  buildPlannerToolCatalogMock({ ACTION_TOOL_NAMES: new Set<string>() }),
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

// ── DB mock ───────────────────────────────────────────────────────────────────

const selectQueue: unknown[][] = [];

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

const dbMock = {
  select: vi.fn(() => makeQueuedSelectBuilder(selectQueue)),
  insert: vi.fn(),
  update: vi.fn(() => ({
    set: function (this: Record<string, unknown>) {
      return Object.assign(this, {
        where: () => Promise.resolve(undefined),
      });
    },
  })),
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
    ).session = { userId: TEST_USER_ID };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

/**
 * Yields one tool-call SSE chunk then stops, producing the same shape that
 * callModelWithSubagent's streaming callback receives from OpenAI.
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
 * Configures callModelWithSubagent to stream the given tool call then stop.
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
 * Configures callModelWithSubagent to produce an empty stream (no tool calls,
 * no text) — the route will still send a done event with default fields.
 */
function setUpEmptyStream() {
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
}

/**
 * Primes the select queue for a fresh widget-default conversation with no
 * existing history (5 slots — same layout as chat-dropped-action.test.ts).
 */
function primeDbForFreshChat() {
  selectQueue.length = 0;
  selectQueue.push([{ displayName: "Tester", email: "tester@example.com" }]); // 1 appUsers
  selectQueue.push([]); // 2 widget-default conv lookup → not found
  selectQueue.push([]); // 3 elaineHistoryConversations row → new conv
  selectQueue.push([]); // 4 elaineHistoryMessages → no history
  selectQueue.push([]); // 5 elaineSettings → default

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
 * Extracts the parsed JSON body of the terminal "done" SSE event from the
 * raw supertest response body.  Returns null if no done event is present.
 */
function parseDoneEvent(body: string): Record<string, unknown> | null {
  const match = body.match(/event: done\r?\ndata: (.+)\r?\n/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

afterEach(() => {
  expect(
    selectQueue.length,
    `selectQueue has ${selectQueue.length} unconsumed slot(s) — update primeDbForFreshChat to match`,
  ).toBe(0);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("start_new_chat tool → SSE done payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHardToolNames.clear();
    mockIsOpenAIResponsesConfigured.mockReturnValue(false);
    mockGetElaineGlobalConfig.mockResolvedValue({
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
    });
    // registerToolCalls must return an array (one schedule per input call).
    // After vi.clearAllMocks() it returns undefined, making every tool call
    // silently vetoed before it reaches the name === START_NEW_CHAT_TOOL_NAME
    // branch.  Restore a pass-through that allows every call.
    mockRegisterToolCalls.mockImplementation(
      (
        candidates: Array<{ id?: string; name: string }>,
      ): Array<{ id: string; allowed: true }> =>
        candidates.map((c) => ({ id: c.id ?? "mock-call-id", allowed: true })),
    );
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
    mockStreamOpenAIResponseRound.mockReset();
    mockDetectClaimedCheckWithoutToolCall.mockReturnValue(null);
    mockRecordElaineLesson.mockResolvedValue({ id: 1, occurrenceCount: 0 });
    mockBuildSelfHealLessonInput.mockReturnValue({
      outcome: "mistake" as const,
      domain: "general" as const,
      situation: "Test situation",
      takeaway: "Test takeaway",
      tags: ["self-heal", "ungrounded-claim"],
    });
  });

  it(
    "Scenario A — emits newChatRequested:true in the done event when the model calls start_new_chat",
    async () => {
      primeDbForFreshChat();
      setUpStreamingToolCall("start_new_chat", "{}");

      const app = buildApp();
      const res = await request(app)
        .post("/api/elaine/chat")
        .send({ message: "Start a new chat please", appId: "hub" })
        .set("Content-Type", "application/json")
        .buffer(true);

      expect(res.status).toBe(200);
      const done = parseDoneEvent(res.text);
      expect(done, "no done SSE event found").not.toBeNull();
      expect(done!.newChatRequested).toBe(true);
    },
    15_000,
  );

  it(
    "Scenario B — newChatRequested is absent from the done event when start_new_chat is not called",
    async () => {
      primeDbForFreshChat();
      setUpEmptyStream();

      const app = buildApp();
      const res = await request(app)
        .post("/api/elaine/chat")
        .send({ message: "Hello", appId: "hub" })
        .set("Content-Type", "application/json")
        .buffer(true);

      expect(res.status).toBe(200);
      const done = parseDoneEvent(res.text);
      expect(done, "no done SSE event found").not.toBeNull();
      // Field must be absent (not false) — the server omits falsy values.
      expect(done!.newChatRequested).toBeUndefined();
    },
    15_000,
  );
});
