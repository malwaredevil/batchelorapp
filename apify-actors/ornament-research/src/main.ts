/**
 * Hallmark Ornament Research Actor
 *
 * Two modes:
 *
 * 1. single-item (default) — Given a barcode, Hallmark SKU, or ornament name+year,
 *    uses a headless Playwright browser to search hallmark.com (JS-rendered) and
 *    extract structured data from the product page.
 *
 * 2. catalog-crawl — Fetches Hallmark's product sitemap, filters for ornament URLs,
 *    and uses CheerioCrawler (static HTML, fast + cheap) to extract structured data
 *    from every ornament page. Outputs one dataset item per ornament.
 *
 * Phase 2 (when eBay API key available): add eBay Browse API valuation step.
 */

import { Actor } from "apify";
import { PlaywrightCrawler, CheerioCrawler, Dataset } from "crawlee";

type Mode = "single-item" | "catalog-crawl";

interface Input {
  // Mode selector
  mode?: Mode;
  // single-item fields
  barcode?: string;
  hallmarkSku?: string;
  name?: string;
  year?: number;
  // catalog-crawl fields
  sitemapUrl?: string;
  urlFilter?: string;
  maxProducts?: number;
}

interface HallmarkProduct {
  found: boolean;
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

// ────────────────────────────────────────────────────────────────────────────

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? {};
const mode: Mode = input.mode ?? "single-item";

// ============================================================================
// MODE: catalog-crawl
// ============================================================================
if (mode === "catalog-crawl") {
  const sitemapUrl =
    input.sitemapUrl ?? "https://www.hallmark.com/sitemap_0-product.xml";
  const urlFilter = input.urlFilter ?? "/ornaments/";
  const maxProducts = input.maxProducts ?? 5000;

  console.log(`Catalog crawl mode — fetching sitemap: ${sitemapUrl}`);

  // Fetch sitemap XML (plain fetch — no browser needed)
  const sitemapResp = await fetch(sitemapUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Apify/1.0)" },
  });
  if (!sitemapResp.ok) {
    throw new Error(`Sitemap fetch failed: ${sitemapResp.status}`);
  }
  const sitemapXml = await sitemapResp.text();

  // Extract and filter URLs
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
    maxConcurrency: 8,
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

      // ── JSON-LD Product schema ─────────────────────────────────────────
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() ?? "") as Record<
            string,
            unknown
          >;
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

            const offers = data["offers"] as
              | Record<string, unknown>
              | undefined;
            if (offers?.["price"]) {
              const p = parseFloat(String(offers["price"]));
              if (!isNaN(p)) product.retailPriceUsd = p;
            }
          }
        } catch {
          // skip malformed JSON-LD
        }
      });

      // ── Artist from DOM ────────────────────────────────────────────────
      $("span, p, li, td, dd").each((_, el) => {
        const text = $(el).text().trim();
        if (/^Artist:\s*.+/.test(text)) {
          const m = text.match(/Artist:\s*(.+)/);
          if (m) {
            product.artist = m[1].trim();
            return false; // break each loop
          }
        }
        return true;
      });

      // ── Series + sequence from description ────────────────────────────
      if (product.description) {
        const { seriesName, sequenceNumber } = parseSeriesFromDescription(
          product.description,
        );
        product.seriesName = seriesName;
        product.sequenceNumber = sequenceNumber;
      }

      // ── Year from name ────────────────────────────────────────────────
      if (!product.year && product.name) {
        product.year = parseYear(product.name);
      }
      if (!product.year && product.description) {
        product.year = parseYear(product.description);
      }

      // ── Ornament category from URL path ───────────────────────────────
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
}

// ============================================================================
// MODE: single-item (default)
// ============================================================================
const { hallmarkSku, name, year } = input;

if (!hallmarkSku && !name) {
  console.error("Input must include at least hallmarkSku or name");
  await Actor.exit();
}

// ── Build search query ──────────────────────────────────────────────────────
// Prefer SKU search (most precise). Fall back to name+year.
const searchQuery = hallmarkSku ?? [name, year].filter(Boolean).join(" ");
const searchUrl = `https://www.hallmark.com/search/?q=${encodeURIComponent(searchQuery)}`;

console.log(`Searching Hallmark.com for: "${searchQuery}"`);
console.log(`Search URL: ${searchUrl}`);

// ── Shared result store ─────────────────────────────────────────────────────
let result: HallmarkProduct = {
  found: false,
  hallmarkSku: hallmarkSku ?? null,
  name: null,
  brand: "Hallmark",
  seriesName: null,
  sequenceNumber: null,
  year: year ?? null,
  artist: null,
  originalRetailPrice: null,
  hallmarkProductUrl: null,
  images: [],
  description: null,
  confidence: 0,
  source: "hallmark.com",
  scrapedAt: new Date().toISOString(),
};

// ── Crawler ─────────────────────────────────────────────────────────────────
const crawler = new PlaywrightCrawler({
  maxRequestsPerCrawl: 3,
  requestHandlerTimeoutSecs: 60,

  async requestHandler({ request, page, enqueueLinks, log }) {
    const url = request.url;
    log.info(`Processing: ${url}`);

    if (request.label === "SEARCH") {
      // Wait for JS to render the product grid
      await page.waitForTimeout(3000);

      // Try to find product URLs from JSON-LD ItemList
      const jsonLdTexts = await page.$$eval(
        'script[type="application/ld+json"]',
        (els: Element[]) => els.map((el: Element) => el.textContent ?? ""),
      );

      let productUrls: string[] = [];
      for (const text of jsonLdTexts) {
        try {
          const data = JSON.parse(text);
          if (
            data["@type"] === "ItemList" &&
            Array.isArray(data.itemListElement)
          ) {
            productUrls = data.itemListElement
              .map((item: { url?: string }) => item.url)
              .filter(Boolean);
          }
        } catch {
          // skip malformed JSON-LD
        }
      }

      // Fallback: look for product tile links in the DOM
      if (productUrls.length === 0) {
        productUrls = await page.$$eval(
          'a[href*="/ornaments/"][href*=".html"]',
          (els: Element[]) =>
            els
              .map((el: Element) => (el as HTMLAnchorElement).href)
              .filter((h: string) => /[A-Z0-9]{5,10}\.html$/.test(h))
              .slice(0, 5),
        );
      }

      log.info(
        `Found ${productUrls.length} product URL(s): ${productUrls.slice(0, 3).join(", ")}`,
      );

      if (productUrls.length === 0) {
        log.warning("No product URLs found on search page");
        return;
      }

      // Follow the first (most relevant) product URL
      await enqueueLinks({
        urls: [productUrls[0]],
        label: "PRODUCT",
      });
    }

    if (request.label === "PRODUCT") {
      result.hallmarkProductUrl = url;

      // JSON-LD Product schema — most reliable source
      const jsonLdTexts = await page.$$eval(
        'script[type="application/ld+json"]',
        (els: Element[]) => els.map((el: Element) => el.textContent ?? ""),
      );

      for (const text of jsonLdTexts) {
        try {
          const data = JSON.parse(text);
          if (data["@type"] === "Product") {
            result.name = data.name ?? null;
            result.brand = data.brand?.name ?? "Hallmark";
            result.hallmarkSku = data.mpn ?? data.sku ?? result.hallmarkSku;
            result.description = data.description ?? null;
            result.images = Array.isArray(data.image)
              ? data.image
                  .filter((u: unknown) => typeof u === "string")
                  .slice(0, 4)
              : typeof data.image === "string"
                ? [data.image]
                : [];
          }
        } catch {
          // skip
        }
      }

      // ── Parse series and sequence from description ──────────────────────
      if (result.description) {
        const { seriesName, sequenceNumber } = parseSeriesFromDescription(
          result.description,
        );
        result.seriesName = seriesName;
        result.sequenceNumber = sequenceNumber;
      }

      // ── Artist ──────────────────────────────────────────────────────────
      const artistText = await page
        .$$eval("span, p, li", (els: Element[]) => {
          for (const el of els) {
            const text = el.textContent?.trim() ?? "";
            if (/^Artist:\s*.+/.test(text)) return text;
          }
          return null;
        })
        .catch(() => null);

      if (artistText) {
        const artistMatch = artistText.match(/Artist:\s*(.+)/);
        if (artistMatch) result.artist = artistMatch[1].trim();
      }

      // Fallback: look for an element immediately after an "Artist:" label
      if (!result.artist) {
        result.artist = await page
          .evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll("span, p, td, dd"),
            );
            for (let i = 0; i < spans.length; i++) {
              if (/^Artist:?\s*$/.test(spans[i].textContent?.trim() ?? "")) {
                return spans[i + 1]?.textContent?.trim() ?? null;
              }
            }
            return null;
          })
          .catch(() => null);
      }

      // ── Retail price ────────────────────────────────────────────────────
      const priceText = await page
        .$$eval(
          ".price-sales, .sales .value, [itemprop=price], .product__price",
          (els: Element[]) =>
            els.map((el: Element) => el.textContent?.trim()).find(Boolean) ??
            null,
        )
        .catch(() => null);

      if (priceText) {
        const priceMatch = priceText.match(/[\d.]+/);
        if (priceMatch) result.originalRetailPrice = parseFloat(priceMatch[0]);
      }

      // ── Year from name if not provided ──────────────────────────────────
      if (!result.year && result.name) {
        result.year = parseYear(result.name);
      }

      // ── Confidence scoring ──────────────────────────────────────────────
      let confidence = 0;
      if (hallmarkSku && result.hallmarkSku === hallmarkSku) confidence += 0.5;
      if (result.name) confidence += 0.2;
      if (result.seriesName) confidence += 0.15;
      if (result.artist) confidence += 0.1;
      if (result.originalRetailPrice) confidence += 0.05;
      result.confidence = Math.min(confidence, 1);
      result.found = confidence >= 0.2;

      log.info(
        `Extracted: name="${result.name}" series="${result.seriesName}" seq=${result.sequenceNumber} artist="${result.artist}" price=${result.originalRetailPrice} confidence=${result.confidence}`,
      );
    }
  },

  failedRequestHandler({ request, log }) {
    log.error(`Request failed: ${request.url}`);
  },
});

// ── Run ─────────────────────────────────────────────────────────────────────
await crawler.run([{ url: searchUrl, label: "SEARCH" }]);

// ── Save output ─────────────────────────────────────────────────────────────
await Dataset.pushData(result);

console.log("Result:", JSON.stringify(result, null, 2));

await Actor.exit();
