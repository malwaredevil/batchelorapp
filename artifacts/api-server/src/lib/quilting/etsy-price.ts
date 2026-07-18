/**
 * Etsy price suggestion for quilting shopping-list items (#215).
 *
 * Uses the `epctex/etsy-scraper` Apify actor — the most complete Etsy scraper
 * on the Apify Store (no official Etsy public API exists).
 */

import { runApifyActor } from "../apify-client";

export interface EtsyListing {
  title: string;
  priceUsd: number;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  seller: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
}

export interface EtsyPriceSuggestionResult {
  suggestionUsd: number;
  listingCount: number;
  listings: EtsyListing[];
  cachedAt: string;
}

const ACTOR_ID = "epctex/etsy-scraper";

export function buildEtsyQuery(
  name: string,
  type: "pattern" | "fabric" | "other",
  extras: {
    designer?: string | null;
    manufacturer?: string | null;
    colorway?: string | null;
  },
): string {
  const parts = [name];
  if (type === "pattern") {
    if (extras.designer) parts.push(extras.designer);
    parts.push("quilt pattern");
  } else if (type === "fabric") {
    if (extras.manufacturer) parts.push(extras.manufacturer);
    if (extras.colorway) parts.push(extras.colorway);
    parts.push("quilting fabric");
  }
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

export async function suggestEtsyPrice(
  query: string,
  apiToken: string,
): Promise<EtsyPriceSuggestionResult | null> {
  const items = await runApifyActor(
    ACTOR_ID,
    {
      search: query,
      maxItems: 10,
      startUrls: [],
    },
    apiToken,
    { timeoutMs: 90_000, maxItems: 10 },
  );

  const listings: EtsyListing[] = [];

  for (const item of items) {
    // epctex/etsy-scraper returns listings under various field names
    const price = parsePrice(
      item.price ?? item.priceValue ?? item.currentPrice,
    );
    if (price === null) continue;

    // Convert non-USD currencies (rough approximation — API returns in listing currency)
    const currency = String(item.currency ?? item.priceCurrency ?? "USD");

    listings.push({
      title: String(item.title ?? item.name ?? ""),
      priceUsd: price,
      currency,
      rating:
        typeof item.rating === "number"
          ? item.rating
          : typeof item.averageRating === "number"
            ? item.averageRating
            : null,
      reviewCount:
        typeof item.reviewCount === "number"
          ? item.reviewCount
          : typeof item.totalReviews === "number"
            ? item.totalReviews
            : null,
      seller: item.seller ? String(item.seller) : null,
      listingUrl:
        (item.listingUrl ?? item.url)
          ? String(item.listingUrl ?? item.url)
          : null,
      imageUrl:
        (item.primaryImage ?? item.imageUrl)
          ? String(item.primaryImage ?? item.imageUrl)
          : null,
    });
  }

  if (listings.length === 0) return null;

  const prices = listings.map((l) => l.priceUsd);
  return {
    suggestionUsd: median(prices),
    listingCount: listings.length,
    listings: listings.slice(0, 8),
    cachedAt: new Date().toISOString(),
  };
}
