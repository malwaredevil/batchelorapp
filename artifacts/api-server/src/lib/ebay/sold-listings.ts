/**
 * eBay completed/sold-listings scraper via Apify.
 *
 * Uses the `caffein.dev/ebay-sold-listings` actor on Apify Store — the most
 * widely used eBay sold-listings scraper (368 K+ runs, ~99 % success rate,
 * actively maintained at version 1.19 as of 2026-08-15). It scrapes eBay's
 * "Sold Items" results pages and returns one structured record per completed
 * sale. No eBay Developer credentials are required — authentication is handled
 * by the actor itself.
 *
 * ## Cost implications
 * The actor uses Apify's pay-per-event billing model. Each lookup starts one
 * actor run, which typically costs roughly $0.05–0.15 USD depending on Apify
 * plan pricing and the number of results requested. Calls are made only when
 * the user explicitly triggers an eBay price refresh (never on page loads or
 * background jobs) and only when APIFY_API_TOKEN is set, so the feature is
 * opt-in at the infrastructure level.
 *
 * ## Actor: caffein.dev/ebay-sold-listings
 * https://apify.com/caffein.dev/ebay-sold-listings
 *
 * Input schema (relevant fields used here):
 *   keyword  — search term string (e.g. "Hallmark ornament 2020")
 *   count    — maximum number of results to return
 *   site     — eBay site (0 = ebay.com/USD; default is US)
 *
 * Each output record includes (documented field names):
 *   title       — listing title
 *   price       — final sold price (number)
 *   soldCurrency — ISO currency code (e.g. "USD")
 *   endedAt     — sale completion timestamp (ISO string)
 *   condition   — localized item condition label
 *   url         — eBay listing URL
 *   imageUrl    — thumbnail image URL
 *   scrapedAt   — time the record was scraped (NOT the sale date; do not use)
 */

import { runApifyActor } from "../apify-client";
import { logger } from "../logger";

const ACTOR_ID = "caffein.dev/ebay-sold-listings";

export interface EbaySoldListing {
  title: string;
  priceUsd: number;
  currency: string;
  soldDate: string | null;
  condition: string | null;
  imageUrl: string | null;
  itemUrl: string | null;
}

export interface EbaySoldListingsResult {
  priceMinUsd: number;
  priceMaxUsd: number;
  priceMedianUsd: number;
  listingCount: number;
  listings: EbaySoldListing[];
  cachedAt: string;
}

function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    // Strip currency symbols, commas, etc.: "$12,345.67" → 12345.67
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Parse the sale completion timestamp from an actor record.
 * caffein.dev/ebay-sold-listings documents the field as `endedAt`.
 * `scrapedAt` is the time the record was scraped — not the sale date — and
 * must not be used as a sale date.
 */
function parseSoldDate(item: Record<string, unknown>): string | null {
  // `endedAt` is the documented sale-completion timestamp for this actor.
  // `soldDate` / `dateSold` are kept as backward-compatible fallbacks only.
  const raw = item.endedAt ?? item.soldDate ?? item.dateSold ?? item.endDate;
  if (!raw) return null;
  try {
    const d = new Date(String(raw));
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * Look up recently-sold eBay listings for a given search query via Apify.
 *
 * Only USD-denominated results are included in the return value. Records in
 * other currencies (returned when the actor uses non-US eBay sites) are
 * discarded so that callers can rely on the `*Usd` fields being accurate.
 *
 * Returns null if the actor returns no USD sold listings, or if the run
 * fails (errors are logged but not re-thrown so callers can degrade
 * gracefully to asking-price Browse API data).
 *
 * @param query     Search query — same string passed to the Browse API.
 * @param apiToken  Apify API token (`env.apifyApiToken`).
 * @param count     Maximum number of sold listings to request (default 15).
 */
export async function lookupEbaySoldListings(
  query: string,
  apiToken: string,
  count = 15,
): Promise<EbaySoldListingsResult | null> {
  let items: Record<string, unknown>[];
  try {
    items = await runApifyActor(
      ACTOR_ID,
      {
        // caffein.dev/ebay-sold-listings input schema:
        keyword: query, // string (singular); actor also accepts keywords array
        count, // result limit; actor uses "count", not "maxItems"
        // site 0 = ebay.com (US marketplace, USD pricing)
        // This keeps soldCurrency consistently USD so *Usd fields are accurate.
        site: 0,
      },
      apiToken,
      {
        timeoutMs: 120_000,
        pollIntervalMs: 5_000,
        maxItems: count,
        // Actor default is 2048 MB; 1024 MB is sufficient for small searches
        memoryMbytes: 1024,
      },
    );
  } catch (err) {
    logger.warn(
      { err, query },
      "ebay sold-listings apify run failed (non-fatal)",
    );
    return null;
  }

  const listings: EbaySoldListing[] = [];

  for (const item of items) {
    // `price` is the "final transaction price" per the actor's README
    const price = parsePrice(item.price ?? item.soldPrice ?? item.currentPrice);
    if (price === null) continue;

    // `soldCurrency` is the documented currency field for this actor.
    // Discard non-USD results to keep *Usd aggregates accurate.
    const currency = String(
      item.soldCurrency ?? item.currency ?? item.priceCurrency ?? "USD",
    );
    if (currency !== "USD") continue;

    // `url` is the documented listing-URL field; imageUrl is the thumbnail
    const urlRaw = item.url ?? item.itemUrl ?? item.link;
    const imageRaw =
      item.imageUrl ?? item.thumbnailUrl ?? item.image ?? item.primaryImage;

    listings.push({
      title: String(item.title ?? item.name ?? ""),
      priceUsd: price,
      currency,
      soldDate: parseSoldDate(item), // derived from `endedAt`, not `scrapedAt`
      condition: item.condition ? String(item.condition) : null,
      imageUrl: imageRaw ? String(imageRaw) : null,
      itemUrl: urlRaw ? String(urlRaw) : null,
    });
  }

  if (listings.length === 0) return null;

  const prices = listings.map((l) => l.priceUsd);
  const priceMinUsd = Math.min(...prices);
  const priceMaxUsd = Math.max(...prices);
  const priceMedianUsd = median(prices);

  logger.info(
    { query, listingCount: listings.length, priceMinUsd, priceMaxUsd },
    "ebay sold-listings apify: results fetched",
  );

  return {
    priceMinUsd,
    priceMaxUsd,
    priceMedianUsd,
    listingCount: listings.length,
    listings: listings.slice(0, 10),
    cachedAt: new Date().toISOString(),
  };
}
