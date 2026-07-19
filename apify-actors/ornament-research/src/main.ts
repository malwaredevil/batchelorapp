/**
 * Hallmark Ornament Research Actor
 *
 * Given a barcode, Hallmark SKU, or ornament name+year, this actor:
 * 1. Searches hallmark.com using a headless browser (handles JS-rendered results)
 * 2. Follows the product detail page URL
 * 3. Extracts: name, MPN, series, sequence number, artist, retail price, images
 * 4. Outputs a structured result to the Apify dataset
 *
 * Phase 2 (when eBay API key available): add eBay Browse API valuation step.
 */

import { Actor } from "apify";
import { PlaywrightCrawler, Dataset } from "crawlee";

interface Input {
  barcode?: string;
  hallmarkSku?: string;
  name?: string;
  year?: number;
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

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? {};
const { barcode, hallmarkSku, name, year } = input;

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
        (els) => els.map((el) => el.textContent ?? ""),
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
          (els) =>
            els
              .map((el) => (el as HTMLAnchorElement).href)
              .filter((h) => /[A-Z0-9]{5,10}\.html$/.test(h))
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
        (els) => els.map((el) => el.textContent ?? ""),
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
      // e.g. "26th in the Toymaker Santa Keepsake Ornament series"
      if (result.description) {
        const seriesMatch = result.description.match(
          /(\d+)(?:st|nd|rd|th)\s+in\s+(?:the\s+)?(.+?)\s+(?:Keepsake\s+Ornament\s+)?[Ss]eries/,
        );
        if (seriesMatch) {
          result.sequenceNumber = parseInt(seriesMatch[1], 10);
          result.seriesName = seriesMatch[2]
            .replace(/Keepsake Ornament/i, "")
            .trim();
        }
      }

      // ── Artist ──────────────────────────────────────────────────────────
      // Hallmark pages include: <span>Artist:</span> <span>Name Here</span>
      const artistText = await page
        .$$eval("span, p, li", (els) => {
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
          (els) =>
            els.map((el) => el.textContent?.trim()).find(Boolean) ?? null,
        )
        .catch(() => null);

      if (priceText) {
        const priceMatch = priceText.match(/[\d.]+/);
        if (priceMatch) result.originalRetailPrice = parseFloat(priceMatch[0]);
      }

      // ── Year from name if not provided ──────────────────────────────────
      if (!result.year && result.name) {
        const yearMatch = result.name.match(/\b(20\d{2})\b/);
        if (yearMatch) result.year = parseInt(yearMatch[1], 10);
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
