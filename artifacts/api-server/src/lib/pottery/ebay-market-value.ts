/**
 * eBay sold-listings lookup for pottery items and ornaments.
 *
 * Uses the official eBay Finding API (findCompletedItems) to search sold +
 * completed listings — every result is a real transaction, not just an asking
 * price. Replaced the previous Apify scraper approach with the official API.
 *
 * For ornament lookups, also calls the Browse API to retrieve structured
 * item attributes (year, artist, series, theme) via aspect refinements.
 *
 * Fallback behaviour
 * ------------------
 * When the Finding API is unavailable (e.g. 418 WAF block, quota exhaustion,
 * or API deprecation), `lookupEbayMarketValue` falls back to the Browse API's
 * active-listing prices. Results from this fallback are marked
 * `sourceType: "active_listing"` so callers can display appropriate wording
 * ("current asking prices" instead of "recent sold prices").
 */

import { env } from "../env";
import { findCompletedItems, type FindingListing } from "../ebay/finding";
import {
  searchItemAspects,
  searchActiveListingPrices,
  topAspectValues,
  type BrowseActiveListing,
} from "../ebay/browse";
import { logger } from "../logger";

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
  /**
   * Indicates whether prices came from real sold/completed listings ("sold") or
   * from the Browse API's active-listing fallback ("active_listing"). Callers
   * should adjust copy accordingly — e.g. "recent sold prices" vs "current
   * asking prices". Defaults to "sold" when the Finding API works normally.
   */
  sourceType: "sold" | "active_listing";
  /** Structured item attributes from Browse API aspect refinements (ornament lookups only). */
  itemSpecifics?: Record<string, string>;
}

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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Look up eBay sold-listing market value for an item.
 *
 * @param query       Search query (use buildEbayQuery to construct, or pass a
 *                    UPC / Hallmark item number directly — eBay handles all of
 *                    these as keywords and matches them to product listings).
 * @param opts.upc    Optional raw UPC or Hallmark SKU (e.g. "661127022308" or
 *                    "QXI7404"). When provided, the function tries a direct UPC
 *                    keyword search alongside the text query and uses whichever
 *                    returns more sold listings.
 * @param opts.withAspects If true, also calls the Browse API for structured item
 *                    attributes (year, artist, series, etc.). Adds ~1s latency.
 */
export async function lookupEbayMarketValue(
  query: string,
  opts: { withAspects?: boolean; upc?: string | null } = {},
): Promise<EbayMarketValueResult | null> {
  if (!env.ebayAppId) {
    throw new Error("eBay API not configured (EBAY_APP_ID missing)");
  }

  const upcQuery = opts.upc?.trim();

  // Run Finding API searches + aspect lookup in parallel.
  // Both the primary keyword search and the UPC search are non-fatal:
  // if the Finding API is blocked (e.g. 418 WAF) we fall back to Browse API
  // active-listing prices rather than propagating the error to the caller.
  const [primaryResults, upcResults, aspectResult] = await Promise.all([
    findCompletedItems(query, 20).catch((err: unknown) => {
      logger.warn(
        { err, query },
        "ebay finding: primary keyword search failed (will attempt Browse API fallback)",
      );
      return [] as FindingListing[];
    }),
    upcQuery && upcQuery !== query
      ? findCompletedItems(upcQuery, 20).catch((err: unknown) => {
          logger.warn(
            { err, upc: upcQuery },
            "ebay upc keyword search failed (non-fatal)",
          );
          return [] as FindingListing[];
        })
      : Promise.resolve([] as FindingListing[]),
    opts.withAspects
      ? searchItemAspects(upcQuery ?? query).catch((err) => {
          logger.warn(
            { err, query },
            "ebay browse aspects fetch failed (non-fatal)",
          );
          return null;
        })
      : Promise.resolve(null),
  ]);

  // Prefer UPC results when they outnumber the text-query results (better precision)
  const findingResults =
    upcResults.length >= primaryResults.length && upcResults.length > 0
      ? upcResults
      : primaryResults;

  // ── Finding API fallback: use Browse API active-listing prices ──────────────
  // When the Finding API returns nothing (API down, WAF block, quota exceeded,
  // or genuine zero results), try the Browse API for current asking prices.
  // This keeps the feature working with degraded data rather than failing hard.
  if (findingResults.length === 0) {
    const browseResult = await searchActiveListingPrices(upcQuery ?? query, {
      limit: 20,
    }).catch((err: unknown) => {
      logger.warn(
        { err, query },
        "ebay browse active-listing fallback also failed",
      );
      return null;
    });

    if (!browseResult || browseResult.listings.length === 0) return null;

    logger.info(
      { query, found: browseResult.listings.length },
      "ebay finding: using Browse API active-listing fallback (Finding API returned 0 results)",
    );

    const listings: EbayListing[] = browseResult.listings.map((l) => ({
      title: l.title,
      soldPrice: l.price, // repurposed field: asking price, not sold price
      currency: l.currency,
      soldDate: null,
      condition: l.condition,
      imageUrl: l.imageUrl,
      itemUrl: l.itemUrl,
    }));

    const prices = listings.map((l) => l.soldPrice);
    return {
      priceMinUsd: browseResult.priceMinUsd,
      priceMaxUsd: browseResult.priceMaxUsd,
      priceMedianUsd: median(prices),
      listingCount: listings.length,
      listings: listings.slice(0, 10),
      cachedAt: new Date().toISOString(),
      sourceType: "active_listing",
      itemSpecifics: aspectResult ? topAspectValues(aspectResult) : undefined,
    };
  }
  // ───────────────────────────────────────────────────────────────────────────

  const listings: EbayListing[] = findingResults.map((l) => ({
    title: l.title,
    soldPrice: l.soldPrice,
    currency: l.currency,
    soldDate: l.soldDate,
    condition: l.condition,
    imageUrl: l.imageUrl,
    itemUrl: l.itemUrl,
  }));

  const prices = listings.map((l) => l.soldPrice);
  return {
    priceMinUsd: Math.min(...prices),
    priceMaxUsd: Math.max(...prices),
    priceMedianUsd: median(prices),
    listingCount: listings.length,
    listings: listings.slice(0, 10),
    cachedAt: new Date().toISOString(),
    sourceType: "sold",
    itemSpecifics: aspectResult ? topAspectValues(aspectResult) : undefined,
  };
}

export { buildQuery as buildEbayQuery };

// ---------------------------------------------------------------------------
// Ornament-specific eBay lookup: for-sale range + last sold (2 years)
// ---------------------------------------------------------------------------

export interface OrnamentEbayForSale {
  priceMinUsd: number;
  priceMaxUsd: number;
  listingCount: number;
  listings: BrowseActiveListing[];
}

export interface OrnamentEbayLastSold {
  priceUsd: number;
  soldDate: string | null;
  listingCount: number;
}

export interface OrnamentEbayData {
  forSale: OrnamentEbayForSale | null;
  lastSold: OrnamentEbayLastSold | null;
  itemSpecifics: Record<string, string> | undefined;
  searchQuery: string;
  cachedAt: string;
}

/**
 * Look up eBay market data for an ornament:
 *  - forSale: current active-listing price range (Browse API)
 *  - lastSold: most recent sold price within the past 2 years (Finding API)
 *  - itemSpecifics: structured attributes from Browse API aspects
 */
export async function lookupOrnamentEbayData(
  query: string,
  opts: { upc?: string | null } = {},
): Promise<OrnamentEbayData | null> {
  if (!env.ebayAppId) {
    throw new Error("eBay API not configured (EBAY_APP_ID missing)");
  }

  const upcQuery = opts.upc?.trim();
  const effectiveQuery = upcQuery ?? query;

  const [forSaleResult, soldResults, soldResultsUpc, aspectResult] =
    await Promise.all([
      // Current active listings (asking prices)
      searchActiveListingPrices(effectiveQuery).catch((err) => {
        logger.warn(
          { err, query: effectiveQuery },
          "ebay for-sale search failed (non-fatal)",
        );
        return null;
      }),
      // Sold listings — past 2 years (730 days), most recent first
      findCompletedItems(query, 20, 730).catch((err) => {
        logger.warn(
          { err, query },
          "ebay sold search (text query) failed (non-fatal)",
        );
        return [] as FindingListing[];
      }),
      // UPC-based sold listings (more precise when available)
      upcQuery && upcQuery !== query
        ? findCompletedItems(upcQuery, 20, 730).catch((err) => {
            logger.warn(
              { err, upc: upcQuery },
              "ebay sold search (upc) failed (non-fatal)",
            );
            return [] as FindingListing[];
          })
        : Promise.resolve([] as FindingListing[]),
      // Item specifics via Browse aspects
      searchItemAspects(effectiveQuery).catch((err) => {
        logger.warn(
          { err, query: effectiveQuery },
          "ebay aspects fetch failed (non-fatal)",
        );
        return null;
      }),
    ]);

  // Prefer UPC sold results when they are more numerous
  const soldListing =
    soldResultsUpc.length >= soldResults.length && soldResultsUpc.length > 0
      ? soldResultsUpc
      : soldResults;

  const lastSold: OrnamentEbayLastSold | null =
    soldListing.length > 0
      ? {
          priceUsd: soldListing[0].soldPrice,
          soldDate: soldListing[0].soldDate,
          listingCount: soldListing.length,
        }
      : null;

  if (!forSaleResult && !lastSold) return null;

  return {
    forSale: forSaleResult,
    lastSold,
    itemSpecifics: aspectResult ? topAspectValues(aspectResult) : undefined,
    searchQuery: query,
    cachedAt: new Date().toISOString(),
  };
}
