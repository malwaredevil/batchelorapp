/**
 * eBay market value lookup for pottery items and ornaments.
 *
 * Primary source: eBay Browse API (RESTful, OAuth-based) for current
 * asking-price ranges and structured item attributes via aspect refinements.
 *
 * Sold-price source: Apify `epctex/ebay-scraper` actor (type "SOLD") when
 * APIFY_API_TOKEN is configured.  The legacy Finding API is permanently
 * blocked by eBay's own WAF (418 on every request from any network) and is
 * no longer called — see lib/ebay/finding.ts for the reference implementation.
 *
 * ## Cost note (Apify sold-price lookups)
 * Each sold-price lookup triggers an Apify actor run that consumes paid
 * Apify platform credits — roughly $0.02–0.10 USD per call at typical run
 * sizes (≤15 items, 256 MB, ~30–60 s).  Lookups are only performed when the
 * user explicitly requests an eBay price refresh (never on page loads or
 * background jobs) and only when `env.apifyApiToken` is set.  If Apify is
 * unavailable or the actor returns no sold results, the function degrades
 * gracefully to Browse API asking-price data (sourceType "active_listing").
 */

import { env } from "../env";
import {
  searchItemAspects,
  searchActiveListingPrices,
  topAspectValues,
  type BrowseActiveListing,
} from "../ebay/browse";
import { lookupEbaySoldListings } from "../ebay/sold-listings";
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
   * Always "active_listing" now that the Finding API (the only "sold" source)
   * is retired — kept as a discriminated field so existing callers/DB rows
   * that branch on it keep working. See module header for context.
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
 * Look up eBay market value for an item.
 *
 * Always fetches current asking prices from the Browse API. When
 * `env.apifyApiToken` is configured, also attempts a sold-price lookup via
 * the Apify `epctex/ebay-scraper` actor; if that succeeds the returned
 * `sourceType` is `"sold"` and each listing carries a real `soldDate`.
 * If the Apify run fails or returns no results, the function falls back
 * gracefully to Browse API data with `sourceType: "active_listing"`.
 *
 * @param query       Search query (use buildEbayQuery to construct, or pass a
 *                    UPC / Hallmark item number directly — eBay handles all of
 *                    these as keywords and matches them to product listings).
 * @param opts.upc    Optional raw UPC or Hallmark SKU (e.g. "661127022308" or
 *                    "QXI7404"). When provided, the UPC is used as the primary
 *                    search term for both Browse API and the Apify scraper.
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
  const effectiveQuery = upcQuery ?? query;

  // Run Browse API (asking prices + optional aspects) and Apify sold-price
  // scraper in parallel. The Apify call is skipped when the token is absent.
  const [browseResult, aspectResult, soldResult] = await Promise.all([
    searchActiveListingPrices(effectiveQuery, { limit: 20 }).catch(
      (err: unknown) => {
        logger.warn(
          { err, query: effectiveQuery },
          "ebay browse active-listing search failed",
        );
        return null;
      },
    ),
    opts.withAspects
      ? searchItemAspects(effectiveQuery).catch((err) => {
          logger.warn(
            { err, query: effectiveQuery },
            "ebay browse aspects fetch failed (non-fatal)",
          );
          return null;
        })
      : Promise.resolve(null),
    env.apifyApiToken
      ? lookupEbaySoldListings(effectiveQuery, env.apifyApiToken)
      : Promise.resolve(null),
  ]);

  // Prefer sold-price data when available; fall back to asking prices.
  if (soldResult && soldResult.listings.length > 0) {
    const listings: EbayListing[] = soldResult.listings.map((l) => ({
      title: l.title,
      soldPrice: l.priceUsd,
      currency: l.currency,
      soldDate: l.soldDate,
      condition: l.condition,
      imageUrl: l.imageUrl,
      itemUrl: l.itemUrl,
    }));

    return {
      priceMinUsd: soldResult.priceMinUsd,
      priceMaxUsd: soldResult.priceMaxUsd,
      priceMedianUsd: soldResult.priceMedianUsd,
      listingCount: soldResult.listingCount,
      listings,
      cachedAt: soldResult.cachedAt,
      sourceType: "sold",
      itemSpecifics: aspectResult ? topAspectValues(aspectResult) : undefined,
    };
  }

  // Apify unavailable or returned nothing — use Browse API asking prices.
  if (!browseResult || browseResult.listings.length === 0) return null;

  const listings: EbayListing[] = browseResult.listings.map((l) => ({
    title: l.title,
    soldPrice: l.price, // field name kept for compatibility — this is an asking price
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
  /**
   * Always null now that the Finding API (the only sold-price source) is
   * retired — kept on the type so existing callers/DB rows/UI branches that
   * check for it keep compiling and degrade gracefully. See module header.
   */
  lastSold: OrnamentEbayLastSold | null;
  itemSpecifics: Record<string, string> | undefined;
  searchQuery: string;
  cachedAt: string;
}

/**
 * Look up eBay market data for an ornament:
 *  - forSale: current active-listing price range (Browse API)
 *  - lastSold: most-recent sold price via Apify scraper (when configured)
 *  - itemSpecifics: structured attributes from Browse API aspects
 *
 * When `env.apifyApiToken` is set, `lastSold` is populated from the Apify
 * `epctex/ebay-scraper` actor (type "SOLD").  If the Apify run fails or
 * returns no sold listings, `lastSold` is null and the function degrades
 * gracefully to asking-price-only data.
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

  const [forSaleResult, aspectResult, soldResult] = await Promise.all([
    // Current active listings (asking prices)
    searchActiveListingPrices(effectiveQuery).catch((err) => {
      logger.warn(
        { err, query: effectiveQuery },
        "ebay for-sale search failed (non-fatal)",
      );
      return null;
    }),
    // Item specifics via Browse aspects
    searchItemAspects(effectiveQuery).catch((err) => {
      logger.warn(
        { err, query: effectiveQuery },
        "ebay aspects fetch failed (non-fatal)",
      );
      return null;
    }),
    // Sold/completed listings via Apify (skipped when token absent)
    env.apifyApiToken
      ? lookupEbaySoldListings(effectiveQuery, env.apifyApiToken)
      : Promise.resolve(null),
  ]);

  if (!forSaleResult) return null;

  // Build lastSold from Apify results: use the median price across sold
  // listings as the representative "last sold" price, and pick the most
  // recent soldDate found in the result set.
  let lastSold: OrnamentEbayLastSold | null = null;
  if (soldResult && soldResult.listings.length > 0) {
    const mostRecentDate =
      soldResult.listings
        .map((l) => l.soldDate)
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null;

    lastSold = {
      priceUsd: soldResult.priceMedianUsd,
      soldDate: mostRecentDate,
      listingCount: soldResult.listingCount,
    };
  }

  return {
    forSale: forSaleResult,
    lastSold,
    itemSpecifics: aspectResult ? topAspectValues(aspectResult) : undefined,
    searchQuery: query,
    cachedAt: new Date().toISOString(),
  };
}
