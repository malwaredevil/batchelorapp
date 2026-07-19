/**
 * Hallmark HookedOnHallmark Crawl Actor
 *
 * Scrapes hookedonhallmark.com — the world's largest Hallmark ornament
 * retailer — for collector prices, SKUs, availability, and series data.
 *
 * Strategy: pull all 16 000+ product URLs from their sitemap.xml (no
 * pagination needed), then scrape each product page with CheerioCrawler.
 * Each page embeds a `var _3d_item = {...}` JS literal that contains
 * name, Hallmark SKU, price, and availability in static HTML.
 *
 * Typical run: ~16 500 ornaments in 20–40 minutes at maxConcurrency 20.
 *
 * Actor: hallmark-hooh-crawl
 */

import { Actor } from "apify";
import { CheerioCrawler, Dataset } from "crawlee";

interface Input {
  maxItems?: number;
  startUrls?: string[];
}

interface HoohProduct {
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

const SITEMAP_URL = "https://www.hookedonhallmark.com/sitemap.xml";
const SERIES_RE =
  /(\d+)(?:st|nd|rd|th)\s+in\s+(?:the\s+)?(.+?)\s+(?:Keepsake\s+Ornament\s+)?[Ss]eries/i;

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

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? {};
const maxItems = input.maxItems ?? 0;

let productUrls: string[] = input.startUrls ?? [];

if (productUrls.length === 0) {
  console.log("Fetching sitemap to discover all product URLs…");
  const sitemapResp = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Apify Bot)" },
  });
  const sitemapXml = await sitemapResp.text();
  const allUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => m[1],
  );
  productUrls = allUrls.filter((u) => /_p_\d+/.test(u));
  console.log(`Sitemap: found ${productUrls.length} product URLs`);
}

if (maxItems > 0) {
  productUrls = productUrls.slice(0, maxItems);
}

console.log(`Scraping ${productUrls.length} product pages…`);

const crawler = new CheerioCrawler({
  maxConcurrency: 20,
  requestHandlerTimeoutSecs: 30,
  maxRequestRetries: 2,
  additionalMimeTypes: ["text/html"],

  async requestHandler({ request, $, log }) {
    const url = request.url;

    // Extract the embedded JS literal: var _3d_item = {...};
    let itemData: {
      catalogid?: number;
      id?: string;
      name?: string;
      price?: number;
      availability?: number;
    } = {};
    $("script").each((_, el) => {
      const src = $(el).html() ?? "";
      const m = src.match(/var _3d_item = (\{[^;]+\});/);
      if (m) {
        try {
          itemData = JSON.parse(m[1]) as typeof itemData;
        } catch {
          // malformed — skip
        }
      }
    });

    if (!itemData.name) {
      log.warning(`No _3d_item found: ${url}`);
      return;
    }

    // Breadcrumbs via itemprop="name" in breadcrumb list
    // Structure: Home > Hallmark Ornaments By Year > {Year} Hallmark Ornaments > [subcategory] > {Product}
    const crumbs: string[] = [];
    $('[itemprop="name"]').each((_, el) => {
      const text = ($(el).attr("content") ?? $(el).text())
        .trim()
        .replace(/&quot;/g, '"');
      if (text) crumbs.push(text);
    });

    // 4th crumb (index 3) is a subcategory when it differs from the product name
    const productName = itemData.name ?? null;
    const subcategory =
      crumbs.length >= 5 &&
      crumbs[3] !== productName &&
      !crumbs[3].includes(productName ?? "")
        ? crumbs[3]
        : null;

    // Year: prefer product name (starts with year), fall back to year crumb
    const year =
      parseYear(productName ?? "") ?? (crumbs[2] ? parseYear(crumbs[2]) : null);

    // Series: parse from product name
    const { seriesName, sequenceNumber } = parseSeries(productName ?? "");

    const product: HoohProduct = {
      productUrl: url,
      catalogId: itemData.catalogid ?? null,
      hallmarkSku: itemData.id ?? null,
      name: productName,
      year,
      subcategory,
      seriesName,
      sequenceNumber,
      retailPriceUsd:
        typeof itemData.price === "number" ? itemData.price : null,
      inStock: itemData.availability === 1,
      source: "hookedonhallmark.com",
      crawledAt: new Date().toISOString(),
    };

    log.info(
      `✓ ${product.name} | SKU=${product.hallmarkSku ?? "—"} | $${product.retailPriceUsd ?? "—"} | ${product.inStock ? "in stock" : "out"}`,
    );
    await Dataset.pushData(product);
  },

  failedRequestHandler({ request, log }) {
    log.error(`Failed: ${request.url}`);
  },
});

await crawler.run(productUrls.map((url) => ({ url, label: "PRODUCT" })));
console.log("HooH crawl complete");

await Actor.exit();
