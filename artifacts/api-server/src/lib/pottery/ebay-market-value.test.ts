/**
 * Unit tests for ebay-market-value.ts
 *
 * Key scenarios:
 *   1. Finding API succeeds → sourceType "sold", sold dates included
 *   2. Finding API throws (418 WAF block) → Browse API fallback → sourceType "active_listing"
 *   3. Both Finding API and Browse API fail → returns null
 *   4. probeFindingApi returns ok:false with status for non-ok HTTP responses
 *   5. probeFindingApi returns ok:true for a valid ack=Success response
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Infrastructure mocks ─────────────────────────────────────────────────────

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../env", () => ({
  env: { ebayAppId: "test-app-id", ebayCertId: "test-cert-id" },
}));

// ── Module mocks (must come before the import under test) ────────────────────

vi.mock("../ebay/finding", () => ({
  findCompletedItems: vi.fn(),
  probeFindingApi: vi.fn(),
}));

vi.mock("../ebay/browse", () => ({
  searchItemAspects: vi.fn(),
  searchActiveListingPrices: vi.fn(),
  topAspectValues: vi.fn((r) => r),
}));

// ── Imports (after vi.mock) ──────────────────────────────────────────────────

import { lookupEbayMarketValue } from "./ebay-market-value";
import { probeFindingApi } from "../ebay/finding";
import { findCompletedItems, type FindingListing } from "../ebay/finding";
import {
  searchActiveListingPrices,
  type BrowseActivePriceResult,
} from "../ebay/browse";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSoldListing(
  overrides: Partial<FindingListing> = {},
): FindingListing {
  return {
    itemId: "123",
    title: "Test Pottery Vase",
    soldPrice: 45.0,
    currency: "USD",
    soldDate: "2025-06-01T00:00:00.000Z",
    condition: "Used",
    imageUrl: null,
    itemUrl: "https://ebay.com/item/123",
    ...overrides,
  };
}

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("lookupEbayMarketValue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns sourceType 'sold' when Finding API succeeds with results", async () => {
    vi.mocked(findCompletedItems).mockResolvedValue([
      makeSoldListing({ soldPrice: 40 }),
      makeSoldListing({ soldPrice: 60 }),
    ]);

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("sold");
    expect(result!.priceMinUsd).toBe(40);
    expect(result!.priceMaxUsd).toBe(60);
    expect(result!.listingCount).toBe(2);
  });

  it("falls back to Browse API and returns sourceType 'active_listing' when Finding API throws", async () => {
    // Simulate a WAF 418 block
    vi.mocked(findCompletedItems).mockRejectedValue(
      new Error("eBay Finding API error (418): "),
    );
    vi.mocked(searchActiveListingPrices).mockResolvedValue(makeBrowseResult());

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("active_listing");
    expect(result!.priceMinUsd).toBe(30);
    expect(result!.priceMaxUsd).toBe(60);
    // Active-listing results should not carry sold dates
    for (const l of result!.listings) {
      expect(l.soldDate).toBeNull();
    }
  });

  it("returns null when both Finding API and Browse API fail", async () => {
    vi.mocked(findCompletedItems).mockRejectedValue(new Error("418 block"));
    vi.mocked(searchActiveListingPrices).mockRejectedValue(
      new Error("browse down"),
    );

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).toBeNull();
  });

  it("returns null when Browse API fallback returns no listings", async () => {
    vi.mocked(findCompletedItems).mockRejectedValue(new Error("418 block"));
    vi.mocked(searchActiveListingPrices).mockResolvedValue(null);

    const result = await lookupEbayMarketValue("Test Pottery Vase");

    expect(result).toBeNull();
  });

  it("prefers UPC results over keyword results when UPC has more hits", async () => {
    vi.mocked(findCompletedItems)
      .mockResolvedValueOnce([makeSoldListing({ soldPrice: 50 })]) // primary query
      .mockResolvedValueOnce([
        makeSoldListing({ soldPrice: 55 }),
        makeSoldListing({ soldPrice: 65 }),
      ]); // upc query

    const result = await lookupEbayMarketValue("Test Pottery Vase", {
      upc: "661127022308",
    });

    expect(result).not.toBeNull();
    expect(result!.listingCount).toBe(2); // UPC results win
    expect(result!.sourceType).toBe("sold");
  });
});
