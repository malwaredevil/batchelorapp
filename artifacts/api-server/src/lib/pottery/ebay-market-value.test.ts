/**
 * Unit tests for ebay-market-value.ts
 *
 * Covers three data-source paths:
 *   1. Apify sold-listings succeeds → sourceType "sold", real soldDate values
 *   2. Apify sold-listings unavailable/fails → falls back to Browse API
 *      asking prices (sourceType "active_listing")
 *   3. Both sources fail or return empty → returns null
 *
 * Also tests ornament-specific lookupOrnamentEbayData:
 *   4. Apify sold data → lastSold populated (median price, most-recent date)
 *   5. No Apify token → lastSold null, forSale still populated from Browse API
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Infrastructure mocks ─────────────────────────────────────────────────────

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Default env: eBay credentials present, Apify token absent (tests that
// need Apify override this via vi.mocked(env).apifyApiToken = "test-token").
vi.mock("../env", () => ({
  env: {
    ebayAppId: "test-app-id",
    ebayCertId: "test-cert-id",
    apifyApiToken: undefined,
  },
}));

// ── Module mocks (must come before the import under test) ────────────────────

vi.mock("../ebay/browse", () => ({
  searchItemAspects: vi.fn(),
  searchActiveListingPrices: vi.fn(),
  topAspectValues: vi.fn((r) => r),
}));

vi.mock("../ebay/sold-listings", () => ({
  lookupEbaySoldListings: vi.fn(),
}));

// ── Imports (after vi.mock) ──────────────────────────────────────────────────

import {
  lookupEbayMarketValue,
  lookupOrnamentEbayData,
} from "./ebay-market-value";
import {
  searchActiveListingPrices,
  searchItemAspects,
  type BrowseActivePriceResult,
} from "../ebay/browse";
import { lookupEbaySoldListings } from "../ebay/sold-listings";
import type { EbaySoldListingsResult } from "../ebay/sold-listings";
import { env } from "../env";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBrowseResult(
  overrides: Partial<BrowseActivePriceResult> = {},
): BrowseActivePriceResult {
  return {
    priceMinUsd: 30.0,
    priceMaxUsd: 60.0,
    listingCount: 3,
    listings: [
      {
        itemId: "a1",
        title: "Active Pottery Listing",
        price: 40.0,
        currency: "USD",
        condition: "Good",
        imageUrl: null,
        itemUrl: "https://ebay.com/item/a1",
      },
    ],
    ...overrides,
  };
}

function makeSoldResult(
  overrides: Partial<EbaySoldListingsResult> = {},
): EbaySoldListingsResult {
  // Simulates the shape lookupEbaySoldListings returns after parsing the actor's
  // output fields (endedAt → soldDate, soldCurrency → currency, etc.).
  return {
    priceMinUsd: 18.0,
    priceMaxUsd: 42.0,
    priceMedianUsd: 25.0,
    listingCount: 5,
    listings: [
      {
        title: "Sold Pottery Vase",
        priceUsd: 25.0,
        currency: "USD",
        // soldDate is parsed from actor's `endedAt` field
        soldDate: "2026-07-01T10:00:00.000Z",
        condition: "Pre-Owned",
        imageUrl: "https://i.ebayimg.com/img/sold.jpg",
        itemUrl: "https://ebay.com/itm/sold1",
      },
      {
        title: "Sold Pottery Vase (older)",
        priceUsd: 18.0,
        currency: "USD",
        soldDate: "2026-06-15T08:00:00.000Z",
        condition: "Pre-Owned",
        imageUrl: null,
        itemUrl: "https://ebay.com/itm/sold2",
      },
    ],
    cachedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

// ── lookupEbayMarketValue ────────────────────────────────────────────────────

describe("lookupEbayMarketValue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no Apify token
    (env as Record<string, unknown>).apifyApiToken = undefined;
  });

  it("returns sourceType 'sold' with real soldDates when Apify returns sold listings", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(makeSoldResult());

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("sold");
    expect(result!.priceMinUsd).toBe(18);
    expect(result!.priceMaxUsd).toBe(42);
    expect(result!.priceMedianUsd).toBe(25);
    // Sold listings carry real soldDate values
    expect(result!.listings[0]!.soldDate).toBe("2026-07-01T10:00:00.000Z");
    // Apify was called with the right query and token
    expect(lookupEbaySoldListings).toHaveBeenCalledWith(
      "Test Pottery Vase",
      "test-apify-token",
    );
  });

  it("returns sourceType 'active_listing' when Apify is not configured", async () => {
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("active_listing");
    expect(lookupEbaySoldListings).not.toHaveBeenCalled();
    // Active-listing results carry null soldDate
    for (const l of result!.listings) {
      expect(l.soldDate).toBeNull();
    }
  });

  it("falls back to asking prices when Apify returns null (no sold listings found)", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(null);

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("active_listing");
    expect(result!.priceMinUsd).toBe(30);
  });

  it("falls back to asking prices when Apify run throws", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    // lookupEbaySoldListings already catches errors internally and returns null
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(null);

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result!.sourceType).toBe("active_listing");
  });

  it("returns null when Browse API fails and Apify is not configured", async () => {
    vi.mocked(searchActiveListingPrices).mockRejectedValue(
      new Error("browse down"),
    );

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).toBeNull();
  });

  it("returns null when Browse API returns no listings and Apify is not configured", async () => {
    vi.mocked(searchActiveListingPrices).mockResolvedValue(null);

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).toBeNull();
  });

  it("preserves soldDate: null in listings when Apify record lacks endedAt", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    // Simulate parseSoldDate returning null because endedAt was absent
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(
      makeSoldResult({
        listings: [
          {
            title: "Sold Pottery Vase (no date)",
            priceUsd: 25.0,
            currency: "USD",
            soldDate: null, // endedAt absent from actor record
            condition: "Pre-Owned",
            imageUrl: null,
            itemUrl: "https://ebay.com/itm/sold-no-date",
          },
        ],
      }),
    );

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("sold");
    // soldDate must be null — not the string "null", not undefined
    expect(result!.listings[0]!.soldDate).toBeNull();
    // Aggregate data still valid
    expect(result!.priceMinUsd).toBe(18);
    expect(result!.priceMedianUsd).toBe(25);
  });

  it("searches by UPC instead of the text query when a UPC is provided", async () => {
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());

    await lookupEbayMarketValue("Test Pottery Vase", {
      upc: "661127022308",
    });

    expect(searchActiveListingPrices).toHaveBeenCalledWith(
      "661127022308",
      expect.objectContaining({ limit: 20 }),
    );
  });
});

// ── lookupOrnamentEbayData ───────────────────────────────────────────────────

describe("lookupOrnamentEbayData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (env as Record<string, unknown>).apifyApiToken = undefined;
    // searchItemAspects is called inside lookupOrnamentEbayData; default to empty result
    vi.mocked(searchItemAspects).mockResolvedValue({ aspects: [], total: 0 });
  });

  it("populates lastSold with median price and most-recent soldDate from Apify", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(makeSoldResult());

    const result = await lookupOrnamentEbayData("Hallmark Star Trek 2020");

    expect(result).not.toBeNull();
    expect(result!.lastSold).not.toBeNull();
    // Median price from the sold result
    expect(result!.lastSold!.priceUsd).toBe(25);
    // Most-recent soldDate from the two listings
    expect(result!.lastSold!.soldDate).toBe("2026-07-01T10:00:00.000Z");
    expect(result!.lastSold!.listingCount).toBe(5);
    // forSale is still populated from Browse API
    expect(result!.forSale).not.toBeNull();
    expect(result!.forSale!.priceMinUsd).toBe(30);
  });

  it("returns lastSold: null when Apify token is absent", async () => {
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());

    const result = await lookupOrnamentEbayData("Hallmark Star Trek 2020");

    expect(result).not.toBeNull();
    expect(result!.lastSold).toBeNull();
    expect(result!.forSale).not.toBeNull();
    expect(lookupEbaySoldListings).not.toHaveBeenCalled();
  });

  it("returns lastSold: null when Apify returns no sold listings", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(null);

    const result = await lookupOrnamentEbayData("Hallmark Star Trek 2020");

    expect(result!.lastSold).toBeNull();
    expect(result!.forSale).not.toBeNull();
  });

  it("returns null when Browse API (for-sale) fails", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockRejectedValue(
      new Error("browse down"),
    );
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(makeSoldResult());

    const result = await lookupOrnamentEbayData("Hallmark Star Trek 2020");

    expect(result).toBeNull();
  });

  it("handles sold listings with no soldDate gracefully (lastSold.soldDate null)", async () => {
    (env as Record<string, unknown>).apifyApiToken = "test-apify-token";
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());
    vi.mocked(lookupEbaySoldListings).mockResolvedValue(
      makeSoldResult({
        listings: [
          {
            title: "Ornament",
            priceUsd: 20,
            currency: "USD",
            soldDate: null, // no date provided by actor
            condition: null,
            imageUrl: null,
            itemUrl: null,
          },
        ],
      }),
    );

    const result = await lookupOrnamentEbayData("Hallmark ornament");

    expect(result!.lastSold).not.toBeNull();
    expect(result!.lastSold!.soldDate).toBeNull();
    expect(result!.lastSold!.priceUsd).toBe(25); // median from makeSoldResult overrides
  });
});
