/**
 * Route-level end-to-end tests proving Elaine's ad-hoc chat-photo analysis
 * tools (analyze_pottery_photo, analyze_fabric_photo, analyze_ornament_photo)
 * and the book-value tool (lookup_book_value) are grounded in the app's real
 * domain analysis pipelines — not a general-knowledge guess.
 *
 * Approach: drive POST /api/elaine/chat via supertest with an attached photo
 * URL. The real per-domain vision functions (analyzeImage for pottery/
 * quilting, analyzeOrnamentImage, analyzePotteryZones, lookupBookValue) are
 * mocked to return a FIXED, distinctive fixture value. callModelWithSubagent
 * is configured to call the tool under test on round 1, then captures the
 * round-2 request body (the tool's result message fed back to the model) and
 * asserts it contains the exact fixture fields — proving the executor
 * actually invoked the real pipeline function and passed its structured
 * output back to the model, rather than letting the model answer from raw
 * vision/general knowledge. Each mocked pipeline function is also asserted
 * to have been called with the attached photo URL(s).
 *
 * Modeled on chat-reminder-doubt.test.ts's mock scaffold — see that file for
 * the rationale behind each vi.mock() below.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";

// ── Hoisted mock controls ───────────────────────────────────────────────────

const {
  mockRegisterToolCalls,
  mockRecordModelRound,
  mockVerify,
  mockSnapshot,
  mockComplete,
  mockCallModelWithSubagent,
  mockCallModel,
  mockAnalyzePotteryPhoto,
  mockAnalyzePotteryZones,
  mockAnalyzeFabricPhoto,
  mockAnalyzeOrnamentPhoto,
  mockLookupBookValue,
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
    mockCallModelWithSubagent: vi.fn(),
    mockCallModel: vi.fn().mockResolvedValue(""),
    // Domain pipeline mocks — the fixtures asserted against below.
    mockAnalyzePotteryPhoto: vi.fn().mockResolvedValue({
      name: "9″ (23 cm) Cobalt Windmill Plate",
      patternDescription: "Cobalt blue windmill scene with border band",
      style: "Blue-and-white Transferware",
      shape: "Dinner Plate",
      maker: "Royal Sphinx Holland",
      makerInfo: "Dutch pottery maker known for delftware-style transferware.",
      dimensions: "9in diameter",
      dominantColors: ["white", "cobalt blue"],
      motifs: ["windmill", "floral border"],
      aiDescription:
        "A charming Dutch transferware plate depicting a windmill scene.",
      glazeType: "Transferware Glaze",
    }),
    mockAnalyzePotteryZones: vi.fn().mockResolvedValue({
      zones: [],
      patternComplexity: "moderate" as const,
      hasRepeatPattern: true,
      dominantZone: "rim border",
    }),
    mockAnalyzeFabricPhoto: vi.fn().mockResolvedValue({
      name: "Autumn Leaves Calico",
      lineName: "Harvest Moon",
      designer: "Jane Sassaman",
      manufacturer: "FreeSpirit",
      colorway: "Rust/Gold",
      printType: "Novelty Print",
      fiberContent: "100% Cotton",
      dominantColors: ["rust", "gold", "brown"],
      motifs: ["leaves", "acorns"],
      styleDescriptors: ["autumnal", "novelty"],
      aiDescription:
        "A rust-and-gold autumn leaf novelty print on 100% cotton.",
    }),
    mockAnalyzeOrnamentPhoto: vi.fn().mockResolvedValue({
      name: "Snoopy and Woodstock Skating",
      seriesOrCollection: "Peanuts",
      year: 1999,
      dimensions: "3in tall",
      dominantColors: ["white", "black", "red"],
      motifs: ["Snoopy", "Woodstock", "ice skates"],
      aiDescription:
        "A festive Peanuts ornament of Snoopy skating with Woodstock.",
      upc: "071277123456",
    }),
    mockLookupBookValue: vi.fn().mockResolvedValue({
      value: 42.5,
      source: "hookedonhallmark.com" as const,
    }),
  };
});

// ── vi.mock() declarations ──────────────────────────────────────────────────

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
  analyzeImage: mockAnalyzeFabricPhoto,
}));

vi.mock("../lib/pottery/openai", () => ({
  analyzeImage: mockAnalyzePotteryPhoto,
  analyzePotteryZones: mockAnalyzePotteryZones,
}));

vi.mock("../lib/ornaments/openai", () => ({
  analyzeOrnamentImage: mockAnalyzeOrnamentPhoto,
}));

vi.mock("../lib/ornaments/book-value", () => ({
  lookupBookValue: mockLookupBookValue,
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
  executeListScheduledContacts: vi.fn().mockResolvedValue("{}"),
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
  executeListRemindersTool: vi
    .fn()
    .mockResolvedValue('{"reminders":[],"returned":0}'),
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

// elaine-lessons is not mocked in the original file — the real
// getRelevantElaineLessons makes a db.select() call that consumes an extra
// selectQueue slot; mock it out so the queue stays aligned with
// primeDbForFreshChat's 5-slot layout (see api-server-route-testing memory).
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

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn().mockResolvedValue("{}"),
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

vi.mock("./runtime", () => ({
  assertElaineToolFamilyCoverage: vi.fn(),
  aggregateElaineTraceEvaluations: vi.fn().mockReturnValue([]),
  detectClaimedCheckWithoutToolCall: vi.fn().mockReturnValue(null),
  buildSelfHealLessonInput: vi.fn(),
  selfHealPatternKey: vi.fn().mockReturnValue("self_heal:mock"),
  buildClassifierDoubtLessonInput: vi.fn().mockReturnValue({
    outcome: "mistake",
    domain: "general",
    situation: "mock situation",
    takeaway: "mock takeaway",
    tags: ["classifier-doubt"],
  }),
  classifierDoubtPatternKey: vi.fn().mockReturnValue("classifier_doubt:mock"),
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
    setTraceAvailable = vi.fn();
    markFailedReadStepsAdjusted = vi.fn();
    recordObservation = vi.fn();
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
  MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>([
    "analyze_pottery_photo",
    "analyze_fabric_photo",
    "analyze_ornament_photo",
    "lookup_book_value",
  ]),
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

// ── App bootstrap ────────────────────────────────────────────────────────────

import type { IRouter } from "express";
let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = 42;
const TEST_PHOTO_URL = "https://signed.example.com/attached-photo.jpg";

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
 * Configures callModelWithSubagent so round 1 emits a tool-call stream for
 * `toolName`/`argsJson`, and round 2+ captures the request body (which
 * includes the tool-result message fed back to the model) before returning
 * an empty stream. Returns a getter for all captured round bodies.
 */
function setUpToolCallThenCapture(
  toolName: string,
  argsJson: string,
): () => { messages?: Array<{ role: string; content?: unknown }> }[] {
  const capturedBodies: {
    messages?: Array<{ role: string; content?: unknown }>;
  }[] = [];
  let round = 0;
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
      const createFn = vi
        .fn()
        .mockImplementation(
          (body: { messages?: Array<{ role: string; content?: unknown }> }) => {
            capturedBodies.push(body);
            round++;
            if (round === 1) {
              return (async function* () {
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
              })();
            }
            return (async function* () {})();
          },
        );
      const mockClient = {
        chat: { completions: { create: createFn } },
      };
      await callback(mockClient, "mock-model", []);
    },
  );
  return () => capturedBodies;
}

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

/** Finds the tool-result message (role "tool") in a captured round body. */
function findToolResultContent(
  bodies: { messages?: Array<{ role: string; content?: unknown }> }[],
): string {
  for (const body of bodies) {
    const toolMsg = body.messages?.find((m) => m.role === "tool");
    if (toolMsg && typeof toolMsg.content === "string") return toolMsg.content;
  }
  return "";
}

beforeEach(() => {
  vi.clearAllMocks();

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

  // Restore default resolved values cleared by clearAllMocks.
  mockAnalyzePotteryPhoto.mockResolvedValue({
    name: "9″ (23 cm) Cobalt Windmill Plate",
    patternDescription: "Cobalt blue windmill scene with border band",
    style: "Blue-and-white Transferware",
    shape: "Dinner Plate",
    maker: "Royal Sphinx Holland",
    makerInfo: "Dutch pottery maker known for delftware-style transferware.",
    dimensions: "9in diameter",
    dominantColors: ["white", "cobalt blue"],
    motifs: ["windmill", "floral border"],
    aiDescription:
      "A charming Dutch transferware plate depicting a windmill scene.",
    glazeType: "Transferware Glaze",
  });
  mockAnalyzePotteryZones.mockResolvedValue({
    zones: [],
    patternComplexity: "moderate" as const,
    hasRepeatPattern: true,
    dominantZone: "rim border",
  });
  mockAnalyzeFabricPhoto.mockResolvedValue({
    name: "Autumn Leaves Calico",
    lineName: "Harvest Moon",
    designer: "Jane Sassaman",
    manufacturer: "FreeSpirit",
    colorway: "Rust/Gold",
    printType: "Novelty Print",
    fiberContent: "100% Cotton",
    dominantColors: ["rust", "gold", "brown"],
    motifs: ["leaves", "acorns"],
    styleDescriptors: ["autumnal", "novelty"],
    aiDescription: "A rust-and-gold autumn leaf novelty print on 100% cotton.",
  });
  mockAnalyzeOrnamentPhoto.mockResolvedValue({
    name: "Snoopy and Woodstock Skating",
    seriesOrCollection: "Peanuts",
    year: 1999,
    dimensions: "3in tall",
    dominantColors: ["white", "black", "red"],
    motifs: ["Snoopy", "Woodstock", "ice skates"],
    aiDescription:
      "A festive Peanuts ornament of Snoopy skating with Woodstock.",
    upc: "071277123456",
  });
  mockLookupBookValue.mockResolvedValue({
    value: 42.5,
    source: "hookedonhallmark.com" as const,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/elaine/chat — grounded photo/lookup tools (task 858)", () => {
  it("analyze_pottery_photo: calls the real pottery vision pipeline and feeds its structured result back to the model", async () => {
    primeDbForFreshChat();
    const getCapturedBodies = setUpToolCallThenCapture(
      "analyze_pottery_photo",
      "{}",
    );

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message: "What style is this pottery piece?",
        appId: "pottery",
        attachmentUrls: [TEST_PHOTO_URL],
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // The real pipeline function(s) were actually invoked with the attached
    // photo URL — not skipped in favor of raw model vision/guessing.
    expect(mockAnalyzePotteryPhoto).toHaveBeenCalledWith([TEST_PHOTO_URL]);
    expect(mockAnalyzePotteryZones).toHaveBeenCalledWith([TEST_PHOTO_URL]);

    // The tool result fed back to the model must contain the exact fixture
    // fields the mocked pipeline returned, proving the answer is grounded in
    // that real analysis rather than a plausible-sounding guess.
    const toolResult = findToolResultContent(getCapturedBodies());
    expect(toolResult).toContain("Blue-and-white Transferware");
    expect(toolResult).toContain("Royal Sphinx Holland");
    expect(toolResult).toContain("Transferware Glaze");
    // Must explicitly disclose this is a non-destructive, ad-hoc lookup.
    expect(toolResult.toLowerCase()).toContain("nothing was saved");
  }, 15_000);

  it("analyze_fabric_photo: calls the real quilting fabric analysis pipeline and feeds its structured result back to the model", async () => {
    primeDbForFreshChat();
    const getCapturedBodies = setUpToolCallThenCapture(
      "analyze_fabric_photo",
      "{}",
    );

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message: "Can you identify this fabric print?",
        appId: "quilting",
        attachmentUrls: [TEST_PHOTO_URL],
      })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(mockAnalyzeFabricPhoto).toHaveBeenCalledWith([TEST_PHOTO_URL]);

    const toolResult = findToolResultContent(getCapturedBodies());
    expect(toolResult).toContain("Jane Sassaman");
    expect(toolResult).toContain("Harvest Moon");
    expect(toolResult).toContain("Novelty Print");
    expect(toolResult.toLowerCase()).toContain("nothing was saved");
  }, 15_000);

  it("analyze_ornament_photo: calls the real ornament vision pipeline and feeds its structured result (incl. UPC) back to the model", async () => {
    primeDbForFreshChat();
    const getCapturedBodies = setUpToolCallThenCapture(
      "analyze_ornament_photo",
      "{}",
    );

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message: "What ornament is this?",
        appId: "ornaments",
        attachmentUrls: [TEST_PHOTO_URL],
      })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(mockAnalyzeOrnamentPhoto).toHaveBeenCalledWith([TEST_PHOTO_URL]);

    const toolResult = findToolResultContent(getCapturedBodies());
    expect(toolResult).toContain("Peanuts");
    expect(toolResult).toContain("071277123456");
    expect(toolResult.toLowerCase()).toContain("nothing was saved");
  }, 15_000);

  it("lookup_book_value: calls the real two-source book-value lookup, not search_hallmark, and reports its exact value/source", async () => {
    primeDbForFreshChat();
    const getCapturedBodies = setUpToolCallThenCapture(
      "lookup_book_value",
      JSON.stringify({
        name: "Snoopy and Woodstock Skating",
        seriesOrCollection: "Peanuts",
        year: 1999,
      }),
    );

    const res = await request(buildApp())
      .post("/api/elaine/chat")
      .send({
        message: "What's the book value of my Snoopy and Woodstock ornament?",
        appId: "ornaments",
      })
      .buffer(true);

    expect(res.status).toBe(200);

    // The real two-source lookup was called with the model-supplied args —
    // not the separate search_hallmark catalog/Apify path.
    expect(mockLookupBookValue).toHaveBeenCalledWith({
      name: "Snoopy and Woodstock Skating",
      seriesOrCollection: "Peanuts",
      year: 1999,
    });

    const toolResult = findToolResultContent(getCapturedBodies());
    expect(toolResult).toContain("42.5");
    expect(toolResult).toContain("hookedonhallmark.com");
  }, 15_000);
});
