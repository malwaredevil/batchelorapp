/**
 * Tests for the update_app_config Elaine action:
 *
 *  1. POST /api/elaine/action { type: "update_app_config" } is rejected with 403
 *     when the calling user is not the app owner.
 *  2. POST /api/elaine/action { type: "update_app_config" } returns 200 with the
 *     updated config row when called by the app owner.
 *  3. "update_app_config" must NOT appear in AGENTPHONE_ACTION_TYPES — it is
 *     in RESTRICTED_EXCLUDED_ACTION_TYPES and must stay excluded from the
 *     SMS/voice/email channel so a phone-matched user can never mutate
 *     app-wide AI tuning constants.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  makeEagerSelectBuilder,
  makeInsertBuilder,
  makeSimpleUpdateBuilder,
  makeDeleteBuilder,
} from "../test-helpers/db-mock";

// ── DB mock ──────────────────────────────────────────────────────────────────
// selectQueue drives sequential .where() / .limit() calls in order.

const selectQueue: unknown[][] = [];

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn(() => makeInsertBuilder()),
  update: vi.fn(() => makeSimpleUpdateBuilder()),
  delete: vi.fn(() => makeDeleteBuilder()),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

// ── App-config mock ───────────────────────────────────────────────────────────
// updateConfigValue is what the action executor calls after the isOwner check.

let _updateConfigValueReturn: unknown = null;

vi.mock("../lib/app-config", () => ({
  updateConfigValue: vi.fn(async () => _updateConfigValueReturn),
  getAllConfig: vi.fn(async () => []),
  getConfig: vi.fn(async (_m: string, _k: string, dv: unknown) => dv),
  getConfigRow: vi.fn(async () => null),
  invalidateConfigCache: vi.fn(),
  validateConfigValue: vi.fn(() => null),
  APP_CONFIG_DEFAULTS: [
    {
      module: "travels",
      key: "itinerary_gen_max_tokens",
      value: "4000",
      type: "integer",
      label: "Itinerary generation AI max tokens",
    },
  ],
}));

// ── Auth middleware ───────────────────────────────────────────────────────────

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

// ── Rate limiters ─────────────────────────────────────────────────────────────

vi.mock("../middleware/rateLimit", () => ({
  phoneVerifyLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Logger ────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// ── AI / external service stubs ───────────────────────────────────────────────

vi.mock("../lib/ai-client", () => ({
  callModel: vi.fn(),
  callModelWithSubagent: vi.fn(),
}));

vi.mock("../lib/openai", () => ({
  embedText: vi.fn(),
}));

vi.mock("../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn(async () => ({
    chatModel: "test-model",
    subagentModel: "test-model",
    requestTimeoutMs: 10_000,
    maxResponseTokens: 1_000,
  })),
  invalidateElaineGlobalConfigCache: vi.fn(),
}));

vi.mock("../lib/openrouter-models", () => ({
  listOpenRouterModels: vi.fn(async () => []),
}));

vi.mock("../lib/travels/storage", () => ({
  deleteTripPhoto: vi.fn(),
}));

vi.mock("../lib/travels-storage", () => ({
  deleteDocument: vi.fn(),
}));

vi.mock("../lib/google-calendar-tokens", () => ({
  getValidAccessToken: vi.fn(),
}));

vi.mock("../routes/travels/documents", () => ({
  rescanTripDocument: vi.fn(),
}));

vi.mock("../routes/travels/reminders", () => ({
  getReminderSyncTarget: vi.fn(),
  syncReminderCalendarEvents: vi.fn(),
  deleteAllReminderCalendarEvents: vi.fn(),
}));

vi.mock("../routes/travels/ai", () => ({
  generateItineraryForTrip: vi.fn(),
  ItineraryActionError: class ItineraryActionError extends Error {},
}));

vi.mock("../lib/email", () => ({
  sendAssistantEmail: vi.fn(),
  sendTestEmail: vi.fn(),
  resendConfigured: vi.fn(() => false),
}));

vi.mock("../lib/sms", () => ({
  sendSms: vi.fn(),
  SmsRegistrationPendingError: class extends Error {},
  SmsOptedOutError: class extends Error {},
}));

vi.mock("../lib/web-search", () => ({
  webSearch: vi.fn(),
}));

vi.mock("../lib/expert-consult", () => ({
  consultExperts: vi.fn(),
}));

vi.mock("../lib/travels/google-maps", () => ({
  getWeatherForecast: vi.fn(),
  getAirQuality: vi.fn(),
  getPollenForecast: vi.fn(),
  searchPlaces: vi.fn(),
  computeRoute: vi.fn(),
}));

// ── Sub-action modules (empty schemas/executors so ActionBody still parses) ──

vi.mock("./pottery-actions", () => ({
  potteryActionSchemas: [],
  potteryActionExecutors: {},
  buildPotteryActionLabel: vi.fn(async () => "pottery action"),
  potteryActionTools: [],
}));

vi.mock("./quilting-actions", () => ({
  quiltingActionSchemas: [],
  quiltingActionExecutors: {},
  buildQuiltingActionLabel: vi.fn(async () => "quilting action"),
  quiltingActionTools: [],
}));

vi.mock("./ornaments-actions", () => ({
  ornamentActionSchemas: [],
  ornamentActionExecutors: {},
  buildOrnamentActionLabel: vi.fn(async () => "ornament action"),
  ornamentActionTools: [],
}));

// ── Remaining deps that touch the FS or network ───────────────────────────────

vi.mock("multer", () => {
  const m = () => ({
    single: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    array: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  });
  m.memoryStorage = () => ({});
  return { default: m };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        remove: vi.fn(),
        createSignedUrl: vi.fn(),
      })),
    },
  })),
}));

vi.mock("../lib/env", () => ({
  env: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    DEV_SCREENSHOT_TOKEN: "test-screenshot-token",
    SESSION_SECRET: "test-secret",
    NODE_ENV: "test",
    RESEND_FROM_EMAIL: "test@example.com",
    AGENTPHONE_WEBHOOK_SECRET: "test-webhook-secret",
    RESEND_WEBHOOK_SECRET_DEV: "test-resend-secret",
    RESEND_WEBHOOK_SECRET_PROD: "test-resend-secret-prod",
  },
}));

vi.mock("../lib/retry", () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn(async () => ({ text: "" })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER_USER_ID = 1;
const NON_OWNER_USER_ID = 2;

// Pre-warmed in beforeAll so the first dynamic import completes before any
// test's per-test timeout starts ticking. Without this, the module load
// itself exhausts the default 5 s per-test timeout before the assertion runs.
import type { IRouter } from "express";
let elaineRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./index");
  elaineRouter = mod.default;
}, 30_000);

function buildApp(userId: number): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = { userId };
    next();
  });
  app.use("/elaine", elaineRouter);
  app.use(
    (
      err: unknown,
      _req: unknown,
      res: { status: (n: number) => { json: (b: unknown) => void } },
      _next: unknown,
    ) => {
      const message =
        err instanceof Error ? err.message : "Internal Server Error";
      res.status(500).json({ error: message });
    },
  );
  return app;
}

const VALID_PAYLOAD = {
  type: "update_app_config",
  payload: {
    module: "travels",
    key: "itinerary_gen_max_tokens",
    value: "5000",
  },
};

const UPDATED_ROW = {
  id: 42,
  module: "travels",
  key: "itinerary_gen_max_tokens",
  value: "5000",
  type: "integer",
  label: "Itinerary generation AI max tokens",
  description: null,
  updatedAt: new Date().toISOString(),
};

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  selectQueue.length = 0;
  _updateConfigValueReturn = null;
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /elaine/action — update_app_config", () => {
  it("returns 403 when the calling user is not the app owner", async () => {
    // isOwner check: user does not have owner rights
    selectQueue.push([{ isOwner: false }]);

    const app = await buildApp(NON_OWNER_USER_ID);
    const res = await request(app).post("/elaine/action").send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin access required|owner/i);
  });

  it("returns 403 when isOwner is null (unset)", async () => {
    // isOwner column is nullable — treat null as non-owner
    selectQueue.push([{ isOwner: null }]);

    const app = await buildApp(NON_OWNER_USER_ID);
    const res = await request(app).post("/elaine/action").send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it("returns 200 and the updated row when the owner calls with a valid payload", async () => {
    // isOwner check passes
    selectQueue.push([{ isOwner: true }]);
    _updateConfigValueReturn = UPDATED_ROW;

    const app = await buildApp(OWNER_USER_ID);
    const res = await request(app).post("/elaine/action").send(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("update_app_config");
    expect(res.body.result).toMatchObject({
      module: "travels",
      key: "itinerary_gen_max_tokens",
      value: "5000",
    });
  });

  it("calls updateConfigValue with the exact module, key, and value from the payload", async () => {
    selectQueue.push([{ isOwner: true }]);
    _updateConfigValueReturn = UPDATED_ROW;

    const app = await buildApp(OWNER_USER_ID);
    await request(app).post("/elaine/action").send(VALID_PAYLOAD);

    const { updateConfigValue } = await import("../lib/app-config");
    expect(updateConfigValue).toHaveBeenCalledWith(
      "travels",
      "itinerary_gen_max_tokens",
      "5000",
    );
  });

  it("returns 400 when the module+key is not in APP_CONFIG_DEFAULTS (schema guard)", async () => {
    selectQueue.push([{ isOwner: true }]);

    const app = await buildApp(OWNER_USER_ID);
    const res = await request(app)
      .post("/elaine/action")
      .send({
        type: "update_app_config",
        payload: {
          module: "travels",
          key: "nonexistent_key",
          value: "999",
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a recognised control panel setting/i);
  });

  it("returns 404 when the key is in the schema but updateConfigValue returns null (missing DB row)", async () => {
    selectQueue.push([{ isOwner: true }]);
    _updateConfigValueReturn = null;

    const app = await buildApp(OWNER_USER_ID);
    const res = await request(app).post("/elaine/action").send(VALID_PAYLOAD);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe("AGENTPHONE_ACTION_TYPES — update_app_config exclusion", () => {
  it("does not include update_app_config in the AgentPhone allowlist", async () => {
    const { AGENTPHONE_ACTION_TYPES } = await import("./index");
    expect(AGENTPHONE_ACTION_TYPES.has("update_app_config")).toBe(false);
  });
});
