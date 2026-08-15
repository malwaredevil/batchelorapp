/**
 * Route-level wiring test for the self-heal code-suggestion pipeline.
 *
 * Task #914: drives POST /api/elaine/chat through the real Elaine router
 * three times with a mocked model reply that triggers the "claimed check"
 * self-heal detector, then asserts:
 *   1. recordElaineLesson is called with source:"self_heal" on every turn.
 *   2. diagnoseRecurringFailureInBackground is called with the correct
 *      patternKey and occurrenceCount after every turn.
 *   3. On the third turn (occurrenceCount = threshold), the call carries
 *      occurrenceCount:3 — the value that pushes maybeDiagnoseRecurringFailure
 *      over its threshold.
 *   4. The SSE stream includes the self-heal correction delta.
 *   5. A caught error inside the self-heal try/catch is logged as a warning
 *      and does not crash the chat turn.
 *
 * Approach mirrors chat-reminder-doubt.test.ts: import elaineRouter once in
 * beforeAll, mount it on a minimal Express app, drive it via supertest.
 * All AI / DB / third-party dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";

// ── Hoisted mock refs ─────────────────────────────────────────────────────────

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
  mockDetectMismatch,
  mockBuildSelfHealLessonInput,
  mockSelfHealPatternKey,
  mockRecordElaineLesson,
  mockDiagnoseInBackground,
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

  const LESSON_INPUT = {
    outcome: "mistake" as const,
    domain: "general",
    situation:
      'Started to tell the user a check or confirmation had been performed (e.g. "I checked and...", "I confirmed that...") without actually calling any tool that turn to establish it.',
    takeaway:
      "Never state that you checked, confirmed, or verified something unless a real tool call this turn actually established it.",
    tags: ["self-heal", "ungrounded-claim"],
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
    mockComplete: vi
      .fn()
      .mockReturnValue({ ...MOCK_TRACE, status: "completed" as const }),
    mockSetTraceAvailable: vi.fn(),
    mockMarkFailedReadStepsAdjusted: vi.fn(),
    mockRecordObservation: vi.fn(),
    mockCallModelWithSubagent: vi.fn(),
    mockCallModel: vi.fn().mockResolvedValue(""),
    // Mismatch detector: by default returns a mismatch (the "claimed check"
    // failure mode). Individual tests can override this to null.
    mockDetectMismatch: vi.fn().mockReturnValue({
      kind: "claimed_check_without_tool_call" as const,
      claimedPhrase: "I checked",
    }),
    mockBuildSelfHealLessonInput: vi.fn().mockReturnValue(LESSON_INPUT),
    mockSelfHealPatternKey: vi
      .fn()
      .mockImplementation((kind: string) => `self_heal:${kind}`),
    mockRecordElaineLesson: vi.fn(),
    mockDiagnoseInBackground: vi.fn(),
  };
});

// ── vi.mock() declarations ─────────────────────────────────────────────────────

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(),
  startSpan: vi.fn((_o: unknown, cb: () => unknown) => cb()),
  setConversationId: vi.fn(),
  Scope: class {},
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/rateLimit", () => ({
  loginLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  passwordResetLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  phoneVerifyLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  authLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  apiLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  adminLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  webhookLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
  aiLimiter: (_r: unknown, _s: unknown, n: () => void) => n(),
}));

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
  webSearchWithCorroboration: vi.fn().mockResolvedValue([]),
  buildWebSearchToolResult: vi.fn().mockReturnValue(""),
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
  executeListScheduledContacts: vi.fn().mockResolvedValue(""),
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
  executeListRemindersTool: vi.fn().mockResolvedValue(""),
  reminderReadTools: [],
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

/**
 * elaine-lessons is mocked so getRelevantElaineLessons and recordElaineLesson
 * don't consume DB queue slots or interfere with mock state across tests.
 * recordElaineLesson is controlled per-test via mockRecordElaineLesson.
 */
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
  recordElaineLesson: mockRecordElaineLesson,
}));

/**
 * elaine-code-diagnosis is mocked so diagnoseRecurringFailureInBackground is
 * a plain spy — this test verifies the hook in index.ts calls it correctly,
 * not that the background function itself fires (that's covered in
 * self-heal-pipeline.test.ts).
 */
vi.mock("../lib/elaine-code-diagnosis", () => ({
  diagnoseRecurringFailureInBackground: mockDiagnoseInBackground,
  maybeDiagnoseRecurringFailure: vi.fn().mockResolvedValue(null),
  listElaineCodeSuggestions: vi.fn().mockResolvedValue([]),
  decideElaineCodeSuggestion: vi.fn().mockResolvedValue(null),
}));

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn().mockResolvedValue("{}"),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

vi.mock("./runtime", () => ({
  assertElaineToolFamilyCoverage: vi.fn(),
  aggregateElaineTraceEvaluations: vi.fn().mockReturnValue([]),
  // Self-heal detector: controlled per-test via mockDetectMismatch.
  detectClaimedCheckWithoutToolCall: mockDetectMismatch,
  // buildSelfHealLessonInput and selfHealPatternKey must be in the runtime
  // mock because index.ts imports them from "./runtime".
  buildSelfHealLessonInput: mockBuildSelfHealLessonInput,
  selfHealPatternKey: mockSelfHealPatternKey,
  buildElaineSourceRoute: vi.fn().mockReturnValue({
    preferredKinds: [],
    fallbackKinds: [],
    sourceKind: "direct",
    sourceName: "current page context",
    confidence: "high",
  }),
  classifyElaineRequest: vi.fn().mockReturnValue({
    type: "conversational",
    scope: "none",
    intent: "chat",
  }),
  isReminderDoubtMessage: vi.fn().mockReturnValue(false),
  isSchedulingDoubtMessage: vi.fn().mockReturnValue(false),
  buildClassifierDoubtLessonInput: vi.fn().mockReturnValue({
    outcome: "mistake",
    domain: "general",
    situation: "mock situation",
    takeaway: "mock takeaway",
    tags: ["classifier-doubt"],
  }),
  classifierDoubtPatternKey: vi.fn().mockReturnValue("classifier_doubt:mock"),
  completedActionAcknowledgement: vi.fn().mockReturnValue(""),
  createElaineTurnTrace: vi.fn().mockResolvedValue({ id: 1 }),
  createFallbackPlan: vi.fn().mockReturnValue({
    goal: "Answer the user",
    steps: [],
    assumptions: [],
    completionCriteria: ["User receives a helpful reply"],
  }),
  decideElaineModelStreamRecovery: vi.fn().mockReturnValue({
    retry: false,
    suppressTools: false,
    resetPartialContent: false,
  }),
  ELAINE_READ_CONCURRENCY: 3,
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
  MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>(),
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
}));

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

// ── Router bootstrap ──────────────────────────────────────────────────────────

import type { IRouter } from "express";
let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER_ID = 42;

const silentLog = {
  warn: vi.fn(),
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
 * Primes the DB select queue for a fresh conversation with no history.
 * Queue positions match the order the chat route issues selects:
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
  selectQueue.push([]); // 3 — convRow null
  selectQueue.push([]); // 4 — no history
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
 * Configures callModelWithSubagent to stream a plain text reply.
 * An empty stream body is sufficient — detectClaimedCheckWithoutToolCall is
 * mocked to always return a mismatch regardless of the actual text content.
 */
function setUpTextReplyStream() {
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
 * Parses the raw SSE body and returns the concatenated text from all delta
 * events.
 */
function parseSseDeltaText(body: string): string {
  const blocks = body.split(/\n\n+/).filter(Boolean);
  const texts: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) continue;
    if (eventLine.slice("event:".length).trim() !== "delta") continue;
    try {
      const parsed = JSON.parse(dataLine.slice("data:".length).trim()) as {
        text?: string;
      };
      if (typeof parsed.text === "string") texts.push(parsed.text);
    } catch {
      // ignore
    }
  }
  return texts.join("");
}

// ── Shared beforeEach ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  silentLog.warn.mockReset();

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

  // Restore hoisted defaults cleared by clearAllMocks.
  mockDetectMismatch.mockReturnValue({
    kind: "claimed_check_without_tool_call" as const,
    claimedPhrase: "I checked",
  });
  mockBuildSelfHealLessonInput.mockReturnValue({
    outcome: "mistake" as const,
    domain: "general",
    situation:
      'Started to tell the user a check or confirmation had been performed (e.g. "I checked and...", "I confirmed that...") without actually calling any tool that turn to establish it.',
    takeaway:
      "Never state that you checked, confirmed, or verified something unless a real tool call this turn actually established it.",
    tags: ["self-heal", "ungrounded-claim"],
  });
  mockSelfHealPatternKey.mockImplementation(
    (kind: string) => `self_heal:${kind}`,
  );

  setUpTextReplyStream();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — self-heal wiring in the real router", () => {
  it("appends the self-heal correction delta when the detector fires", async () => {
    primeDbForFreshChat();
    mockRecordElaineLesson.mockResolvedValueOnce({ id: 1, occurrenceCount: 1 });

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Check my reminders", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);

    // The self-heal correction must appear in the SSE delta stream.
    const deltaText = parseSseDeltaText(res.text);
    expect(deltaText).toContain(
      "Actually, I need to be careful here — I haven't actually verified that yet",
    );
  }, 15_000);

  it("calls recordElaineLesson with source:'self_heal' when the detector fires", async () => {
    primeDbForFreshChat();
    mockRecordElaineLesson.mockResolvedValueOnce({ id: 1, occurrenceCount: 1 });

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "How are my reminders?", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(mockRecordElaineLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_ID,
        source: "self_heal",
        outcome: "mistake",
      }),
    );
  }, 15_000);

  it("calls diagnoseRecurringFailureInBackground with patternKey and occurrenceCount from the lesson", async () => {
    primeDbForFreshChat();
    mockRecordElaineLesson.mockResolvedValueOnce({ id: 7, occurrenceCount: 2 });

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Did my reminder save?", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(mockDiagnoseInBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        patternKey: "self_heal:claimed_check_without_tool_call",
        lessonId: 7,
        occurrenceCount: 2,
      }),
    );
  }, 15_000);

  it("across three turns the third call carries occurrenceCount:3 — the threshold-crossing value", async () => {
    const app = buildApp();

    // Turn 1: first occurrence
    primeDbForFreshChat();
    mockRecordElaineLesson.mockResolvedValueOnce({ id: 1, occurrenceCount: 1 });
    const r1 = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "Check my reminders please", appId: "hub" })
      .buffer(true);
    expect(r1.status).toBe(200);

    // Turn 2: second occurrence
    primeDbForFreshChat();
    mockRecordElaineLesson.mockResolvedValueOnce({ id: 1, occurrenceCount: 2 });
    const r2 = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "And again please", appId: "hub" })
      .buffer(true);
    expect(r2.status).toBe(200);

    // Turn 3: third occurrence — occurrenceCount reaches threshold
    primeDbForFreshChat();
    mockRecordElaineLesson.mockResolvedValueOnce({ id: 1, occurrenceCount: 3 });
    const r3 = await request(app)
      .post("/api/elaine/chat")
      .send({ message: "One more time", appId: "hub" })
      .buffer(true);
    expect(r3.status).toBe(200);

    // diagnoseRecurringFailureInBackground must have been called once per turn.
    expect(mockDiagnoseInBackground).toHaveBeenCalledTimes(3);

    // Third call must carry occurrenceCount:3 and the correct patternKey —
    // the real index.ts self-heal block passes the lesson's occurrenceCount
    // directly, so if the wiring is broken the value will be wrong.
    const [, , thirdCall] = mockDiagnoseInBackground.mock.calls as [
      unknown,
      unknown,
      [{ patternKey: string; occurrenceCount: number; lessonId: number }],
    ];
    expect(thirdCall[0]).toMatchObject({
      patternKey: "self_heal:claimed_check_without_tool_call",
      occurrenceCount: 3,
      lessonId: 1,
    });
  }, 30_000);

  it("does NOT call recordElaineLesson or diagnoseRecurringFailureInBackground when the detector returns null", async () => {
    primeDbForFreshChat();
    // Override: no mismatch detected this turn
    mockDetectMismatch.mockReturnValueOnce(null);

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "What's the weather like?", appId: "hub" })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(mockRecordElaineLesson).not.toHaveBeenCalled();
    expect(mockDiagnoseInBackground).not.toHaveBeenCalled();
  }, 15_000);

  it("does not crash the chat turn when recordElaineLesson throws — logs a warning instead", async () => {
    primeDbForFreshChat();
    // Make the lesson-recording throw (simulates a DB connection failure)
    mockRecordElaineLesson.mockRejectedValueOnce(new Error("DB write failed"));

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({ message: "Check my reminders", appId: "hub" })
      .buffer(true);

    // The turn must still complete successfully
    expect(res.status).toBe(200);

    // The error is caught by the try/catch in index.ts and logged as a warn
    expect(silentLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "DB write failed" }),
      }),
      "elaine: failed to record self-heal lesson",
    );

    // diagnoseRecurringFailureInBackground must NOT have been called (the
    // throw happened before it could be reached)
    expect(mockDiagnoseInBackground).not.toHaveBeenCalled();
  }, 15_000);
});
