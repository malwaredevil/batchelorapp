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

type Mode = "single-item" | "catalog-crawl" | "historical-crawl";

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
  // historical-crawl fields
  startYear?: number;
  endYear?: number;
  maxOrnamentsPerYear?: number;
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
// MODE: historical-crawl
// Scrapes hallmarkornaments.com (The Ornament Factory) year by year.
// Year-category URLs are hardcoded from the site's navigation (non-sequential
// c_NNN values, discovered 2026-07-19). Pagination pattern: 1995_c_260-2-3.html
// ============================================================================
if (mode === "historical-crawl") {
  const YEAR_CATEGORY_URLS: Record<number, string> = {
    1973: "https://www.hallmarkornaments.com/1973_c_303.html",
    1974: "https://www.hallmarkornaments.com/1974_c_304.html",
    1975: "https://www.hallmarkornaments.com/1975_c_305.html",
    1976: "https://www.hallmarkornaments.com/1976_c_296.html",
    1977: "https://www.hallmarkornaments.com/1977_c_302.html",
    1978: "https://www.hallmarkornaments.com/1978_c_301.html",
    1979: "https://www.hallmarkornaments.com/1979_c_285.html",
    1980: "https://www.hallmarkornaments.com/1980_c_274.html",
    1981: "https://www.hallmarkornaments.com/1981_c_287.html",
    1982: "https://www.hallmarkornaments.com/1982_c_281.html",
    1983: "https://www.hallmarkornaments.com/1983_c_284.html",
    1984: "https://www.hallmarkornaments.com/1984_c_282.html",
    1985: "https://www.hallmarkornaments.com/1985_c_278.html",
    1986: "https://www.hallmarkornaments.com/1986_c_283.html",
    1987: "https://www.hallmarkornaments.com/1987_c_275.html",
    1988: "https://www.hallmarkornaments.com/1988_c_279.html",
    1989: "https://www.hallmarkornaments.com/1989_c_277.html",
    1990: "https://www.hallmarkornaments.com/1990_c_280.html",
    1991: "https://www.hallmarkornaments.com/1991_c_256.html",
    1992: "https://www.hallmarkornaments.com/1992_c_257.html",
    1993: "https://www.hallmarkornaments.com/1993_c_258.html",
    1994: "https://www.hallmarkornaments.com/1994_c_259.html",
    1995: "https://www.hallmarkornaments.com/1995_c_260.html",
    1996: "https://www.hallmarkornaments.com/1996_c_261.html",
    1997: "https://www.hallmarkornaments.com/1997_c_262.html",
    1998: "https://www.hallmarkornaments.com/1998_c_263.html",
    1999: "https://www.hallmarkornaments.com/1999_c_264.html",
    2000: "https://www.hallmarkornaments.com/2000_c_265.html",
    2001: "https://www.hallmarkornaments.com/2001_c_266.html",
    2002: "https://www.hallmarkornaments.com/2002_c_267.html",
    2003: "https://www.hallmarkornaments.com/2003_c_268.html",
    2004: "https://www.hallmarkornaments.com/2004_c_269.html",
    2005: "https://www.hallmarkornaments.com/2005_c_270.html",
    2006: "https://www.hallmarkornaments.com/2006_c_271.html",
    2007: "https://www.hallmarkornaments.com/2007_c_272.html",
    2008: "https://www.hallmarkornaments.com/2008_c_273.html",
    2009: "https://www.hallmarkornaments.com/2009_c_276.html",
    2010: "https://www.hallmarkornaments.com/2010_c_286.html",
    2011: "https://www.hallmarkornaments.com/2011_c_288.html",
    2012: "https://www.hallmarkornaments.com/2012_c_289.html",
    2013: "https://www.hallmarkornaments.com/2013_c_297.html",
    2014: "https://www.hallmarkornaments.com/2014_c_306.html",
    2015: "https://www.hallmarkornaments.com/2015_c_308.html",
    2016: "https://www.hallmarkornaments.com/2016_c_310.html",
    2017: "https://www.hallmarkornaments.com/2017_c_316.html",
    2018: "https://www.hallmarkornaments.com/2018_c_322.html",
    2019: "https://www.hallmarkornaments.com/2019_c_352.html",
    2020: "https://www.hallmarkornaments.com/2020_c_368.html",
    2021: "https://www.hallmarkornaments.com/2021_c_373.html",
    2022: "https://www.hallmarkornaments.com/2022_c_387.html",
    2023: "https://www.hallmarkornaments.com/2023_c_394.html",
    2024: "https://www.hallmarkornaments.com/2024_c_420.html",
    2025: "https://www.hallmarkornaments.com/2025_c_430.html",
    2026: "https://www.hallmarkornaments.com/2026_c_471.html",
  };

  const startYear = input.startYear ?? 1973;
  const endYear = input.endYear ?? 2026;
  const maxOrnamentsPerYear = input.maxOrnamentsPerYear ?? 0;

  const yearUrls = Object.entries(YEAR_CATEGORY_URLS)
    .filter(([y]) => {
      const yr = parseInt(y, 10);
      return yr >= startYear && yr <= endYear;
    })
    .map(([, url]) => url);

  console.log(
    `Historical crawl mode — ${yearUrls.length} year(s) from ${startYear} to ${endYear}`,
  );

  interface HistoricalProduct {
    hallmarkSku: string | null;
    name: string | null;
    year: number | null;
    seriesName: string | null;
    sequenceNumber: number | null;
    artist: string | null;
    collectorPriceUsd: number | null;
    productUrl: string;
    images: string[];
    source: "hallmarkornaments.com";
    crawledAt: string;
  }

  // Track product URLs enqueued so far to prevent duplicates across pagination
  const enqueuedProductUrls = new Set<string>();
  // Per-year ornament count caps
  const yearProductCount: Record<string, number> = {};

  const historicalCrawler = new CheerioCrawler({
    maxConcurrency: 6,
    requestHandlerTimeoutSecs: 30,
    maxRequestRetries: 2,

    async requestHandler({ request, $, enqueueLinks, log }) {
      const url = request.url;

      // ── YEAR_PAGE: list page for a given year ──────────────────────────────
      if (request.label === "YEAR_PAGE") {
        // Extract year from URL (e.g. /1995_c_260.html → 1995)
        const yearMatch = url.match(/\/(\d{4})_c_/);
        const pageYear = yearMatch ? yearMatch[1] : "unknown";

        // Extract the c_NNN base from the URL (needed to find pagination links)
        const cBaseMatch = url.match(/(\d{4}_c_\d+)/);
        const cBase = cBaseMatch ? cBaseMatch[1] : null;

        // Collect product links (_p_ pattern)
        const productUrls: string[] = [];
        $('a[href*="_p_"]').each((_, el) => {
          const href = $(el).attr("href");
          if (!href || !href.includes("_p_")) return;
          const absUrl = href.startsWith("http")
            ? href
            : `https://www.hallmarkornaments.com/${href.replace(/^\//, "")}`;
          if (!enqueuedProductUrls.has(absUrl)) {
            if (maxOrnamentsPerYear > 0) {
              const count = yearProductCount[pageYear] ?? 0;
              if (count >= maxOrnamentsPerYear) return;
              yearProductCount[pageYear] = count + 1;
            }
            enqueuedProductUrls.add(absUrl);
            productUrls.push(absUrl);
          }
        });

        if (productUrls.length > 0) {
          await enqueueLinks({ urls: productUrls, label: "PRODUCT" });
          log.info(
            `Year ${pageYear}: queued ${productUrls.length} products from ${url}`,
          );
        }

        // Find pagination links for this year (pattern: 1995_c_260-2-3.html)
        if (cBase) {
          const paginationUrls: string[] = [];
          $(`a[href*="${cBase}-"]`).each((_, el) => {
            const href = $(el).attr("href");
            if (!href) return;
            const absUrl = href.startsWith("http")
              ? href
              : `https://www.hallmarkornaments.com/${href.replace(/^\//, "")}`;
            // Only enqueue pagination pages, not product pages
            if (!absUrl.includes("_p_") && !enqueuedProductUrls.has(absUrl)) {
              enqueuedProductUrls.add(absUrl); // re-use set to avoid duplicate page enqueues
              paginationUrls.push(absUrl);
            }
          });
          if (paginationUrls.length > 0) {
            await enqueueLinks({ urls: paginationUrls, label: "YEAR_PAGE" });
            log.info(
              `Year ${pageYear}: queued ${paginationUrls.length} pagination page(s)`,
            );
          }
        }
        return;
      }

      // ── PRODUCT: individual ornament detail page ───────────────────────────
      if (request.label === "PRODUCT") {
        const product: HistoricalProduct = {
          hallmarkSku: null,
          name: null,
          year: null,
          seriesName: null,
          sequenceNumber: null,
          artist: null,
          collectorPriceUsd: null,
          productUrl: url,
          images: [],
          source: "hallmarkornaments.com",
          crawledAt: new Date().toISOString(),
        };

        // ── JSON-LD Product schema (name, SKU, images) ───────────────────────
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const data = JSON.parse($(el).html() ?? "") as Record<
              string,
              unknown
            >;
            if (data["@type"] === "Product") {
              product.name = (data["name"] as string) ?? null;
              product.hallmarkSku =
                (data["sku"] as string) ?? (data["mpn"] as string) ?? null;

              const image = data["image"];
              product.images = Array.isArray(image)
                ? (image as unknown[])
                    .filter((u): u is string => typeof u === "string")
                    .slice(0, 4)
                : typeof image === "string"
                  ? [image]
                  : [];

              // Price from JSON-LD offers
              const offers = data["offers"] as
                | Record<string, unknown>
                | undefined;
              if (offers?.["price"]) {
                const p = parseFloat(String(offers["price"]));
                if (!isNaN(p)) product.collectorPriceUsd = p;
              }
            }
          } catch {
            // skip malformed JSON-LD
          }
        });

        // ── Fallback: page title for name ────────────────────────────────────
        if (!product.name) {
          const titleEl = $("h1").first().text().trim();
          if (titleEl) product.name = titleEl;
        }

        // ── Year from URL (reliable: URL always contains year) ───────────────
        const urlYearMatch = url.match(/hallmarkornaments\.com\/(\d{4})-/);
        if (urlYearMatch) {
          product.year = parseInt(urlYearMatch[1], 10);
        } else if (product.name) {
          product.year = parseYear(product.name);
        }

        // ── Series + sequence number from name/page ──────────────────────────
        $("td, th, dd, dt, li, span").each((_, el) => {
          const text = $(el).text().trim();
          if (/^Series[:\s]/i.test(text)) {
            const m = text.match(/Series[:\s]+(.+)/i);
            if (m) product.seriesName = m[1].trim().split(/\s{2,}/)[0];
          }
          if (/^Series #[:\s]/i.test(text) || /^#\d+\s+in/i.test(text)) {
            const m = text.match(/(\d+)/);
            if (m) product.sequenceNumber = parseInt(m[1], 10);
          }
          if (/^Artist[:\s]/i.test(text)) {
            const m = text.match(/Artist[:\s]+(.+)/i);
            if (m) product.artist = m[1].trim().split(/\s{2,}/)[0];
          }
        });

        // ── Series from name (e.g. "3rd in Frosty Friends series") ──────────
        if (!product.seriesName && product.name) {
          const { seriesName, sequenceNumber } = parseSeriesFromDescription(
            product.name,
          );
          product.seriesName = seriesName;
          product.sequenceNumber = sequenceNumber;
        }

        if (product.name) {
          log.info(
            `✓ ${product.name} (${product.hallmarkSku ?? "no-sku"}) yr=${product.year}`,
          );
          await Dataset.pushData(product);
        } else {
          log.warning(`No name extracted from: ${url}`);
        }
      }
    },

    failedRequestHandler({ request, log }) {
      log.error(`Request failed: ${request.url}`);
    },
  });

  await historicalCrawler.run(
    yearUrls.map((url) => ({ url, label: "YEAR_PAGE" })),
  );
  console.log("Historical crawl complete");
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
