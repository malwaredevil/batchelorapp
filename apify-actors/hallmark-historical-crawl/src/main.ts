/**
 * Hallmark Historical Crawl Actor
 *
 * Scrapes hallmarkornaments.com (The Ornament Factory) year by year,
 * collecting every Keepsake ornament from 1973 to 2026.
 *
 * Year-category URLs are hardcoded from the site's navigation — the c_NNN
 * values are non-sequential database IDs, not computed from the year.
 * Discovered and mapped 2026-07-19. Pagination pattern: 1995_c_260-2-3.html
 *
 * Typical run: ~5,000–15,000 ornaments in 30–90 minutes.
 *
 * Actor: hallmark-historical-crawl
 */

import { Actor } from "apify";
import { CheerioCrawler, Dataset } from "crawlee";

interface Input {
  startYear?: number;
  endYear?: number;
  maxOrnamentsPerYear?: number;
}

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

// Year → category page URL mapping.
// c_NNN values are non-sequential database IDs from hallmarkornaments.com's nav.
// Do NOT attempt to compute these — use this hardcoded map.
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

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? {};
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
  `Historical crawl — ${yearUrls.length} year(s) from ${startYear} to ${endYear}`,
);

const enqueuedProductUrls = new Set<string>();
const yearProductCount: Record<string, number> = {};

const historicalCrawler = new CheerioCrawler({
  maxConcurrency: 20,
  requestHandlerTimeoutSecs: 30,
  maxRequestRetries: 2,

  async requestHandler({ request, $, enqueueLinks, log }) {
    const url = request.url;

    if (request.label === "YEAR_PAGE") {
      const yearMatch = url.match(/\/(\d{4})_c_/);
      const pageYear = yearMatch ? yearMatch[1] : "unknown";

      const cBaseMatch = url.match(/(\d{4}_c_\d+)/);
      const cBase = cBaseMatch ? cBaseMatch[1] : null;

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

      if (cBase) {
        const paginationUrls: string[] = [];
        $(`a[href*="${cBase}-"]`).each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          const absUrl = href.startsWith("http")
            ? href
            : `https://www.hallmarkornaments.com/${href.replace(/^\//, "")}`;
          if (!absUrl.includes("_p_") && !enqueuedProductUrls.has(absUrl)) {
            enqueuedProductUrls.add(absUrl);
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

      if (!product.name) {
        const titleEl = $("h1").first().text().trim();
        if (titleEl) product.name = titleEl;
      }

      const urlYearMatch = url.match(/hallmarkornaments\.com\/(\d{4})-/);
      if (urlYearMatch) {
        product.year = parseInt(urlYearMatch[1], 10);
      } else if (product.name) {
        product.year = parseYear(product.name);
      }

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
        if (
          /^Artist[s]?[:\s]/i.test(text) ||
          /^(?:Sculptor|Designed by)[:\s]/i.test(text)
        ) {
          const m = text.match(
            /(?:Artist[s]?|Sculptor|Designed by)[:\s]+(.+)/i,
          );
          if (m) product.artist = m[1].trim().split(/\s{2,}/)[0];
        }
      });

      if (!product.seriesName && product.name) {
        const { seriesName, sequenceNumber } = parseSeriesFromDescription(
          product.name,
        );
        product.seriesName = seriesName;
        product.sequenceNumber = sequenceNumber;
      }

      // Fallback: parse series from the URL slug — the slug often encodes the
      // full title including ordinal+series, e.g.
      // "1995-Frosty-Friends-16th-in-Frosty-Friends-Series_p_3422.html"
      if (!product.seriesName) {
        const slug = url
          .replace(/^.*\//, "")
          .replace(/_p_\d+\.html$/, "")
          .replace(/-/g, " ");
        const { seriesName, sequenceNumber } = parseSeriesFromDescription(slug);
        if (seriesName) {
          product.seriesName = seriesName;
          product.sequenceNumber = sequenceNumber;
        }
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
