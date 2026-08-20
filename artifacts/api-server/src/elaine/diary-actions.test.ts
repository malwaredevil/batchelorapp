/**
 * Tests for the add_diary_entry and delete_diary_entry action executors,
 * ActionBody discriminated union validation, and buildAgentphoneContext
 * diary-entry inclusion.
 *
 * Executor tests drive the POST /elaine/action route via supertest so the
 * full parse → executor → response cycle is exercised without mocking the
 * internals of index.ts.  buildAgentphoneContext is exported and called
 * directly with a controlled db mock so diary-entry lines can be asserted
 * without standing up the entire restricted-turn engine.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import type { IRouter } from "express";
import {
  sentryMockFactory,
  rateLimitMockFactory,
} from "./test-helpers/standard-mock-scaffold";

// ---------------------------------------------------------------------------
// Hoisted shared state — must exist before vi.mock factories run.
// ---------------------------------------------------------------------------
const { selectQueue, insertReturning, deleteReturning, dbMock } = vi.hoisted(
  () => {
    const selectQueue: unknown[][] = [];
    /** Rows returned from the next insert().values().returning() call. */
    const insertReturning: { value: unknown[] } = { value: [] };
    /** Rows returned from the next delete().where().returning() call. */
    const deleteReturning: { value: unknown[] } = { value: [] };

    /**
     * Builds a Drizzle-style select query builder that consumes one slot from
     * selectQueue when db.select() is called (eager shift), then resolves that
     * slot from whichever terminal method the route code reaches.
     *
     * Handles every chain style used in index.ts:
     *   .from().where()                          → thenable
     *   .from().where().limit(n)                 → Promise
     *   .from().where().orderBy().limit(n)       → Promise
     *   .from().orderBy().limit(n)               → Promise
     *   .from().innerJoin().where()              → thenable
     */
    function makeQueryBuilder() {
      const result: unknown[] = selectQueue.shift() ?? [];
      const promise = Promise.resolve(result);

      const thenable = {
        then<T, U = never>(
          onfulfilled?: ((v: unknown[]) => T | PromiseLike<T>) | null,
          onrejected?: ((r: unknown) => U | PromiseLike<U>) | null,
        ): Promise<T | U> {
          return promise.then(onfulfilled, onrejected) as Promise<T | U>;
        },
      };

      const afterOrderBy = {
        limit: (_n: number) => promise,
        then: thenable.then,
      };

      const afterWhere = {
        orderBy: (..._args: unknown[]) => afterOrderBy,
        limit: (_n: number) => promise,
        then: thenable.then,
      };

      const afterInnerJoin = {
        where: (_cond: unknown) => afterWhere,
        then: thenable.then,
      };

      const afterFrom = {
        where: (_cond: unknown) => afterWhere,
        orderBy: (..._args: unknown[]) => afterOrderBy,
        innerJoin: (_t: unknown, _on: unknown) => afterInnerJoin,
        then: thenable.then,
      };

      return { from: (_table: unknown) => afterFrom };
    }

    const dbMock = {
      select: vi.fn(() => makeQueryBuilder()),
      insert: vi.fn(() => ({
        values: (_v: unknown) => ({
          returning: () => Promise.resolve(insertReturning.value),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      })),
      update: vi.fn(() => ({
        set: () => ({ where: () => Promise.resolve([]) }),
      })),
      delete: vi.fn(() => ({
        where: () => ({
          returning: () => Promise.resolve(deleteReturning.value),
        }),
      })),
    };

    return { selectQueue, insertReturning, deleteReturning, dbMock };
  },
);

// ---------------------------------------------------------------------------
// Module mocks — same set as messenger-model-routing.test.ts
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

vi.mock("../middleware/auth", () => ({
  requireAuth: (
    req: { session: { userId?: number } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    next();
  },
}));

vi.mock("@sentry/node", () => sentryMockFactory());

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "ok", tool_calls: [] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
  callModelWithSubagent: vi.fn().mockResolvedValue({ content: "" }),
  HIDDEN_REASONING: {},
}));

vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn().mockResolvedValue({
    chatModel: "fast-model",
    models: { restrictedTextModel: "smart-model" },
    isEnabled: true,
    actionConfirmationMode: "auto_run",
  }),
  updateElaineGlobalConfig: vi.fn(),
  // ElaineTurnRuntime (loaded via the real, unmocked "./runtime" module in
  // this file) falls back to this constant when no `budget` override is
  // passed — must stay in the mock or the module import throws "No
  // DEFAULT_RUNTIME_BUDGET export is defined".
  DEFAULT_RUNTIME_BUDGET: {
    maxModelRounds: 8,
    maxToolCalls: 24,
    maxReplans: 10,
    maxElapsedMs: 240_000,
  },
}));

vi.mock("../lib/openai-responses", () => ({
  isOpenAIResponsesConfigured: vi.fn().mockReturnValue(false),
  recordOpenAIResponsesFallback: vi.fn(),
  createOpenAIStableIdentifier: vi.fn().mockReturnValue("id-stub"),
  generateOpenAIResponseText: vi.fn().mockResolvedValue(""),
  getOpenAIResponsesMetrics: vi.fn().mockReturnValue({}),
  isRecoverableOpenAIStateError: vi.fn().mockReturnValue(false),
  messagesToResponseInput: vi.fn().mockReturnValue([]),
  OpenAIResponsesUnavailableError: class extends Error {
    category = "config_missing";
  },
  resolveOpenAIResponsesModel: vi.fn().mockReturnValue(""),
  streamOpenAIResponseRound: vi.fn(),
  runRestrictedTurnViaOpenAIResponses: vi.fn(),
}));

vi.mock("../lib/app-config", () => ({
  getAllConfig: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  getConfigRow: vi.fn().mockResolvedValue(null),
  updateConfigValue: vi.fn().mockResolvedValue(undefined),
  APP_CONFIG_DEFAULTS: [],
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue([]),
  openaiClient: { chat: { completions: { create: vi.fn() } } },
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

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/travels/storage", () => ({
  deleteTripPhoto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/travels-storage", () => ({
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/soft-delete", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
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
  generateItineraryForTrip: vi.fn().mockResolvedValue(undefined),
  ItineraryActionError: class extends Error {},
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
  removeWishlistItemExecutor: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../lib/elaine-memory", () => ({
  getElaineMemorySummary: vi.fn().mockResolvedValue(null),
  getRelevantElaineMemory: vi.fn().mockResolvedValue({ evidenceBlock: "" }),
  rememberElaineMemory: vi.fn().mockResolvedValue(undefined),
  forgetElaineMemory: vi.fn().mockResolvedValue(undefined),
  correctElaineMemory: vi.fn().mockResolvedValue(undefined),
  saveElaineMemorySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/elaine-cross-channel", () => ({
  loadCrossChannelContext: vi.fn().mockResolvedValue(""),
  appendCrossChannelEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/env", () => ({
  env: {
    isProduction: false,
    sessionSecret: "test-session",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
  },
}));

vi.mock("../lib/elaine-tasks", () => ({
  listElaineTasksForUser: vi.fn().mockResolvedValue([]),
  getElaineTaskForUser: vi.fn().mockResolvedValue(null),
  cancelElaineTaskForUser: vi.fn().mockResolvedValue(false),
}));

vi.mock("../lib/document-parsing", () => ({
  extractDocumentText: vi.fn().mockResolvedValue(""),
  docTypeTagForMime: vi.fn().mockReturnValue("document"),
}));

vi.mock("../lib/document-generation", () => ({
  buildDocumentBuffer: vi.fn().mockResolvedValue(Buffer.from("")),
  DOCUMENT_MIME_BY_FORMAT: {},
  DOCUMENT_EXTENSION_BY_FORMAT: {},
}));

vi.mock("../lib/storage-core", () => ({
  ensureBucketWithPolicy: vi.fn().mockResolvedValue(undefined),
  ELAINE_ATTACHMENTS_BUCKET_POLICY: {},
  buildStorageAdapter: vi.fn(() => ({
    uploadImage: vi.fn().mockResolvedValue("mock/path.jpg"),
    downloadImage: vi.fn().mockResolvedValue({
      buffer: Buffer.from(""),
      contentType: "image/jpeg",
    }),
    deleteImage: vi.fn().mockResolvedValue(undefined),
  })),
  IMAGE_ONLY_POLICY: {},
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      })),
    },
  })),
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "" }),
}));

vi.mock("multer", () => {
  const m = vi.fn(() => ({ single: vi.fn(() => vi.fn()) })) as unknown as {
    (): { single: () => () => void };
    memoryStorage: () => object;
  };
  (m as unknown as { memoryStorage: () => object }).memoryStorage = vi.fn(
    () => ({}),
  );
  return { default: m };
});

// ---------------------------------------------------------------------------
// Module under test — imported AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------

import type { buildAgentphoneContext as BuildAgentphoneContextFn } from "./index";

const TEST_USER_ID = 99;

let elaineRouter: IRouter;
let buildAgentphoneContext: typeof BuildAgentphoneContextFn;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
  buildAgentphoneContext = mod.buildAgentphoneContext;
}, 30_000);

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

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
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
    };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/elaine", elaineRouter);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (
        err &&
        typeof err === "object" &&
        Array.isArray((err as { issues?: unknown }).issues)
      ) {
        res.status(400).json({ error: "Invalid request." });
        return;
      }
      res.status(500).json({ error: "Something went wrong." });
    },
  );
  return app;
}

// ---------------------------------------------------------------------------
// Reset shared state before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  selectQueue.length = 0;
  insertReturning.value = [];
  deleteReturning.value = [];
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// add_diary_entry executor
// ---------------------------------------------------------------------------

describe("add_diary_entry executor (POST /elaine/action)", () => {
  it("inserts a diary entry and returns 201 with the new row when the trip exists", async () => {
    // Trip lookup → found
    selectQueue.push([{ id: 5 }]);
    // insert().values().returning() → the new row
    const newRow = {
      id: 42,
      tripId: 5,
      entryDate: "2026-08-05",
      title: "Arrived in Paris",
      body: "What a gorgeous city.",
      addedByUserId: TEST_USER_ID,
    };
    insertReturning.value = [newRow];

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: {
          tripId: 5,
          entryDate: "2026-08-05",
          title: "Arrived in Paris",
          body: "What a gorgeous city.",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("add_diary_entry");
    expect(res.body.result).toMatchObject({
      id: 42,
      tripId: 5,
      entryDate: "2026-08-05",
      title: "Arrived in Paris",
    });

    // Confirm insert was called
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  it("returns 201 when title is omitted (title is optional)", async () => {
    selectQueue.push([{ id: 7 }]);
    insertReturning.value = [
      {
        id: 43,
        tripId: 7,
        entryDate: "2026-08-06",
        title: null,
        body: "Rainy day.",
      },
    ];

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: { tripId: 7, entryDate: "2026-08-06", body: "Rainy day." },
      });

    expect(res.status).toBe(201);
    expect(res.body.result.title).toBeNull();
  });

  it("returns 404 when the trip does not exist", async () => {
    // Trip lookup → not found
    selectQueue.push([]);

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: {
          tripId: 999,
          entryDate: "2026-08-05",
          body: "Phantom trip.",
        },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/trip not found/i);
    // insert must NOT have been called
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("returns 400 when body field is missing (required by schema)", async () => {
    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: { tripId: 5, entryDate: "2026-08-05" /* body missing */ },
      });

    expect(res.status).toBe(400);
  });

  it("returns 400 when tripId is missing", async () => {
    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: { entryDate: "2026-08-05", body: "Missing tripId." },
      });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// delete_diary_entry executor
// ---------------------------------------------------------------------------

describe("delete_diary_entry executor (POST /elaine/action)", () => {
  it("deletes the entry and returns 200 with the deleted id when both trip and entry exist", async () => {
    // Trip lookup → found
    selectQueue.push([{ id: 5 }]);
    // delete().where().returning() → the deleted row
    deleteReturning.value = [{ id: 42 }];

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: 5, entryId: 42 },
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("delete_diary_entry");
    expect(res.body.result).toEqual({ id: 42 });

    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the trip does not exist", async () => {
    selectQueue.push([]);

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: 999, entryId: 1 },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/trip not found/i);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("returns 404 when the diary entry does not belong to the trip (delete returns empty)", async () => {
    // Trip found but delete finds no matching row (wrong tripId/entryId pair)
    selectQueue.push([{ id: 5 }]);
    deleteReturning.value = []; // nothing deleted

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: 5, entryId: 9999 },
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/diary entry not found/i);
  });

  it("returns 400 when entryId is missing", async () => {
    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: 5 /* entryId missing */ },
      });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ActionBody discriminated union — add / delete diary payloads
// ---------------------------------------------------------------------------

describe("ActionBody discriminated union validation via /action route", () => {
  it("accepts a fully valid add_diary_entry payload", async () => {
    selectQueue.push([{ id: 1 }]);
    insertReturning.value = [
      {
        id: 1,
        tripId: 1,
        entryDate: "2026-08-01",
        title: null,
        body: "Hello.",
      },
    ];

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: { tripId: 1, entryDate: "2026-08-01", body: "Hello." },
      });

    // Schema accepted — executor ran (trip lookup happened)
    expect(res.status).not.toBe(400);
  });

  it("accepts a fully valid delete_diary_entry payload", async () => {
    selectQueue.push([{ id: 1 }]);
    deleteReturning.value = [{ id: 7 }];

    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "delete_diary_entry",
        payload: { tripId: 1, entryId: 7 },
      });

    expect(res.status).not.toBe(400);
  });

  it("rejects add_diary_entry with an empty body string (minLength 1)", async () => {
    const res = await request(buildApp())
      .post("/elaine/action")
      .send({
        type: "add_diary_entry",
        payload: { tripId: 1, entryDate: "2026-08-01", body: "" },
      });

    expect(res.status).toBe(400);
  });

  it("rejects a completely unknown action type", async () => {
    const res = await request(buildApp())
      .post("/elaine/action")
      .send({ type: "explode_everything", payload: {} });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// buildAgentphoneContext — diary entry lines
// ---------------------------------------------------------------------------

describe("buildAgentphoneContext", () => {
  /**
   * buildAgentphoneContext makes four sequential awaited db.select() calls:
   *  [0] travelsTrips       — trips
   *  [1] travelsPackingItems innerJoin — packing rows
   *  [2] travelsReminders   — open reminders
   *  [3] travelsDiaryEntries — diary entries
   */

  it("includes diary entry lines when entries exist for a trip", async () => {
    // [0] trips
    selectQueue.push([
      {
        id: 1,
        title: "Paris Summer",
        destination: "Paris",
        status: "active",
        startDate: "2026-08-01",
        endDate: "2026-08-10",
      },
    ]);
    // [1] packing rows
    selectQueue.push([]);
    // [2] reminders
    selectQueue.push([]);
    // [3] diary entries
    selectQueue.push([
      {
        id: 42,
        tripId: 1,
        entryDate: "2026-08-05",
        title: "Eiffel Tower",
        body: "Visited the Eiffel Tower today.",
      },
      {
        id: 43,
        tripId: 1,
        entryDate: "2026-08-06",
        title: null,
        body: "Quiet museum day.",
      },
    ]);

    const context = await buildAgentphoneContext();

    expect(context).toContain("Diary entries:");
    expect(context).toContain("entryId: 42");
    expect(context).toContain("Eiffel Tower");
    expect(context).toContain("Visited the Eiffel Tower today.");
    expect(context).toContain("entryId: 43");
    expect(context).toContain("Quiet museum day.");
    // Should NOT say "No diary entries yet."
    expect(context).not.toContain("No diary entries yet.");
  });

  it('includes "No diary entries yet." when no entries exist', async () => {
    // [0] trips
    selectQueue.push([
      {
        id: 2,
        title: null,
        destination: "Tokyo",
        status: "wishlist",
        startDate: null,
        endDate: null,
      },
    ]);
    // [1] packing
    selectQueue.push([]);
    // [2] reminders
    selectQueue.push([]);
    // [3] diary — empty
    selectQueue.push([]);

    const context = await buildAgentphoneContext();

    expect(context).toContain("No diary entries yet.");
    expect(context).not.toContain("Diary entries:");
  });

  it("includes the trip's destination as fallback label when title is null", async () => {
    selectQueue.push([
      {
        id: 3,
        title: null,
        destination: "Rome",
        status: "active",
        startDate: "2026-09-01",
        endDate: null,
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([
      {
        id: 50,
        tripId: 3,
        entryDate: "2026-09-02",
        title: null,
        body: "Saw the Colosseum.",
      },
    ]);

    const context = await buildAgentphoneContext();

    expect(context).toContain("Diary entries:");
    // Trip label should fall back to destination "Rome" when title is null
    expect(context).toContain("Rome");
    expect(context).toContain("entryId: 50");
  });

  it("truncates long diary bodies to 200 characters with an ellipsis", async () => {
    const longBody = "A".repeat(300);
    selectQueue.push([
      {
        id: 4,
        title: "Long Entry Trip",
        destination: "Berlin",
        status: "active",
        startDate: null,
        endDate: null,
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([
      {
        id: 60,
        tripId: 4,
        entryDate: "2026-10-01",
        title: null,
        body: longBody,
      },
    ]);

    const context = await buildAgentphoneContext();

    expect(context).toContain("…");
    // The full 300-char body should not appear verbatim
    expect(context).not.toContain(longBody);
  });
});
