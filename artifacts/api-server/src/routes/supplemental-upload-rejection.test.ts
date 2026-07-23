/**
 * Integration tests: upload rejection at the route level — supplemental images.
 *
 * Verifies that the multer fileFilter + sniffAndValidateMime chain correctly
 * rejects bad uploads and accepts valid images through the supplemental-image
 * upload routes (secondary images added to an existing item/trip), following
 * the same pattern as upload-rejection.test.ts which covers primary uploads.
 *
 * Coverage:
 *   - pottery   POST /api/pottery/items/:id/images
 *   - ornaments POST /api/ornaments/items/:id/images
 *   - travels   POST /api/travels/trips/:id/photos
 *   - travels   POST /api/travels/magnets/check
 *
 * Rejection cases verified:
 *   - GIF declared as image/gif         → fileFilter rejects (type not allowed)
 *   - SVG declared as image/svg+xml     → fileFilter rejects (type not allowed)
 *   - PDF declared as application/pdf   → fileFilter rejects (image-only routes)
 *   - Non-image file declared as image/jpeg → magic-byte check rejects
 *   - GIF declared as image/jpeg (spoofed MIME) → magic-byte check rejects
 *   - File exceeding the size limit     → multer LIMIT_FILE_SIZE rejects
 *
 * Acceptance cases verified:
 *   - Valid JPEG → 201 (201 for item routes, 200 for magnets/check)
 *   - Valid PNG  → 201
 *
 * Magnets/check note: previously used a hand-rolled fileFilter without a
 * magic-byte sniff, so spoofed files could bypass validation. Fixed in this
 * pass to use createImageFileFilter + sniffAndValidateMime, consistent with
 * all other upload routes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import sharp from "sharp";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../test-helpers/db-mock";
import { generateVisualEmbedding } from "../lib/visual-embed";

// ---------------------------------------------------------------------------
// Shared DB mock — used by all route builders
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const {
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
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

// ---------------------------------------------------------------------------
// vi.mock calls — hoisted by Vitest, must remain at module level
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../middleware/rateLimit", () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkAiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  supplementalUploadLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
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

vi.mock("../lib/env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-openrouter",
    isProduction: false,
    sessionSecret: "test-session",
    ebayAppId: null,
  },
}));

// ── pottery ──────────────────────────────────────────────────────────────────

vi.mock("../lib/pottery/openai", () => ({
  analyzeImage: vi.fn().mockResolvedValue({
    name: "Test Piece",
    style: null,
    shape: null,
    maker: null,
    makerInfo: null,
    patternDescription: null,
    dominantColors: [],
    motifs: [],
    aiDescription: null,
    dimensions: null,
    glazeType: null,
  }),
  analyzePotteryZones: vi.fn().mockResolvedValue(null),
  locateBackstampAndEnhanceMaker: vi.fn().mockResolvedValue(null),
  buildEmbeddingText: vi.fn().mockReturnValue("test text"),
  embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock("../lib/pottery/storage", () => ({
  uploadImage: vi.fn().mockResolvedValue("pottery/mock-supplemental.jpg"),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  downloadImageBuffer: vi.fn().mockResolvedValue({
    buffer: Buffer.alloc(12),
    contentType: "image/jpeg",
  }),
}));

vi.mock("../lib/pottery/image", () => ({
  toDataUrl: vi.fn().mockReturnValue("data:image/jpeg;base64,/9j/"),
}));

vi.mock("../lib/pottery/serialize", () => ({
  serializeItem: vi.fn().mockResolvedValue({
    id: 1,
    name: "Test Piece",
    quantity: 1,
    lockedFields: [],
    notes: null,
    dimensions: null,
    patternDescription: null,
    style: null,
    shape: null,
    maker: null,
    makerInfo: null,
    aiDescription: null,
    acquiredAt: "2026-01-01",
    glazeType: null,
    surfaceZones: null,
    dominantColors: [],
    motifs: [],
    categories: [],
    images: [],
    imageUrl: "https://mock.supabase.co/pottery/mock.jpg",
    createdAt: new Date("2026-01-01"),
  }),
  serializeItems: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn().mockResolvedValue(null),
  buildEbayQuery: vi.fn().mockReturnValue("test query"),
}));

// ── quilting (needed because pottery.ts may pull shared lib) ──────────────────

vi.mock("../lib/openai", () => ({
  analyzeImage: vi.fn().mockResolvedValue({
    name: "Test Fabric",
    lineName: null,
    designer: null,
    manufacturer: null,
    colorway: null,
    printType: null,
    fiberContent: null,
    dominantColors: [],
    motifs: [],
    styleDescriptors: [],
    aiDescription: null,
  }),
  buildEmbeddingText: vi.fn().mockReturnValue("fabric text"),
  embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock("../lib/storage", () => ({
  uploadImage: vi.fn().mockResolvedValue("quilting/mock.jpg"),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  downloadImageBuffer: vi.fn().mockResolvedValue(Buffer.alloc(12)),
  downloadImageAsDataUrl: vi
    .fn()
    .mockResolvedValue("data:image/jpeg;base64,/9j/"),
}));

vi.mock("../lib/image", () => ({
  toDataUrl: vi.fn().mockReturnValue("data:image/jpeg;base64,/9j/"),
  generateFlatFabricTile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  generateFlatFabricTileV2: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  generateFabricTilePosterized: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  generateFabricTileVectorized: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  generateFabricTileVectorizedTuned: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  generateProductionFabricTile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  getCachedProductionFabricTile: vi.fn().mockResolvedValue(null),
  DIRECTION_A_SMOOTH_TUNING: {},
  DIRECTION_A_CRISP_TUNING: {},
  DIRECTION_A_THREE_PASS_TUNING: {},
  DIRECTION_A_ULTRA_SMOOTH_TUNING: {},
  DIRECTION_A_MAX_DETAIL_TUNING: {},
}));

vi.mock("../lib/serialize", () => ({
  serializeFabric: vi.fn().mockResolvedValue({ id: 1, name: "Test Fabric" }),
  serializeFabrics: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/collection-search", () => ({
  semanticCollectionSearch: vi.fn().mockResolvedValue([]),
  buildFabricSearchDocument: vi.fn().mockReturnValue(""),
  buildOrnamentSearchDocument: vi.fn().mockReturnValue(""),
  buildPotterySearchDocument: vi.fn().mockReturnValue(""),
}));

// ── ornaments ─────────────────────────────────────────────────────────────────

vi.mock("../lib/ornaments/openai", () => ({
  analyzeOrnamentImage: vi.fn().mockResolvedValue({
    name: "Test Ornament",
    seriesOrCollection: null,
    year: null,
    brand: null,
    condition: null,
    origin: null,
    dimensions: null,
    upc: null,
    dominantColors: [],
    motifs: [],
    aiDescription: null,
  }),
  buildEmbeddingText: vi.fn().mockReturnValue("ornament text"),
  embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  extractBarcodeFromPhoto: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/ornaments/storage", () => ({
  uploadImage: vi.fn().mockResolvedValue("ornaments/mock-supplemental.jpg"),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  downloadImageBuffer: vi.fn().mockResolvedValue({
    buffer: Buffer.alloc(12),
    contentType: "image/jpeg",
  }),
}));

vi.mock("../lib/ornaments/image", () => ({
  toDataUrl: vi.fn().mockReturnValue("data:image/jpeg;base64,/9j/"),
}));

vi.mock("../lib/ornaments/serialize", () => ({
  serializeItem: vi.fn().mockResolvedValue({
    id: 1,
    name: "Test Ornament",
    brand: "Hallmark",
    seriesOrCollection: null,
    year: null,
    barcodeValue: null,
    quantity: 1,
    lockedFields: [],
    notes: null,
    dimensions: null,
    condition: null,
    origin: null,
    aiDescription: null,
    acquiredAt: "2026-01-01",
    dominantColors: [],
    motifs: [],
    bookValue: null,
    bookValueSource: null,
    bookValueUpdatedAt: null,
    categories: [],
    images: [],
    imageUrl: "https://mock.supabase.co/ornaments/mock.jpg",
    createdAt: new Date("2026-01-01"),
  }),
  serializeItems: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/ornaments/barcode", () => ({
  lookupBarcode: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/ornaments/book-value", () => ({
  lookupBookValue: vi.fn().mockResolvedValue(null),
}));

// ── travels shared ────────────────────────────────────────────────────────────

vi.mock("../lib/travels/db-helpers", () => ({
  tripExists: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/travels/storage", () => ({
  uploadTripPhoto: vi.fn().mockResolvedValue("travels/mock-photo.jpg"),
  downloadTripPhoto: vi.fn().mockResolvedValue({
    buffer: Buffer.alloc(12),
    contentType: "image/jpeg",
  }),
  deleteTripPhoto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/travels-storage", () => ({
  uploadDocument: vi.fn().mockResolvedValue("travels/mock.pdf"),
  downloadDocument: vi.fn().mockResolvedValue({
    buffer: Buffer.alloc(4),
    contentType: "application/pdf",
  }),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/travel-document-extraction", () => ({
  extractFromImage: vi.fn().mockResolvedValue({ data: {}, sourceSpans: null }),
  extractFromPdf: vi.fn().mockResolvedValue({ data: {}, sourceSpans: null }),
}));

// ── shared visual-embed ───────────────────────────────────────────────────────

vi.mock("../lib/visual-embed", () => ({
  generateVisualEmbedding: vi.fn().mockResolvedValue(null),
  generateZoneEmbedding: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Magic-byte constants (same as upload-rejection.test.ts)
// ---------------------------------------------------------------------------

const GIF_MAGIC = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00");
const SVG_CONTENT = Buffer.from(
  "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>",
);
const PDF_MAGIC = Buffer.from("%PDF-1.4 this is a fake pdf file for testing");
const NON_IMAGE_CONTENT = Buffer.from("<?php echo 'hello'; ?>");

let tinyJpeg: Buffer;
let tinyPng: Buffer;

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

function addErrorHandler(app: Express): void {
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err && typeof err === "object") {
        const e = err as { name?: string; code?: string; message?: string };
        if (
          e.name === "UploadValidationError" ||
          e.code === "LIMIT_FILE_SIZE"
        ) {
          res.status(400).json({ error: e.message ?? "Upload rejected" });
          return;
        }
      }
      res.status(500).json({ error: "Internal error" });
    },
  );
}

// ---------------------------------------------------------------------------
// Test session middleware
// ---------------------------------------------------------------------------

const TEST_USER_ID = 42;
const silentLog = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
};

function addSession(app: Express): void {
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
    };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
}

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

async function buildPotteryApp(): Promise<Express> {
  const { default: router } = await import("./pottery/pottery");
  const app = express();
  addSession(app);
  app.use("/api/pottery", router);
  addErrorHandler(app);
  return app;
}

async function buildOrnamentsApp(): Promise<Express> {
  const { default: router } = await import("./ornaments/ornaments");
  const app = express();
  addSession(app);
  app.use("/api/ornaments", router);
  addErrorHandler(app);
  return app;
}

async function buildTravelsPhotosApp(): Promise<Express> {
  const { default: router } = await import("./travels/photos");
  const app = express();
  addSession(app);
  app.use("/api/travels", router);
  addErrorHandler(app);
  return app;
}

async function buildTravelsMagnetsApp(): Promise<Express> {
  const { default: router } = await import("./travels/magnets");
  const app = express();
  addSession(app);
  app.use("/api/travels", router);
  addErrorHandler(app);
  return app;
}

// ---------------------------------------------------------------------------
// Global setup
// ---------------------------------------------------------------------------

let potteryApp: Express;
let ornamentsApp: Express;
let travelsPhotosApp: Express;
let travelsMagnetsApp: Express;

beforeAll(async () => {
  const base = {
    create: {
      width: 1,
      height: 1,
      channels: 3 as const,
      background: { r: 100, g: 100, b: 100 },
    },
  };
  [
    tinyJpeg,
    tinyPng,
    potteryApp,
    ornamentsApp,
    travelsPhotosApp,
    travelsMagnetsApp,
  ] = await Promise.all([
    sharp(base).jpeg().toBuffer(),
    sharp(base).png().toBuffer(),
    buildPotteryApp(),
    buildOrnamentsApp(),
    buildTravelsPhotosApp(),
    buildTravelsMagnetsApp(),
  ]);
}, 60_000);

beforeEach(() => {
  selectQueue.length = 0;
  lastReturning.value = [];
  vi.clearAllMocks();
  // Re-apply defaults that clearAllMocks may clear depending on Vitest version
  dbMock.execute.mockResolvedValue({ rows: [] });
  vi.mocked(generateVisualEmbedding).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Pottery — POST /api/pottery/items/:id/images (supplemental)
// ---------------------------------------------------------------------------

describe("Pottery POST /api/pottery/items/:id/images — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    // fileFilter passes (image/jpeg declared), handler runs item-exists check first
    selectQueue.push([{ id: 1 }]);

    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/jpeg (spoofed MIME) — magic-byte check", async () => {
    // fileFilter passes (image/jpeg declared), handler runs item-exists check first
    selectQueue.push([{ id: 1 }]);

    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", GIF_MAGIC, {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 10 MB size limit", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    // selectQueue[0]: item existence check → item found
    selectQueue.push([{ id: 1 }]);
    // selectQueue[1]: existing supplemental images → none yet
    selectQueue.push([]);
    lastReturning.value = [{ id: 10, label: null, position: 0 }];

    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", tinyJpeg, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 10, position: 0 });
  });

  it("accepts a valid PNG and returns 201", async () => {
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([]);
    lastReturning.value = [{ id: 11, label: null, position: 0 }];

    const res = await request(potteryApp)
      .post("/api/pottery/items/1/images")
      .attach("image", tinyPng, {
        filename: "photo.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Ornaments — POST /api/ornaments/items/:id/images (supplemental)
// ---------------------------------------------------------------------------

describe("Ornaments POST /api/ornaments/items/:id/images — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    // fileFilter passes (image/jpeg declared), handler runs item-exists check first
    selectQueue.push([{ id: 1 }]);

    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/jpeg (spoofed MIME) — magic-byte check", async () => {
    // fileFilter passes (image/jpeg declared), handler runs item-exists check first
    selectQueue.push([{ id: 1 }]);

    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", GIF_MAGIC, {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 10 MB size limit", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([]);
    lastReturning.value = [{ id: 20, label: null, position: 0 }];

    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", tinyJpeg, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 20, position: 0 });
  });

  it("accepts a valid PNG and returns 201", async () => {
    selectQueue.push([{ id: 1 }]);
    selectQueue.push([]);
    lastReturning.value = [{ id: 21, label: null, position: 0 }];

    const res = await request(ornamentsApp)
      .post("/api/ornaments/items/1/images")
      .attach("image", tinyPng, {
        filename: "photo.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Travels photos — POST /api/travels/trips/:id/photos
// ---------------------------------------------------------------------------

describe("Travels POST /api/travels/trips/:id/photos — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/jpeg (spoofed MIME) — magic-byte check", async () => {
    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", GIF_MAGIC, {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 20 MB size limit", async () => {
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0xff);
    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    // sortOrder query for existing photos (none)
    selectQueue.push([]);
    lastReturning.value = [
      {
        id: 30,
        tripId: 1,
        userId: TEST_USER_ID,
        storagePath: "travels/mock-photo.jpg",
        caption: null,
        photoType: "photo",
        sortOrder: 0,
        visualEmbedding: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", tinyJpeg, {
        filename: "vacation.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 30, photoType: "photo" });
  });

  it("accepts a valid PNG and returns 201", async () => {
    selectQueue.push([]);
    lastReturning.value = [
      {
        id: 31,
        tripId: 1,
        userId: TEST_USER_ID,
        storagePath: "travels/mock-photo.png",
        caption: null,
        photoType: "photo",
        sortOrder: 0,
        visualEmbedding: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(travelsPhotosApp)
      .post("/api/travels/trips/1/photos")
      .attach("photo", tinyPng, {
        filename: "vacation.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Travels magnets — POST /api/travels/magnets/check
//
// Previously used a hand-rolled inline fileFilter with no magic-byte sniff —
// a spoofed file (e.g. GIF declared as image/jpeg) would pass the fileFilter
// and reach the handler. Fixed to use createImageFileFilter + sniffAndValidateMime.
// ---------------------------------------------------------------------------

describe("Travels POST /api/travels/magnets/check — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/jpeg (spoofed MIME) — magic-byte check", async () => {
    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", GIF_MAGIC, {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 10 MB size limit", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("accepts a valid JPEG and returns a verdict", async () => {
    // generateVisualEmbedding must return a non-null embedding for the handler
    // to proceed past the 503 guard. Override the null default for this test.
    vi.mocked(generateVisualEmbedding).mockResolvedValueOnce(
      new Array(1024).fill(0),
    );

    // selectQueue[0]: unembedded magnets backfill query → none to backfill
    selectQueue.push([]);
    // db.execute: vector similarity search → no matches (already set to {rows:[]} by default)

    const res = await request(travelsMagnetsApp)
      .post("/api/travels/magnets/check")
      .attach("photo", tinyJpeg, {
        filename: "magnet.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verdict: "no_match", matches: [] });
  });
});
