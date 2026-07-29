/**
 * eBay sold-listings lookup for pottery items and ornaments.
 *
 * Uses the official eBay Finding API (findCompletedItems) to search sold +
 * completed listings — every result is a real transaction, not just an asking
 * price. Replaced the previous Apify scraper approach with the official API.
 *
 * For ornament lookups, also calls the Browse API to retrieve structured
 * item attributes (year, artist, series, theme) via aspect refinements.
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

  // If a UPC / item-number is provided, run both the UPC keyword search and the
  // text query in parallel; use whichever returns more results (UPC search is
  // usually more precise when the value matches a real eBay product page).
  const upcQuery = opts.upc?.trim();
  const [primaryResults, upcResults, aspectResult] = await Promise.all([
    findCompletedItems(query, 20),
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

  if (findingResults.length === 0) return null;

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
