/**
 * Integration tests: upload rejection at the route level.
 *
 * Verifies that the multer fileFilter + sniffAndValidateMime chain correctly
 * rejects bad uploads and accepts valid images through real Express routes —
 * not just in isolated unit-test helpers.
 *
 * Coverage:
 *   - pottery   POST /api/pottery/items
 *   - quilting  POST /api/quilting/fabrics
 *   - ornaments POST /api/ornaments/items
 *   - travels   POST /api/travels/trips/:id/documents
 *
 * Rejection cases verified:
 *   - GIF declared as image/gif         → fileFilter rejects (type not allowed)
 *   - SVG declared as image/svg+xml     → fileFilter rejects (type not allowed)
 *   - PDF declared as application/pdf   → fileFilter rejects (image-only routes)
 *   - Non-image file declared as image/jpeg → magic-byte check rejects
 *   - GIF declared as image/jpeg (spoofed MIME) → magic-byte check rejects
 *   - File exceeding the size limit     → 413 (global uploadSizeGuard or multer backstop)
 *
 * Acceptance cases verified:
 *   - Valid JPEG, PNG, WebP → 201
 *   - PDF on travels/documents → 201 (travels accepts PDF)
 *
 * NOTE on "correct MIME / wrong file" behaviour:
 *   A real PNG uploaded with Content-Type: image/jpeg is intentionally NOT
 *   rejected. sniffAndValidateMime detects the true format from the magic
 *   bytes and returns "image/png". isImageMimeType("image/png") is true, so
 *   the upload proceeds normally. This is correct behaviour — only files
 *   whose content cannot be identified as a supported format are rejected.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import sharp from "sharp";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../test-helpers/db-mock";
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
  uploadImage: vi.fn().mockResolvedValue("pottery/mock.jpg"),
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

// ── quilting ──────────────────────────────────────────────────────────────────

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
  uploadImage: vi.fn().mockResolvedValue("ornaments/mock.jpg"),
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

// ── travels documents ─────────────────────────────────────────────────────────

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

vi.mock("../lib/travels/db-helpers", () => ({
  tripExists: vi.fn().mockResolvedValue(true),
}));

// ── shared visual-embed ───────────────────────────────────────────────────────

vi.mock("../lib/visual-embed", () => ({
  generateVisualEmbedding: vi.fn().mockResolvedValue(null),
  generateZoneEmbedding: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Magic-byte constants
// ---------------------------------------------------------------------------

/** GIF89a header — not in any route's ALLOWED_IMAGE_TYPES. */
const GIF_MAGIC = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00");

/** SVG text content. */
const SVG_CONTENT = Buffer.from(
  "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>",
);

/** Minimal %PDF magic bytes. */
const PDF_MAGIC = Buffer.from("%PDF-1.4 this is a fake pdf file for testing");

/**
 * Non-image payload — declared as image/jpeg by the attacker.
 * fileFilter passes (declared MIME is allowed), but sniffAndValidateMime
 * throws because the magic bytes don't match any supported format.
 */
const NON_IMAGE_CONTENT = Buffer.from("<?php echo 'hello'; ?>");

// Real tiny images — generated once in beforeAll via sharp.
let tinyJpeg: Buffer;
let tinyPng: Buffer;
let tinyWebp: Buffer;

// ---------------------------------------------------------------------------
// Error handler — shared across all mini-apps
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
        if (e.name === "UploadValidationError") {
          res.status(400).json({ error: e.message ?? "Upload rejected" });
          return;
        }
        if (e.code === "LIMIT_FILE_SIZE") {
          // Mirror app.ts: return 413 (not 400) so the client-side
          // getUploadErrorMessage() utility can distinguish oversized uploads
          // from other validation failures and surface the right toast message.
          res.status(413).json({
            error: "File is too large. Please upload a smaller file.",
          });
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

async function buildFabricsApp(): Promise<Express> {
  const { default: router } = await import("./quilting/fabrics");
  const app = express();
  addSession(app);
  app.use("/api/quilting", router);
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

async function buildTravelsDocumentsApp(): Promise<Express> {
  const { default: router } = await import("./travels/documents");
  const app = express();
  addSession(app);
  app.use("/api/travels", router);
  addErrorHandler(app);
  return app;
}

// ---------------------------------------------------------------------------
// Global setup — build all apps and tiny images once before any tests run.
// All four routers are loaded here so the first test in each describe block
// doesn't hit the module-load time inside the 5-second per-test timeout.
// ---------------------------------------------------------------------------

let potteryApp: Express;
let fabricsApp: Express;
let ornamentsApp: Express;
let travelsDocumentsApp: Express;

beforeAll(
  async () => {
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
      tinyWebp,
      potteryApp,
      fabricsApp,
      ornamentsApp,
      travelsDocumentsApp,
    ] = await Promise.all([
      sharp(base).jpeg().toBuffer(),
      sharp(base).png().toBuffer(),
      sharp(base).webp().toBuffer(),
      buildPotteryApp(),
      buildFabricsApp(),
      buildOrnamentsApp(),
      buildTravelsDocumentsApp(),
    ]);
  },
  60_000, // generous timeout for module loading
);

beforeEach(() => {
  selectQueue.length = 0;
  lastReturning.value = [];
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pottery — POST /api/pottery/items
// ---------------------------------------------------------------------------

describe("Pottery POST /api/pottery/items — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/jpeg (spoofed MIME) — magic-byte check", async () => {
    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", GIF_MAGIC, {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 10 MB size limit with 413 and a 'too large' message", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    // Must be 413 (not 400) so the client-side getUploadErrorMessage() utility
    // can surface a specific "too large" toast instead of a generic failure.
    expect(res.status).toBe(413);
    // The error body must contain a "too large" message that getUploadErrorMessage
    // can extract verbatim and pass to the toast — no generic "Something went wrong".
    expect(res.body).toHaveProperty("error");
    expect((res.body as { error: string }).error).toMatch(/too large/i);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 1,
        userId: TEST_USER_ID,
        name: "Test Piece",
        quantity: 1,
        notes: null,
        dimensions: null,
        patternDescription: null,
        style: null,
        shape: null,
        maker: null,
        makerInfo: null,
        dominantColors: [],
        motifs: [],
        aiDescription: null,
        acquiredAt: "2026-01-01",
        imagePath: "pottery/mock.jpg",
        glazeType: null,
        surfaceZones: null,
        lockedFields: [],
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];
    // allCats select (auto-categorisation) → empty = no categories matched
    selectQueue.push([]);
    // syncDuplicateCategory: no "Duplicate" category found → returns early
    selectQueue.push([]);

    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", tinyJpeg, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
  });

  it("accepts a valid PNG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 2,
        userId: TEST_USER_ID,
        name: "PNG Piece",
        quantity: 1,
        notes: null,
        dimensions: null,
        patternDescription: null,
        style: null,
        shape: null,
        maker: null,
        makerInfo: null,
        dominantColors: [],
        motifs: [],
        aiDescription: null,
        acquiredAt: "2026-01-01",
        imagePath: "pottery/mock.png",
        glazeType: null,
        surfaceZones: null,
        lockedFields: [],
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];
    selectQueue.push([]); // allCats
    selectQueue.push([]); // syncDuplicateCategory

    const res = await request(potteryApp)
      .post("/api/pottery/items")
      .attach("image", tinyPng, {
        filename: "photo.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Quilting — POST /api/quilting/fabrics
// ---------------------------------------------------------------------------

describe("Quilting POST /api/quilting/fabrics — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/png (spoofed MIME) — magic-byte check", async () => {
    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", GIF_MAGIC, {
        filename: "fake.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 10 MB size limit with 413 and a 'too large' message", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
    expect(res.body).toHaveProperty("error");
    expect((res.body as { error: string }).error).toMatch(/too large/i);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 1,
        userId: TEST_USER_ID,
        name: "Test Fabric",
        imagePath: "quilting/mock.jpg",
        quantity: 1,
        quantityUnit: "yards",
        widthInches: null,
        sku: null,
        notes: null,
        lockedFields: [],
        dominantColors: [],
        motifs: [],
        styleDescriptors: [],
        aiDescription: null,
        acquiredAt: null,
        lineName: null,
        designer: null,
        manufacturer: null,
        colorway: null,
        printType: null,
        fiberContent: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", tinyJpeg, {
        filename: "fabric.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
  });

  it("accepts a valid WebP and returns 201", async () => {
    lastReturning.value = [
      {
        id: 2,
        userId: TEST_USER_ID,
        name: "WebP Fabric",
        imagePath: "quilting/mock.webp",
        quantity: 1,
        quantityUnit: "yards",
        widthInches: null,
        sku: null,
        notes: null,
        lockedFields: [],
        dominantColors: [],
        motifs: [],
        styleDescriptors: [],
        aiDescription: null,
        acquiredAt: null,
        lineName: null,
        designer: null,
        manufacturer: null,
        colorway: null,
        printType: null,
        fiberContent: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(fabricsApp)
      .post("/api/quilting/fabrics")
      .attach("image", tinyWebp, {
        filename: "fabric.webp",
        contentType: "image/webp",
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Ornaments — POST /api/ornaments/items
// ---------------------------------------------------------------------------

describe("Ornaments POST /api/ornaments/items — upload rejection", () => {
  it("rejects a GIF (declared as image/gif) — fileFilter layer", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — fileFilter layer", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a PDF (declared as application/pdf) — fileFilter layer", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", PDF_MAGIC, {
        filename: "test.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/webp (spoofed MIME) — magic-byte check", async () => {
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", GIF_MAGIC, {
        filename: "fake.webp",
        contentType: "image/webp",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 10 MB size limit with 413 and a 'too large' message", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 0xff);
    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
    expect(res.body).toHaveProperty("error");
    expect((res.body as { error: string }).error).toMatch(/too large/i);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 1,
        userId: TEST_USER_ID,
        name: "Test Ornament",
        brand: "Hallmark",
        seriesOrCollection: null,
        year: null,
        barcodeValue: null,
        quantity: 1,
        notes: null,
        dimensions: null,
        condition: null,
        origin: null,
        aiDescription: null,
        acquiredAt: "2026-01-01",
        imagePath: "ornaments/mock.jpg",
        dominantColors: [],
        motifs: [],
        bookValue: null,
        bookValueSource: null,
        bookValueUpdatedAt: null,
        lockedFields: [],
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];
    selectQueue.push([]); // allCats select

    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", tinyJpeg, {
        filename: "ornament.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
  });

  it("accepts a valid PNG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 2,
        userId: TEST_USER_ID,
        name: "PNG Ornament",
        brand: "Hallmark",
        seriesOrCollection: null,
        year: null,
        barcodeValue: null,
        quantity: 1,
        notes: null,
        dimensions: null,
        condition: null,
        origin: null,
        aiDescription: null,
        acquiredAt: "2026-01-01",
        imagePath: "ornaments/mock.png",
        dominantColors: [],
        motifs: [],
        bookValue: null,
        bookValueSource: null,
        bookValueUpdatedAt: null,
        lockedFields: [],
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];
    selectQueue.push([]); // allCats select

    const res = await request(ornamentsApp)
      .post("/api/ornaments/items")
      .attach("image", tinyPng, {
        filename: "ornament.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Travels — POST /api/travels/trips/:id/documents
// ---------------------------------------------------------------------------

describe("Travels POST /api/travels/trips/:id/documents — upload rejection", () => {
  it("rejects a non-image file declared as image/gif — magic-byte check", async () => {
    // travels fileFilter allows anything starting with "image/" or "application/pdf"
    // so image/gif passes the filter — but GIF magic bytes fail sniffAndValidateMime
    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", GIF_MAGIC, {
        filename: "test.gif",
        contentType: "image/gif",
      });

    expect(res.status).toBe(400);
  });

  it("rejects an SVG (declared as image/svg+xml) — magic-byte check after fileFilter passes", async () => {
    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", SVG_CONTENT, {
        filename: "test.svg",
        contentType: "image/svg+xml",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-image file declared as image/jpeg — magic-byte check", async () => {
    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", NON_IMAGE_CONTENT, {
        filename: "evil.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a GIF file declared as image/jpeg (spoofed MIME) — magic-byte check", async () => {
    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", GIF_MAGIC, {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the 20 MB size limit with 413 and a 'too large' message", async () => {
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0xff);
    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
    expect(res.body).toHaveProperty("error");
    expect((res.body as { error: string }).error).toMatch(/too large/i);
  });

  it("accepts a valid JPEG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 1,
        tripId: 1,
        userId: TEST_USER_ID,
        storagePath: "travels/mock.jpg",
        title: null,
        documentType: null,
        originalFilename: "boarding.jpg",
        extractedData: {},
        sourceSpans: null,
        rawText: null,
        status: "linked",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", tinyJpeg, {
        filename: "boarding.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
  });

  it("accepts a valid PDF and returns 201", async () => {
    lastReturning.value = [
      {
        id: 2,
        tripId: 1,
        userId: TEST_USER_ID,
        storagePath: "travels/mock.pdf",
        title: null,
        documentType: null,
        originalFilename: "itinerary.pdf",
        extractedData: {},
        sourceSpans: null,
        rawText: null,
        status: "linked",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", PDF_MAGIC, {
        filename: "itinerary.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(201);
  });

  it("accepts a valid PNG and returns 201", async () => {
    lastReturning.value = [
      {
        id: 3,
        tripId: 1,
        userId: TEST_USER_ID,
        storagePath: "travels/mock.png",
        title: null,
        documentType: null,
        originalFilename: "photo.png",
        extractedData: {},
        sourceSpans: null,
        rawText: null,
        status: "linked",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ];

    const res = await request(travelsDocumentsApp)
      .post("/api/travels/trips/1/documents")
      .attach("file", tinyPng, {
        filename: "photo.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
  });
});
