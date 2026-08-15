/**
 * ebay-force-refresh-executor.test.ts
 *
 * Focused executor tests for estimate_pottery_market_value and
 * ornament_ebay_price_lookup, verifying that:
 *   1. force: true bypasses a fresh cache and calls the external lookup
 *   2. force omitted / false returns cached data without calling the lookup
 *   3. A stale cache always triggers a fresh lookup regardless of force
 *   4. 503 when eBay is not configured
 *   5. 404 when the item is not found
 *   6. 422 when the lookup returns no results
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimitMockFactory } from "./test-helpers/standard-mock-scaffold";

// ── Shared state (vi.hoisted so mocks can reference them) ─────────────────────

const { selectQueue, updateReturnQueue, ebayMocks, envMock, dbMock } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const updateReturnQueue: unknown[][] = [];

    function makeSelectBuilder() {
      let slot: unknown[] = [];
      const builder = {
        from() {
          slot = selectQueue.shift() ?? [];
          return builder;
        },
        where() {
          return Promise.resolve(slot);
        },
        limit() {
          return Promise.resolve(slot);
        },
        then<T, R = never>(
          onfulfilled?: ((value: unknown[]) => T | PromiseLike<T>) | null,
          onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
        ): Promise<T | R> {
          return Promise.resolve(slot).then(onfulfilled, onrejected) as Promise<
            T | R
          >;
        },
      };
      return builder;
    }

    function makeUpdateBuilder() {
      const returning = vi.fn(() => {
        const slot = updateReturnQueue.shift() ?? [];
        return Promise.resolve(slot);
      });
      const where = vi.fn(() => ({ returning }));
      const set = vi.fn(() => ({ where }));
      return { set };
    }

    const dbMock = {
      select: vi.fn(() => makeSelectBuilder()),
      update: vi.fn(() => makeUpdateBuilder()),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
      insert: vi.fn(() => ({})),
    };

    const ebayMocks = {
      lookupEbayMarketValue: vi.fn(async (_query: string) => ({
        priceMinUsd: 10,
        priceMaxUsd: 30,
        priceMedianUsd: 20,
        listingCount: 3,
        listings: [],
        sourceType: "active_listing" as const,
        itemSpecifics: {},
      })),
      lookupOrnamentEbayData: vi.fn(
        async (_query: string, _opts?: unknown) => ({
          forSale: {
            priceMinUsd: 15,
            priceMaxUsd: 40,
            listingCount: 5,
            listings: [],
          },
          lastSold: null,
          searchQuery: "Hallmark test 2003",
          cachedAt: new Date().toISOString(),
        }),
      ),
      buildEbayQuery: vi.fn((name: string, _opts?: unknown) => `${name} query`),
    };

    const envMock = {
      ebayAppId: "test-app-id",
      supabaseUrl: "https://test.supabase.co",
    };

    return {
      selectQueue,
      updateReturnQueue,
      ebayMocks,
      envMock,
      dbMock,
    };
  });

// ── Module mocks (must be at file top level, not inside vi.hoisted) ───────────

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/pottery/ebay-market-value", () => ({
  lookupEbayMarketValue: ebayMocks.lookupEbayMarketValue,
  lookupOrnamentEbayData: ebayMocks.lookupOrnamentEbayData,
  buildEbayQuery: ebayMocks.buildEbayQuery,
}));

vi.mock("../lib/env", () => ({ env: envMock }));

vi.mock("../lib/soft-delete", () => ({ logActivity: vi.fn() }));

vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());

vi.mock("../routes/pottery/pottery", () => ({
  runItemAnalysis: vi.fn(),
  bulkReanalyzePotteryItems: vi.fn(),
  promotePotteryImageToPrimary: vi.fn(),
  createPotteryItemFromBuffer: vi.fn(),
}));

vi.mock("../routes/pottery/categories", () => ({
  mergePotteryCategories: vi.fn(),
}));

vi.mock("../lib/pottery/storage", () => ({ deleteImage: vi.fn() }));

vi.mock("../routes/ornaments/ornaments", () => ({
  bulkReanalyzeOrnamentItems: vi.fn(),
  promoteOrnamentImageToPrimary: vi.fn(),
  createOrnamentItemFromBuffer: vi.fn(),
}));

vi.mock("../lib/ornaments/storage", () => ({ deleteImage: vi.fn() }));

// ── Subject imports (after mocks) ─────────────────────────────────────────────

import { consumeAiRateLimit } from "../middleware/rateLimit";
import { potteryActionExecutors } from "./pottery-actions";
import { ornamentActionExecutors } from "./ornaments-actions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FRESH_CACHE_DATE = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
const STALE_CACHE_DATE = new Date(
  Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days — beyond 7-day TTL
);

const POTTERY_ITEM_CACHED = {
  id: 42,
  name: "Blue Willow Bowl",
  maker: "Wedgwood",
  style: "Transferware",
  ebayPriceCachedAt: FRESH_CACHE_DATE,
  ebayPriceMinUsd: "12.50",
  ebayPriceMaxUsd: "28.00",
  ebayPriceMedianUsd: "18.00",
  ebayPriceListings: { sourceType: "active_listing", items: [{}] },
};

const POTTERY_ITEM_STALE = {
  ...POTTERY_ITEM_CACHED,
  ebayPriceCachedAt: STALE_CACHE_DATE,
};

const POTTERY_ITEM_NO_CACHE = {
  id: 42,
  name: "Blue Willow Bowl",
  maker: "Wedgwood",
  style: "Transferware",
  ebayPriceCachedAt: null,
  ebayPriceMinUsd: null,
  ebayPriceMaxUsd: null,
  ebayPriceMedianUsd: null,
  ebayPriceListings: null,
};

const UPDATED_POTTERY_ROW = {
  ebayPriceMinUsd: "10",
  ebayPriceMaxUsd: "30",
  ebayPriceMedianUsd: "20",
  ebayPriceCachedAt: new Date(),
};

const ORNAMENT_ITEM_CACHED = {
  id: 99,
  name: "Frosty Friends 2003",
  brand: "Hallmark",
  seriesOrCollection: "Frosty Friends",
  year: 2003,
  barcodeValue: "661127022308",
  ebayPriceCachedAt: FRESH_CACHE_DATE,
  ebayPriceMinUsd: "20.00",
  ebayPriceMaxUsd: "50.00",
  ebayPriceListings: [{}, {}],
  ebayLastSoldPriceUsd: "35.00",
  ebayLastSoldDate: FRESH_CACHE_DATE,
};

const ORNAMENT_ITEM_STALE = {
  ...ORNAMENT_ITEM_CACHED,
  ebayPriceCachedAt: STALE_CACHE_DATE,
};

// ── estimate_pottery_market_value ─────────────────────────────────────────────

describe("estimate_pottery_market_value executor", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateReturnQueue.length = 0;
    vi.clearAllMocks();
    envMock.ebayAppId = "test-app-id";
  });

  it("returns 503 when eBay is not configured", async () => {
    envMock.ebayAppId = "";
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(503);
  });

  it("returns 404 when item not found", async () => {
    selectQueue.push([]);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(404);
    expect(ebayMocks.lookupEbayMarketValue).not.toHaveBeenCalled();
  });

  it("returns cached data (fromCache: true) when cache is fresh and force is omitted", async () => {
    selectQueue.push([POTTERY_ITEM_CACHED]);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { fromCache: boolean } };
    expect(body.result.fromCache).toBe(true);
    expect(ebayMocks.lookupEbayMarketValue).not.toHaveBeenCalled();
  });

  it("returns cached data (fromCache: true) when cache is fresh and force is false", async () => {
    selectQueue.push([POTTERY_ITEM_CACHED]);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42, force: false } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { fromCache: boolean } };
    expect(body.result.fromCache).toBe(true);
    expect(ebayMocks.lookupEbayMarketValue).not.toHaveBeenCalled();
  });

  it("bypasses fresh cache and calls lookup when force is true", async () => {
    selectQueue.push([POTTERY_ITEM_CACHED]);
    updateReturnQueue.push([UPDATED_POTTERY_ROW]);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42, force: true } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { fromCache: boolean } };
    expect(body.result.fromCache).toBe(false);
    expect(ebayMocks.lookupEbayMarketValue).toHaveBeenCalledOnce();
  });

  it("calls lookup when cache is stale regardless of force flag", async () => {
    selectQueue.push([POTTERY_ITEM_STALE]);
    updateReturnQueue.push([UPDATED_POTTERY_ROW]);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(ebayMocks.lookupEbayMarketValue).toHaveBeenCalledOnce();
  });

  it("calls lookup when there is no cached data yet", async () => {
    selectQueue.push([POTTERY_ITEM_NO_CACHE]);
    updateReturnQueue.push([UPDATED_POTTERY_ROW]);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(ebayMocks.lookupEbayMarketValue).toHaveBeenCalledOnce();
  });

  it("returns 422 when the external lookup finds no listings", async () => {
    selectQueue.push([POTTERY_ITEM_NO_CACHE]);
    ebayMocks.lookupEbayMarketValue.mockResolvedValueOnce(null as never);
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(422);
  });

  it("returns 429 when rate-limited before a live lookup", async () => {
    selectQueue.push([POTTERY_ITEM_NO_CACHE]);
    vi.mocked(consumeAiRateLimit).mockResolvedValueOnce({ limited: true });
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(429);
    expect(ebayMocks.lookupEbayMarketValue).not.toHaveBeenCalled();
  });

  it("does not call rate limiter when returning fresh cached data", async () => {
    selectQueue.push([POTTERY_ITEM_CACHED]);
    await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(vi.mocked(consumeAiRateLimit)).not.toHaveBeenCalled();
  });

  it("returns 503 when the external lookup throws", async () => {
    selectQueue.push([POTTERY_ITEM_NO_CACHE]);
    ebayMocks.lookupEbayMarketValue.mockRejectedValueOnce(
      new Error("Apify timeout"),
    );
    const result = await potteryActionExecutors.estimate_pottery_market_value(
      { itemId: 42 } as never,
      1,
    );
    expect(result.status).toBe(503);
  });
});

// ── ornament_ebay_price_lookup ────────────────────────────────────────────────

describe("ornament_ebay_price_lookup executor", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateReturnQueue.length = 0;
    vi.clearAllMocks();
    envMock.ebayAppId = "test-app-id";
  });

  it("returns 503 when eBay is not configured", async () => {
    envMock.ebayAppId = "";
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(503);
  });

  it("returns 404 when ornament not found", async () => {
    selectQueue.push([]);
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(404);
    expect(ebayMocks.lookupOrnamentEbayData).not.toHaveBeenCalled();
  });

  it("returns cached data (fromCache: true) when cache is fresh and force is omitted", async () => {
    selectQueue.push([ORNAMENT_ITEM_CACHED]);
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { fromCache: boolean } };
    expect(body.result.fromCache).toBe(true);
    expect(ebayMocks.lookupOrnamentEbayData).not.toHaveBeenCalled();
  });

  it("returns cached data (fromCache: true) when cache is fresh and force is false", async () => {
    selectQueue.push([ORNAMENT_ITEM_CACHED]);
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99, force: false } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { fromCache: boolean } };
    expect(body.result.fromCache).toBe(true);
    expect(ebayMocks.lookupOrnamentEbayData).not.toHaveBeenCalled();
  });

  it("bypasses fresh cache and calls lookup when force is true", async () => {
    selectQueue.push([ORNAMENT_ITEM_CACHED]);
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99, force: true } as never,
      1,
    );
    expect(result.status).toBe(200);
    const body = result.body as { result: { fromCache: boolean } };
    expect(body.result.fromCache).toBe(false);
    expect(ebayMocks.lookupOrnamentEbayData).toHaveBeenCalledOnce();
  });

  it("calls lookup when cache is stale regardless of force flag", async () => {
    selectQueue.push([ORNAMENT_ITEM_STALE]);
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(200);
    expect(ebayMocks.lookupOrnamentEbayData).toHaveBeenCalledOnce();
  });

  it("returns 422 when the external lookup finds no listings", async () => {
    selectQueue.push([ORNAMENT_ITEM_STALE]);
    ebayMocks.lookupOrnamentEbayData.mockResolvedValueOnce(null as never);
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(422);
  });

  it("returns 503 when the external lookup throws", async () => {
    selectQueue.push([ORNAMENT_ITEM_STALE]);
    ebayMocks.lookupOrnamentEbayData.mockRejectedValueOnce(
      new Error("Apify timeout"),
    );
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(503);
  });

  it("returns 429 when rate-limited before a live lookup", async () => {
    selectQueue.push([ORNAMENT_ITEM_STALE]);
    vi.mocked(consumeAiRateLimit).mockResolvedValueOnce({ limited: true });
    const result = await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(result.status).toBe(429);
    expect(ebayMocks.lookupOrnamentEbayData).not.toHaveBeenCalled();
  });

  it("does not call rate limiter when returning fresh cached data", async () => {
    selectQueue.push([ORNAMENT_ITEM_CACHED]);
    await ornamentActionExecutors.ornament_ebay_price_lookup(
      { itemId: 99 } as never,
      1,
    );
    expect(vi.mocked(consumeAiRateLimit)).not.toHaveBeenCalled();
  });
});
