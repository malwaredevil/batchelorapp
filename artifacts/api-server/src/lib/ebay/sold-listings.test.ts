/**
 * Unit tests for lib/ebay/sold-listings.ts
 *
 * Validates the actor contract mapping layer for caffein.dev/ebay-sold-listings:
 *   - `endedAt`     → EbaySoldListing.soldDate  (sale completion timestamp)
 *   - `soldCurrency`→ EbaySoldListing.currency   (ISO currency)
 *   - `price`       → EbaySoldListing.priceUsd   (final sold price)
 *   - `url`         → EbaySoldListing.itemUrl     (listing URL)
 *   - `imageUrl`    → EbaySoldListing.imageUrl    (thumbnail)
 *   - `scrapedAt` is NOT treated as the sale date (must be ignored)
 *   - Non-USD records are filtered out before aggregation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../apify-client", () => ({
  runApifyActor: vi.fn(),
}));

import { lookupEbaySoldListings } from "./sold-listings";
import { runApifyActor } from "../apify-client";

// Helpers ─────────────────────────────────────────────────────────────────────

/** Minimal valid actor record using the documented caffein.dev field names. */
function makeActorRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Hallmark Star Trek Ornament 2020",
    price: 28.5,
    soldCurrency: "USD",
    endedAt: "2026-07-10T15:30:00.000Z",
    condition: "Pre-Owned",
    url: "https://www.ebay.com/itm/12345",
    imageUrl: "https://i.ebayimg.com/images/g/abc/s-l300.jpg",
    // scrapedAt should NOT be mistaken for soldDate
    scrapedAt: "2026-08-14T08:00:00.000Z",
    ...overrides,
  };
}

// Tests ───────────────────────────────────────────────────────────────────────

describe("lookupEbaySoldListings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps documented actor fields to EbaySoldListing correctly", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([makeActorRecord()]);

    const result = await lookupEbaySoldListings(
      "Hallmark Star Trek 2020",
      "tok",
    );

    expect(result).not.toBeNull();
    expect(result!.listings).toHaveLength(1);

    const listing = result!.listings[0]!;
    expect(listing.title).toBe("Hallmark Star Trek Ornament 2020");
    expect(listing.priceUsd).toBe(28.5);
    expect(listing.currency).toBe("USD");
    // endedAt (sale date) must be used, NOT scrapedAt
    expect(listing.soldDate).toBe("2026-07-10T15:30:00.000Z");
    expect(listing.condition).toBe("Pre-Owned");
    expect(listing.itemUrl).toBe("https://www.ebay.com/itm/12345");
    expect(listing.imageUrl).toBe(
      "https://i.ebayimg.com/images/g/abc/s-l300.jpg",
    );
  });

  it("passes correct input schema to the actor (keyword + count + site)", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([makeActorRecord()]);

    await lookupEbaySoldListings("pottery vase", "my-token", 12);

    expect(runApifyActor).toHaveBeenCalledWith(
      "caffein.dev/ebay-sold-listings",
      expect.objectContaining({
        keyword: "pottery vase", // string, not array; not "keywords"
        count: 12, // "count", not "maxItems"
        site: 0, // US marketplace → USD
      }),
      "my-token",
      expect.any(Object),
    );
  });

  it("does not treat scrapedAt as the sold date when endedAt is absent", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([
      makeActorRecord({ endedAt: undefined }),
    ]);

    const result = await lookupEbaySoldListings("pottery vase", "tok");

    // scrapedAt must not be promoted to soldDate; result should have null soldDate
    expect(result!.listings[0]!.soldDate).toBeNull();
  });

  it("filters out non-USD records so *Usd aggregates remain accurate", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([
      makeActorRecord({ soldCurrency: "GBP", price: 20 }), // filtered out
      makeActorRecord({ soldCurrency: "USD", price: 35 }), // kept
    ]);

    const result = await lookupEbaySoldListings("pottery vase", "tok");

    expect(result).not.toBeNull();
    expect(result!.listingCount).toBe(1);
    expect(result!.priceMinUsd).toBe(35);
    expect(result!.priceMaxUsd).toBe(35);
  });

  it("returns null when all records are non-USD", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([
      makeActorRecord({ soldCurrency: "EUR" }),
    ]);

    const result = await lookupEbaySoldListings("pottery vase", "tok");

    expect(result).toBeNull();
  });

  it("computes correct min/max/median from multiple listings", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([
      makeActorRecord({ price: 10 }),
      makeActorRecord({ price: 20 }),
      makeActorRecord({ price: 30 }),
    ]);

    const result = await lookupEbaySoldListings("test item", "tok");

    expect(result!.priceMinUsd).toBe(10);
    expect(result!.priceMaxUsd).toBe(30);
    expect(result!.priceMedianUsd).toBe(20);
    expect(result!.listingCount).toBe(3);
  });

  it("returns null when the actor run fails", async () => {
    vi.mocked(runApifyActor).mockRejectedValue(new Error("Apify down"));

    const result = await lookupEbaySoldListings("test item", "tok");

    expect(result).toBeNull();
  });

  it("returns null when the actor returns no records", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([]);

    const result = await lookupEbaySoldListings("test item", "tok");

    expect(result).toBeNull();
  });

  it("skips records with no parseable price", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([
      makeActorRecord({ price: null }), // no price → skipped
      makeActorRecord({ price: 50 }), // valid
    ]);

    const result = await lookupEbaySoldListings("test item", "tok");

    expect(result!.listingCount).toBe(1);
    expect(result!.priceMinUsd).toBe(50);
  });
});
