/**
 * ornaments-delete.test.ts
 *
 * Verifies that DELETE /items/:id correctly soft-deletes the ornament and its
 * supplemental images WITHOUT immediately removing storage objects. Storage
 * cleanup is intentionally deferred to the purge job so the item remains
 * restorable from the recycle bin for 30 days.
 *
 * A separate source-level assertion confirms that purge-deleted.ts covers
 * ornament storage paths — ensuring that files uploaded during a cancelled
 * camera-add are never permanently orphaned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Rate limiters (pass-through) ──────────────────────────────────────────────
vi.mock("../../middleware/rateLimit", () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkAiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  supplementalUploadLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// ── Auth (inject a test user) ─────────────────────────────────────────────────
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

// ── Soft-delete activity log (fire-and-forget; suppress in tests) ─────────────
vi.mock("../../lib/soft-delete", () => ({
  logActivity: vi.fn(),
}));

// ── Storage — track any deleteImage calls ─────────────────────────────────────
const mockDeleteImage = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/ornaments/storage", () => ({
  uploadImage: vi.fn(),
  downloadImageBuffer: vi.fn(),
  deleteImage: mockDeleteImage,
  invalidateImageCache: vi.fn(),
}));

// ── Multer / upload-validation — kept minimal ─────────────────────────────────
vi.mock("multer", () => {
  const multerFn = () => ({
    single: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    array: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    none: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  });
  multerFn.memoryStorage = vi.fn();
  multerFn.diskStorage = vi.fn();
  return { default: multerFn };
});

vi.mock("@workspace/upload-validation", () => ({
  createImageFileFilter: vi.fn(() => vi.fn()),
  sniffImageType: vi.fn(() => "image/jpeg"),
  sniffAndValidateMime: vi.fn(),
  isImageMimeType: vi.fn(() => true),
  stripMetadata: vi.fn(),
}));

// ── External helpers (not exercised by this test) ────────────────────────────
vi.mock("../../lib/ornaments/openai", () => ({
  analyzeOrnamentImage: vi.fn(),
  appraiseOrnamentImage: vi.fn(),
  buildEmbeddingText: vi.fn(),
  embedText: vi.fn(),
  extractBarcodeFromPhoto: vi.fn(),
}));

vi.mock("../../lib/ornaments/barcode", () => ({ lookupBarcode: vi.fn() }));
vi.mock("../../lib/ornaments/book-value", () => ({ lookupBookValue: vi.fn() }));
vi.mock("../../lib/collection-search", () => ({
  semanticCollectionSearch: vi.fn(),
  buildOrnamentSearchDocument: vi.fn(),
}));
vi.mock("../../lib/ai-client", () => ({ getModels: vi.fn() }));
vi.mock("../../lib/ai-provenance", () => ({
  assignGenerationRunTarget: vi.fn(),
  runAnalysisWithEvidence: vi.fn(),
  runAnalysisWithEvidenceTrace: vi.fn(),
}));
vi.mock("../../lib/collection-parsing", () => ({
  matchCategoryIds: vi.fn(() => []),
  mergeExistingCategoryIds: vi.fn(),
  parsePositiveIntegerArray: vi.fn(),
}));
vi.mock("../../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn(),
  lookupOrnamentEbayData: vi.fn(),
  buildEbayQuery: vi.fn(),
}));
vi.mock("../../lib/ornaments/serialize", () => ({
  serializeItem: vi.fn(),
  serializeItems: vi.fn(() => []),
}));
vi.mock("../../lib/ornaments/image", () => ({
  toDataUrl: vi.fn(),
  sniffImageType: vi.fn(),
}));
vi.mock("../../lib/env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    isProduction: false,
    sessionSecret: "test-secret",
    ebayAppId: undefined,
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// DELETE handler call sequence:
//   1. db.select({imagePath}).from(ornamentsItems).where().limit(1)  — item fetch
//   2. db.update(ornamentsImages).set({deletedAt}).where()           — images soft-delete
//   3. db.update(ornamentsItems).set({deletedAt}).where()            — item soft-delete

let selectCallCount = 0;
let itemRow: { imagePath: string } | null = null;

// Track update calls so we can assert soft-delete happened
const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

function makeEagerBuilder(result: unknown[]) {
  const p = Promise.resolve(result);
  const b = {
    from: () => b,
    where: () => b,
    limit: () => p,
    orderBy: () => p,
    then<T1 = unknown[], T2 = never>(
      ok?: ((v: unknown[]) => T1 | PromiseLike<T1>) | null,
      err?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
    ) {
      return p.then(ok, err) as Promise<T1 | T2>;
    },
  };
  return b;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();

  const mockDb = {
    select: vi.fn(() => {
      selectCallCount += 1;
      return makeEagerBuilder(
        selectCallCount === 1 && itemRow ? [itemRow] : [],
      );
    }),
    update: vi.fn((table: unknown) => {
      const tableName = String(
        (table as { _: { name?: string }; _config?: { name?: string } })?._
          ?.name ??
          (table as Record<string, unknown>)?.tableName ??
          "unknown",
      );
      const builder = {
        set(payload: Record<string, unknown>) {
          updateCalls.push({ table: tableName, payload });
          return builder;
        },
        where() {
          return Promise.resolve(undefined);
        },
        returning() {
          return Promise.resolve([]);
        },
      };
      return builder;
    }),
    delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    })),
  };

  return { ...actual, db: mockDb };
});

// ── Deferred router import ────────────────────────────────────────────────────
import type { IRouter } from "express";

let ornamentsRouter: IRouter;

async function getRouter(): Promise<IRouter> {
  if (!ornamentsRouter) {
    const mod = await import("./ornaments");
    ornamentsRouter = mod.default;
  }
  return ornamentsRouter;
}

function buildApp(router: IRouter): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: 1,
    };
    next();
  });
  app.use("/ornaments", router);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /ornaments/items/:id — soft-delete semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    updateCalls.length = 0;
    itemRow = null;
    mockDeleteImage.mockResolvedValue(undefined);
  });

  it("returns 404 when the ornament does not exist", async () => {
    itemRow = null;
    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).delete("/ornaments/items/99");
    expect(res.status).toBe(404);
  });

  it("returns 200 and soft-deletes when the ornament exists", async () => {
    itemRow = { imagePath: "ornaments/42/primary.jpg" };
    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).delete("/ornaments/items/42");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // At least two update calls: one for ornamentsImages, one for ornamentsItems
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    // Every update call must set a deletedAt — confirming soft-delete, not hard-delete
    for (const call of updateCalls) {
      expect(call.payload).toHaveProperty("deletedAt");
    }
  });

  it("does NOT call deleteImage immediately — storage is preserved for recycle-bin restore", async () => {
    itemRow = { imagePath: "ornaments/7/primary.jpg" };
    const router = await getRouter();
    const app = buildApp(router);
    await request(app).delete("/ornaments/items/7");

    // Allow any queued microtasks/macrotasks to flush
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockDeleteImage).not.toHaveBeenCalled();
  });

  it("camera-add cancel: deleting a newly-created ornament soft-deletes (not hard-deletes) so images survive for restore", async () => {
    // A user takes one photo → ornament created → taps Cancel
    // The cancel handler calls DELETE /items/:id, which must soft-delete so
    // the item can be recovered from the recycle bin if the user changes their mind.
    itemRow = { imagePath: "ornaments/99/camera-shot.jpg" };
    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).delete("/ornaments/items/99");

    expect(res.status).toBe(200);

    await new Promise((resolve) => setImmediate(resolve));

    // Storage must NOT be touched immediately — purge job handles this after 30 days.
    expect(mockDeleteImage).not.toHaveBeenCalled();
    // DB rows must be soft-deleted (deletedAt set)
    expect(updateCalls.some((c) => c.payload.deletedAt instanceof Date)).toBe(
      true,
    );
  });
});

// ── Purge-job source invariant ────────────────────────────────────────────────

describe("purge-deleted.ts — ornament storage cleanup coverage", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../lib/purge-deleted.ts", import.meta.url)),
    "utf8",
  );

  it("fetches the primary imagePath for soft-deleted ornaments before purging", () => {
    // Confirms purge job reads ornamentsItems.imagePath, not just the DB row id,
    // so the primary photo is included in the storage removal batch.
    expect(source).toContain("imagePath: ornamentsItems.imagePath");
  });

  it("fetches supplemental storagePaths before purging", () => {
    // Confirms supplemental images are also queued for storage deletion.
    expect(source).toContain("storagePath: ornamentsImages.storagePath");
  });

  it("passes both primary and supplemental paths to removeStoragePaths for the ornaments bucket", () => {
    // Confirms both path sets flow into the same removeStoragePaths call so no
    // file (primary or supplemental) can be skipped when the purge runs.
    expect(source).toContain('removeStoragePaths("ornaments"');
    expect(source).toContain("rows.map((r) => r.imagePath)");
    expect(source).toContain("suppImages.map((i) => i.storagePath)");
  });
});
