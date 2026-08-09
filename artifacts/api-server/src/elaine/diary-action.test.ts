/**
 * End-to-end tests for the Elaine edit_diary_entry action tool.
 *
 * Exercises the full round-trip through POST /api/elaine/action with
 * type "edit_diary_entry".  The executor queries travelsTrips to verify the
 * trip exists, then patches travelsDiaryEntries.  All heavy AI / calendar /
 * Sentry dependencies are stubbed so only the executor logic and db mock run.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { makeEagerSelectBuilder } from "../test-helpers/db-mock";

// ============================================================================
// Mocks — ALL vi.mock() calls must be hoisted before any dynamic imports.
// ============================================================================

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(),
  startSpan: vi.fn((_o: unknown, cb: () => unknown) => cb()),
  Scope: class {},
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/rateLimit", () => ({
  phoneVerifyLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/auth", () => ({
  requireAuth: (
    req: { session: { userId?: number } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.session.userId) {
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

// ── DB mock ──────────────────────────────────────────────────────────────────

const selectQueue: unknown[][] = [];
let updateReturning: unknown[] = [];
let deleteReturning: unknown[] = [];
let insertReturning: unknown[] = [];

function makeUpdateBuilder() {
  const builder = {
    set(_set: unknown) {
      return builder;
    },
    where() {
      return builder;
    },
    returning() {
      return Promise.resolve(updateReturning);
    },
  };
  return builder;
}

function makeDeleteBuilder() {
  const builder = {
    where() {
      return builder;
    },
    returning() {
      return Promise.resolve(deleteReturning);
    },
  };
  return builder;
}

function makeInsertBuilder() {
  const builder = {
    values(_vals: unknown) {
      return {
        returning() {
          return Promise.resolve(insertReturning);
        },
        onConflictDoNothing() {
          return {
            returning() {
              return Promise.resolve(insertReturning);
            },
          };
        },
      };
    },
    onConflictDoNothing() {
      return {
        returning() {
          return Promise.resolve(insertReturning);
        },
      };
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn(() => makeInsertBuilder()),
  update: vi.fn(() => makeUpdateBuilder()),
  delete: vi.fn(() => makeDeleteBuilder()),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: dbMock,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() },
  };
});

// ── Action sub-modules — only executor maps matter; include *ActionTools: [] ─

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
  buildUniversalActionLabel: vi.fn().mockResolvedValue(""),
  universalActionExecutors: {},
  universalActionSchemas: [],
  universalActionTools: [],
  UNIVERSAL_ACTION_TYPES: [],
}));

vi.mock("./adaptive-actions", () => ({
  adaptiveActionExecutors: {},
  adaptiveActionSchemas: [],
  adaptiveActionTools: [],
  buildAdaptiveActionLabel: vi.fn().mockResolvedValue(""),
  ADAPTIVE_ACTION_TYPES: [],
}));

vi.mock("./communication-actions", () => ({
  buildCommunicationActionLabel: vi.fn().mockResolvedValue(""),
  communicationActionExecutors: {},
  communicationActionSchemas: [],
  communicationActionTools: [],
  executeListContactChannels: vi.fn().mockResolvedValue([]),
  executeListScheduledContacts: vi.fn().mockResolvedValue([]),
  listContactChannelsTool: {
    type: "function",
    function: { name: "list_contact_channels", parameters: {} },
  },
  listScheduledContactsTool: {
    type: "function",
    function: { name: "list_scheduled_contacts", parameters: {} },
  },
  LIST_CONTACT_CHANNELS_TOOL_NAME: "list_contact_channels",
  LIST_SCHEDULED_CONTACTS_TOOL_NAME: "list_scheduled_contacts",
  COMMUNICATION_ACTION_TYPES: [],
}));

vi.mock("./office-actions", () => ({
  executeOfficeTool: vi.fn().mockResolvedValue({}),
  officeActionTools: [],
  FIND_EMAILS_ABOUT_TOPIC_TOOL_NAME: "find_emails_about_topic",
  GET_EMAIL_DETAIL_TOOL_NAME: "get_email_detail",
  SUMMARIZE_INBOX_TOOL_NAME: "summarize_inbox",
}));

vi.mock("./universal-read-tools", () => ({
  GET_ELAINE_TASK_TOOL_NAME: "get_elaine_task",
  GET_NOTE_TOOL_NAME: "get_note",
  LIST_NOTES_TOOL_NAME: "list_notes",
  LIST_NOTIFICATIONS_TOOL_NAME: "list_notifications",
  GET_NOTIFICATION_COUNTS_TOOL_NAME: "get_notification_counts",
  GET_NOTIFICATION_PREFERENCES_TOOL_NAME: "get_notification_preferences",
  LIST_ELAINE_MEMORIES_TOOL_NAME: "list_memories",
  LIST_ELAINE_TASKS_TOOL_NAME: "list_elaine_tasks",
  universalReadTools: [],
  executeUniversalReadTool: vi.fn().mockResolvedValue({}),
}));

vi.mock("./travel-wishlist-executors", () => ({
  removeWishlistItemExecutor: vi
    .fn()
    .mockResolvedValue({ status: 200, body: {} }),
}));

vi.mock("./yardage-math", () => ({
  calculateYardage: vi.fn().mockReturnValue(0),
}));

// ── planner-tool-catalog — stub all exported constants / tool arrays ─────────

vi.mock("./planner-tool-catalog", () => ({
  ACTION_CONFIRMATION_MODES: ["one_by_one", "all_at_once", "auto_run"],
  ACTION_TOOL_NAMES: new Set<string>(),
  ACTION_TOOLS: [],
  CALCULATE_YARDAGE_TOOL_NAME: "calculate_yardage",
  CHECK_INTEGRATIONS_HEALTH_TOOL_NAME: "check_integrations_health",
  CONSULT_EXPERTS_TOOL_NAME: "consult_experts",
  EBAY_SEARCH_TOOL_NAME: "ebay_search",
  ELAINE_PLANNER_TOOL_CATALOG: [],
  FETCH_PAGE_TOOL_NAME: "fetch_page",
  FIND_NEARBY_PLACES_TOOL_NAME: "find_nearby_places",
  GENERATE_DOCUMENT_TOOL_NAME: "generate_document",
  GET_AIR_QUALITY_TOOL_NAME: "get_air_quality",
  GET_EXCHANGE_RATE_TOOL_NAME: "get_exchange_rate",
  GET_POLLEN_FORECAST_TOOL_NAME: "get_pollen_forecast",
  GET_ROUTE_INFO_TOOL_NAME: "get_route_info",
  GET_WEATHER_TOOL_NAME: "get_weather_forecast",
  LOOKUP_BARCODE_TOOL_NAME: "lookup_product_barcode",
  NAVIGATE_TOOL_NAME: "suggest_navigation",
  QUERY_HOUSEHOLD_TOOL_NAME: "query_household_data",
  REMEMBER_TOOL_NAME: "remember_household_fact",
  SEARCH_FLIGHTS_TOOL_NAME: "search_flights",
  SEARCH_HALLMARK_TOOL_NAME: "search_hallmark",
  SEARCH_HOUSEHOLD_TOOL_NAME: "search_household_data",
  SEARCH_TRIP_DOCUMENTS_TOOL_NAME: "search_trip_documents",
  SET_MODE_TOOL_NAME: "set_action_confirmation_mode",
  SHOW_DATA_CARD_TOOL_NAME: "show_data_card",
  SHOW_DESTINATION_CARD_TOOL_NAME: "show_destination_card",
  SHOW_FABRIC_SWATCH_TOOL_NAME: "show_fabric_swatch",
  SHOW_ORNAMENT_ITEM_TOOL_NAME: "show_ornament_item",
  SHOW_POTTERY_ITEM_TOOL_NAME: "show_pottery_item",
  SHOW_TRIP_CARD_TOOL_NAME: "show_trip_card",
  SOFT_TOOLS: [],
  SOFT_TOOLS_EXTRA: [],
  SUGGEST_CLOTHING_LAYERS_TOOL_NAME: "suggest_clothing_layers",
  TRIP_STATUS_ENUM: ["planning", "active", "completed"],
  WEB_SEARCH_TOOL_NAME: "web_search",
  buildElainePlannerToolCatalog: vi.fn().mockReturnValue([]),
}));

// ── runtime sub-module ────────────────────────────────────────────────────────

vi.mock("./runtime", () => ({
  assertElaineToolFamilyCoverage: vi.fn(),
  aggregateElaineTraceEvaluations: vi.fn().mockReturnValue([]),
  buildElaineSourceRoute: vi.fn().mockReturnValue(""),
  classifyElaineRequest: vi.fn().mockResolvedValue("general"),
  completedActionAcknowledgement: vi.fn().mockReturnValue(""),
  createElaineTurnTrace: vi.fn().mockReturnValue({}),
  createFallbackPlan: vi.fn().mockReturnValue({}),
  decideElaineModelStreamRecovery: vi.fn().mockReturnValue("abort"),
  ELAINE_READ_CONCURRENCY: 3,
  ElaineTurnRuntime: class {
    on() {
      return this;
    }
    run() {
      return Promise.resolve({});
    }
  },
  evaluateForecastDateCoverage: vi.fn().mockResolvedValue({}),
  evaluateElaineTrace: vi.fn().mockResolvedValue({}),
  findElaineSatisfiedFallback: vi.fn().mockReturnValue(null),
  finishElaineTurnTrace: vi.fn().mockResolvedValue(undefined),
  generateElainePlan: vi.fn().mockResolvedValue({}),
  loadElaineTurnTracesForMessages: vi.fn().mockResolvedValue([]),
  mapWithConcurrency: vi.fn().mockResolvedValue([]),
  MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>(),
  MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: {},
  persistElaineTraceBestEffort: vi.fn().mockResolvedValue(undefined),
  preparedActionAcknowledgement: vi.fn().mockReturnValue(""),
  provenanceForTool: vi.fn().mockReturnValue(null),
  requestNeedsStructuredPlan: vi.fn().mockReturnValue(false),
  sanitizeRuntimeText: vi.fn((t: string) => t),
  selectElaineReplanTool: vi.fn().mockReturnValue(null),
  isReusableElaineResponseState: vi.fn().mockReturnValue(false),
  selectElaineOpenAIRole: vi.fn().mockReturnValue("assistant"),
  stripElaineCitationMetadata: vi.fn((t: string) => t),
}));

// ── capability-registry ───────────────────────────────────────────────────────

vi.mock("./capability-registry", () => ({
  buildElaineCapabilityRegistry: vi.fn().mockReturnValue({}),
  buildPlannerCatalogFromCapabilities: vi.fn().mockReturnValue([]),
  ELAINE_TOOL_POLICIES: {},
  NARROW_READ_CHANNEL_JUSTIFICATIONS: {},
}));

// ── app-operation-tools ───────────────────────────────────────────────────────

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

// ── household data ────────────────────────────────────────────────────────────

vi.mock("./household-counts", () => ({
  queryHouseholdData: vi.fn().mockResolvedValue(""),
}));

vi.mock("./household-search", () => ({
  searchHouseholdData: vi.fn().mockResolvedValue([]),
}));

// ── admin-config ──────────────────────────────────────────────────────────────

vi.mock("./admin-config", () => ({
  AdminConfigBody: { parse: vi.fn() },
  applyAdminConfigPatch: vi.fn().mockResolvedValue(undefined),
  resetElaineGlobalConfigToDefaults: vi.fn().mockResolvedValue(undefined),
}));

// ── restricted-channel-config ─────────────────────────────────────────────────

vi.mock("./restricted-channel-config", () => ({
  RESTRICTED_EXCLUDED_ACTION_TYPES: new Set<string>(),
  RESTRICTED_SOFT_TOOL_NAMES: new Set<string>(),
}));

// ── lib/* stubs ───────────────────────────────────────────────────────────────

vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn().mockResolvedValue({ content: "" }),
  callModelWithSubagent: vi.fn().mockResolvedValue({ content: "" }),
  HIDDEN_REASONING: Symbol("hidden"),
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock("../lib/openai-responses", () => ({
  createOpenAIStableIdentifier: vi.fn().mockReturnValue("id"),
  generateOpenAIResponseText: vi.fn().mockResolvedValue(""),
  getOpenAIResponsesMetrics: vi.fn().mockResolvedValue({}),
  isOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  messagesToResponseInput: vi.fn().mockReturnValue([]),
  OpenAIResponsesUnavailableError: class extends Error {},
  recordOpenAIResponsesFallback: vi.fn(),
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue("gpt-4o"),
  streamOpenAIResponseRound: vi.fn(),
}));

vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn().mockResolvedValue({
    enabled: true,
    chatWindowSize: "comfortable",
    actionConfirmationMode: "one_by_one",
  }),
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
  uploadDocument: vi.fn().mockResolvedValue("mock-path"),
  downloadDocument: vi.fn().mockResolvedValue({
    buffer: Buffer.from(""),
    contentType: "application/pdf",
  }),
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
}));

vi.mock("../lib/sms", () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue([]),
  appendCrossChannelEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-memory", () => ({
  correctElaineMemory: vi.fn().mockResolvedValue(undefined),
  forgetElaineMemory: vi.fn().mockResolvedValue(undefined),
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  getRelevantElaineMemory: vi.fn().mockResolvedValue([]),
  rememberElaineMemory: vi.fn().mockResolvedValue(undefined),
  saveElaineMemorySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-tasks", () => ({
  cancelElaineTaskForUser: vi.fn().mockResolvedValue(false),
  getElaineTaskForUser: vi.fn().mockResolvedValue(null),
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/storage-core", () => ({
  ensureBucketWithPolicy: vi.fn().mockResolvedValue(undefined),
  ELAINE_ATTACHMENTS_BUCKET_POLICY: {
    name: "elaine-attachments",
    allowedMimeTypes: [],
  },
}));

vi.mock("../lib/upload-limits", () => ({
  multerLimitForPrefix: vi.fn().mockReturnValue({ fileSize: 5 * 1024 * 1024 }),
}));

vi.mock("../lib/retry", () => ({
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
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

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "" }),
}));

vi.mock("multer", () => {
  const multerInstance = {
    single: vi.fn(
      () => (_req: unknown, _res: unknown, next: () => void) => next(),
    ),
    array: vi.fn(
      () => (_req: unknown, _res: unknown, next: () => void) => next(),
    ),
  };
  const multerFn = vi.fn(() => multerInstance) as unknown as {
    (...args: unknown[]): typeof multerInstance;
    memoryStorage: () => object;
  };
  multerFn.memoryStorage = vi.fn(() => ({}));
  return { default: multerFn };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({
          data: { publicUrl: "https://mock.supabase.co/storage/file.jpg" },
        }),
      })),
    },
  })),
}));

// ============================================================================
// App under test — loaded after all mocks are declared
// ============================================================================

const TEST_USER_ID = 42;
const TRIP_ID = 7;
const ENTRY_ID = 1;

const silentLog = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
};

import type { IRouter } from "express";
let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
    };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("Test app error handler caught:", err);
      res.status(500).json({ error: "Something went wrong." });
    },
  );
  return app;
}

function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {};
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/elaine", elaineRouter);
  return app;
}

const SAMPLE_TRIP_ROW = { id: TRIP_ID };

const SAMPLE_ENTRY = {
  id: ENTRY_ID,
  tripId: TRIP_ID,
  entryDate: "2026-08-01",
  title: "Day one",
  body: "We arrived safely.",
  addedByUserId: TEST_USER_ID,
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  selectQueue.length = 0;
  updateReturning = [];
  deleteReturning = [];
  insertReturning = [];
  vi.clearAllMocks();
  // Restore db mock methods that any test might have replaced.
  dbMock.select = vi.fn(() => makeEagerSelectBuilder(selectQueue));
  dbMock.insert = vi.fn(() => makeInsertBuilder());
  dbMock.update = vi.fn(() => makeUpdateBuilder());
  dbMock.delete = vi.fn(() => makeDeleteBuilder());
});

// ============================================================================
// Tests
// ============================================================================

describe("POST /api/elaine/action — edit_diary_entry", () => {
  it("returns 401 when not authenticated", async () => {
    const app = buildUnauthApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: { tripId: TRIP_ID, entryId: ENTRY_ID, body: "Updated." },
      });
    expect(res.status).toBe(401);
  });

  it("updates the body only and returns the updated entry", async () => {
    // Executor: 1st select = trip existence check
    selectQueue.push([SAMPLE_TRIP_ROW]);
    const updatedEntry = { ...SAMPLE_ENTRY, body: "Updated body text." };
    updateReturning = [updatedEntry];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: {
          tripId: TRIP_ID,
          entryId: ENTRY_ID,
          body: "Updated body text.",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("edit_diary_entry");
    expect(res.body.result.body).toBe("Updated body text.");
    expect(res.body.result.id).toBe(ENTRY_ID);
  });

  it("updates entryDate and title together", async () => {
    selectQueue.push([SAMPLE_TRIP_ROW]);
    const updatedEntry = {
      ...SAMPLE_ENTRY,
      entryDate: "2026-08-05",
      title: "Day five",
    };
    updateReturning = [updatedEntry];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: {
          tripId: TRIP_ID,
          entryId: ENTRY_ID,
          entryDate: "2026-08-05",
          title: "Day five",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("edit_diary_entry");
    expect(res.body.result.entryDate).toBe("2026-08-05");
    expect(res.body.result.title).toBe("Day five");
  });

  it("returns 404 when the diary entry does not exist", async () => {
    selectQueue.push([SAMPLE_TRIP_ROW]);
    // Update returns nothing → executor returns 404
    updateReturning = [];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: { tripId: TRIP_ID, entryId: 999, body: "Nope." },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 when the trip does not exist", async () => {
    // Trip select returns empty → executor returns 404 for trip
    selectQueue.push([]);
    updateReturning = [];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: { tripId: 999, entryId: ENTRY_ID, body: "Nope." },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/trip not found/i);
  });

  it("does not call db.update when payload has no fields to change (Zod refine)", async () => {
    // The EditDiaryEntryActionPayload .refine() rejects a payload with no
    // update fields — ActionBody.parse() throws and no update runs.
    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: { tripId: TRIP_ID, entryId: ENTRY_ID },
      });

    // Zod throws before the executor runs → non-200 response
    expect(res.status).not.toBe(200);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("body-only edit preserves the existing title (title not included in DB set call)", async () => {
    // Arrange: trip exists, and the DB returns the entry with the original title intact.
    selectQueue.push([SAMPLE_TRIP_ROW]);
    const entryWithTitleAndBody = {
      ...SAMPLE_ENTRY,
      title: "Original Title",
      body: "New body content only.",
    };
    updateReturning = [entryWithTitleAndBody];

    // Spy on the set() call to verify title was NOT written.
    let capturedSetArg: Record<string, unknown> | undefined;
    const originalUpdate = dbMock.update;
    dbMock.update = vi.fn(() => {
      const builder = {
        set(arg: Record<string, unknown>) {
          capturedSetArg = arg;
          return builder;
        },
        where() {
          return builder;
        },
        returning() {
          return Promise.resolve(updateReturning);
        },
      };
      return builder;
    });

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "edit_diary_entry",
        payload: {
          tripId: TRIP_ID,
          entryId: ENTRY_ID,
          body: "New body content only.",
          // title is intentionally omitted
        },
      });

    // 1. The response must succeed and echo the original title.
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("edit_diary_entry");
    expect(res.body.result.title).toBe("Original Title");
    expect(res.body.result.body).toBe("New body content only.");

    // 2. The executor must NOT have included title in the Drizzle set() call,
    //    which would silently overwrite the stored value.
    expect(capturedSetArg).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(capturedSetArg, "title")).toBe(
      false,
    );

    // Restore
    dbMock.update = originalUpdate;
  });
});

// ============================================================================
// delete_diary_entry
// ============================================================================

describe("POST /api/elaine/action — delete_diary_entry", () => {
  it("returns 401 when not authenticated", async () => {
    const app = buildUnauthApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: TRIP_ID, entryId: ENTRY_ID },
      });
    expect(res.status).toBe(401);
  });

  it("deletes an existing entry and returns its id", async () => {
    // Executor: 1st select = trip existence check
    selectQueue.push([SAMPLE_TRIP_ROW]);
    // delete.where().returning() → the deleted row id
    deleteReturning = [{ id: ENTRY_ID }];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: TRIP_ID, entryId: ENTRY_ID },
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("delete_diary_entry");
    expect(res.body.result.id).toBe(ENTRY_ID);
  });

  it("returns 404 when the diary entry does not exist", async () => {
    // Trip found but delete returns nothing → entry not found
    selectQueue.push([SAMPLE_TRIP_ROW]);
    deleteReturning = [];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: TRIP_ID, entryId: 999 },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/diary entry not found/i);
  });

  it("returns 404 when the trip does not exist", async () => {
    // Trip select returns empty → executor short-circuits before the delete
    selectQueue.push([]);
    deleteReturning = [];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: 999, entryId: ENTRY_ID },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/trip not found/i);
    // db.delete must never be called when the trip lookup fails
    expect(dbMock.delete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// add_diary_entry
// ============================================================================

describe("POST /api/elaine/action — add_diary_entry", () => {
  it("returns 401 when not authenticated", async () => {
    const app = buildUnauthApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: {
          tripId: TRIP_ID,
          entryDate: "2026-08-01",
          body: "Arrived safely.",
        },
      });
    expect(res.status).toBe(401);
  });

  it("creates the entry and returns 201 with the new row", async () => {
    // Executor: 1st select = trip existence check
    selectQueue.push([SAMPLE_TRIP_ROW]);
    const newEntry = {
      ...SAMPLE_ENTRY,
      id: 99,
      body: "Arrived safely.",
      title: null,
    };
    insertReturning = [newEntry];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: {
          tripId: TRIP_ID,
          entryDate: "2026-08-01",
          body: "Arrived safely.",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("add_diary_entry");
    expect(res.body.result.id).toBe(99);
    expect(res.body.result.body).toBe("Arrived safely.");
    expect(dbMock.insert).toHaveBeenCalledOnce();
  });

  it("creates the entry with an optional title when provided", async () => {
    selectQueue.push([SAMPLE_TRIP_ROW]);
    const newEntry = {
      ...SAMPLE_ENTRY,
      id: 100,
      title: "Day One",
      body: "We landed.",
    };
    insertReturning = [newEntry];

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: {
          tripId: TRIP_ID,
          entryDate: "2026-08-01",
          title: "Day One",
          body: "We landed.",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("add_diary_entry");
    expect(res.body.result.title).toBe("Day One");
    expect(res.body.result.body).toBe("We landed.");
  });

  it("returns 404 when the trip does not exist", async () => {
    // Trip select returns empty → executor short-circuits before the insert
    selectQueue.push([]);

    const app = buildApp();
    const res = await request(app)
      .post("/api/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: {
          tripId: 999,
          entryDate: "2026-08-01",
          body: "Should not persist.",
        },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/trip not found/i);
    // db.insert must never be called when the trip lookup fails
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
