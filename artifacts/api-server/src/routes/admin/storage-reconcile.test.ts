import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/rateLimit", () => ({
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    isProduction: false,
    sessionSecret: "test-secret",
  },
}));

// ── DB / jobs mocks ──────────────────────────────────────────────────────────

let mockEnqueueResult = 42;
let mockQueryResult: unknown[] = [];

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async () => ({ rows: mockQueryResult })),
  },
  appUsers: {},
}));

vi.mock("../../lib/jobs/queue", () => ({
  enqueueJob: vi.fn(async () => mockEnqueueResult),
}));

vi.mock("../../middleware/owner", () => ({
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    _res: unknown,
    next: () => void,
  ) => {
    req.session = { userId: 1 };
    next();
  },
}));

import { pool } from "@workspace/db";
import { enqueueJob } from "../../lib/jobs/queue";
import storageReconcileRouter from "./storage-reconcile";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockEnqueue = enqueueJob as ReturnType<typeof vi.fn>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/admin/storage", storageReconcileRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueueResult = 42;
  mockQueryResult = [];
  mockPool.query.mockResolvedValue({ rows: mockQueryResult });
});

// ---------------------------------------------------------------------------
// POST /admin/storage/reconcile
// ---------------------------------------------------------------------------
describe("POST /admin/storage/reconcile", () => {
  it("enqueues a storage.reconcile job and returns 202 with jobId", async () => {
    const app = buildApp();
    const res = await request(app).post("/admin/storage/reconcile").send({});
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe(42);
    expect(res.body.idempotencyKey).toMatch(
      /^storage\.reconcile:\d{4}-\d{2}-\d{2}$/,
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "storage.reconcile",
        idempotencyKey: expect.stringMatching(/^storage\.reconcile:/),
      }),
    );
  });

  it("accepts a custom triggeredBy in the body", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/admin/storage/reconcile")
      .send({ triggeredBy: "admin-dashboard" });
    expect(res.status).toBe(202);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ triggeredBy: "admin-dashboard" }),
      }),
    );
  });

  it("falls back to user:<id> when no triggeredBy is supplied", async () => {
    const app = buildApp();
    await request(app).post("/admin/storage/reconcile").send({});
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ triggeredBy: "user:1" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /admin/storage/reconcile/latest
// ---------------------------------------------------------------------------
describe("GET /admin/storage/reconcile/latest", () => {
  it("returns 404 when no reconcile job has ever run", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();
    const res = await request(app).get("/admin/storage/reconcile/latest");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it("returns 404 for a queued or running job with no completed result", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();
    const res = await request(app).get("/admin/storage/reconcile/latest");
    expect(res.status).toBe(404);
  });

  it("returns the most recent job row when one exists", async () => {
    const fakeJob = {
      id: 99,
      status: "succeeded",
      result: {
        generatedAt: "2024-06-01T00:00:00.000Z",
        durationMs: 1234,
        triggeredBy: "user:1",
        buckets: [],
        summary: {
          totalOrphans: 5,
          totalMissing: 2,
          totalStaleTemp: 0,
          bucketsWithErrors: 0,
        },
      },
      progress_percent: 100,
      progress_message: "Done",
      created_at: "2024-06-01T00:00:00.000Z",
      completed_at: "2024-06-01T00:00:10.000Z",
      idempotency_key: "storage.reconcile:2024-06-01",
    };
    mockPool.query.mockResolvedValue({ rows: [fakeJob] });
    const app = buildApp();
    const res = await request(app).get("/admin/storage/reconcile/latest");
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe(99);
    expect(res.body.job.status).toBe("succeeded");
    expect(res.body.job.result.summary.totalOrphans).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/storage/reconcile/history
// ---------------------------------------------------------------------------
describe("GET /admin/storage/reconcile/history", () => {
  it("returns an empty array when no jobs exist", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const app = buildApp();
    const res = await request(app).get("/admin/storage/reconcile/history");
    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([]);
  });

  it("returns history rows without result payload", async () => {
    const rows = [
      {
        id: 10,
        status: "succeeded",
        progress_percent: 100,
        created_at: "2024-05-01T00:00:00.000Z",
      },
      {
        id: 11,
        status: "failed",
        progress_percent: 50,
        created_at: "2024-05-02T00:00:00.000Z",
      },
    ];
    mockPool.query.mockResolvedValue({ rows });
    const app = buildApp();
    const res = await request(app).get("/admin/storage/reconcile/history");
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(2);
  });

  it("rejects a limit larger than 50", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/admin/storage/reconcile/history?limit=100",
    );
    expect(res.status).toBe(400);
  });
});
