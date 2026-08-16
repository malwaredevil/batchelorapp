import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  ornamentsBarcodeCache,
  ornamentUpcCorrections,
  hallmarkOrnaments,
  hallmarkHoohCatalog,
  ornamentsItems,
} from "@workspace/db";
import { logger } from "../logger";
import { getConfig } from "../app-config";
import { env } from "../env";
import { lookupHoohBySku } from "./hooh-single-lookup";
import { searchHallmark } from "./hallmark-search";
import { getEbayAppToken } from "../ebay/oauth";
import { callModel, MODELS } from "../ai-client";

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
 * eBay Browse API — GTIN/UPC lookup.
 * Searches active listings by the exact barcode and extracts product identity
 * from the top listing title + aspect refinements (Year, Artist, Series, Theme).
 * Used as a fallback when UPCitemdb and Open Food Facts both miss.
 */
async function fetchFromEbay(barcode: string): Promise<UpcFetchResult> {
  if (!env.ebayAppId || !env.ebayCertId) {
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

  const token = await getEbayAppToken();

  const params = new URLSearchParams({
    gtin: barcode,
    limit: "3",
    fieldgroups: "ASPECT_REFINEMENTS",
  });

  const resp = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!resp.ok) {
    throw new Error(`eBay Browse API HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    total?: number;
    itemSummaries?: Array<{
      title?: string;
      image?: { imageUrl?: string };
      price?: { value?: string };
    }>;
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

  const total = data.total ?? 0;
  if (total === 0 || !data.itemSummaries?.length) {
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

  // Pull the top-listed item's title and image
  const topItem = data.itemSummaries[0];
  const title = topItem?.title?.trim() ?? "";
  const imageUrl = topItem?.image?.imageUrl ?? null;

  // Extract structured attributes from aspect refinements
  const aspects: Record<string, string> = {};
  for (const dist of data.refinement?.aspectDistributions ?? []) {
    const topVal = dist.aspectValueDistributions?.sort(
      (a, b) => b.matchCount - a.matchCount,
    )[0];
    if (topVal)
      aspects[dist.localizedAspectName.toLowerCase()] =
        topVal.localizedAspectValue;
  }

  const year =
    aspects["year"] != null
      ? parseInt(aspects["year"], 10)
      : guessYearFromTitle(title);
  const seriesOrCollection =
    aspects["series"] ??
    aspects["series name"] ??
    guessSeriesFromTitle(title) ??
    null;

  logger.info(
    { barcode, title, total, year, seriesOrCollection },
    "eBay GTIN lookup: found product",
  );

  return {
    found: true,
    name: title || null,
    brand: "Hallmark",
    seriesOrCollection,
    year: Number.isFinite(year) ? year : null,
    description: null,
    imageUrl,
    model: aspects["sku"] ?? aspects["model"] ?? undefined,
  };
}

/**
 * AI fallback — ask an LLM to identify the ornament by UPC.
 * Models have training-data knowledge of many common Hallmark ornaments and can
 * correctly identify products that UPCitemdb and eBay GTIN search may miss.
 */
async function fetchFromAI(barcode: string): Promise<UpcFetchResult> {
  const prompt = [
    `A user is scanning a product barcode: ${barcode}.`,
    `It is very likely a Hallmark Keepsake Ornament (Hallmark barcodes start with 661127).`,
    `Using your training knowledge, identify this exact product.`,
    `Reply ONLY with a valid JSON object — no markdown, no explanation.`,
    `If you can identify it with high confidence:`,
    `{"found":true,"name":"<full product name>","brand":"Hallmark","seriesOrCollection":"<series/collection name or null>","year":<4-digit year as integer or null>,"description":"<one sentence or null>"}`,
    `If you cannot identify it: {"found":false}`,
    `Do not guess — only set found:true if you are confident.`,
  ].join(" ");

  const raw = await callModel(MODELS.FAST_VISION, async (client, model) => {
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    return completion.choices[0]?.message?.content?.trim() ?? "";
  });

  let parsed: {
    found?: boolean;
    name?: string;
    brand?: string;
    seriesOrCollection?: string | null;
    year?: number | null;
    description?: string | null;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    logger.warn({ barcode, raw }, "AI barcode lookup: could not parse JSON");
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

  if (!parsed.found) {
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

  logger.info(
    { barcode, name: parsed.name, year: parsed.year, source: "ai" },
    "AI barcode lookup: identified product",
  );

  return {
    found: true,
    name: parsed.name?.trim() || null,
    brand: parsed.brand?.trim() || "Hallmark",
    seriesOrCollection: parsed.seriesOrCollection?.trim() || null,
    year: parsed.year ?? null,
    description: parsed.description?.trim() || null,
    imageUrl: null,
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

/**
 * Persist a HooH single-lookup result into hallmark_hooh_catalog, then
 * re-run enrichFromHallmarkCatalog (reads the merged view) to return the
 * full enrichment struct. Returns null if HooH found nothing.
 */
async function enrichViaHooh(
  sku: string,
  barcode: string,
): Promise<Awaited<ReturnType<typeof enrichFromHallmarkCatalog>>> {
  const hoohResult = await lookupHoohBySku(sku);
  if (!hoohResult) return null;

  const productUrl =
    hoohResult.productUrl ||
    `https://www.hookedonhallmark.com/?s=${encodeURIComponent(sku)}`;

  await db
    .insert(hallmarkHoohCatalog)
    .values({
      productUrl,
      catalogId: hoohResult.catalogId,
      hallmarkSku: hoohResult.hallmarkSku,
      name: hoohResult.name,
      year: hoohResult.year,
      subcategory: hoohResult.subcategory,
      seriesName: hoohResult.seriesName,
      sequenceNumber: hoohResult.sequenceNumber,
      retailPriceUsd:
        hoohResult.retailPriceUsd != null
          ? String(hoohResult.retailPriceUsd)
          : null,
      inStock: hoohResult.inStock,
      crawledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: hallmarkHoohCatalog.productUrl,
      set: {
        hallmarkSku: hoohResult.hallmarkSku,
        name: hoohResult.name,
        retailPriceUsd:
          hoohResult.retailPriceUsd != null
            ? String(hoohResult.retailPriceUsd)
            : null,
        inStock: hoohResult.inStock,
        updatedAt: new Date(),
      },
    });

  logger.info(
    { sku, name: hoohResult.name, price: hoohResult.retailPriceUsd },
    "HooH single-lookup: persisted to hallmark_hooh_catalog",
  );

  const enriched = await enrichFromHallmarkCatalog(sku);
  if (enriched) {
    void patchOrnamentsFromEnrichment(barcode, enriched);
  }
  return enriched;
}

/**
 * Background fallback: run the Apify hallmark-single-lookup Playwright actor
 * when HooH didn't have the ornament. Fire-and-forget — does not block the
 * barcode response. Saves to hallmark_hooh_catalog and patches any ornaments
 * already saved with this barcode.
 */
async function enrichCatalogViaApify(
  sku: string,
  barcode: string,
): Promise<void> {
  try {
    const result = await searchHallmark({ hallmarkSku: sku });
    if (!result) {
      logger.info({ sku }, "Apify hallmark-search: no result for SKU");
      return;
    }

    const productUrl =
      result.hallmarkProductUrl ??
      `https://www.hallmark.com/search/?q=${encodeURIComponent(sku)}`;

    await db
      .insert(hallmarkHoohCatalog)
      .values({
        productUrl,
        catalogId: null,
        hallmarkSku: result.hallmarkSku ?? sku,
        name: result.name,
        year: result.year,
        subcategory: null,
        seriesName: result.seriesName,
        sequenceNumber: result.sequenceNumber,
        retailPriceUsd:
          result.originalRetailPrice != null
            ? String(result.originalRetailPrice)
            : null,
        inStock: false,
        source: "hallmark.com",
        crawledAt: new Date(),
      })
      .onConflictDoUpdate({
        target: hallmarkHoohCatalog.productUrl,
        set: {
          hallmarkSku: result.hallmarkSku ?? sku,
          name: result.name,
          retailPriceUsd:
            result.originalRetailPrice != null
              ? String(result.originalRetailPrice)
              : null,
          updatedAt: new Date(),
        },
      });

    logger.info(
      { sku, name: result.name },
      "Apify hallmark-search: persisted to hallmark_hooh_catalog",
    );

    const enriched = await enrichFromHallmarkCatalog(sku);
    if (enriched) {
      await patchOrnamentsFromEnrichment(barcode, enriched);
    }
  } catch (err) {
    logger.warn({ err, sku }, "Apify background enrichment failed");
  }
}

/**
 * Auto-patch ornament items that were saved with this barcode before the
 * Hallmark catalog enrichment was available. Only fills fields that are still
 * null — never overwrites data the user has already entered.
 */
async function patchOrnamentsFromEnrichment(
  barcode: string,
  hallmark: NonNullable<Awaited<ReturnType<typeof enrichFromHallmarkCatalog>>>,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {};
    if (hallmark.seriesName) patch.seriesOrCollection = hallmark.seriesName;
    if (hallmark.collectorPriceUsd) {
      patch.bookValue = hallmark.collectorPriceUsd;
      patch.bookValueSource = "hallmark-catalog";
      patch.bookValueUpdatedAt = new Date();
    }

    if (Object.keys(patch).length === 0) return;

    const result = await db
      .update(ornamentsItems)
      .set(patch)
      .where(
        and(
          eq(ornamentsItems.barcodeValue, barcode),
          isNull(ornamentsItems.seriesOrCollection),
        ),
      );

    logger.info(
      { barcode, fields: Object.keys(patch), rowCount: result.rowCount ?? 0 },
      "Auto-patched ornament(s) from HooH/Apify enrichment",
    );
  } catch (err) {
    logger.warn(
      { err, barcode },
      "Failed to auto-patch ornaments from enrichment",
    );
  }
}

export async function lookupBarcode(
  rawBarcode: string,
): Promise<BarcodeLookupResult> {
  const barcode = rawBarcode.trim();

  // ── 0. Load cache + correction in parallel ────────────────────────────────
  const [[cached], [correction]] = await Promise.all([
    db
      .select()
      .from(ornamentsBarcodeCache)
      .where(eq(ornamentsBarcodeCache.barcode, barcode))
      .limit(1),
    db
      .select()
      .from(ornamentUpcCorrections)
      .where(eq(ornamentUpcCorrections.barcode, barcode))
      .orderBy(desc(ornamentUpcCorrections.createdAt))
      .limit(1),
  ]);

  // ── 1. Return from cache if available ────────────────────────────────────
  // NOTE: a cached found=0 entry does NOT short-circuit here — we continue
  // through the fallback chain so eBay/AI can discover a match that the
  // original lookup missed.  Only a found=1 cache hit is authoritative.
  if (cached?.found === 1) {
    // Apply any user-submitted correction as an override.
    if (correction) {
      const correctedName = correction.correctedName ?? cached.name;
      const correctedBrand = correction.correctedBrand ?? cached.brand;
      const correctedSeries =
        correction.correctedSeriesOrCollection ?? cached.seriesOrCollection;
      const correctedYear = correction.correctedYear ?? cached.year;

      // Persist correction into cache so subsequent cache-only reads also
      // reflect it (idempotent — safe to overwrite with same values).
      await db
        .update(ornamentsBarcodeCache)
        .set({
          name: correctedName,
          brand: correctedBrand,
          seriesOrCollection: correctedSeries,
          year: correctedYear,
        })
        .where(eq(ornamentsBarcodeCache.barcode, barcode));

      logger.info(
        { barcode, correctedName, correctedBrand },
        "Barcode cache returned with user correction applied",
      );

      return {
        barcode,
        found: true,
        name: correctedName,
        brand: correctedBrand,
        seriesOrCollection: correctedSeries,
        year: correctedYear,
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

    return {
      barcode,
      found: true,
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

  // Hallmark registers UPCs under the 661127 prefix. UPCitemdb and Open Food
  // Facts often contain incorrect / conflated data for these codes (e.g. they
  // return a bathroom cleaner for a Hallmark ornament UPC). Skip those sources
  // for Hallmark barcodes and go straight to eBay GTIN search + AI, which are
  // authoritative for the collectibles market.
  const isHallmarkBarcode = barcode.startsWith("661127");

  // ── 2. eBay GTIN search — exact barcode match against real listings ─────
  // This is an authoritative, verifiable match (the barcode is searched
  // directly), so it must run before the AI guess below.
  let upcResult: UpcFetchResult | null = null;
  try {
    const r = await fetchFromEbay(barcode);
    if (r.found) {
      logger.info({ barcode }, "eBay GTIN lookup: identified product");
      upcResult = r;
    } else {
      logger.info(
        { barcode },
        "eBay GTIN lookup: not found — trying UPCitemdb/OPF",
      );
    }
  } catch (ebayErr) {
    logger.warn({ err: ebayErr, barcode }, "eBay GTIN lookup failed");
  }

  // ── 3. UPCitemdb → Open Food Facts fallback chain (non-Hallmark only) ────
  // Hallmark UPCs (661127 prefix) frequently return incorrect data from these
  // generic product databases; skip them for Hallmark barcodes.
  if (!upcResult) {
    if (!isHallmarkBarcode) {
      try {
        const r = await fetchFromUpcItemDb(barcode);
        if (r.found) upcResult = r;
        else {
          logger.info(
            { barcode },
            "UPCitemdb: not found — trying Open Food Facts",
          );
          try {
            const r2 = await fetchFromOpenFoodFacts(barcode);
            if (r2.found) upcResult = r2;
          } catch (offErr) {
            logger.warn(
              { err: offErr, barcode },
              "Open Food Facts fallback failed",
            );
          }
        }
      } catch (primaryErr) {
        logger.warn(
          { err: primaryErr, barcode },
          "UPCitemdb lookup failed — trying Open Food Facts fallback",
        );
        try {
          const r2 = await fetchFromOpenFoodFacts(barcode);
          if (r2.found) upcResult = r2;
        } catch (offErr) {
          logger.warn(
            { err: offErr, barcode },
            "Open Food Facts fallback failed",
          );
        }
      }
    } else {
      logger.info(
        { barcode },
        "Hallmark UPC prefix: skipping UPCitemdb/OPF (unreliable for Hallmark barcodes)",
      );
    }
  }

  // ── 4. AI lookup — last resort only ───────────────────────────────────────
  // The AI is guessing from training-data recall, not verifying the barcode
  // against anything — it has repeatedly misidentified the correct ornament
  // for a given UPC when real sources exist. Only use it when every
  // verifiable source above found nothing, and never let it override a real
  // match.
  if (!upcResult) {
    try {
      const r = await fetchFromAI(barcode);
      if (r.found) {
        logger.info(
          { barcode },
          "AI barcode lookup: identified product (no verified source found one)",
        );
        upcResult = r;
      } else {
        logger.info({ barcode }, "AI barcode lookup: not found");
      }
    } catch (aiErr) {
      logger.warn({ err: aiErr, barcode }, "AI barcode lookup failed");
    }
  }

  // If every source failed, write a not-found cache entry and return early
  if (!upcResult) {
    if (!cached) {
      // Only write a not-found entry when there is no prior cache row at all
      await db
        .insert(ornamentsBarcodeCache)
        .values({ barcode, found: 0 })
        .onConflictDoNothing();
    }
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

  // ── 5. Enrich from hallmark_ornaments if a SKU is available ──────────────
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
          "Hallmark SKU extracted but not in catalog — trying HooH single-lookup",
        );
        try {
          hallmark = await enrichViaHooh(sku, barcode);
        } catch (hoohErr) {
          logger.warn({ err: hoohErr, sku }, "HooH single-lookup threw");
        }
        if (!hallmark && env.apifyApiToken) {
          void enrichCatalogViaApify(sku, barcode);
          logger.info(
            { sku },
            "HooH miss — Apify enrichment queued in background",
          );
        }
      }
    } catch (err) {
      logger.warn({ err, barcode, sku }, "Hallmark catalog enrichment failed");
    }
  }

  // Merge: authoritative Hallmark data wins over heuristic title parsing
  const baseName = hallmark?.name ?? upcResult.name ?? null;
  const baseSeries =
    hallmark?.seriesName ?? upcResult.seriesOrCollection ?? null;
  const baseYear = hallmark?.year ?? upcResult.year ?? null;
  const imageUrl = upcResult.imageUrl ?? hallmark?.images?.[0] ?? null;
  const baseBrand = upcResult.brand ?? "Hallmark";

  // Apply user correction override (most-recent correction wins over catalog)
  const name = correction?.correctedName ?? baseName;
  const brand = correction?.correctedBrand ?? baseBrand;
  const seriesOrCollection =
    correction?.correctedSeriesOrCollection ?? baseSeries;
  const year = correction?.correctedYear ?? baseYear;

  if (correction) {
    logger.info(
      { barcode, name, brand, seriesOrCollection, year },
      "User correction applied to fresh barcode lookup result",
    );
  }

  // ── 6. Write / update cache ───────────────────────────────────────────────
  // Use onConflictDoUpdate so a successful fallback overwrites a prior
  // found=0 row — the cache should always reflect the best known result.
  const cacheValues = {
    barcode,
    found: 1 as const,
    name,
    brand,
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
  };
  await db
    .insert(ornamentsBarcodeCache)
    .values(cacheValues)
    .onConflictDoUpdate({
      target: ornamentsBarcodeCache.barcode,
      set: cacheValues,
    });

  // Also back-patch any ornament items saved before enrichment arrived
  if (hallmark) {
    void patchOrnamentsFromEnrichment(barcode, hallmark);
  }

  return {
    barcode,
    found: true,
    name,
    brand,
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
