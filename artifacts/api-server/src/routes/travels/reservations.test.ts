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
const { updateCalls, makeInsertBuilder, makeUpdateBuilder } =
  createTrackedMutationBuilders();

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn((table: unknown) => makeInsertBuilder(table)),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

const enqueueJob = vi.fn().mockResolvedValue(123);
vi.mock("../../lib/jobs/queue", () => ({
  enqueueJob: (...args: unknown[]) => enqueueJob(...args),
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session: { userId?: number } },
    _res: unknown,
    next: () => void,
  ) => {
    req.session.userId = 42;
    next();
  },
}));

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

import type { IRouter } from "express";
let reservationsRouter: IRouter;
let travelsReservations: (typeof import("@workspace/db"))["travelsReservations"];

beforeAll(async () => {
  const mod = await import("./reservations");
  reservationsRouter = mod.default;
  const dbModule = await import("@workspace/db");
  travelsReservations = dbModule.travelsReservations;
}, 30_000);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId?: number } }).session = {};
    next();
  });
  app.use("/api/travels", reservationsRouter);
  return app;
}

function findLastCheckedAtUpdate() {
  return updateCalls.find(
    (c) =>
      c.table === travelsReservations &&
      c.set &&
      typeof c.set === "object" &&
      "lastCheckedAt" in c.set,
  );
}

beforeEach(() => {
  selectQueue.length = 0;
  updateCalls.length = 0;
  vi.clearAllMocks();
  enqueueJob.mockResolvedValue(123);
});

// ---------------------------------------------------------------------------
// POST /reservations/:id/check-now
// ---------------------------------------------------------------------------

describe("POST /api/travels/reservations/:id/check-now", () => {
  it("enqueues a monitoring-check job without optimistically updating lastCheckedAt", async () => {
    selectQueue.push([{ id: 5, monitoringEnabled: true }]); // reservation lookup
    const app = buildApp();

    const res = await request(app).post(
      "/api/travels/reservations/5/check-now",
    );

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(123);
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "travels.monitoring-check",
        payload: { reservationId: 5 },
      }),
    );
    // The regression this guards against: the route used to set
    // lastCheckedAt itself right after enqueueing, before the job ever ran.
    expect(findLastCheckedAtUpdate()).toBeUndefined();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("404s when the reservation does not exist", async () => {
    selectQueue.push([]); // reservation lookup → not found
    const app = buildApp();

    const res = await request(app).post(
      "/api/travels/reservations/999/check-now",
    );

    expect(res.status).toBe(404);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("409s when monitoring is disabled for the reservation, without enqueueing", async () => {
    selectQueue.push([{ id: 5, monitoringEnabled: false }]);
    const app = buildApp();

    const res = await request(app).post(
      "/api/travels/reservations/5/check-now",
    );

    expect(res.status).toBe(409);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
