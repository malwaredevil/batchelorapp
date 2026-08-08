import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const {
  insertCalls,
  updateCalls,
  lastReturning,
  makeInsertBuilder,
  makeUpdateBuilder,
  makeDeleteBuilder,
} = createTrackedMutationBuilders();

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn((table: unknown) => makeInsertBuilder(table)),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
  delete: vi.fn((table: unknown) => makeDeleteBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../../lib/travels/db-helpers", () => ({
  tripExists: vi.fn().mockResolvedValue(true),
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

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 42;
const TRIP_ID = 7;

const silentLog = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
};

import type { IRouter } from "express";
let diaryRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./diary");
  diaryRouter = mod.default;
}, 30_000);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser("test-session-secret"));
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
    };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/travels", diaryRouter);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: "Something went wrong." });
    },
  );
  return app;
}

function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser("test-session-secret"));
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {};
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/travels", diaryRouter);
  return app;
}

const SAMPLE_ENTRY = {
  id: 1,
  tripId: TRIP_ID,
  entryDate: "2026-08-01",
  title: "Day one",
  body: "We arrived safely.",
  addedByUserId: TEST_USER_ID,
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  selectQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  lastReturning.value = [];
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/travels/trips/:tripId/diary
// ---------------------------------------------------------------------------

describe("GET /api/travels/trips/:tripId/diary", () => {
  it("returns 401 without a session", async () => {
    const app = buildUnauthApp();
    const res = await request(app).get(`/api/travels/trips/${TRIP_ID}/diary`);
    expect(res.status).toBe(401);
  });

  it("returns an empty array when there are no entries", async () => {
    selectQueue.push([]);
    const app = buildApp();
    const res = await request(app).get(`/api/travels/trips/${TRIP_ID}/diary`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns a list of diary entries", async () => {
    selectQueue.push([SAMPLE_ENTRY]);
    const app = buildApp();
    const res = await request(app).get(`/api/travels/trips/${TRIP_ID}/diary`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(SAMPLE_ENTRY.id);
  });

  it("returns 404 when the trip does not exist", async () => {
    const { tripExists } = await import("../../lib/travels/db-helpers");
    vi.mocked(tripExists).mockResolvedValueOnce(false);

    const app = buildApp();
    const res = await request(app).get(`/api/travels/trips/${TRIP_ID}/diary`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/travels/trips/:tripId/diary
// ---------------------------------------------------------------------------

describe("POST /api/travels/trips/:tripId/diary", () => {
  it("returns 401 without a session", async () => {
    const app = buildUnauthApp();
    const res = await request(app)
      .post(`/api/travels/trips/${TRIP_ID}/diary`)
      .send({ entryDate: "2026-08-01", body: "Hello" });
    expect(res.status).toBe(401);
  });

  it("creates a diary entry and returns 201", async () => {
    lastReturning.value = [SAMPLE_ENTRY];
    const app = buildApp();
    const res = await request(app)
      .post(`/api/travels/trips/${TRIP_ID}/diary`)
      .send({
        entryDate: "2026-08-01",
        title: "Day one",
        body: "We arrived safely.",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(SAMPLE_ENTRY.id);
    expect(res.body.body).toBe(SAMPLE_ENTRY.body);
    expect(insertCalls).toHaveLength(1);
  });

  it("returns 400 when body is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/api/travels/trips/${TRIP_ID}/diary`)
      .send({ entryDate: "2026-08-01" });
    expect(res.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 400 when entryDate is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/api/travels/trips/${TRIP_ID}/diary`)
      .send({ body: "Hello" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the trip does not exist", async () => {
    const { tripExists } = await import("../../lib/travels/db-helpers");
    vi.mocked(tripExists).mockResolvedValueOnce(false);

    const app = buildApp();
    const res = await request(app)
      .post(`/api/travels/trips/${TRIP_ID}/diary`)
      .send({ entryDate: "2026-08-01", body: "Hello" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/travels/trips/:tripId/diary/:entryId
// ---------------------------------------------------------------------------

describe("PATCH /api/travels/trips/:tripId/diary/:entryId", () => {
  it("returns 401 without a session", async () => {
    const app = buildUnauthApp();
    const res = await request(app)
      .patch(`/api/travels/trips/${TRIP_ID}/diary/1`)
      .send({ body: "Updated body." });
    expect(res.status).toBe(401);
  });

  it("updates the body only and returns the updated entry", async () => {
    const updated = { ...SAMPLE_ENTRY, body: "Updated body." };
    lastReturning.value = [updated];
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/travels/trips/${TRIP_ID}/diary/1`)
      .send({ body: "Updated body." });

    expect(res.status).toBe(200);
    expect(res.body.body).toBe("Updated body.");
    expect(updateCalls).toHaveLength(1);
    const setPayload = updateCalls[0].set as Record<string, unknown>;
    expect(setPayload.body).toBe("Updated body.");
    expect(setPayload.entryDate).toBeUndefined();
  });

  it("updates entryDate and title together", async () => {
    const updated = {
      ...SAMPLE_ENTRY,
      entryDate: "2026-08-05",
      title: "Day five",
    };
    lastReturning.value = [updated];
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/travels/trips/${TRIP_ID}/diary/1`)
      .send({ entryDate: "2026-08-05", title: "Day five" });

    expect(res.status).toBe(200);
    expect(res.body.entryDate).toBe("2026-08-05");
    expect(res.body.title).toBe("Day five");
    expect(updateCalls).toHaveLength(1);
    const setPayload = updateCalls[0].set as Record<string, unknown>;
    expect(setPayload.entryDate).toBe("2026-08-05");
    expect(setPayload.title).toBe("Day five");
  });

  it("returns 404 when the entry does not exist", async () => {
    // lastReturning.value is empty → no row returned → 404
    lastReturning.value = [];
    const app = buildApp();

    const res = await request(app)
      .patch(`/api/travels/trips/${TRIP_ID}/diary/999`)
      .send({ body: "Nope." });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 when no fields are provided", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/travels/trips/${TRIP_ID}/diary/1`)
      .send({});
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 400 when body is empty string (too short)", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/api/travels/trips/${TRIP_ID}/diary/1`)
      .send({ body: "" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/travels/trips/:tripId/diary/:entryId
// ---------------------------------------------------------------------------

describe("DELETE /api/travels/trips/:tripId/diary/:entryId", () => {
  it("returns 401 without a session", async () => {
    const app = buildUnauthApp();
    const res = await request(app).delete(
      `/api/travels/trips/${TRIP_ID}/diary/1`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 204 when the entry is deleted successfully", async () => {
    // makeDeleteBuilder records the delete call; the route checks returned rows.
    // The route uses .delete().where().returning() — but createTrackedMutationBuilders
    // makeDeleteBuilder resolves the where() call without returning rows,
    // causing a 404. Use a custom delete builder that returns rows.
    dbMock.delete = vi.fn(() => {
      const builder = {
        where() {
          return builder;
        },
        returning() {
          return Promise.resolve([{ id: 1 }]);
        },
      };
      return builder;
    });

    const app = buildApp();
    const res = await request(app).delete(
      `/api/travels/trips/${TRIP_ID}/diary/1`,
    );
    expect(res.status).toBe(204);
  });

  it("returns 404 when the entry does not exist", async () => {
    dbMock.delete = vi.fn(() => {
      const builder = {
        where() {
          return builder;
        },
        returning() {
          return Promise.resolve([]);
        },
      };
      return builder;
    });

    const app = buildApp();
    const res = await request(app).delete(
      `/api/travels/trips/${TRIP_ID}/diary/999`,
    );
    expect(res.status).toBe(404);
  });
});
