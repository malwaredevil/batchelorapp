import { eq } from "drizzle-orm";
import { db, ornamentsBarcodeCache } from "@workspace/db";
import { logger } from "../logger";

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

const FETCH_TIMEOUT_MS = 8_000;

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
  const baseUrl = userKey
    ? "https://api.upcitemdb.com/prod/v1/lookup"
    : "https://api.upcitemdb.com/prod/trial/lookup";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (userKey) headers["user_key"] = userKey;
    if (process.env.UPCITEMDB_KEY_TYPE)
      headers["key_type"] = process.env.UPCITEMDB_KEY_TYPE;

    const resp = await fetch(
      `${baseUrl}?upc=${encodeURIComponent(barcode)}`,
      { headers, signal: controller.signal },
    );
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
  } catch (err) {
    logger.warn({ err, barcode }, "UPCitemdb lookup failed");
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
