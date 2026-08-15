/**
 * pottery-ebay-sold.test.ts
 *
 * Route-level integration test for POST /pottery/items/:id/estimate-market-value.
 *
 * Verifies the full handler flow:
 *   1. When Apify returns sold listings → response has sourceType "sold" with real prices.
 *   2. When Apify is not configured (token absent) → response has sourceType "active_listing".
 *   3. When no eBay listings found at all → 422 returned.
 *   4. When eBay is not configured (no ebayAppId) → 503 returned.
 *   5. When item does not exist → 404 returned.
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

// ── Storage (not exercised by the market-value endpoint) ──────────────────────
vi.mock("../../lib/pottery/storage", () => ({
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
vi.mock("../../lib/pottery/openai", () => ({
  analyzeImage: vi.fn(),
  analyzePotteryZones: vi.fn(),
  locateBackstampAndEnhanceMaker: vi.fn(),
  buildEmbeddingText: vi.fn(),
  embedText: vi.fn(),
}));
vi.mock("../../lib/visual-embed", () => ({
  generateVisualEmbedding: vi.fn(),
  generateZoneEmbedding: vi.fn(),
}));
vi.mock("../../lib/collection-search", () => ({
  semanticCollectionSearch: vi.fn(),
  buildPotterySearchDocument: vi.fn(),
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
vi.mock("../../lib/pottery/serialize", () => ({
  serializeItem: vi.fn(),
  serializeItems: vi.fn(() => []),
}));
vi.mock("../../lib/pottery/image", () => ({ toDataUrl: vi.fn() }));

// ── eBay market-value (the module under test at the route level) ───────────────
const mockLookupEbayMarketValue = vi.fn();
const mockBuildEbayQuery = vi.fn(() => "McCoy pottery vase art deco");

vi.mock("../../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: mockLookupEbayMarketValue,
  buildEbayQuery: mockBuildEbayQuery,
  lookupOrnamentEbayData: vi.fn(),
}));

// ── env ───────────────────────────────────────────────────────────────────────
//
// Default: eBay configured (ebayAppId present) so the 503 guard is bypassed.
// Individual tests override ebayAppId when testing the 503 path.
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
// estimate-market-value handler call sequence:
//   1. db.select({id,name,maker,style}).from(potteryItems).where(eq(...))  → item lookup
//   2. db.update(potteryItems).set({...}).where(eq(...)).returning({...})   → cache write

let selectResult: unknown[] = [];
let updateReturning: unknown[] = [];

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
          return builder;
        },
        returning() {
          return Promise.resolve(updateReturning);
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

let potteryRouter: IRouter;

async function getRouter(): Promise<IRouter> {
  if (!potteryRouter) {
    const mod = await import("./pottery");
    potteryRouter = mod.default;
  }
  return potteryRouter;
}

function buildApp(router: IRouter): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = { userId: 1 };
    next();
  });
  app.use("/pottery", router);
  return app;
}

// ── Test data ─────────────────────────────────────────────────────────────────

const ITEM_ROW = {
  id: 1,
  name: "McCoy Vase",
  maker: "McCoy",
  style: "Art Deco",
};

const SOLD_MARKET_VALUE = {
  sourceType: "sold" as const,
  priceMinUsd: 18,
  priceMaxUsd: 42,
  priceMedianUsd: 25,
  listingCount: 5,
  listings: [
    {
      title: "Sold McCoy Vase",
      priceUsd: 25,
      currency: "USD",
      soldDate: "2026-07-01T10:00:00.000Z",
      condition: "Pre-Owned",
      imageUrl: "https://i.ebayimg.com/img/sold.jpg",
      itemUrl: "https://ebay.com/itm/sold1",
      sourceType: "sold",
    },
  ],
  cachedAt: "2026-08-15T00:00:00.000Z",
};

const ACTIVE_MARKET_VALUE = {
  sourceType: "active_listing" as const,
  priceMinUsd: 30,
  priceMaxUsd: 60,
  priceMedianUsd: 45,
  listingCount: 3,
  listings: [
    {
      title: "McCoy Vase (active)",
      priceUsd: 45,
      currency: "USD",
      soldDate: null,
      condition: "Good",
      imageUrl: null,
      itemUrl: "https://ebay.com/itm/active1",
      sourceType: "active_listing",
    },
  ],
  cachedAt: "2026-08-15T00:00:00.000Z",
};

const DB_UPDATE_RETURNING = [
  {
    ebayPriceMinUsd: "18",
    ebayPriceMaxUsd: "42",
    ebayPriceMedianUsd: "25",
    ebayPriceCachedAt: new Date("2026-08-15T00:00:00.000Z"),
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /pottery/items/:id/estimate-market-value — sold-price flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildEbayQuery.mockReturnValue("McCoy pottery vase art deco");
    selectResult = [];
    updateReturning = [];
    // Restore defaults
    mockEnv.ebayAppId = "test-ebay-app-id";
    mockEnv.apifyApiToken = "test-apify-token";
  });

  it("returns sourceType 'sold' with real prices when Apify returns sold listings", async () => {
    selectResult = [ITEM_ROW];
    updateReturning = DB_UPDATE_RETURNING;
    mockLookupEbayMarketValue.mockResolvedValue(SOLD_MARKET_VALUE);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(200);
    expect(res.body.sourceType).toBe("sold");
    expect(res.body.priceMinUsd).toBe(18);
    expect(res.body.priceMaxUsd).toBe(42);
    expect(res.body.priceMedianUsd).toBe(25);
    expect(res.body.listingCount).toBe(5);
    // First listing must carry a real soldDate (not null)
    expect(res.body.listings[0].soldDate).toBe("2026-07-01T10:00:00.000Z");
    expect(res.body.searchQuery).toBe("McCoy pottery vase art deco");
  });

  it("returns sourceType 'active_listing' when Apify is not configured", async () => {
    selectResult = [ITEM_ROW];
    updateReturning = [
      {
        ebayPriceMinUsd: "30",
        ebayPriceMaxUsd: "60",
        ebayPriceMedianUsd: "45",
        ebayPriceCachedAt: new Date("2026-08-15T00:00:00.000Z"),
      },
    ];
    mockLookupEbayMarketValue.mockResolvedValue(ACTIVE_MARKET_VALUE);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(200);
    expect(res.body.sourceType).toBe("active_listing");
    // Active listings carry null soldDate — confirms no silent fallback corruption
    for (const listing of res.body.listings) {
      expect(listing.soldDate).toBeNull();
    }
  });

  it("returns soldDate as JSON null (not the string 'null') when Apify sold listing lacks endedAt", async () => {
    selectResult = [ITEM_ROW];
    updateReturning = DB_UPDATE_RETURNING;
    // Simulate an Apify record where endedAt was absent — parseSoldDate returns null
    mockLookupEbayMarketValue.mockResolvedValue({
      ...SOLD_MARKET_VALUE,
      listings: [
        {
          title: "Sold McCoy Vase (no date)",
          priceUsd: 25,
          currency: "USD",
          soldDate: null, // endedAt absent from actor record
          condition: "Pre-Owned",
          imageUrl: null,
          itemUrl: "https://ebay.com/itm/sold-no-date",
        },
      ],
    });

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(200);
    expect(res.body.sourceType).toBe("sold");
    // soldDate must be JSON null — not the string "null", not undefined
    expect(res.body.listings[0].soldDate).toBeNull();
    // Aggregate prices must still be correct
    expect(res.body.priceMinUsd).toBe(18);
    expect(res.body.priceMedianUsd).toBe(25);
  });

  it("returns 422 when no eBay listings are found (lookupEbayMarketValue returns null)", async () => {
    selectResult = [ITEM_ROW];
    mockLookupEbayMarketValue.mockResolvedValue(null);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no ebay listings/i);
  });

  it("returns 503 when eBay API is not configured (no ebayAppId)", async () => {
    mockEnv.ebayAppId = undefined;
    selectResult = [ITEM_ROW];

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ebay api not configured/i);
  });

  it("returns 404 when the pottery item does not exist", async () => {
    selectResult = []; // no row returned
    mockLookupEbayMarketValue.mockResolvedValue(SOLD_MARKET_VALUE);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/999/estimate-market-value",
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    // eBay lookup must not be called if the item doesn't exist
    expect(mockLookupEbayMarketValue).not.toHaveBeenCalled();
  });

  it("bypasses fresh cache and fires a paid Apify run when force: true is passed", async () => {
    // Item has data cached only 1 hour ago — well within the 7-day window.
    // Without force the handler would return the cached row immediately.
    // With force: true it must skip the cache and call lookupEbayMarketValue.
    const recentDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    selectResult = [
      {
        ...ITEM_ROW,
        ebayPriceCachedAt: recentDate,
        ebayPriceMinUsd: "25",
        ebayPriceMaxUsd: "55",
        ebayPriceMedianUsd: "40",
        ebayPriceListings: {
          sourceType: "active_listing",
          items: [],
        },
      },
    ];
    updateReturning = DB_UPDATE_RETURNING;
    mockLookupEbayMarketValue.mockResolvedValue(SOLD_MARKET_VALUE);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app)
      .post("/pottery/items/1/estimate-market-value")
      .send({ force: true });

    expect(res.status).toBe(200);
    // fromCache must NOT be true — a fresh run was performed
    expect(res.body.fromCache).not.toBe(true);
    // The paid lookup must have been invoked despite the fresh cache
    expect(mockLookupEbayMarketValue).toHaveBeenCalledOnce();
    // Response must carry the fresh Apify data, not the stale cached prices
    expect(res.body.sourceType).toBe("sold");
    expect(res.body.priceMinUsd).toBe(18);
  });

  it("returns cached data (fromCache: true) when cache is fresh and force is absent", async () => {
    // Confirm the inverse: without force, a fresh cache is returned immediately
    // and the paid Apify lookup is NOT called.
    const recentDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    selectResult = [
      {
        ...ITEM_ROW,
        ebayPriceCachedAt: recentDate,
        ebayPriceMinUsd: "25",
        ebayPriceMaxUsd: "55",
        ebayPriceMedianUsd: "40",
        ebayPriceListings: {
          sourceType: "active_listing",
          items: [],
        },
      },
    ];

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(200);
    expect(res.body.fromCache).toBe(true);
    // Paid lookup must NOT have been called
    expect(mockLookupEbayMarketValue).not.toHaveBeenCalled();
  });

  it("returns sourceType 'active_listing' when cached row has no sourceType key (pre-migration rows)", async () => {
    // Simulate a DB row cached before sourceType was introduced:
    // ebayPriceListings has { items: [...] } but no sourceType field.
    const recentDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago — well within 7-day window
    selectResult = [
      {
        id: 1,
        name: "McCoy Vase",
        maker: "McCoy",
        style: "Art Deco",
        ebayPriceCachedAt: recentDate,
        ebayPriceMinUsd: "25",
        ebayPriceMaxUsd: "55",
        ebayPriceMedianUsd: "40",
        // No sourceType key — exactly what a pre-migration cached row looks like
        ebayPriceListings: {
          items: [
            {
              title: "McCoy Vase (old cache)",
              priceUsd: 40,
              currency: "USD",
              soldDate: null,
              condition: "Good",
              imageUrl: null,
              itemUrl: "https://ebay.com/itm/old-cache-1",
            },
          ],
        },
      },
    ];

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post(
      "/pottery/items/1/estimate-market-value",
    );

    expect(res.status).toBe(200);
    // The safe default must be returned — not undefined, not null, not "sold"
    expect(res.body.sourceType).toBe("active_listing");
    expect(res.body.fromCache).toBe(true);
    expect(res.body.priceMinUsd).toBe(25);
    expect(res.body.listingCount).toBe(1);
    // The paid Apify scraper must NOT be called — cache was hit
    expect(mockLookupEbayMarketValue).not.toHaveBeenCalled();
  });
});
