/**
 * Hallmark Catalog Crawl Actor
 *
 * Fetches Hallmark's product sitemap, filters for ornament URLs, and uses
 * CheerioCrawler (static HTML, fast + cheap) to extract structured data from
 * every ornament page on hallmark.com. Outputs one dataset item per ornament.
 *
 * Typical run: ~1,080 ornaments in 8–10 minutes.
 *
 * Actor: hallmark-catalog-crawl
 */

import { Actor } from "apify";
import { CheerioCrawler, Dataset } from "crawlee";

interface Input {
  sitemapUrl?: string;
  urlFilter?: string;
  maxProducts?: number;
}

interface CatalogProduct {
  hallmarkSku: string | null;
  name: string | null;
  description: string | null;
  seriesName: string | null;
  sequenceNumber: number | null;
  year: number | null;
  artist: string | null;
  retailPriceUsd: number | null;
  productUrl: string;
  images: string[];
  ornamentCategory: string | null;
  source: "hallmark.com-sitemap";
  crawledAt: string;
}

/** Parse series + sequence from a Hallmark description string. */
function parseSeriesFromDescription(description: string): {
  seriesName: string | null;
  sequenceNumber: number | null;
} {
  const m = description.match(
    /(\d+)(?:st|nd|rd|th)\s+in\s+(?:the\s+)?(.+?)\s+(?:Keepsake\s+Ornament\s+)?[Ss]eries/,
  );
  if (!m) return { seriesName: null, sequenceNumber: null };
  return {
    sequenceNumber: parseInt(m[1], 10),
    seriesName: m[2].replace(/Keepsake Ornament/i, "").trim(),
  };
}

/** Extract a 4-digit year from a string. */
function parseYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? {};
const sitemapUrl =
  input.sitemapUrl ?? "https://www.hallmark.com/sitemap_0-product.xml";
const urlFilter = input.urlFilter ?? "/ornaments/";
const maxProducts = input.maxProducts ?? 5000;

console.log(`Catalog crawl — fetching sitemap: ${sitemapUrl}`);

const sitemapResp = await fetch(sitemapUrl, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; Apify/1.0)" },
});
if (!sitemapResp.ok) {
  throw new Error(`Sitemap fetch failed: ${sitemapResp.status}`);
}
const sitemapXml = await sitemapResp.text();

const urlMatches = sitemapXml.match(/<loc>([\s\S]*?)<\/loc>/g) ?? [];
let productUrls = urlMatches
  .map((m) => m.replace(/<\/?loc>/g, "").trim())
  .filter((u) => u.includes(urlFilter));

if (maxProducts > 0) productUrls = productUrls.slice(0, maxProducts);

console.log(
  `Found ${productUrls.length} ornament URLs to crawl (filter="${urlFilter}")`,
);

if (productUrls.length === 0) {
  console.warn("No URLs matched — check sitemapUrl and urlFilter");
  await Actor.exit();
}

const catalogCrawler = new CheerioCrawler({
  maxConcurrency: 20,
  requestHandlerTimeoutSecs: 30,
  maxRequestRetries: 2,

  async requestHandler({ request, $, log }) {
    const url = request.url;

    const product: CatalogProduct = {
      hallmarkSku: null,
      name: null,
      description: null,
      seriesName: null,
      sequenceNumber: null,
      year: null,
      artist: null,
      retailPriceUsd: null,
      productUrl: url,
      images: [],
      ornamentCategory: null,
      source: "hallmark.com-sitemap",
      crawledAt: new Date().toISOString(),
    };

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() ?? "") as Record<string, unknown>;
        if (data["@type"] === "Product") {
          product.hallmarkSku =
            (data["mpn"] as string) ?? (data["sku"] as string) ?? null;
          product.name = (data["name"] as string) ?? null;
          product.description = (data["description"] as string) ?? null;

          const image = data["image"];
          product.images = Array.isArray(image)
            ? (image as unknown[])
                .filter((u): u is string => typeof u === "string")
                .slice(0, 4)
            : typeof image === "string"
              ? [image]
              : [];

          const offers = data["offers"] as Record<string, unknown> | undefined;
          if (offers?.["price"]) {
            const p = parseFloat(String(offers["price"]));
            if (!isNaN(p)) product.retailPriceUsd = p;
          }
        }
      } catch {
        // skip malformed JSON-LD
      }
    });

    $("span, p, li, td, dd").each((_, el) => {
      const text = $(el).text().trim();
      if (/^Artist:\s*.+/.test(text)) {
        const m = text.match(/Artist:\s*(.+)/);
        if (m) {
          product.artist = m[1].trim();
          return false;
        }
      }
      return true;
    });

    if (product.description) {
      const { seriesName, sequenceNumber } = parseSeriesFromDescription(
        product.description,
      );
      product.seriesName = seriesName;
      product.sequenceNumber = sequenceNumber;
    }

    if (!product.year && product.name) {
      product.year = parseYear(product.name);
    }
    if (!product.year && product.description) {
      product.year = parseYear(product.description);
    }

    const catMatch = url.match(/\/ornaments\/([^/]+)\//);
    if (catMatch) {
      product.ornamentCategory = catMatch[1]
        .replace(/-ornaments$/, "")
        .replace(/-/g, " ");
    }

    if (product.name) {
      log.info(`✓ ${product.name} (${product.hallmarkSku ?? "no-sku"})`);
      await Dataset.pushData(product);
    } else {
      log.warning(`No name extracted from: ${url}`);
    }
  },

  failedRequestHandler({ request, log }) {
    log.error(`Request failed: ${request.url}`);
  },
});

await catalogCrawler.run(productUrls.map((url) => ({ url })));
console.log("Catalog crawl complete");

await Actor.exit();
