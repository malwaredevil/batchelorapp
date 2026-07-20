/**
 * Direct single-item lookup on HookedOnHallmark.com by Hallmark SKU.
 *
 * HooH serves static HTML (no JS rendering needed), so we fetch directly —
 * no Apify overhead. Two HTTP requests: one search page, one product page.
 * Parses the same `var _3d_item = {...}` literal that the full hooh-crawl
 * actor uses, so the extracted data shape is identical.
 *
 * Typical wall-clock time: 2–5 s.
 */

import { logger } from "../logger";

const UA = "Mozilla/5.0 (compatible; Batchelor-Bot/1.0)";
const FETCH_TIMEOUT_MS = 8_000;
const SERIES_RE =
  /(\d+)(?:st|nd|rd|th)\s+in\s+(?:the\s+)?(.+?)\s+(?:Keepsake\s+Ornament\s+)?[Ss]eries/i;

export interface HoohSingleResult {
  productUrl: string;
  catalogId: number | null;
  hallmarkSku: string | null;
  name: string | null;
  year: number | null;
  subcategory: string | null;
  seriesName: string | null;
  sequenceNumber: number | null;
  retailPriceUsd: number | null;
  inStock: boolean;
  source: "hookedonhallmark.com";
  crawledAt: string;
}

function parseYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function parseSeries(text: string): {
  seriesName: string | null;
  sequenceNumber: number | null;
} {
  const m = text.match(SERIES_RE);
  if (!m) return { seriesName: null, sequenceNumber: null };
  return {
    sequenceNumber: parseInt(m[1], 10),
    seriesName: m[2].replace(/Keepsake Ornament/gi, "").trim(),
  };
}

async function fetchHooh(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function parseProductPage(html: string, url: string): HoohSingleResult | null {
  const m = html.match(/var _3d_item = (\{[^;]+\});/);
  if (!m) return null;

  let itemData: {
    catalogid?: number;
    id?: string;
    name?: string;
    price?: number;
    availability?: number;
  } = {};
  try {
    itemData = JSON.parse(m[1]) as typeof itemData;
  } catch {
    return null;
  }

  if (!itemData.name) return null;

  const crumbs: string[] = [];
  const bRe = /itemprop="name"[^>]*(?:content="([^"]+)"|>([^<]+)<)/g;
  let bm: RegExpExecArray | null;
  while ((bm = bRe.exec(html)) !== null) {
    const t = (bm[1] ?? bm[2] ?? "").trim().replace(/&quot;/g, '"');
    if (t) crumbs.push(t);
  }

  const productName = itemData.name;
  const subcategory =
    crumbs.length >= 5 &&
    crumbs[3] !== productName &&
    !crumbs[3].includes(productName)
      ? crumbs[3]
      : null;

  const year =
    parseYear(productName) ?? (crumbs[2] ? parseYear(crumbs[2]) : null);
  const { seriesName, sequenceNumber } = parseSeries(productName);

  return {
    productUrl: url,
    catalogId: itemData.catalogid ?? null,
    hallmarkSku: itemData.id ?? null,
    name: productName,
    year,
    subcategory,
    seriesName,
    sequenceNumber,
    retailPriceUsd: typeof itemData.price === "number" ? itemData.price : null,
    inStock: itemData.availability === 1,
    source: "hookedonhallmark.com",
    crawledAt: new Date().toISOString(),
  };
}

/**
 * Look up a single ornament on HookedOnHallmark.com by Hallmark SKU.
 *
 * Returns null if:
 *  - The search returns no matching product URL
 *  - The product page has no `_3d_item` literal
 *  - The returned SKU doesn't match the queried SKU (relevance miss)
 *  - Any network / timeout error occurs
 */
export async function lookupHoohBySku(
  sku: string,
): Promise<HoohSingleResult | null> {
  logger.info({ sku }, "hooh-single-lookup: searching by SKU");

  const searchUrl = `https://www.hookedonhallmark.com/?s=${encodeURIComponent(sku)}`;
  const searchHtml = await fetchHooh(searchUrl);
  if (!searchHtml) {
    logger.warn({ sku }, "hooh-single-lookup: search fetch failed");
    return null;
  }

  const urlMatch = searchHtml.match(
    /href="(https:\/\/www\.hookedonhallmark\.com\/[^"]*_p_\d+[^"]*)"/,
  );
  if (!urlMatch) {
    logger.info(
      { sku },
      "hooh-single-lookup: no product found in search results",
    );
    return null;
  }

  const productUrl = urlMatch[1].replace(/&amp;/g, "&");
  const productHtml = await fetchHooh(productUrl);
  if (!productHtml) {
    logger.warn(
      { sku, productUrl },
      "hooh-single-lookup: product page fetch failed",
    );
    return null;
  }

  const result = parseProductPage(productHtml, productUrl);
  if (!result) {
    logger.info({ sku, productUrl }, "hooh-single-lookup: no _3d_item on page");
    return null;
  }

  if (result.hallmarkSku && result.hallmarkSku !== sku) {
    logger.warn(
      { queriedSku: sku, returnedSku: result.hallmarkSku },
      "hooh-single-lookup: SKU mismatch — treating as miss",
    );
    return null;
  }

  logger.info(
    {
      sku,
      name: result.name,
      price: result.retailPriceUsd,
      series: result.seriesName,
      inStock: result.inStock,
    },
    "hooh-single-lookup: found ornament",
  );
  return result;
}
