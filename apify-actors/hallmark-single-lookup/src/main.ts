/**
 * Hallmark Single-Item Lookup Actor
 *
 * Given a barcode, Hallmark SKU, or ornament name+year, uses a headless
 * Playwright browser to search hallmark.com (JS-rendered) and extract
 * structured data from the product page.
 *
 * Actor: hallmark-single-lookup
 * Actor ID: created separately from hallmark-catalog-crawl and hallmark-historical-crawl
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
const { hallmarkSku, name, year } = input;

if (!hallmarkSku && !name) {
  console.error("Input must include at least hallmarkSku or name");
  await Actor.exit();
}

const searchQuery = hallmarkSku ?? [name, year].filter(Boolean).join(" ");
const searchUrl = `https://www.hallmark.com/search/?q=${encodeURIComponent(searchQuery)}`;

console.log(`Searching Hallmark.com for: "${searchQuery}"`);
console.log(`Search URL: ${searchUrl}`);

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

const crawler = new PlaywrightCrawler({
  maxRequestsPerCrawl: 3,
  requestHandlerTimeoutSecs: 60,

  async requestHandler({ request, page, enqueueLinks, log }) {
    const url = request.url;
    log.info(`Processing: ${url}`);

    if (request.label === "SEARCH") {
      await page.waitForTimeout(3000);

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

      await enqueueLinks({ urls: [productUrls[0]], label: "PRODUCT" });
    }

    if (request.label === "PRODUCT") {
      result.hallmarkProductUrl = url;

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

      if (result.description) {
        const { seriesName, sequenceNumber } = parseSeriesFromDescription(
          result.description,
        );
        result.seriesName = seriesName;
        result.sequenceNumber = sequenceNumber;
      }

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

      if (!result.year && result.name) {
        result.year = parseYear(result.name);
      }

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

await crawler.run([{ url: searchUrl, label: "SEARCH" }]);

await Dataset.pushData(result);
console.log("Result:", JSON.stringify(result, null, 2));

await Actor.exit();
