import { eq } from "drizzle-orm";
import { db, ornamentsBarcodeCache } from "@workspace/db";
import { logger } from "../logger";
import { getConfig } from "../app-config";

/**
 * UPCitemdb barcode lookup, cached per-UPC in ornaments_barcode_cache so
 * repeat scans (multiples of the same ornament, or re-scans) never re-hit
 * the outside API. Uses the free "trial" endpoint by default; if
 * UPCITEMDB_USER_KEY is set, uses the paid "prod" lookup endpoint instead
 * (higher rate limits, same response shape).
 */

export interface BarcodeLookupResult {
  barcode: string;
  found: boolean;
  name: string | null;
  brand: string | null;
  seriesOrCollection: string | null;
  year: number | null;
  description: string | null;
  imageUrl: string | null;
  fromCache: boolean;
}

const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

function guessSeriesFromTitle(title: string): string | null {
  // UPCitemdb titles are often "Hallmark Keepsake Ornament <Series> <Name> <Year>".
  const match = title.match(
    /Keepsake\s+(?:Ornament\s+)?(?:Series\s+)?([A-Za-z0-9 '&-]{3,40})/i,
  );
  return match ? match[1].trim() : null;
}

function guessYearFromTitle(title: string): number | null {
  const match = title.match(/\b(19[89]\d|20[0-4]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchFromUpcItemDb(
  barcode: string,
): Promise<Omit<BarcodeLookupResult, "barcode" | "fromCache">> {
  const userKey = process.env.UPCITEMDB_USER_KEY;
  // Read endpoint URLs from the admin config panel, falling back to hardcoded defaults.
  // Free trial endpoint requires no API key (up to 100 lookups/day).
  // If UPCITEMDB_USER_KEY is set, uses the paid endpoint for higher rate limits.
  const baseUrl = userKey
    ? await getConfig(
        "ornaments",
        "upcitemdb_paid_url",
        "https://api.upcitemdb.com/prod/v1/lookup",
      )
    : await getConfig(
        "ornaments",
        "upcitemdb_trial_url",
        "https://api.upcitemdb.com/prod/trial/lookup",
      );

  const controller = new AbortController();
  const fetchTimeoutMs = await getConfig(
    "ornaments",
    "barcode_fetch_timeout_ms",
    8_000,
  );
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (userKey) headers["user_key"] = userKey;
    if (process.env.UPCITEMDB_KEY_TYPE)
      headers["key_type"] = process.env.UPCITEMDB_KEY_TYPE;

    const resp = await fetch(`${baseUrl}?upc=${encodeURIComponent(barcode)}`, {
      headers,
      signal: controller.signal,
    });

    // Rate limit exceeded — free trial allows 100 lookups/day.
    // Return not-found without caching so the caller can retry later.
    if (resp.status === 429) {
      const remaining = resp.headers.get("X-RateLimit-Remaining") ?? "?";
      const reset = resp.headers.get("X-RateLimit-Reset");
      const resetAt = reset
        ? new Date(parseInt(reset, 10) * 1000).toISOString()
        : "unknown";
      logger.warn(
        { barcode, remaining, resetAt, endpoint: userKey ? "paid" : "trial" },
        "UPCitemdb rate limit exceeded — lookup skipped until quota resets",
      );
      return {
        found: false,
        name: null,
        brand: null,
        seriesOrCollection: null,
        year: null,
        description: null,
        imageUrl: null,
      };
    }

    if (!resp.ok) {
      throw new Error(`UPCitemdb HTTP ${resp.status}`);
    }
    const body = (await resp.json()) as {
      code?: string;
      items?: Array<{
        title?: string;
        brand?: string;
        description?: string;
        images?: string[];
      }>;
    };

    const item = body.items?.[0];
    if (body.code !== "OK" || !item) {
      return {
        found: false,
        name: null,
        brand: null,
        seriesOrCollection: null,
        year: null,
        description: null,
        imageUrl: null,
      };
    }

    const title = item.title?.trim() ?? "";
    return {
      found: true,
      name: title || null,
      brand: item.brand?.trim() || "Hallmark",
      seriesOrCollection: title ? guessSeriesFromTitle(title) : null,
      year: title ? guessYearFromTitle(title) : null,
      description: item.description?.trim() || null,
      imageUrl: item.images?.[0] ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Web-scraping fallback using Open Food Facts (free, no quota).
 * Covers non-Hallmark barcodes that UPCitemdb may rate-limit or miss.
 * Returns found:false without throwing when the product is simply not in the
 * database — only throws on network/HTTP errors so the caller can distinguish
 * a genuine service failure from a not-found result.
 */
async function fetchFromOpenFoodFacts(
  barcode: string,
): Promise<Omit<BarcodeLookupResult, "barcode" | "fromCache">> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,generic_name,image_url`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Batchelor-App/1.0 (https://app.batchelor.app)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(6_000),
  });
  if (!resp.ok) throw new Error(`Open Food Facts HTTP ${resp.status}`);

  const body = (await resp.json()) as {
    status?: number;
    product?: {
      product_name?: string;
      brands?: string;
      generic_name?: string;
      image_url?: string;
    };
  };

  if (body.status !== 1 || !body.product) {
    return {
      found: false,
      name: null,
      brand: null,
      seriesOrCollection: null,
      year: null,
      description: null,
      imageUrl: null,
    };
  }

  const product = body.product;
  const name =
    product.product_name?.trim() || product.generic_name?.trim() || null;
  return {
    found: !!name,
    name,
    brand: product.brands?.trim() || null,
    seriesOrCollection: null,
    year: null,
    description: null,
    imageUrl: product.image_url?.trim() || null,
  };
}

export async function lookupBarcode(
  rawBarcode: string,
): Promise<BarcodeLookupResult> {
  const barcode = rawBarcode.trim();

  const [cached] = await db
    .select()
    .from(ornamentsBarcodeCache)
    .where(eq(ornamentsBarcodeCache.barcode, barcode))
    .limit(1);

  if (cached) {
    return {
      barcode,
      found: cached.found === 1,
      name: cached.name,
      brand: cached.brand,
      seriesOrCollection: cached.seriesOrCollection,
      year: cached.year,
      description: cached.description,
      imageUrl: cached.imageUrl,
      fromCache: true,
    };
  }

  let result: Omit<BarcodeLookupResult, "barcode" | "fromCache">;
  try {
    result = await fetchFromUpcItemDb(barcode);
  } catch (primaryErr) {
    logger.warn(
      { err: primaryErr, barcode },
      "UPCitemdb lookup failed — trying Open Food Facts fallback",
    );
    try {
      result = await fetchFromOpenFoodFacts(barcode);
    } catch (fallbackErr) {
      logger.warn(
        { err: fallbackErr, barcode },
        "Open Food Facts fallback also failed",
      );
      // Don't cache transient failures — only cache genuine not-found results.
      return {
        barcode,
        found: false,
        name: null,
        brand: null,
        seriesOrCollection: null,
        year: null,
        description: null,
        imageUrl: null,
        fromCache: false,
      };
    }
  }

  await db
    .insert(ornamentsBarcodeCache)
    .values({
      barcode,
      found: result.found ? 1 : 0,
      name: result.name,
      brand: result.brand,
      seriesOrCollection: result.seriesOrCollection,
      year: result.year,
      description: result.description,
      imageUrl: result.imageUrl,
    })
    .onConflictDoNothing();

  return { barcode, ...result, fromCache: false };
}
