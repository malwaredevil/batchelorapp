import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const { updateCalls, makeUpdateBuilder, makeDeleteBuilder } =
  createTrackedMutationBuilders();

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
  delete: vi.fn((table: unknown) => makeDeleteBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

const getValidAccessToken = vi.fn<(userId: number) => Promise<string | null>>();
vi.mock("../../lib/google-calendar-tokens", () => ({
  getValidAccessToken: (userId: number) => getValidAccessToken(userId),
}));

vi.mock("../../lib/google-calendar-oauth", () => ({
  googleCalendarOAuthEnabled: () => false,
  createGoogleCalendarClient: () => ({
    generateAuthUrl: () => "https://accounts.google.com/mock",
  }),
  GOOGLE_CALENDAR_SCOPES: ["https://www.googleapis.com/auth/calendar"],
}));

vi.mock("../../middleware/auth", () => ({
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
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const TEST_USER_ID = 7;

import type { IRouter } from "express";
let gcalRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./google-calendar");
  gcalRouter = mod.default;
}, 30_000);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
    };
    next();
  });
  app.use("/api/travels", gcalRouter);
  return app;
}

beforeEach(() => {
  selectQueue.length = 0;
  updateCalls.length = 0;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/travels/google-calendar/status
// ---------------------------------------------------------------------------

describe("GET /api/travels/google-calendar/status", () => {
  it("returns connected:false when the user has no connection row", async () => {
    // db.select() returns no connection rows
    selectQueue.push([]);
    const app = buildApp();

    const res = await request(app).get(
      "/api/travels/google-calendar/status",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, googleEmail: null });
    // getValidAccessToken should not be called — there's nothing to check
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  it("returns connected:true with no tokenExpired field when the access token is valid", async () => {
    selectQueue.push([
      {
        userId: TEST_USER_ID,
        googleEmail: "user@example.com",
        refreshToken: "enc-refresh",
        accessToken: "enc-access",
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        needsReauth: false,
      },
    ]);
    getValidAccessToken.mockResolvedValue("live-access-token");
    const app = buildApp();

    const res = await request(app).get(
      "/api/travels/google-calendar/status",
    );

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.googleEmail).toBe("user@example.com");
    // tokenExpired should be absent (undefined serialises to omitted key)
    expect(res.body.tokenExpired).toBeUndefined();
    expect(getValidAccessToken).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it("returns tokenExpired:true when getValidAccessToken returns null", async () => {
    selectQueue.push([
      {
        userId: TEST_USER_ID,
        googleEmail: "user@example.com",
        refreshToken: "enc-refresh",
        accessToken: null,
        accessTokenExpiresAt: null,
        needsReauth: true,
      },
    ]);
    // Simulate a revoked token: the lib returns null
    getValidAccessToken.mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).get(
      "/api/travels/google-calendar/status",
    );

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.googleEmail).toBe("user@example.com");
    expect(res.body.tokenExpired).toBe(true);
  });

  it("still reports tokenExpired:true even if the connection row has needsReauth:false but the refresh fails", async () => {
    // The row might have needsReauth:false from a previous successful refresh,
    // but getValidAccessToken just failed (transient error or race).
    selectQueue.push([
      {
        userId: TEST_USER_ID,
        googleEmail: "other@example.com",
        refreshToken: "enc-refresh",
        accessToken: "stale",
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        needsReauth: false,
      },
    ]);
    getValidAccessToken.mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).get(
      "/api/travels/google-calendar/status",
    );

    expect(res.status).toBe(200);
    expect(res.body.tokenExpired).toBe(true);
  });

  it("returns 401 when the session has no userId", async () => {
    const app = express();
    app.use(express.json());
    // No session middleware — session.userId is undefined
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {};
      next();
    });
    app.use("/api/travels", gcalRouter);

    const res = await request(app).get(
      "/api/travels/google-calendar/status",
    );

    expect(res.status).toBe(401);
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });
});
