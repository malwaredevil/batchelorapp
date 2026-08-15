/**
 * Route-level test confirming the Elaine chat endpoint returns a graceful
 * 200 reply — not a 500 — when the planner falls back because the model
 * produced a pure-reasoning goal (the PRIVATE_REASONING_SENTINEL case).
 *
 * The underlying model call (callModel) is stubbed to return a candidate-set
 * JSON where every candidate's goal is a hidden-reasoning block
 * (`<think>…</think>`).  The *real* generateElainePlan runs, detects the
 * sentinel via validateElainePlan, and falls back to the safe fallback plan
 * with source: "fallback".  This test confirms the chat route handles that
 * gracefully: HTTP 200, a valid done event, and a trace plan goal that is
 * never the sentinel string.
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
import { PRIVATE_REASONING_SENTINEL } from "./runtime/contracts";
import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";
import {
  elaineLessonsMockFactory,
  loggerMockFactory,
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";
import { buildRuntimeMock } from "./test-helpers/runtime-mock";

// ── Hoisted mock controls ────────────────────────────────────────────────────
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
  mockRequestNeedsStructuredPlan,
} = vi.hoisted(() => {
  const MOCK_TRACE = {
    version: 1 as const,
    traceId: "test-trace-id",
    requestClass: { type: "conversational" as const, scope: "none" as const },
    goal: "Help with this request accurately",
    plan: {
      version: 1 as const,
      goal: "Help with this request accurately",
      steps: [] as Array<{
        id: string;
        label: string;
        toolName?: string;
        dependsOn: string[];
      }>,
      assumptions: [] as string[],
      completionCriteria: [
        "Answer the request or clearly identify the exact missing input",
      ] as string[],
    },
    observations: [] as unknown[],
    events: [] as Array<{ type: string; at: string; summary: string }>,
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
    mockRequestNeedsStructuredPlan: vi.fn().mockReturnValue(false),
  };
});

// ── Pure-reasoning candidate set ─────────────────────────────────────────────
// When callModel returns this JSON, validateElainePlanCandidateSet calls
// validateElainePlan on each candidate.  Both goals sanitize to
// PRIVATE_REASONING_SENTINEL, so both fail the sentinel check, causing
// the whole candidate set to be rejected and generateElainePlan to fall back.
const REASONING_ONLY_CANDIDATES_JSON = JSON.stringify({
  candidates: [
    {
      approach: "Direct approach",
      version: 1,
      goal: "<think>internal reasoning that must not reach the trace</think>",
      assumptions: [],
      completionCriteria: ["The request is completed"],
      steps: [
        {
          id: "respond",
          label: "Answer the question",
          kind: "respond",
          toolName: null,
          dependsOn: [],
          expectedEvidence: "A grounded answer",
          required: true,
        },
      ],
    },
    {
      approach: "Research first",
      version: 1,
      goal: "<thinking>also hidden reasoning</thinking>",
      assumptions: [],
      completionCriteria: ["The request is completed"],
      steps: [
        {
          id: "lookup",
          label: "Look something up",
          kind: "lookup",
          toolName: null,
          dependsOn: [],
          expectedEvidence: "A lookup result",
          required: true,
        },
      ],
    },
  ],
  chosenIndex: 0,
  selectionReason: "Direct is faster.",
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

vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn().mockResolvedValue({}),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

// Use importOriginal so the real generateElainePlan, createFallbackPlan, and
// sanitizeRuntimeText run — these are pure functions with no DB dependencies.
// Everything that touches the DB (ElaineTurnRuntime, trace store, etc.) is
// replaced with a test double.  requestNeedsStructuredPlan is overridden to
// return true so the planner path actually fires for our test message.
vi.mock("./runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
  return buildRuntimeMock({
    // Real createFallbackPlan so the fallback plan shape is correct.
    createFallbackPlan: actual.createFallbackPlan,
    // Real generateElainePlan — this is the code under test.  callModel is
    // mocked to return REASONING_ONLY_CANDIDATES_JSON so the sentinel check
    // fires inside validateElainePlan and the function falls back.
    generateElainePlan: actual.generateElainePlan,
    // Overridden per-test to true so the planner path fires.
    requestNeedsStructuredPlan: (...args: unknown[]) =>
      mockRequestNeedsStructuredPlan(...args),
    // Real sanitizeRuntimeText so sentinel detection works correctly.
    sanitizeRuntimeText: actual.sanitizeRuntimeText,
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
  });
});

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

vi.mock("./planner-tool-catalog", () => buildPlannerToolCatalogMock());

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
 * Chainable Drizzle-style select builder that pulls results from selectQueue.
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
  insert: vi.fn(() => makeInsertBuilder([])),
  update: vi.fn(() => makeUpdateBuilder()),
  delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
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
 * Primes the select queue for a fresh widget-default conversation.
 * Same 5-slot layout as chat-dropped-action.test.ts's primeDbForFreshChat.
 */
function primeDbForFreshChat() {
  selectQueue.length = 0;
  selectQueue.push([{ displayName: "Tester", email: "tester@example.com" }]); // appUsers
  selectQueue.push([]); // widget-default conv not found
  selectQueue.push([]); // convRow null (new conv)
  selectQueue.push([]); // no history messages
  selectQueue.push([]); // no elaineSettings row

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
 * Asserts that every selectQueue slot added by primeDbForFreshChat was
 * consumed during the test.  A leftover slot means the handler issued fewer
 * db.select() calls than the queue was primed for; a deficit causes a cryptic
 * ECONNRESET or wrong-data failure in the next test.
 *
 * Call this in afterEach so drift is surfaced with a clear failure message
 * rather than a mysterious queue-misalignment error in a later test.
 */
function assertSelectQueueDrained() {
  expect(
    selectQueue.length,
    `selectQueue has ${selectQueue.length} unconsumed slot(s) after the test — ` +
      `update primeDbForFreshChat to match the current db.select() call order ` +
      `in the chat handler (index.ts)`,
  ).toBe(0);
}

/**
 * Finds the data payload of the first SSE event with the given type.
 */
function findSseEventData(body: string, eventType: string): unknown {
  const blocks = body.split(/\n\n+/).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) continue;
    if (eventLine.slice("event:".length).trim() === eventType) {
      try {
        return JSON.parse(dataLine.slice("data:".length).trim()) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

const MOCK_TRACE_BASE = {
  version: 1 as const,
  traceId: "test-trace-id",
  requestClass: { kind: "answer", complexity: "multi_step" },
  goal: "Help with this request accurately",
  plan: {
    version: 1 as const,
    goal: "Help with this request accurately",
    steps: [] as unknown[],
    assumptions: [] as string[],
    completionCriteria: [
      "Answer the request or clearly identify the exact missing input",
    ] as string[],
  },
  sourceRoute: undefined,
  observations: [] as unknown[],
  events: [] as Array<{ type: string; at: string; summary: string }>,
  verification: null,
  status: "running" as const,
  traceAvailable: true,
  startedAt: "2025-01-01T00:00:00.000Z",
  completedAt: null,
  usage: { modelRounds: 0, toolCalls: 0, replans: 0, elapsedMs: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();

  // Restore defaults cleared by clearAllMocks.
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
  mockSnapshot.mockReturnValue(MOCK_TRACE_BASE);
  mockComplete.mockReturnValue({
    ...MOCK_TRACE_BASE,
    status: "completed" as const,
  });

  // callModel is called twice by generateElainePlan (two attempts before
  // giving up): both times return the pure-reasoning candidate set so the
  // sentinel check fires and the function falls back.
  mockCallModel.mockResolvedValue(REASONING_ONLY_CANDIDATES_JSON);

  // Default: callModelWithSubagent produces no tool calls (empty stream).
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

  // requestNeedsStructuredPlan returns true so the planner path fires.
  mockRequestNeedsStructuredPlan.mockReturnValue(true);
});

afterEach(() => {
  assertSelectQueueDrained();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — planner pure-reasoning goal fallback", () => {
  it("returns HTTP 200 with a valid done event when the model returns a pure-reasoning goal", async () => {
    primeDbForFreshChat();

    // callModel returns reasoning-only JSON — real generateElainePlan detects
    // the sentinel, falls back after two attempts, and the route continues.
    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message: "Find me the best restaurants in Rome",
        appId: "travels",
      })
      .buffer(true);

    // The endpoint must not 500 — it must establish the SSE stream (200).
    expect(res.status).toBe(200);

    // The "done" event must be present — the turn completed rather than
    // hanging or crashing after the planner fallback.
    const doneData = findSseEventData(res.text, "done") as {
      runtimeTrace?: { plan?: { goal?: string } };
    } | null;
    expect(doneData).not.toBeNull();

    // The trace plan goal must never be the private-reasoning sentinel string.
    const traceGoal = doneData?.runtimeTrace?.plan?.goal;
    expect(traceGoal).not.toBe(PRIVATE_REASONING_SENTINEL);
  }, 15_000);

  it("does not emit an error SSE event when the planner falls back gracefully", async () => {
    primeDbForFreshChat();

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message: "Find me the best restaurants in Rome",
        appId: "travels",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // No "error" SSE event — a fallback is handled silently, not surfaced as
    // a user-facing error.
    expect(findSseEventData(res.text, "error")).toBeNull();

    // The turn still completes with a done event.
    expect(findSseEventData(res.text, "done")).not.toBeNull();
  }, 15_000);
});
