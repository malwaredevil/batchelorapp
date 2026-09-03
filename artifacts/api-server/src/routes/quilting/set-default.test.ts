/**
 * Focused route tests: promote-to-primary (set-default) for quilting
 * patterns and quilts supplemental images.
 *
 * These routes swap the entity's primary `imagePath` with a supplemental
 * `quiltingImages` row's `storagePath` inside a transaction with row locks.
 * The swap is symmetric, so replay safety comes from a compare-and-swap
 * contract: the client sends `expectedVersion` (the `?v=` cache-buster it
 * rendered, i.e. pathCacheBuster(storagePath)); the server refuses (409, no
 * writes) when the supplemental's current storage path no longer hashes to
 * that value — which is exactly the state after the swap has been applied.
 * The UI additionally disables gallery actions while any image mutation is
 * in flight (`isMutating`), but that is defence-in-depth, not the guarantee.
 *
 * Verified here:
 *  1. A single promotion (with expectedVersion) swaps the paths.
 *  2. Replaying the identical request against the REAL post-swap DB state
 *     (supplemental row now holds the old primary path) → 409, no writes.
 *  3. Unknown pattern/quilt or image id → 404, no UPDATEs.
 *  4. Patterns only: promoting when there is no previous primary
 *     (nullable imagePath) promotes the supplemental and soft-deletes its
 *     row instead of writing a null storagePath.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { pathCacheBuster } from "../../lib/path-cache-buster";

// ---------------------------------------------------------------------------
// DB mock with transaction support
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const txUpdateCalls: Array<{ set: Record<string, unknown> }> = [];

function makeTxSelectBuilder() {
  const resultPromise = Promise.resolve(selectQueue.shift() ?? []);
  const builder = {
    from: () => builder,
    where: () => builder,
    for: () => builder,
    limit: () => resultPromise,
  };
  return builder;
}

function makeTxUpdateBuilder() {
  return {
    set(values: Record<string, unknown>) {
      txUpdateCalls.push({ set: values });
      return { where: () => Promise.resolve([]) };
    },
  };
}

function makeRootSelectBuilder() {
  const resultPromise = Promise.resolve(selectQueue.shift() ?? []);
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => resultPromise,
    orderBy: () => resultPromise,
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): Promise<TResult1 | TResult2> {
      return resultPromise.then(onfulfilled, onrejected) as Promise<
        TResult1 | TResult2
      >;
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeRootSelectBuilder()),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: vi.fn(() => makeTxSelectBuilder()),
      update: vi.fn(() => makeTxUpdateBuilder()),
    };
    return fn(tx);
  }),
  update: vi.fn(() => makeTxUpdateBuilder()),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../../middleware/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middleware/rateLimit", () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkAiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  supplementalUploadLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

vi.mock("../../lib/env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
    isProduction: false,
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../lib/storage", () => ({
  uploadImage: vi.fn().mockResolvedValue("quilting/mock.jpg"),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  downloadImageBuffer: vi.fn(),
  downloadImageAsDataUrl: vi.fn(),
}));

vi.mock("../../lib/openai", () => ({
  analyzePatternImage: vi.fn(),
  enrichPatternMetadata: vi.fn(),
  extractBlockFromImage: vi.fn(),
  analyzeQuiltImage: vi.fn(),
}));

vi.mock("../../lib/soft-delete", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// Serialization runs after the swap; it is covered elsewhere. Return
// route-schema-valid minimal objects so GetPatternResponse / GetQuiltResponse
// parse succeeds and the test stays focused on the swap semantics.
vi.mock("../../lib/serialize", () => ({
  serializePattern: vi.fn(async (row: { id: number; imagePath?: string }) => ({
    id: row.id,
    name: "P",
    dominantColors: [],
    lockedFields: [],
    categories: [],
    images: [],
    imageUrl: row.imagePath ? `/api/quilting/patterns/${row.id}/image` : null,
    hasEmbedding: false,
    recognitionRefreshStatus: null,
    createdAt: new Date().toISOString(),
  })),
  serializePatterns: vi.fn(async () => []),
  serializeQuilt: vi.fn(async (row: { id: number }) => ({
    id: row.id,
    name: "Q",
    dominantColors: [],
    lockedFields: [],
    categories: [],
    images: [],
    imageUrl: `/api/quilting/quilts/${row.id}/image`,
    linkedFabricIds: [],
    linkedPatternIds: [],
    linkedFabrics: [],
    recognitionRefreshStatus: null,
    createdAt: new Date().toISOString(),
  })),
  serializeQuilts: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------

let app: Express;

beforeAll(async () => {
  const patternsRouter = (await import("./patterns")).default;
  const quiltsRouter = (await import("./quilts")).default;
  app = express();
  app.use(express.json());
  app.use("/api/quilting", patternsRouter);
  app.use("/api/quilting", quiltsRouter);
});

beforeEach(() => {
  selectQueue.length = 0;
  txUpdateCalls.length = 0;
});

describe("POST /api/quilting/patterns/:id/images/:imageId/set-default", () => {
  it("swaps the primary path with the supplemental path, then a replay of the identical request against the post-swap state is rejected (409, no writes)", async () => {
    const expectedVersion = pathCacheBuster("quilting/supp.jpg");

    // ── First promotion ──
    selectQueue.push([{ id: 1, imagePath: "quilting/old-primary.jpg" }]); // tx: pattern
    selectQueue.push([{ id: 10, storagePath: "quilting/supp.jpg" }]); // tx: image
    selectQueue.push([{ id: 1, imagePath: "quilting/supp.jpg" }]); // reload for serialize

    const first = await request(app)
      .post("/api/quilting/patterns/1/images/10/set-default")
      .send({ expectedVersion });
    expect(first.status).toBe(200);
    expect(txUpdateCalls).toHaveLength(2);
    expect(txUpdateCalls[0]!.set).toEqual({
      imagePath: "quilting/supp.jpg",
    });
    expect(txUpdateCalls[1]!.set).toEqual({
      storagePath: "quilting/old-primary.jpg",
    });

    // ── Replay: identical request, but the DB now reflects the applied swap
    // (the supplemental row holds the OLD primary path). Without CAS this
    // would swap back; with CAS the version no longer matches → 409. ──
    txUpdateCalls.length = 0;
    selectQueue.push([{ id: 1, imagePath: "quilting/supp.jpg" }]); // tx: pattern (post-swap)
    selectQueue.push([{ id: 10, storagePath: "quilting/old-primary.jpg" }]); // tx: image (post-swap)

    const replay = await request(app)
      .post("/api/quilting/patterns/1/images/10/set-default")
      .send({ expectedVersion });
    expect(replay.status).toBe(409);
    expect(txUpdateCalls).toHaveLength(0);
  });

  it("is a no-op (200, no writes) when the supplemental already holds the primary path", async () => {
    selectQueue.push([{ id: 1, imagePath: "quilting/supp.jpg" }]);
    selectQueue.push([{ id: 10, storagePath: "quilting/supp.jpg" }]);
    selectQueue.push([{ id: 1, imagePath: "quilting/supp.jpg" }]);

    const res = await request(app).post(
      "/api/quilting/patterns/1/images/10/set-default",
    );
    expect(res.status).toBe(200);
    expect(txUpdateCalls).toHaveLength(0);
  });

  it("promotes and soft-deletes the supplemental when there is no previous primary", async () => {
    selectQueue.push([{ id: 1, imagePath: null }]); // nullable pattern primary
    selectQueue.push([{ id: 10, storagePath: "quilting/supp.jpg" }]);
    selectQueue.push([{ id: 1, imagePath: "quilting/supp.jpg" }]);

    const res = await request(app).post(
      "/api/quilting/patterns/1/images/10/set-default",
    );
    expect(res.status).toBe(200);
    expect(txUpdateCalls).toHaveLength(2);
    expect(txUpdateCalls[0]!.set).toEqual({
      imagePath: "quilting/supp.jpg",
    });
    // Never writes a null storagePath — retires the row instead.
    expect(txUpdateCalls[1]!.set).toHaveProperty("deletedAt");
    expect(txUpdateCalls[1]!.set).not.toHaveProperty("storagePath");
  });

  it("404s without writes when the pattern does not exist", async () => {
    selectQueue.push([]); // tx: no pattern

    const res = await request(app).post(
      "/api/quilting/patterns/999/images/10/set-default",
    );
    expect(res.status).toBe(404);
    expect(txUpdateCalls).toHaveLength(0);
  });

  it("404s without writes when the image does not exist", async () => {
    selectQueue.push([{ id: 1, imagePath: "quilting/old.jpg" }]);
    selectQueue.push([]); // tx: no image

    const res = await request(app).post(
      "/api/quilting/patterns/1/images/999/set-default",
    );
    expect(res.status).toBe(404);
    expect(txUpdateCalls).toHaveLength(0);
  });
});

describe("POST /api/quilting/quilts/:id/images/:imageId/set-default", () => {
  it("swaps the primary path, then a replay of the identical request against the post-swap state is rejected (409, no writes)", async () => {
    const expectedVersion = pathCacheBuster("quilting/quilt-supp.jpg");

    // ── First promotion ──
    selectQueue.push([{ id: 2, imagePath: "quilting/quilt-primary.jpg" }]);
    selectQueue.push([{ id: 20, storagePath: "quilting/quilt-supp.jpg" }]);
    selectQueue.push([{ id: 2, imagePath: "quilting/quilt-supp.jpg" }]);

    const first = await request(app)
      .post("/api/quilting/quilts/2/images/20/set-default")
      .send({ expectedVersion });
    expect(first.status).toBe(200);
    expect(txUpdateCalls).toHaveLength(2);
    expect(txUpdateCalls[0]!.set).toEqual({
      imagePath: "quilting/quilt-supp.jpg",
    });
    expect(txUpdateCalls[1]!.set).toEqual({
      storagePath: "quilting/quilt-primary.jpg",
    });

    // ── Replay against the applied swap → 409, no writes ──
    txUpdateCalls.length = 0;
    selectQueue.push([{ id: 2, imagePath: "quilting/quilt-supp.jpg" }]);
    selectQueue.push([{ id: 20, storagePath: "quilting/quilt-primary.jpg" }]);

    const replay = await request(app)
      .post("/api/quilting/quilts/2/images/20/set-default")
      .send({ expectedVersion });
    expect(replay.status).toBe(409);
    expect(txUpdateCalls).toHaveLength(0);
  });

  it("is a no-op (200, no writes) when paths already match", async () => {
    selectQueue.push([{ id: 2, imagePath: "quilting/same.jpg" }]);
    selectQueue.push([{ id: 20, storagePath: "quilting/same.jpg" }]);
    selectQueue.push([{ id: 2, imagePath: "quilting/same.jpg" }]);

    const res = await request(app).post(
      "/api/quilting/quilts/2/images/20/set-default",
    );
    expect(res.status).toBe(200);
    expect(txUpdateCalls).toHaveLength(0);
  });

  it("404s without writes when the quilt does not exist", async () => {
    selectQueue.push([]);

    const res = await request(app).post(
      "/api/quilting/quilts/999/images/20/set-default",
    );
    expect(res.status).toBe(404);
    expect(txUpdateCalls).toHaveLength(0);
  });
});
