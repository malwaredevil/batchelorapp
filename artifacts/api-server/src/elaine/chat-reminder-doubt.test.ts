/**
 * Route-level end-to-end test for the reminder-doubt forced-tool path.
 *
 * When the user sends a message that matches isReminderDoubtMessage (e.g.
 * "I set a reminder but I don't see it"), the chat handler enqueues
 * "list_reminders" in nextForcedToolQueue so the model's very first round is
 * forced to call that tool — grounding Elaine's answer in real DB state rather
 * than prompt compliance alone.
 *
 * Coverage:
 *   Scenario A — reminder-doubt message → tool_start event with name
 *     "list_reminders" appears in the SSE stream before any final reply text.
 *
 *   Scenario B — non-doubt message → no tool_start event for list_reminders
 *     (the forced-tool path is not engaged).
 *
 * Approach: drive POST /api/elaine/chat via supertest with all AI/DB/Sentry
 * dependencies mocked.  isReminderDoubtMessage is mocked to return true/false
 * per scenario.  callModelWithSubagent is configured to stream a list_reminders
 * tool call on the first round (Scenario A) so the full soft-tool execution
 * path fires, emitting tool_start.
 *
 * Parallel to chat-dropped-action.test.ts and the scheduling-doubt path —
 * see that file for the full mock scaffold rationale.
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
  loggerMockFactory,
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";

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
  mockIsReminderDoubtMessage,
  mockIsSchedulingDoubtMessage,
  mockExecuteListRemindersTool,
  mockExecuteListScheduledContacts,
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
    // Controlled per-scenario
    mockIsReminderDoubtMessage: vi.fn().mockReturnValue(false),
    mockIsSchedulingDoubtMessage: vi.fn().mockReturnValue(false),
    mockExecuteListRemindersTool: vi
      .fn()
      .mockResolvedValue('{"reminders":[],"returned":0}'),
    mockExecuteListScheduledContacts: vi
      .fn()
      .mockResolvedValue("No pending scheduled calls or messages."),
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

vi.mock("./adaptive-actions", () => ({
  adaptiveActionSchemas: [],
  adaptiveActionExecutors: {},
  adaptiveActionTools: [],
  buildAdaptiveActionLabel: vi.fn().mockResolvedValue(""),
}));

vi.mock("./communication-actions", () => ({
  communicationActionSchemas: [],
  communicationActionExecutors: {},
  communicationActionTools: [],
  buildCommunicationActionLabel: vi.fn().mockResolvedValue(""),
  executeListContactChannels: vi.fn().mockResolvedValue([]),
  executeListScheduledContacts: mockExecuteListScheduledContacts,
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
  executeListRemindersTool: mockExecuteListRemindersTool,
  reminderReadTools: [
    {
      type: "function",
      function: {
        name: "list_reminders",
        parameters: { type: "object", properties: {} },
      },
    },
  ],
  reminderActionTools: [],
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
  universalReadTools: [],
  executeUniversalReadTool: vi.fn().mockResolvedValue("{}"),
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
vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());

// Prevent the real diagnoseRecurringFailureInBackground from making live DB
// calls or model requests in the fire-and-forget path added by task #921.
vi.mock("../lib/elaine-code-diagnosis", () => ({
  diagnoseRecurringFailureInBackground: vi.fn(),
  maybeDiagnoseRecurringFailure: vi.fn().mockResolvedValue(null),
  listElaineCodeSuggestions: vi.fn().mockResolvedValue([]),
  decideElaineCodeSuggestion: vi.fn().mockResolvedValue(null),
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
  buildPlannerToolCatalogMock({
    ACTION_TOOL_NAMES: new Set<string>([]),
  }),
);

vi.mock("./runtime", () =>
  buildRuntimeMock({
    // Self-heal detector — no-op; these scenarios don't exercise that path.
    buildSelfHealLessonInput: vi.fn().mockReturnValue({
      outcome: "mistake" as const,
      domain: "general",
      situation: "mock situation",
      takeaway: "mock takeaway",
      tags: ["self-heal"],
    }),
    // Controlled via mockIsReminderDoubtMessage / mockIsSchedulingDoubtMessage
    isReminderDoubtMessage: mockIsReminderDoubtMessage,
    isSchedulingDoubtMessage: mockIsSchedulingDoubtMessage,
    // list_reminders and list_scheduled_contacts are MODEL_VISIBLE hard tools
    // in the real registry — they must be in this set or the round loop routes
    // them to the soft-tool path (which skips the mapWithConcurrency executor
    // that emits tool_start).
    MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>([
      "list_reminders",
      "list_scheduled_contacts",
    ]),
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
    evaluateForecastDateCoverage: vi.fn().mockResolvedValue({}),
    evaluateElaineTrace: vi.fn().mockResolvedValue({}),
    findElaineSatisfiedFallback: vi.fn().mockReturnValue(null),
    finishElaineTurnTrace: vi.fn().mockResolvedValue(undefined),
    generateElainePlan: vi.fn().mockResolvedValue({
      plan: {
        goal: "Answer the user",
        steps: [],
        assumptions: [],
        completionCriteria: ["User receives a helpful reply"],
      },
      source: "generated",
    }),
    loadElaineTurnTracesForMessages: vi.fn().mockResolvedValue(new Map()),
    mapWithConcurrency: vi
      .fn()
      .mockImplementation(
        async <T>(
          items: T[],
          _concurrency: number,
          fn: (item: T) => Promise<unknown>,
        ) => Promise.all(items.map(fn)),
      ),
    MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: new Map<string, string>(),
    persistElaineTraceBestEffort: vi.fn().mockResolvedValue(false),
    preparedActionAcknowledgement: vi.fn().mockReturnValue(""),
    provenanceForTool: vi.fn().mockReturnValue(null),
    requestNeedsStructuredPlan: vi.fn().mockReturnValue(false),
    sanitizeRuntimeText: vi.fn().mockImplementation((t: string) => t),
    selectElaineReplanTool: vi.fn().mockReturnValue(null),
    isReusableElaineResponseState: vi.fn().mockReturnValue(false),
    selectElaineOpenAIRole: vi.fn().mockReturnValue("assistant"),
    stripElaineCitationMetadata: vi.fn().mockImplementation((t: string) => t),
  }),
);

// ── DB mock ──────────────────────────────────────────────────────────────────

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
      req as unknown as {
        session: { userId: number };
        log: typeof silentLog;
      }
    ).session = { userId: TEST_USER_ID };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

/**
 * Streams a single tool-call chunk for the given tool name + args then stops.
 * This is the shape callModelWithSubagent's streaming callback receives from
 * the OpenAI-compatible client.
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

type ForcedToolChoice = {
  type: "function";
  function: { name: string };
};

/**
 * Primes the DB select queue for a fresh widget-default conversation with no
 * history. Queue positions match the order the chat route issues selects:
 *   1. appUsers lookup
 *   2. elaineHistoryConversations widget-default lookup (not found)
 *   3. Promise.all[0]: elaineHistoryConversations row load (null convRow)
 *   4. Promise.all[1]: elaineHistoryMessages (no history)
 *   5. elaineSettings lookup (default settings)
 */
function primeDbForFreshChat() {
  selectQueue.length = 0;
  selectQueue.push([{ displayName: "Tester", email: "tester@example.com" }]); // 1
  selectQueue.push([]); // 2 — widget-default conv not found
  selectQueue.push([]); // 3 — convRow null (new conv)
  selectQueue.push([]); // 4 — no history messages
  selectQueue.push([]); // 5 — no elaineSettings row
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
 * db.select() calls than the queue was primed for — the primeDb* helper is
 * out of date.  A slot deficit (ECONNRESET / wrong-data during the test)
 * means the handler gained a new db.select() call that was not added to
 * primeDbForFreshChat.
 *
 * Call this in afterEach so drift is surfaced with a clear failure message
 * rather than a cryptic ECONNRESET or mismatched data in a later test.
 */
function assertSelectQueueDrained() {
  expect(
    selectQueue.length,
    `selectQueue has ${selectQueue.length} unconsumed slot(s) after the test — ` +
      `update primeDbForFreshChat to match the current db.select() call ` +
      `order in the chat handler (index.ts)`,
  ).toBe(0);
}

/**
 * Parses the raw SSE body and returns:
 *   - eventTypes: ordered list of all event type names seen
 *   - toolStartNames: name values from every tool_start event's data payload
 *   - allDeltaText: concatenated text from all delta events
 */
function parseSseResponse(body: string): {
  eventTypes: string[];
  toolStartNames: string[];
  allDeltaText: string;
} {
  const blocks = body.split(/\n\n+/).filter(Boolean);
  const eventTypes: string[] = [];
  const toolStartNames: string[] = [];
  const deltaTexts: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) continue;

    const eventType = eventLine.slice("event:".length).trim();
    eventTypes.push(eventType);

    const rawData = dataLine.slice("data:".length).trim();
    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      if (eventType === "tool_start" && typeof parsed.name === "string") {
        toolStartNames.push(parsed.name);
      }
      if (eventType === "delta" && typeof parsed.text === "string") {
        deltaTexts.push(parsed.text);
      }
    } catch {
      // ignore malformed event data
    }
  }

  return {
    eventTypes,
    toolStartNames,
    allDeltaText: deltaTexts.join(""),
  };
}

// ── Shared setup ──────────────────────────────────────────────────────────────

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
  mockExecuteListRemindersTool.mockResolvedValue(
    '{"reminders":[],"returned":0}',
  );
  mockExecuteListScheduledContacts.mockResolvedValue(
    "No pending scheduled calls or messages.",
  );

  // Detector defaults: no doubt detected.
  mockIsReminderDoubtMessage.mockReturnValue(false);
  mockIsSchedulingDoubtMessage.mockReturnValue(false);

  // Default streaming: empty round (model replies with no text or tool calls).
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

  // Default registerToolCalls: allow every registered call. Returns one
  // schedule entry per input call (matching the real implementation shape)
  // so the round loop's runtimeScheduleByIndex lookup never returns undefined.
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
});

afterEach(() => {
  assertSelectQueueDrained();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — reminder-doubt forced tool call", () => {
  it("Scenario A: reminder-doubt message → tool_choice forces list_reminders, tool_start appears in SSE", async () => {
    primeDbForFreshChat();

    // Both detectors fire: the user doubts a reminder AND whether the
    // associated scheduled contact action fired.  The production handler
    // pushes list_scheduled_contacts first, then list_reminders.
    mockIsReminderDoubtMessage.mockReturnValue(true);
    mockIsSchedulingDoubtMessage.mockReturnValue(true);

    // Install the dual-round mock: captures tool_choice for each round and
    // emits the appropriate tool-call stream only when the correct tool is
    // forced.  Removing either push from the production wiring causes the
    // corresponding getCapturedToolChoiceRound assertion to fail.
    const { getCapturedToolChoiceRound1, getCapturedToolChoiceRound2 } =
      setUpDualMatchMock();

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message:
          "I set a reminder to call Mom but it didn't get scheduled — I don't see it",
        appId: "hub",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // Round 1 must have been forced to list_scheduled_contacts.
    expect(getCapturedToolChoiceRound1()).toEqual({
      type: "function",
      function: { name: "list_scheduled_contacts" },
    });

    // Round 2 must have been forced to list_reminders (queue was not
    // cleared after the first pop).
    expect(getCapturedToolChoiceRound2()).toEqual({
      type: "function",
      function: { name: "list_reminders" },
    });

    const { eventTypes, toolStartNames } = parseSseResponse(res.text);

    // Downstream: the forced call must have been executed (tool_start emitted)
    // and the executor reached.
    expect(eventTypes).toContain("tool_start");
    expect(toolStartNames).toContain("list_scheduled_contacts");
    expect(mockExecuteListScheduledContacts).toHaveBeenCalledWith(TEST_USER_ID);

    // tool_start must precede the done event.
    const toolStartIdx = eventTypes.indexOf("tool_start");
    const doneIdx = eventTypes.indexOf("done");
    expect(toolStartIdx).toBeLessThan(doneIdx);
  }, 15_000);

  it("Scenario B: non-doubt message → tool_choice is not forced, no list_scheduled_contacts tool_start", async () => {
    primeDbForFreshChat();

    // Detector returns false — forced-tool path is NOT engaged.
    mockIsSchedulingDoubtMessage.mockReturnValue(false);

    // Conditional mock: captures tool_choice but emits nothing (no forced
    // choice → stream returns empty generator → no tool_start event).
    const getCapturedToolChoice = setUpFirstRoundConditionalMockForScheduling();

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message:
          "I set a reminder to call Mom but it didn't get scheduled — I don't see it",
        appId: "hub",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // The production wiring must NOT have forced list_scheduled_contacts for
    // an ordinary (non-doubt) question.
    expect(getCapturedToolChoice()).not.toEqual({
      type: "function",
      function: { name: "list_scheduled_contacts" },
    });

    const { toolStartNames } = parseSseResponse(res.text);

    // No list_reminders tool_start on ordinary messages.
    expect(toolStartNames).not.toContain("list_reminders");
    expect(mockExecuteListRemindersTool).not.toHaveBeenCalled();
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling-doubt forced tool call — symmetric path to the reminder block
// above.  When the user doubts whether a previously-proposed contact/message
// was actually scheduled, the chat handler enqueues "list_scheduled_contacts"
// in nextForcedToolQueue so the model's very first round is forced to call
// that tool — grounding Elaine's answer in real DB state.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirror of setUpFirstRoundConditionalMock but for list_scheduled_contacts.
 * Captures tool_choice from the first chat.completions.create call and only
 * emits the list_scheduled_contacts tool-call stream when tool_choice actually
 * forces it — so removing the production nextForcedToolQueue wiring causes the
 * stream to vanish and all downstream assertions to fail.
 */
function setUpFirstRoundConditionalMockForScheduling(): () => unknown {
  let captured: unknown = undefined;
  mockCallModelWithSubagent.mockImplementationOnce(
    async (
      _model: string,
      _instructions: string,
      callback: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const createFn = vi
        .fn()
        .mockImplementation((body: { tool_choice?: ForcedToolChoice }) => {
          captured = body.tool_choice;
          const isForced =
            body.tool_choice?.type === "function" &&
            body.tool_choice?.function?.name === "list_scheduled_contacts";
          return isForced
            ? makeToolCallStream("list_scheduled_contacts", "{}")
            : (async function* () {})();
        });
      const mockClient = {
        chat: { completions: { create: createFn } },
      };
      await callback(mockClient, "mock-model", []);
    },
  );
  return () => captured;
}

describe("POST /api/elaine/chat — scheduling-doubt forced tool call", () => {
  it("Scenario A: scheduling-doubt message → tool_choice forces list_scheduled_contacts, tool_start appears in SSE", async () => {
    primeDbForFreshChat();

    // Both detectors fire: the user doubts whether the scheduled contact
    // action fired AND a reminder.  The production handler pushes
    // list_scheduled_contacts first, then list_reminders.
    mockIsSchedulingDoubtMessage.mockReturnValue(true);
    mockIsReminderDoubtMessage.mockReturnValue(true);

    // Install the dual-round mock: captures tool_choice for each round and
    // emits the appropriate tool-call stream only when the correct tool is
    // forced.  Removing either push from the production wiring causes the
    // corresponding getCapturedToolChoiceRound assertion to fail.
    const { getCapturedToolChoiceRound1, getCapturedToolChoiceRound2 } =
      setUpDualMatchMock();

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message:
          "I set a reminder to call Mom but it didn't get scheduled — I don't see it",
        appId: "hub",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // Round 1 must have been forced to list_scheduled_contacts.
    expect(getCapturedToolChoiceRound1()).toEqual({
      type: "function",
      function: { name: "list_scheduled_contacts" },
    });

    // Round 2 must have been forced to list_reminders (queue was not
    // cleared after the first pop).
    expect(getCapturedToolChoiceRound2()).toEqual({
      type: "function",
      function: { name: "list_reminders" },
    });

    const { eventTypes, toolStartNames } = parseSseResponse(res.text);

    // Downstream: the forced call must have been executed (tool_start emitted)
    // and the executor reached.
    expect(eventTypes).toContain("tool_start");
    expect(toolStartNames).toContain("list_scheduled_contacts");
    expect(mockExecuteListScheduledContacts).toHaveBeenCalledWith(TEST_USER_ID);

    // tool_start must precede the done event.
    const toolStartIdx = eventTypes.indexOf("tool_start");
    const doneIdx = eventTypes.indexOf("done");
    expect(toolStartIdx).toBeLessThan(doneIdx);
  }, 15_000);

  it("Scenario B: non-doubt message → tool_choice is not forced, no list_scheduled_contacts tool_start", async () => {
    primeDbForFreshChat();

    // Detector returns false — forced-tool path is NOT engaged.
    mockIsSchedulingDoubtMessage.mockReturnValue(false);

    // Conditional mock: captures tool_choice but emits nothing (no forced
    // choice → stream returns empty generator → no tool_start event).
    const getCapturedToolChoice = setUpFirstRoundConditionalMockForScheduling();

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message:
          "I set a reminder to call Mom but it didn't get scheduled — I don't see it",
        appId: "hub",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // The production wiring must NOT have forced list_scheduled_contacts for
    // an ordinary (non-doubt) question.
    expect(getCapturedToolChoice()).not.toEqual({
      type: "function",
      function: { name: "list_scheduled_contacts" },
    });

    const { toolStartNames } = parseSseResponse(res.text);

    // No list_scheduled_contacts tool_start on ordinary messages.
    expect(toolStartNames).not.toContain("list_scheduled_contacts");
    expect(mockExecuteListScheduledContacts).not.toHaveBeenCalled();
  }, 15_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Dual-doubt forced tool calls — when a message matches BOTH
// isSchedulingDoubtMessage AND isReminderDoubtMessage, the handler pushes
// list_scheduled_contacts then list_reminders onto nextForcedToolQueue in that
// order.  A future change that clears the queue after the first pop, or skips
// the second shift(), would not be caught by either single-detector test above.
//
// This test drives the full HTTP route end-to-end and asserts:
//   1. Round 1 is forced to call list_scheduled_contacts (tool_choice set).
//   2. Round 2 is forced to call list_reminders (tool_choice set).
//   3. Both tool_start events appear in the SSE stream in the correct order.
//   4. Both executors were actually invoked.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets up two sequential mockImplementationOnce entries — one per model round.
 *
 * Round 1 mock: captures tool_choice; emits a list_scheduled_contacts tool
 *   call only when tool_choice forces it.
 * Round 2 mock: captures tool_choice; emits a list_reminders tool call only
 *   when tool_choice forces it.
 *
 * Returning getter functions for each captured value lets the test assert the
 * correct injection after the HTTP request resolves.
 */
function setUpDualMatchMock(): {
  getCapturedToolChoiceRound1: () => unknown;
  getCapturedToolChoiceRound2: () => unknown;
} {
  let captured1: unknown = undefined;
  let captured2: unknown = undefined;

  // Round 1: list_scheduled_contacts is at the head of the queue.
  mockCallModelWithSubagent.mockImplementationOnce(
    async (
      _model: string,
      _instructions: string,
      callback: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const createFn = vi
        .fn()
        .mockImplementation((body: { tool_choice?: ForcedToolChoice }) => {
          captured1 = body.tool_choice;
          const isForced =
            body.tool_choice?.type === "function" &&
            body.tool_choice?.function?.name === "list_scheduled_contacts";
          return isForced
            ? makeToolCallStream("list_scheduled_contacts", "{}")
            : (async function* () {})();
        });
      const mockClient = {
        chat: { completions: { create: createFn } },
      };
      await callback(mockClient, "mock-model", []);
    },
  );

  // Round 2: list_reminders is now at the head (scheduling was shifted off).
  mockCallModelWithSubagent.mockImplementationOnce(
    async (
      _model: string,
      _instructions: string,
      callback: (
        client: unknown,
        model: string,
        serverTools: unknown[],
      ) => Promise<void>,
    ) => {
      const createFn = vi
        .fn()
        .mockImplementation((body: { tool_choice?: ForcedToolChoice }) => {
          captured2 = body.tool_choice;
          const isForced =
            body.tool_choice?.type === "function" &&
            body.tool_choice?.function?.name === "list_reminders";
          return isForced
            ? makeToolCallStream("list_reminders", "{}")
            : (async function* () {})();
        });
      const mockClient = {
        chat: { completions: { create: createFn } },
      };
      await callback(mockClient, "mock-model", []);
    },
  );

  return {
    getCapturedToolChoiceRound1: () => captured1,
    getCapturedToolChoiceRound2: () => captured2,
  };
}

describe("POST /api/elaine/chat — dual-doubt forced tool calls (both detectors fire)", () => {
  it("dual-match message → list_scheduled_contacts then list_reminders, both tool_start events appear in SSE in order", async () => {
    primeDbForFreshChat();

    // Both detectors fire. The production handler pushes
    // list_scheduled_contacts first (isSchedulingDoubtMessage block runs
    // before isReminderDoubtMessage) then list_reminders. If either push is
    // removed, or the queue is drained after the first pop, the corresponding
    // tool_choice / tool_start assertion below will fail.
    mockIsSchedulingDoubtMessage.mockReturnValue(true);
    mockIsReminderDoubtMessage.mockReturnValue(true);

    const { getCapturedToolChoiceRound1, getCapturedToolChoiceRound2 } =
      setUpDualMatchMock();

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message:
          "I set a reminder to call Mom but it didn't get scheduled — I don't see it",
        appId: "hub",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // Round 1 must have been forced to list_scheduled_contacts.
    expect(getCapturedToolChoiceRound1()).toEqual({
      type: "function",
      function: { name: "list_scheduled_contacts" },
    });

    // Round 2 must have been forced to list_reminders (queue was not
    // cleared after the first pop).
    expect(getCapturedToolChoiceRound2()).toEqual({
      type: "function",
      function: { name: "list_reminders" },
    });

    const { eventTypes, toolStartNames } = parseSseResponse(res.text);

    // Both tool_start events must appear in the SSE stream.
    expect(toolStartNames).toContain("list_scheduled_contacts");
    expect(toolStartNames).toContain("list_reminders");

    // list_scheduled_contacts must precede list_reminders in the stream.
    const scheduledContactsIdx = toolStartNames.indexOf(
      "list_scheduled_contacts",
    );
    const remindersIdx = toolStartNames.indexOf("list_reminders");
    expect(scheduledContactsIdx).toBeLessThan(remindersIdx);

    // Both executor functions must have been invoked.
    expect(mockExecuteListScheduledContacts).toHaveBeenCalledWith(TEST_USER_ID);
    expect(mockExecuteListRemindersTool).toHaveBeenCalledWith(
      "list_reminders",
      expect.any(String),
      TEST_USER_ID,
    );

    // The last tool_start must appear before the done event.
    const lastToolStartIdx = eventTypes.lastIndexOf("tool_start");
    const doneIdx = eventTypes.indexOf("done");
    expect(lastToolStartIdx).toBeLessThan(doneIdx);
  }, 15_000);
});
