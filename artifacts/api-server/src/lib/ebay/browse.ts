/**
 * eBay Browse API client.
 *
 * Uses the RESTful Browse API to search active listings and retrieve
 * structured item attributes (itemSpecifics / aspect refinements).
 * Requires an OAuth application token — call getEbayAppToken() first.
 *
 * Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 */

import { logger } from "../logger";
import { getEbayAppToken } from "./oauth";

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";

export interface BrowseAspect {
  name: string;
  /** Top values by listing count, descending */
  values: Array<{ value: string; matchCount: number }>;
}

export interface BrowseSearchResult {
  /** Structured aspect refinements (year, artist, series, theme, etc.) */
  aspects: BrowseAspect[];
  /** Total estimated matching listings */
  total: number;
}

export interface BrowseActiveListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition: string | null;
  imageUrl: string | null;
  itemUrl: string | null;
}

export interface BrowseActivePriceResult {
  priceMinUsd: number;
  priceMaxUsd: number;
  listingCount: number;
  /** Up to 10 sample listings (sorted cheapest-first). */
  listings: BrowseActiveListing[];
}

/**
 * Search active eBay listings and return aspect refinement data — the
 * structured attribute distribution across matching items (e.g. Year: 2003 ×5,
 * Artist: Kline-Gaughran ×3). Useful for auto-populating ornament fields from
 * a search query without parsing individual listing titles.
 *
 * Pass `categoryId` to constrain results (11116 = Collectibles > Christmas;
 * omit to search all categories).
 */
export async function searchItemAspects(
  query: string,
  opts: { categoryId?: string; limit?: number } = {},
): Promise<BrowseSearchResult> {
  const token = await getEbayAppToken();

  const params = new URLSearchParams({
    q: query,
    limit: String(opts.limit ?? 5),
    fieldgroups: "ASPECT_REFINEMENTS",
  });
  if (opts.categoryId) params.set("category_ids", opts.categoryId);

  const url = `${BROWSE_BASE}/item_summary/search?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `eBay Browse API error (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await resp.json()) as {
    total?: number;
    refinement?: {
      aspectDistributions?: Array<{
        localizedAspectName: string;
        aspectValueDistributions: Array<{
          localizedAspectValue: string;
          matchCount: number;
        }>;
      }>;
    };
  };

  const aspects: BrowseAspect[] = (
    data.refinement?.aspectDistributions ?? []
  ).map((dist) => ({
    name: dist.localizedAspectName,
    values: (dist.aspectValueDistributions ?? [])
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, 5)
      .map((v) => ({
        value: v.localizedAspectValue,
        matchCount: v.matchCount,
      })),
  }));

  logger.info(
    { query, total: data.total ?? 0, aspectCount: aspects.length },
    "ebay browse: searchItemAspects",
  );

  return { aspects, total: data.total ?? 0 };
}

/**
 * Search currently active (for-sale) eBay listings and return price range data.
 * Unlike findCompletedItems this reflects asking prices, not sold prices.
 */
export async function searchActiveListingPrices(
  query: string,
  opts: { limit?: number } = {},
): Promise<BrowseActivePriceResult | null> {
  const token = await getEbayAppToken();

  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(opts.limit ?? 50, 200)),
  });

  const url = `${BROWSE_BASE}/item_summary/search?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `eBay Browse active-listings error (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await resp.json()) as {
    total?: number;
    itemSummaries?: Array<{
      itemId?: string;
      title?: string;
      price?: { value?: string; currency?: string };
      condition?: string;
      image?: { imageUrl?: string };
      itemWebUrl?: string;
    }>;
  };

  const summaries = data.itemSummaries ?? [];
  if (summaries.length === 0) return null;

  const listings: BrowseActiveListing[] = [];
  for (const item of summaries) {
    const priceVal = parseFloat(item.price?.value ?? "");
    if (!Number.isFinite(priceVal) || priceVal <= 0) continue;
    listings.push({
      itemId: item.itemId ?? "",
      title: item.title ?? "",
      price: priceVal,
      currency: item.price?.currency ?? "USD",
      condition: item.condition ?? null,
      imageUrl: item.image?.imageUrl ?? null,
      itemUrl: item.itemWebUrl ?? null,
    });
  }

  if (listings.length === 0) return null;

  const prices = listings.map((l) => l.price);
  listings.sort((a, b) => a.price - b.price);

  logger.info(
    { query, total: data.total ?? 0, found: listings.length },
    "ebay browse: searchActiveListingPrices",
  );

  return {
    priceMinUsd: Math.min(...prices),
    priceMaxUsd: Math.max(...prices),
    listingCount: listings.length,
    listings: listings.slice(0, 10),
  };
}

/**
 * Convert a BrowseSearchResult's aspects into a flat key→top-value map.
 * Useful for quick attribute extraction (e.g. { Year: "2003", Theme: "Angel" }).
 */
export function topAspectValues(
  result: BrowseSearchResult,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const aspect of result.aspects) {
    const top = aspect.values[0];
    if (top) out[aspect.name] = top.value;
  }
  return out;
}
