/**
 * End-to-end test: reminder-doubt detector forces list_reminders.
 *
 * Verifies that when a user sends "I set a reminder but I don't see it"
 * (or any phrase matching REMINDER_DOUBT_RE), the server:
 *   1. Detects the doubt via isReminderDoubtMessage (mocked to return true)
 *      and enqueues LIST_REMINDERS_TOOL_NAME in nextForcedToolQueue.
 *   2. Forces list_reminders as the first-round tool_choice so the model
 *      cannot skip it and guess from memory.
 *   3. Executes executeListRemindersTool (hard-tool path) and records an
 *      observation in the turn runtime.
 *   4. Proceeds to a second model round that produces the final text reply.
 *
 * Companion to classifier.test.ts (unit-level regex + backstop) — this file
 * closes the loop by driving the full POST /api/elaine/chat route via
 * supertest with all AI/DB/Sentry dependencies mocked.
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
import { buildRuntimeMock } from "./test-helpers/runtime-mock";
import {
  elaineLessonsMockFactory,
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";

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
  mockExecuteListRemindersTool,
  mockIsReminderDoubtMessage,
  mockIsSchedulingDoubtMessage,
  mockMapWithConcurrency,
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
    usage: { modelRounds: 0, toolCalls: 1, replans: 0, elapsedMs: 0 },
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
    mockExecuteListRemindersTool: vi
      .fn()
      .mockResolvedValue("No active reminders found."),
    // Return true for doubt messages so nextForcedToolQueue is populated.
    mockIsReminderDoubtMessage: vi.fn().mockReturnValue(true),
    mockIsSchedulingDoubtMessage: vi.fn().mockReturnValue(false),
    // Hoisted so beforeEach can re-set the implementation after clearAllMocks()
    // — factory-created vi.fn() implementations can be reset by clearAllMocks()
    // in vitest v3; hoisting ensures we always have a stable reference to reset.
    mockMapWithConcurrency: vi.fn(),
  };
});

// ── vi.mock() declarations ────────────────────────────────────────────────────

vi.mock("@sentry/node", () => sentryMockFactory());

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    oauthTokenEncryptionKey: "mock-oauth-encryption-key-placeholder!!",
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
  sendReminderAlertEmail: vi.fn().mockResolvedValue(undefined),
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

// reminder-actions: expose executeListRemindersTool as a hoisted spy so we
// can assert it was called with the right userId.
vi.mock("./reminder-actions", () => ({
  reminderActionSchemas: [],
  reminderActionExecutors: {},
  buildReminderActionLabel: vi.fn().mockResolvedValue(""),
  LIST_REMINDERS_TOOL_NAME: "list_reminders",
  executeListRemindersTool: mockExecuteListRemindersTool,
  reminderReadTools: [],
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

// Uses the shared scaffold to keep the elaine-lessons mock in sync with siblings.
// Wrapped in a lambda so Vitest's hoist pass doesn't reference the import
// binding before the module is initialized.
vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());

// Prevent the real diagnoseRecurringFailureInBackground from making live DB
// calls or model requests in the fire-and-forget path added by task #921.
vi.mock("../lib/elaine-code-diagnosis", () => ({
  diagnoseRecurringFailureInBackground: vi.fn(),
  maybeDiagnoseRecurringFailure: vi.fn().mockResolvedValue(null),
  listElaineCodeSuggestions: vi.fn().mockResolvedValue([]),
  decideElaineCodeSuggestion: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/elaine-tasks", () => ({
  cancelElaineTaskForUser: vi.fn().mockResolvedValue(false),
  getElaineTaskForUser: vi.fn().mockResolvedValue(null),
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
}));

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn().mockResolvedValue({}),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

// ── ./runtime mock ────────────────────────────────────────────────────────────
// Mirrors chat-dropped-action.test.ts but with two key differences:
//   • MODEL_VISIBLE_HARD_TOOL_NAMES includes "list_reminders" so the tool
//     call goes through the hard-tool execution path (lines ~4956-4968 in
//     index.ts) and executeListRemindersTool is invoked.
//   • isReminderDoubtMessage returns true (mocked) so nextForcedToolQueue
//     is populated and the first-round tool_choice is forced.
//   • isSchedulingDoubtMessage returns false so the scheduling queue is not
//     also populated.

vi.mock("./runtime", () =>
  buildRuntimeMock({
    generateElainePlan: vi.fn().mockResolvedValue(null),
    isReminderDoubtMessage: mockIsReminderDoubtMessage,
    isSchedulingDoubtMessage: mockIsSchedulingDoubtMessage,
    mapWithConcurrency: mockMapWithConcurrency,
    // KEY: list_reminders must be in this set so the tool call is routed
    // through hardToolCalls rather than skipped at the ACTION_TOOL_NAMES guard.
    MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>(["list_reminders"]),
    MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: {
      list_reminders: "checking your reminders",
    },
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
  buildPlannerToolCatalogMock({
    // list_reminders appears in SOFT_TOOLS so allAssistantTools is non-empty
    // and the module mock fully satisfies every import in index.ts.
    // list_reminders is a hard read tool, not an action tool, so
    // ACTION_TOOL_NAMES stays empty.
    SOFT_TOOLS: [
      {
        type: "function",
        function: {
          name: "list_reminders",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
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
  buildStorageAdapter: vi.fn(() => ({
    uploadImage: vi.fn(),
    downloadImageBuffer: vi.fn(),
    deleteImage: vi.fn(),
    invalidateImageCache: vi.fn(),
  })),
  IMAGE_ONLY_POLICY: {},
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

/**
 * Chainable Drizzle-style select builder that consumes one slot from the
 * front of selectQueue at construction time, matching the pattern used
 * in chat-dropped-action.test.ts.
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

const dbMock = {
  select: vi.fn(() => makeQueuedSelectBuilder(selectQueue)),
  insert: vi.fn(() =>
    makeInsertBuilder([
      { id: 1, role: "user" },
      { id: 2, role: "assistant" },
    ]),
  ),
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
    ).session = { userId: TEST_USER_ID };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

/**
 * Round 0: yields a single tool-call delta for `list_reminders`.
 * Round 1: yields a plain text content delta (the final answer).
 */
let modelRound = 0;
const capturedToolChoices: unknown[] = [];

async function* makeListRemindersForcedStream(): AsyncGenerator<{
  choices: { delta: unknown }[];
}> {
  yield {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "tc-forced-list-reminders",
              function: { name: "list_reminders", arguments: "{}" },
            },
          ],
        },
      },
    ],
  };
}

async function* makeTextStream(content: string): AsyncGenerator<{
  choices: { delta: unknown }[];
}> {
  yield { choices: [{ delta: { content } }] };
}

/**
 * Primes the select queue for a widget-default conversation that already
 * exists (slot 2 returns a row, so no conversation insert is needed).
 *
 * Slots consumed in order by the chat handler:
 *   1. appUsers lookup            → one user row
 *   2. elaineHistoryConversations widget-default (.limit(1)) → [{ id: 1 }]
 *   3. Promise.all[0]: conv row   → [{ summary:null, ... }]
 *   4. Promise.all[1]: history    → [] (first turn, no prior messages)
 *   5. elaineSettings lookup      → [] (defaults apply)
 */
function primeDb() {
  selectQueue.length = 0;
  selectQueue.push([{ displayName: "Tester", email: "tester@test.com" }]); // 1
  selectQueue.push([{ id: 1 }]); // 2 — widget-default conv found
  selectQueue.push([
    {
      // 3 — conv row
      summary: null,
      summarizedUpToId: null,
      openaiLastResponseId: null,
      openaiStateModel: null,
      openaiStateUpdatedAt: null,
    },
  ]);
  selectQueue.push([]); // 4 — no history messages
  selectQueue.push([]); // 5 — no elaineSettings row (defaults apply)
}

/**
 * Asserts that every selectQueue slot added by primeDb was consumed during
 * the test.  A leftover slot means the handler issued fewer db.select() calls
 * than the queue was primed for — the primeDb helper is out of date.  A slot
 * deficit (ECONNRESET / wrong-data during the test) means the handler gained
 * a new db.select() call that was not added to primeDb.
 *
 * Call this in afterEach so drift is surfaced with a clear failure message
 * rather than a cryptic ECONNRESET or mismatched data in a later test.
 */
function assertSelectQueueDrained() {
  expect(
    selectQueue.length,
    `selectQueue has ${selectQueue.length} unconsumed slot(s) after the test — ` +
      `update primeDb to match the current db.select() call order in the ` +
      `chat handler (index.ts)`,
  ).toBe(0);
}

/**
 * Parses SSE text into typed events so we can inspect the "done" payload.
 */
function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event =
        lines
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim() ?? "message";
      const dataLine =
        lines
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
          .trim() ?? "{}";
      try {
        return { event, data: JSON.parse(dataLine) as unknown };
      } catch {
        return { event, data: dataLine };
      }
    });
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  modelRound = 0;
  capturedToolChoices.length = 0;

  // Restore mocks cleared by clearAllMocks()
  mockRecordModelRound.mockReturnValue(true);
  mockIsReminderDoubtMessage.mockReturnValue(true);
  mockIsSchedulingDoubtMessage.mockReturnValue(false);
  mockExecuteListRemindersTool.mockResolvedValue("No active reminders found.");

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
    usage: { modelRounds: 0, toolCalls: 1, replans: 0, elapsedMs: 0 },
  };
  mockSnapshot.mockReturnValue(MOCK_TRACE);
  mockComplete.mockReturnValue({ ...MOCK_TRACE, status: "completed" as const });
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

  // registerToolCalls returns one schedule per tool call, with allowed:true.
  // Must use `id: call.id` (not `callId`) so schedule.id is populated and
  // runtimeCallId is set correctly in hardToolCalls (line 5259 in index.ts).
  mockRegisterToolCalls.mockImplementation(
    (calls: Array<{ id: string; name: string }>) =>
      calls.map((call) => ({
        id: call.id,
        name: call.name,
        allowed: true,
        consequential: false,
        confirmationRequired: false,
      })),
  );

  // callModelWithSubagent: round 0 emits list_reminders ONLY when tool_choice
  // forces it (conditional mock matching chat-reminder-doubt.test.ts pattern).
  // Round 1+ returns an empty stream so the loop exits after one tool round.
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
      const round = modelRound++;
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockImplementation(
              (params: {
                tool_choice?: {
                  type?: string;
                  function?: { name?: string };
                };
              }) => {
                capturedToolChoices.push(params.tool_choice);
                const isForced =
                  round === 0 &&
                  params.tool_choice?.type === "function" &&
                  params.tool_choice?.function?.name === "list_reminders";
                if (isForced) {
                  return makeListRemindersForcedStream();
                }
                return makeTextStream(
                  "I just checked your reminders — you have none active right now.",
                );
              },
            ),
          },
        },
      };
      await callback(mockClient, "mock-model", []);
    },
  );

  // Reset db mock state
  // Re-set mapWithConcurrency implementation after vi.clearAllMocks() so the
  // tool executor callback actually runs. Factory-created vi.fn() implementations
  // can be cleared by clearAllMocks() in vitest v3; hoisting + explicit reset
  // here is the same pattern used in chat-reminder-doubt.test.ts.
  mockMapWithConcurrency.mockImplementation(
    async <T>(
      items: T[],
      _concurrency: number,
      fn: (item: T) => Promise<unknown>,
    ) => Promise.all(items.map(fn)),
  );

  dbMock.select.mockImplementation(() => makeQueuedSelectBuilder(selectQueue));
  dbMock.insert.mockImplementation(() =>
    makeInsertBuilder([
      { id: 1, role: "user" },
      { id: 2, role: "assistant" },
    ]),
  );
  dbMock.update.mockImplementation(() => makeUpdateBuilder());

  primeDb();
});

afterEach(() => {
  assertSelectQueueDrained();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — reminder-doubt end-to-end", () => {
  it("forces list_reminders as the first-round tool_choice when the user doubts a reminder", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "I don't see my reminder" })
      .set("Content-Type", "application/json")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    // Round 0 must have used a forced tool_choice for list_reminders.
    expect(capturedToolChoices[0]).toEqual({
      type: "function",
      function: { name: "list_reminders" },
    });
  });

  it("calls executeListRemindersTool (the tool actually executes, not just gets proposed)", async () => {
    const app = buildApp();

    await request(app)
      .post("/api/elaine/chat")
      .send({ message: "I set a reminder but I don't see it" })
      .set("Content-Type", "application/json")
      .buffer(true);

    // modelRound is incremented per callModelWithSubagent call.
    // ≥2 means round 0 (tool call) + round 1 (text reply) both ran.
    expect(modelRound).toBeGreaterThanOrEqual(2);
  });

  it("returns a done SSE event so the client can read the completed turn", async () => {
    const app = buildApp();

    await request(app)
      .post("/api/elaine/chat")
      .send({ message: "I set a reminder but I don't see it" })
      .set("Content-Type", "application/json")
      .buffer(true);

    // modelRound is incremented per callModelWithSubagent call.
    // ≥2 means round 0 (tool call) + round 1 (text reply) both ran.
    expect(modelRound).toBeGreaterThanOrEqual(2);
  });

  it("returns a done SSE event so the client can read the completed turn", async () => {
    const app = buildApp();

    await request(app)
      .post("/api/elaine/chat")
      .send({ message: "I set a reminder but I don't see it" })
      .set("Content-Type", "application/json")
      .buffer(true);

    // modelRound is incremented per callModelWithSubagent call.
    // ≥2 means round 0 (tool call) + round 1 (text reply) both ran.
    expect(modelRound).toBeGreaterThanOrEqual(2);
  });

  it("returns a done SSE event so the client can read the completed turn", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "I don't see my reminder" })
      .set("Content-Type", "application/json")
      .buffer(true);

    const events = parseSseEvents(res.text as string);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();

    // The done payload must carry a non-empty content string.
    const done = doneEvent!.data as { content?: string };
    expect(done.content?.trim().length).toBeGreaterThan(0);
  });

  it("also forces list_reminders for the other doubt phrasings in REMINDER_DOUBT_RE", async () => {
    // isReminderDoubtMessage is already mocked to return true for all inputs,
    // mirroring what the real REMINDER_DOUBT_RE does for these phrases.
    // The purpose of this test is to confirm the full routing works for the
    // adjacent phrasing "I don't see my reminder" used in the classifier tests.
    primeDb();
    modelRound = 0;
    capturedToolChoices.length = 0;

    const app = buildApp();

    const res = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "I don't see my reminder" })
      .set("Content-Type", "application/json")
      .buffer(true);

    expect(res.status).toBe(200);
    expect(capturedToolChoices[0]).toEqual({
      type: "function",
      function: { name: "list_reminders" },
    });
    expect(mockExecuteListRemindersTool).toHaveBeenCalledOnce();
  });
});
