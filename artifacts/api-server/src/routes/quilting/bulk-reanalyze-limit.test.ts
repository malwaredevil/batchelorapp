/**
 * Verifies the quilting bulk-reanalyze workers (fabrics/patterns/quilts)
 * cap their batch at the owner-configurable
 * `thresholds.quiltingBulkReanalyzeLimit` from the Elaine config store,
 * rather than the old hardcoded `MAX_BULK_REANALYZE = 20` constant.
 *
 * Each worker's first DB call per id is a `select ... limit(1)` lookup; we
 * mock it to always resolve empty so every id short-circuits into `failed`
 * before any AI/storage calls happen. That isolates the thing under test —
 * how many ids are attempted — from everything else the worker does.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// DB mock: every select(...).from(...).where(...).limit(1) resolves to [].
// ---------------------------------------------------------------------------

const selectCalls: unknown[] = [];

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => Promise.resolve([]),
    limit: () => {
      selectCalls.push(true);
      return Promise.resolve([]);
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
  update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve([]) }) })),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

let quiltingBulkReanalyzeLimit = 20;

vi.mock("../../lib/elaine-config", () => ({
  getElaineGlobalConfig: vi.fn(async () => ({
    thresholds: { quiltingBulkReanalyzeLimit },
  })),
}));

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
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/storage", () => ({
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
  downloadImageBuffer: vi.fn(),
  downloadImageAsDataUrl: vi.fn(),
}));

vi.mock("../../lib/openai", () => ({
  analyzeImage: vi.fn(),
  buildEmbeddingText: vi.fn(),
  embedText: vi.fn(),
  analyzePatternImage: vi.fn(),
  enrichPatternMetadata: vi.fn(),
  extractBlockFromImage: vi.fn(),
  analyzeQuiltImage: vi.fn(),
}));

vi.mock("../../lib/soft-delete", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/serialize", () => ({
  serializeFabric: vi.fn(),
  serializeFabrics: vi.fn(),
  serializePattern: vi.fn(),
  serializePatterns: vi.fn(),
  serializeQuilt: vi.fn(),
  serializeQuilts: vi.fn(),
}));

vi.mock("../../lib/image", () => ({
  toDataUrl: vi.fn(),
  generateFlatFabricTile: vi.fn(),
  generateFlatFabricTileV2: vi.fn(),
  generateFabricTilePosterized: vi.fn(),
  generateFabricTileVectorized: vi.fn(),
  generateFabricTileVectorizedTuned: vi.fn(),
  generateProductionFabricTile: vi.fn(),
  getCachedProductionFabricTile: vi.fn(),
  DIRECTION_A_SMOOTH_TUNING: {},
  DIRECTION_A_CRISP_TUNING: {},
  DIRECTION_A_THREE_PASS_TUNING: {},
  DIRECTION_A_ULTRA_SMOOTH_TUNING: {},
  DIRECTION_A_MAX_DETAIL_TUNING: {},
}));

vi.mock("../../lib/collection-search", () => ({
  semanticCollectionSearch: vi.fn(),
  buildFabricSearchDocument: vi.fn(),
}));

vi.mock("../../lib/ai-client", () => ({
  getModels: vi.fn(async () => ({ fastVision: "mock-model" })),
}));

vi.mock("../../lib/ai-provenance", () => ({
  assignGenerationRunTarget: vi.fn(),
  runAnalysisWithEvidence: vi.fn(),
  runAnalysisWithEvidenceTrace: vi.fn(),
}));

vi.mock("../../lib/visual-embed", () => ({
  generateVisualEmbedding: vi.fn(),
}));

vi.mock("../../lib/collection-parsing", () => ({
  parseStringArray: vi.fn(),
  parseIntegerArray: vi.fn(),
}));

vi.mock("../../lib/quilting/resolve-categories", () => ({
  resolveOrCreateQuiltingCategories: vi.fn(),
}));

vi.mock("@workspace/upload-validation", () => ({
  createImageFileFilter: vi.fn(
    () =>
      (_req: unknown, _file: unknown, cb: (e: unknown, ok: boolean) => void) =>
        cb(null, true),
  ),
  sniffImageType: vi.fn(),
  sniffAndValidateMime: vi.fn(),
  isImageMimeType: vi.fn(),
  stripMetadata: vi.fn(),
}));

beforeEach(() => {
  selectCalls.length = 0;
  quiltingBulkReanalyzeLimit = 20;
});

describe("quilting bulk-reanalyze workers honor thresholds.quiltingBulkReanalyzeLimit", () => {
  it("bulkReanalyzeFabrics caps at the configured limit above the old hardcoded 20 default", async () => {
    const { bulkReanalyzeFabrics } = await import("./fabrics");
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);

    quiltingBulkReanalyzeLimit = 60;
    const { failed } = await bulkReanalyzeFabrics(ids);
    expect(failed).toHaveLength(60);
    expect(failed).toEqual(ids.slice(0, 60));
  });

  it("bulkReanalyzeFabrics still caps at 20 when the owner has not raised the limit", async () => {
    const { bulkReanalyzeFabrics } = await import("./fabrics");
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);

    quiltingBulkReanalyzeLimit = 20;
    const { failed } = await bulkReanalyzeFabrics(ids);
    expect(failed).toHaveLength(20);
  });

  it("bulkReanalyzePatterns caps at the configured limit above the old hardcoded 20 default", async () => {
    const { bulkReanalyzePatterns } = await import("./patterns");
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);

    quiltingBulkReanalyzeLimit = 75;
    const { failed } = await bulkReanalyzePatterns(ids);
    expect(failed).toHaveLength(75);
    expect(failed).toEqual(ids.slice(0, 75));
  });

  it("bulkReanalyzeQuilts caps at the configured limit above the old hardcoded 20 default", async () => {
    const { bulkReanalyzeQuilts } = await import("./quilts");
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);

    quiltingBulkReanalyzeLimit = 100;
    const { failed } = await bulkReanalyzeQuilts(ids);
    expect(failed).toHaveLength(80);
    expect(failed).toEqual(ids);
  });

  it("bulkReanalyzeQuilts still caps at 20 when the owner has not raised the limit", async () => {
    const { bulkReanalyzeQuilts } = await import("./quilts");
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);

    quiltingBulkReanalyzeLimit = 20;
    const { failed } = await bulkReanalyzeQuilts(ids);
    expect(failed).toHaveLength(20);
  });
});
