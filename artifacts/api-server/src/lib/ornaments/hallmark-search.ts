/**
 * Hallmark.com product search via the custom "ornament-research" Apify actor.
 *
 * The actor uses a headless Playwright browser (full JS execution) because
 * hallmark.com's search results are rendered client-side and return zero
 * results with a plain HTTP fetch.
 *
 * Actor ID: NE2FKT2a7bh9AnKvE  (apify-actors/hallmark-single-lookup in batchelorapp repo)
 * Memory:   2048 MB  — Playwright/Chromium requires it; 1 GB hits 95% and risks OOM
 * Timeout:  120 s   — typical run is ~60 s
 *
 * Failure modes (all throw loudly so callers can surface them):
 *   - No APIFY_API_TOKEN             → throws "Apify token not configured"
 *   - Actor run FAILED / TIMED-OUT   → throws from runApifyActor
 *   - found=false / low confidence   → returns null (not an error)
 *   - Apify token quota exhausted    → HTTP 402 from Apify → throws with message
 */

import { runApifyActor } from "../apify-client";
import { env } from "../env";
import { logger } from "../logger";

const ACTOR_ID = "NE2FKT2a7bh9AnKvE";

export interface HallmarkSearchInput {
  /** Hallmark product SKU / MPN (e.g. "QXI7404"). Takes precedence over name. */
  hallmarkSku?: string;
  /** Ornament name (used when no SKU is known). */
  name?: string;
  /** Release year (combined with name for a tighter query). */
  year?: number;
}

export interface HallmarkSearchResult {
  found: true;
  hallmarkSku: string | null;
  name: string | null;
  brand: string | null;
  seriesName: string | null;
  sequenceNumber: number | null;
  year: number | null;
  artist: string | null;
  originalRetailPrice: number | null;
  hallmarkProductUrl: string | null;
  images: string[];
  description: string | null;
  confidence: number;
  source: "hallmark.com";
  scrapedAt: string;
}

export async function searchHallmark(
  input: HallmarkSearchInput,
): Promise<HallmarkSearchResult | null> {
  const apiToken = env.apifyApiToken;
  if (!apiToken) {
    throw new Error(
      "Hallmark search unavailable: APIFY_API_TOKEN is not configured",
    );
  }

  if (!input.hallmarkSku && !input.name) {
    throw new Error(
      "Hallmark search requires at least hallmarkSku or name in the input",
    );
  }

  logger.info(
    { hallmarkSku: input.hallmarkSku, name: input.name, year: input.year },
    "hallmark-search: starting actor run",
  );

  const items = await runApifyActor(
    ACTOR_ID,
    {
      hallmarkSku: input.hallmarkSku,
      name: input.name,
      year: input.year,
    },
    apiToken,
    {
      timeoutMs: 120_000,
      pollIntervalMs: 5_000,
      maxItems: 1,
      memoryMbytes: 2048,
    },
  );

  const raw = items[0] as unknown as
    | (HallmarkSearchResult & { found: boolean })
    | undefined;

  if (!raw) {
    logger.warn({ input }, "hallmark-search: actor returned no dataset items");
    return null;
  }

  // Confidence threshold: require at least 0.2 (found=true is set by the actor
  // at this threshold, but we double-check here in case the actor changes).
  if (!raw.found || (raw.confidence ?? 0) < 0.2) {
    logger.info(
      { input, confidence: raw.confidence, found: raw.found },
      "hallmark-search: result below confidence threshold, returning null",
    );
    return null;
  }

  // If a SKU was supplied and the returned SKU doesn't match, it's a search
  // relevance miss — flag it clearly instead of silently returning a wrong item.
  if (
    input.hallmarkSku &&
    raw.hallmarkSku &&
    raw.hallmarkSku !== input.hallmarkSku
  ) {
    logger.warn(
      {
        queriedSku: input.hallmarkSku,
        returnedSku: raw.hallmarkSku,
        confidence: raw.confidence,
      },
      "hallmark-search: returned SKU does not match queried SKU — treating as miss",
    );
    return null;
  }

  return raw as HallmarkSearchResult;
}
