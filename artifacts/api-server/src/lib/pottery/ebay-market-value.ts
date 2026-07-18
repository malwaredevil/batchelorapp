/**
 * eBay sold-listings lookup for pottery items and ornaments (#213, #214).
 *
 * Uses the `crawloop/ebay-sold-listings-scraper` Apify actor which searches
 * eBay's Sold + Completed filter so every result is a real transaction, not
 * just an asking price.
 */

import { runApifyActor } from "../apify-client";

export interface EbayListing {
  title: string;
  soldPrice: number;
  currency: string;
  soldDate: string | null;
  condition: string | null;
  imageUrl: string | null;
  itemUrl: string | null;
}

export interface EbayMarketValueResult {
  priceMinUsd: number;
  priceMaxUsd: number;
  priceMedianUsd: number;
  listingCount: number;
  listings: EbayListing[];
  cachedAt: string;
}

const ACTOR_ID = "crawloop/ebay-sold-listings-scraper";

function buildQuery(
  name: string,
  extras: {
    maker?: string | null;
    style?: string | null;
    year?: number | null;
    brand?: string | null;
    seriesOrCollection?: string | null;
  },
): string {
  const parts = [name];
  if (extras.maker) parts.push(extras.maker);
  if (extras.seriesOrCollection) parts.push(extras.seriesOrCollection);
  if (extras.style && !extras.seriesOrCollection) parts.push(extras.style);
  if (extras.year) parts.push(String(extras.year));
  if (extras.brand && extras.brand !== "Hallmark") parts.push(extras.brand);
  return parts.filter(Boolean).join(" ");
}

function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function lookupEbayMarketValue(
  query: string,
  apiToken: string,
): Promise<EbayMarketValueResult | null> {
  const items = await runApifyActor(
    ACTOR_ID,
    {
      searchQuery: query,
      maxResults: 20,
      soldListingsOnly: true,
    },
    apiToken,
    { timeoutMs: 60_000, maxItems: 20 },
  );

  const listings: EbayListing[] = [];

  for (const item of items) {
    const price = parsePrice(item.soldPrice ?? item.price);
    if (price === null) continue;

    listings.push({
      title: String(item.title ?? ""),
      soldPrice: price,
      currency: String(item.currency ?? "USD"),
      soldDate: item.soldDate ? String(item.soldDate) : null,
      condition: item.condition ? String(item.condition) : null,
      imageUrl: item.imageUrl ? String(item.imageUrl) : null,
      itemUrl:
        (item.itemUrl ?? item.url) ? String(item.itemUrl ?? item.url) : null,
    });
  }

  if (listings.length === 0) return null;

  const prices = listings.map((l) => l.soldPrice);
  return {
    priceMinUsd: Math.min(...prices),
    priceMaxUsd: Math.max(...prices),
    priceMedianUsd: median(prices),
    listingCount: listings.length,
    listings: listings.slice(0, 10),
    cachedAt: new Date().toISOString(),
  };
}

export { buildQuery as buildEbayQuery };
