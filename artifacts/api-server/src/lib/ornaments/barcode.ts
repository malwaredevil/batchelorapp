import { logger } from "../logger";
import { env } from "../env";
import { getEbayAppToken } from "../ebay/oauth";
import { callModel, MODELS } from "../ai-client";

/**
 * Live barcode identification for ornament intake. Exact eBay GTIN results are
 * preferred; an AI identification is a clearly lower-confidence fallback. This
 * deliberately keeps no UPC cache or scraped reference-catalog dependency.
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
}

interface UpcFetchResult {
  found: boolean;
  name: string | null;
  brand: string | null;
  seriesOrCollection: string | null;
  year: number | null;
  description: string | null;
  imageUrl: string | null;
}

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

/**
 * eBay Browse API — GTIN/UPC lookup.
 * Searches active listings by the exact barcode and extracts product identity
 * from the top listing title + aspect refinements (Year, Series, Theme).
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
  };
}

/**
 * AI fallback — ask an LLM to identify the ornament by UPC.
 * Models have training-data knowledge of many common Hallmark ornaments and can
 * correctly identify products that a live eBay GTIN search may miss.
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

export async function lookupBarcode(
  rawBarcode: string,
): Promise<BarcodeLookupResult> {
  const barcode = rawBarcode.trim();
  // eBay GTIN search is an exact barcode match against live market listings.
  // This is an authoritative, verifiable match (the barcode is searched
  // directly), so it always runs before the AI guess below.
  let upcResult: UpcFetchResult | null = null;
  try {
    const r = await fetchFromEbay(barcode);
    if (r.found) {
      logger.info({ barcode }, "eBay GTIN lookup: identified product");
      upcResult = r;
    } else {
      logger.info(
        { barcode },
        "eBay GTIN lookup: not found — trying AI identification",
      );
    }
  } catch (ebayErr) {
    logger.warn({ err: ebayErr, barcode }, "eBay GTIN lookup failed");
  }

  // AI is a bounded last resort only.
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

  if (!upcResult) {
    return {
      barcode,
      found: false,
      name: null,
      brand: null,
      seriesOrCollection: null,
      year: null,
      description: null,
      imageUrl: null,
    };
  }

  return {
    barcode,
    found: true,
    name: upcResult.name,
    brand: upcResult.brand ?? "Hallmark",
    seriesOrCollection: upcResult.seriesOrCollection,
    year: upcResult.year,
    description: upcResult.description,
    imageUrl: upcResult.imageUrl,
  };
}
