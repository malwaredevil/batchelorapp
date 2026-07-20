import { eq } from "drizzle-orm";
import { db, ornamentsBarcodeCache, hallmarkOrnaments } from "@workspace/db";
import { logger } from "../logger";
import { getConfig } from "../app-config";

/**
 * UPCitemdb barcode lookup, cached per-UPC in ornaments_barcode_cache so
 * repeat scans (multiples of the same ornament, or re-scans) never re-hit
 * the outside API. Uses the free "trial" endpoint by default; if
 * UPCITEMDB_USER_KEY is set, uses the paid "prod" lookup endpoint instead
 * (higher rate limits, same response shape).
 *
 * When the upcitemdb response includes a `model` field (Hallmark SKUs are
 * embedded there as a numeric prefix + SKU, e.g. "9702499QXI7404"), the SKU
 * is extracted and cross-referenced against `hallmark_ornaments` — the single
 * merged table that consolidates hallmark_catalog, hallmark_historical_catalog,
 * and hallmark_hooh_catalog. Any match enriches the result with authoritative
 * series, artist, collector price, availability, and official images.
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
  // Hallmark catalog enrichment — null when the UPC doesn't map to a known SKU
  hallmarkSku: string | null;
  hallmarkArtist: string | null;
  hallmarkSeriesName: string | null;
  hallmarkSequenceNumber: number | null;
  hallmarkRetailPriceUsd: string | null;
  hallmarkCollectorPriceUsd: string | null;
  hallmarkInStock: boolean | null;
  hallmarkImages: string[] | null;
  hallmarkProductUrl: string | null;
}

/** Internal return type from fetchFromUpcItemDb — includes raw `model` field. */
interface UpcFetchResult {
  found: boolean;
  name: string | null;
  brand: string | null;
  seriesOrCollection: string | null;
  year: number | null;
  description: string | null;
  imageUrl: string | null;
  model?: string;
}

const NULL_HALLMARK = {
  hallmarkSku: null,
  hallmarkArtist: null,
  hallmarkSeriesName: null,
  hallmarkSequenceNumber: null,
  hallmarkRetailPriceUsd: null,
  hallmarkCollectorPriceUsd: null,
  hallmarkInStock: null,
  hallmarkImages: null,
  hallmarkProductUrl: null,
} as const;

function guessSeriesFromTitle(title: string): string | null {
  const match = title.match(
    /Keepsake\s+(?:Ornament\s+)?(?:Series\s+)?([A-Za-z0-9 '&-]{3,40})/i,
  );
  return match ? match[1].trim() : null;
}

function guessYearFromTitle(title: string): number | null {
  const match = title.match(/\b(19[89]\d|20[0-4]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchFromUpcItemDb(barcode: string): Promise<UpcFetchResult> {
  const userKey = process.env.UPCITEMDB_USER_KEY;
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
        model?: string;
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
      model: item.model?.trim() || undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Web-scraping fallback using Open Food Facts (free, no quota).
 * Covers non-Hallmark barcodes that UPCitemdb may rate-limit or miss.
 */
async function fetchFromOpenFoodFacts(
  barcode: string,
): Promise<UpcFetchResult> {
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

/**
 * Extract a Hallmark SKU from the upcitemdb `model` field.
 * Hallmark stores their SKU prefixed with a numeric catalog ID:
 *   "9702499QXI7404" → "QXI7404"
 * Returns null if model is absent or stripping digits leaves nothing.
 */
function extractHallmarkSku(model: string | undefined): string | null {
  if (!model) return null;
  const sku = model.replace(/^\d+/, "").trim();
  return sku.length > 0 ? sku : null;
}

/**
 * Look up the hallmark_ornaments merged table by SKU and return the enrichment
 * fields. Returns null if no row is found.
 */
async function enrichFromHallmarkCatalog(sku: string): Promise<{
  sku: string;
  seriesName: string | null;
  sequenceNumber: number | null;
  artist: string | null;
  retailPriceUsd: string | null;
  collectorPriceUsd: string | null;
  inStock: boolean | null;
  images: string[] | null;
  productUrl: string | null;
  name: string | null;
  year: number | null;
} | null> {
  const [row] = await db
    .select()
    .from(hallmarkOrnaments)
    .where(eq(hallmarkOrnaments.hallmarkSku, sku))
    .limit(1);

  if (!row) return null;

  const productUrl =
    row.productUrlHallmark ??
    row.productUrlHistorical ??
    row.productUrlHooh ??
    null;

  return {
    sku: row.hallmarkSku,
    seriesName: row.seriesName ?? null,
    sequenceNumber: row.sequenceNumber ?? null,
    artist: row.artist ?? null,
    retailPriceUsd: row.retailPriceUsd ?? null,
    collectorPriceUsd: row.collectorPriceUsd ?? null,
    inStock: row.inStock ?? null,
    images: row.images && row.images.length > 0 ? row.images : null,
    productUrl,
    name: row.name,
    year: row.year ?? null,
  };
}

export async function lookupBarcode(
  rawBarcode: string,
): Promise<BarcodeLookupResult> {
  const barcode = rawBarcode.trim();

  // ── 1. Return from cache if available ────────────────────────────────────
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
      hallmarkSku: cached.hallmarkSku ?? null,
      hallmarkArtist: cached.hallmarkArtist ?? null,
      hallmarkSeriesName: cached.hallmarkSeriesName ?? null,
      hallmarkSequenceNumber: cached.hallmarkSequenceNumber ?? null,
      hallmarkRetailPriceUsd: cached.hallmarkOriginalRetailPrice ?? null,
      hallmarkCollectorPriceUsd: cached.hallmarkCollectorPriceUsd ?? null,
      hallmarkInStock: cached.hallmarkInStock ?? null,
      hallmarkImages: cached.hallmarkImages ?? null,
      hallmarkProductUrl: cached.hallmarkProductUrl ?? null,
    };
  }

  // ── 2. Fetch from external API ────────────────────────────────────────────
  let upcResult: UpcFetchResult;
  try {
    upcResult = await fetchFromUpcItemDb(barcode);
  } catch (primaryErr) {
    logger.warn(
      { err: primaryErr, barcode },
      "UPCitemdb lookup failed — trying Open Food Facts fallback",
    );
    try {
      upcResult = await fetchFromOpenFoodFacts(barcode);
    } catch (fallbackErr) {
      logger.warn(
        { err: fallbackErr, barcode },
        "Open Food Facts fallback also failed",
      );
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
        ...NULL_HALLMARK,
      };
    }
  }

  // ── 3. Enrich from hallmark_ornaments if a SKU is available ──────────────
  const sku = extractHallmarkSku(upcResult.model);
  let hallmark: Awaited<ReturnType<typeof enrichFromHallmarkCatalog>> = null;
  if (sku) {
    try {
      hallmark = await enrichFromHallmarkCatalog(sku);
      if (hallmark) {
        logger.info(
          { barcode, sku, series: hallmark.seriesName },
          "Hallmark SKU matched in merged catalog",
        );
      } else {
        logger.info(
          { barcode, sku },
          "Hallmark SKU extracted but not in catalog",
        );
      }
    } catch (err) {
      logger.warn({ err, barcode, sku }, "Hallmark catalog enrichment failed");
    }
  }

  // Upgrade core result fields with authoritative Hallmark data where the
  // UPCitemdb title-parse heuristics would be weaker.
  const name = upcResult.name ?? hallmark?.name ?? null;
  const seriesOrCollection =
    hallmark?.seriesName ?? upcResult.seriesOrCollection;
  const year = hallmark?.year ?? upcResult.year;
  // Use official Hallmark image if UPCitemdb returned none
  const imageUrl = upcResult.imageUrl ?? hallmark?.images?.[0] ?? null;

  // ── 4. Write to cache ─────────────────────────────────────────────────────
  await db
    .insert(ornamentsBarcodeCache)
    .values({
      barcode,
      found: upcResult.found ? 1 : 0,
      name,
      brand: upcResult.brand,
      seriesOrCollection,
      year,
      description: upcResult.description,
      imageUrl,
      hallmarkSku: hallmark?.sku ?? null,
      hallmarkSeriesName: hallmark?.seriesName ?? null,
      hallmarkSequenceNumber: hallmark?.sequenceNumber ?? null,
      hallmarkArtist: hallmark?.artist ?? null,
      hallmarkOriginalRetailPrice: hallmark?.retailPriceUsd ?? null,
      hallmarkCollectorPriceUsd: hallmark?.collectorPriceUsd ?? null,
      hallmarkInStock: hallmark?.inStock ?? null,
      hallmarkImages: hallmark?.images ?? null,
      hallmarkProductUrl: hallmark?.productUrl ?? null,
      hallmarkConfidence: hallmark ? "1.000" : null,
      hallmarkEnrichedAt: hallmark ? new Date() : null,
    })
    .onConflictDoNothing();

  return {
    barcode,
    found: upcResult.found,
    name,
    brand: upcResult.brand,
    seriesOrCollection,
    year,
    description: upcResult.description,
    imageUrl,
    fromCache: false,
    hallmarkSku: hallmark?.sku ?? null,
    hallmarkArtist: hallmark?.artist ?? null,
    hallmarkSeriesName: hallmark?.seriesName ?? null,
    hallmarkSequenceNumber: hallmark?.sequenceNumber ?? null,
    hallmarkRetailPriceUsd: hallmark?.retailPriceUsd ?? null,
    hallmarkCollectorPriceUsd: hallmark?.collectorPriceUsd ?? null,
    hallmarkInStock: hallmark?.inStock ?? null,
    hallmarkImages: hallmark?.images ?? null,
    hallmarkProductUrl: hallmark?.productUrl ?? null,
  };
}
