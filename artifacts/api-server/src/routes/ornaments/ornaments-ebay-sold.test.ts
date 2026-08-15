/**
 * ornaments-ebay-sold.test.ts
 *
 * Route-level integration test for POST /ornaments/items/:id/ebay-price-lookup.
 *
 * Verifies the full handler flow:
 *   1. When Apify returns sold listings → response has lastSold populated with
 *      a real priceUsd and soldDate (not null).
 *   2. When Apify is not configured → response has lastSold: null but forSale populated.
 *   3. When no eBay listings found at all → 422 returned.
 *   4. When eBay is not configured (no ebayAppId) → 503 returned.
 *   5. When item does not exist → 404 returned.
 *
 * The UPC fixture 661127022308 (Hallmark Star Trek ornament) is used where
 * applicable since it is the project's canonical known-good barcode fixture.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Rate limiters (pass-through) ──────────────────────────────────────────────
vi.mock("../../middleware/rateLimit", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
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

// ── Soft-delete activity log ──────────────────────────────────────────────────
vi.mock("../../lib/soft-delete", () => ({ logActivity: vi.fn() }));

// ── Storage (not exercised by the ebay-price-lookup endpoint) ─────────────────
vi.mock("../../lib/ornaments/storage", () => ({
  uploadImage: vi.fn(),
  downloadImageBuffer: vi.fn(),
  deleteImage: vi.fn(),
}));

// ── Multer / upload-validation (minimal stubs) ────────────────────────────────
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

// ── AI / embedding stubs (not exercised here) ─────────────────────────────────
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
vi.mock("../../lib/ornaments/serialize", () => ({
  serializeItem: vi.fn(),
  serializeItems: vi.fn(() => []),
}));
vi.mock("../../lib/ornaments/image", () => ({ toDataUrl: vi.fn() }));
vi.mock("../../lib/visual-embed", () => ({
  generateVisualEmbedding: vi.fn(),
  generateZoneEmbedding: vi.fn(),
}));

// ── eBay market-value (the module under test at the route level) ───────────────
const mockLookupOrnamentEbayData = vi.fn();
const mockBuildEbayQuery = vi.fn(() => "Hallmark Star Trek 2024 ornament");

vi.mock("../../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: vi.fn(),
  lookupOrnamentEbayData: mockLookupOrnamentEbayData,
  buildEbayQuery: mockBuildEbayQuery,
}));

// ── env ───────────────────────────────────────────────────────────────────────
const mockEnv: Record<string, unknown> = {
  supabaseUrl: "https://mock.supabase.co",
  supabaseServiceRoleKey: "mock-key",
  isProduction: false,
  sessionSecret: "test-secret",
  ebayAppId: "test-ebay-app-id",
  apifyApiToken: "test-apify-token",
};

vi.mock("../../lib/env", () => ({ env: mockEnv }));

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// ebay-price-lookup handler call sequence:
//   1. db.select({id,name,...}).from(ornamentsItems).where(eq(...))  → item lookup
//   2. db.update(ornamentsItems).set({...}).where(eq(...))           → cache write (no returning)

let selectResult: unknown[] = [];

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();

  const mockDb = {
    select: vi.fn(() => {
      const p = Promise.resolve(selectResult);
      const b: Record<string, unknown> = {
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
    }),
    update: vi.fn(() => {
      const builder: Record<string, unknown> = {
        set() {
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
        returning: () => Promise.resolve([]),
      }),
    })),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
  };

  return { ...actual, db: mockDb };
});

// ── Router import (deferred so mocks are registered first) ────────────────────
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
    (req as unknown as { session: { userId: number } }).session = { userId: 1 };
    // Stub req.log (normally injected by pino-http) so route catch-blocks that
    // call req.log.warn() don't throw a secondary error and return 500 instead
    // of the intended 503.
    (
      req as unknown as {
        log: { warn: () => void; info: () => void; error: () => void };
      }
    ).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/ornaments", router);
  return app;
}

// ── Test data ─────────────────────────────────────────────────────────────────

/**
 * Known-good ornament fixture.
 * Uses the canonical project UPC 661127022308 (Hallmark Star Trek ornament)
 * so results are predictable and tests remain aligned with the barcode fixture.
 */
const ORNAMENT_ROW = {
  id: 1,
  name: "Hallmark Star Trek Enterprise 2024",
  brand: "Hallmark",
  seriesOrCollection: "Star Trek",
  year: 2024,
  barcodeValue: "661127022308",
};

/** Simulates Apify sold listings being returned for this ornament. */
const ORNAMENT_EBAY_WITH_SOLD = {
  forSale: {
    priceMinUsd: 28,
    priceMaxUsd: 55,
    priceMedianUsd: 40,
    listingCount: 4,
    listings: [
      {
        itemId: "a1",
        title: "Hallmark Star Trek Enterprise 2024 (active)",
        price: 40,
        currency: "USD",
        condition: "New",
        imageUrl: null,
        itemUrl: "https://ebay.com/item/a1",
      },
    ],
    cachedAt: "2026-08-15T00:00:00.000Z",
  },
  lastSold: {
    priceUsd: 35,
    // soldDate is derived from the actor's `endedAt` field (not `scrapedAt`)
    soldDate: "2026-07-15T14:30:00.000Z",
    listingCount: 6,
    sourceType: "sold",
  },
  searchQuery: "Hallmark Star Trek 2024 ornament",
  cachedAt: "2026-08-15T00:00:00.000Z",
};

/** Simulates Browse-API-only result (no Apify token). */
const ORNAMENT_EBAY_NO_SOLD = {
  forSale: {
    priceMinUsd: 28,
    priceMaxUsd: 55,
    priceMedianUsd: 40,
    listingCount: 4,
    listings: [],
    cachedAt: "2026-08-15T00:00:00.000Z",
  },
  lastSold: null,
  searchQuery: "Hallmark Star Trek 2024 ornament",
  cachedAt: "2026-08-15T00:00:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /ornaments/items/:id/ebay-price-lookup — sold-price flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildEbayQuery.mockReturnValue("Hallmark Star Trek 2024 ornament");
    selectResult = [];
    mockEnv.ebayAppId = "test-ebay-app-id";
    mockEnv.apifyApiToken = "test-apify-token";
  });

  it("returns lastSold with priceUsd and soldDate when Apify returns sold listings", async () => {
    selectResult = [ORNAMENT_ROW];
    mockLookupOrnamentEbayData.mockResolvedValue(ORNAMENT_EBAY_WITH_SOLD);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(200);
    // lastSold must be non-null when Apify data is present
    expect(res.body.lastSold).not.toBeNull();
    expect(res.body.lastSold.priceUsd).toBe(35);
    // soldDate must be a real ISO date string, not null — confirms sold prices
    // are flowing through rather than silently falling back to asking prices
    expect(res.body.lastSold.soldDate).toBe("2026-07-15T14:30:00.000Z");
    expect(res.body.lastSold.listingCount).toBe(6);
    // forSale data still present alongside sold data
    expect(res.body.forSale).not.toBeNull();
    expect(res.body.forSale.priceMinUsd).toBe(28);
    expect(res.body.searchQuery).toBe("Hallmark Star Trek 2024 ornament");
  });

  it("passes barcodeValue (UPC 661127022308) to lookupOrnamentEbayData when present", async () => {
    selectResult = [ORNAMENT_ROW];
    mockLookupOrnamentEbayData.mockResolvedValue(ORNAMENT_EBAY_WITH_SOLD);

    const router = await getRouter();
    const app = buildApp(router);
    await request(app).post("/ornaments/items/1/ebay-price-lookup");

    // The handler should pass the item's barcodeValue (UPC) as the `upc` option
    // so lookupOrnamentEbayData can use barcode-based lookup for best accuracy.
    expect(mockLookupOrnamentEbayData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ upc: "661127022308" }),
    );
  });

  it("returns lastSold: null when Apify is not configured (forSale still populated)", async () => {
    selectResult = [ORNAMENT_ROW];
    mockLookupOrnamentEbayData.mockResolvedValue(ORNAMENT_EBAY_NO_SOLD);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(200);
    // No sold data → lastSold must be null, never a made-up value
    expect(res.body.lastSold).toBeNull();
    // Asking-price data still works
    expect(res.body.forSale).not.toBeNull();
    expect(res.body.forSale.priceMinUsd).toBe(28);
  });

  it("returns lastSold with soldDate: null when Apify sold listings lack endedAt timestamps", async () => {
    selectResult = [ORNAMENT_ROW];
    // Simulate Apify returning sold data but actor records had no endedAt field
    mockLookupOrnamentEbayData.mockResolvedValue({
      ...ORNAMENT_EBAY_WITH_SOLD,
      lastSold: {
        priceUsd: 35,
        soldDate: null, // endedAt absent from actor record → parseSoldDate returns null
        listingCount: 6,
        sourceType: "sold",
      },
    });

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(200);
    // lastSold must still be present — a missing date is not a missing sale
    expect(res.body.lastSold).not.toBeNull();
    expect(res.body.lastSold.priceUsd).toBe(35);
    // soldDate must be JSON null, not the string "null" and not undefined
    expect(res.body.lastSold.soldDate).toBeNull();
    // forSale data unaffected
    expect(res.body.forSale).not.toBeNull();
  });

  it("returns 422 when no eBay listings found at all (lookupOrnamentEbayData returns null)", async () => {
    selectResult = [ORNAMENT_ROW];
    mockLookupOrnamentEbayData.mockResolvedValue(null);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no ebay listings/i);
  });

  it("returns 503 when eBay API is not configured (no ebayAppId)", async () => {
    mockEnv.ebayAppId = undefined;
    selectResult = [ORNAMENT_ROW];

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ebay api not configured/i);
  });

  it("returns 404 when the ornament does not exist", async () => {
    selectResult = []; // no row returned
    mockLookupOrnamentEbayData.mockResolvedValue(ORNAMENT_EBAY_WITH_SOLD);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/ornaments/items/999/ebay-price-lookup",
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    // eBay lookup must not be called if the item doesn't exist
    expect(mockLookupOrnamentEbayData).not.toHaveBeenCalled();
  });

  it("bypasses fresh cache and fires a paid Apify run when force: true is passed", async () => {
    // Item has data cached only 1 hour ago — well within the 7-day window.
    // Without force the handler would return the cached row immediately.
    // With force: true it must skip the cache and call lookupOrnamentEbayData.
    const recentDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    selectResult = [
      {
        ...ORNAMENT_ROW,
        ebayPriceCachedAt: recentDate,
        ebayPriceMinUsd: "28",
        ebayPriceMaxUsd: "55",
        ebayPriceListings: [],
        ebayLastSoldPriceUsd: "35",
        ebayLastSoldDate: new Date("2026-07-15T14:30:00.000Z"),
      },
    ];
    mockLookupOrnamentEbayData.mockResolvedValue(ORNAMENT_EBAY_WITH_SOLD);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app)
      .post("/ornaments/items/1/ebay-price-lookup")
      .send({ force: true });

    expect(res.status).toBe(200);
    // fromCache must NOT be true — a fresh run was performed
    expect(res.body.fromCache).not.toBe(true);
    // The paid lookup must have been invoked despite the fresh cache
    expect(mockLookupOrnamentEbayData).toHaveBeenCalledOnce();
    // Response must carry fresh data
    expect(res.body.lastSold).not.toBeNull();
    expect(res.body.lastSold.priceUsd).toBe(35);
  });

  it("returns cached data (fromCache: true) when cache is fresh and force is absent", async () => {
    // Confirm the inverse: without force, a fresh cache is returned immediately
    // and the paid Apify lookup is NOT called.
    const recentDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    selectResult = [
      {
        ...ORNAMENT_ROW,
        ebayPriceCachedAt: recentDate,
        ebayPriceMinUsd: "28",
        ebayPriceMaxUsd: "55",
        ebayPriceListings: [],
        ebayLastSoldPriceUsd: "35",
        ebayLastSoldDate: new Date("2026-07-15T14:30:00.000Z"),
      },
    ];

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(200);
    expect(res.body.fromCache).toBe(true);
    // Paid lookup must NOT have been called
    expect(mockLookupOrnamentEbayData).not.toHaveBeenCalled();
  });

  it("returns 503 when lookupOrnamentEbayData throws (eBay temporarily unavailable)", async () => {
    selectResult = [ORNAMENT_ROW];
    mockLookupOrnamentEbayData.mockRejectedValue(
      new Error("Apify actor timeout"),
    );

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/items/1/ebay-price-lookup");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
  });
});
