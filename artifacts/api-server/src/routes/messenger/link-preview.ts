import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, messengerLinkPreviews } from "@workspace/db";
import { logger } from "../../lib/logger";
import { fetchHtmlSafe, fetchJsonSafe } from "../../lib/ssrf-safe-fetch";

const router: IRouter = Router();

const PREVIEW_TIMEOUT_MS = 6000;

const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const DIRECT_FETCH_TIMEOUT_MS = 3000;
const MIN_REMAINING_MS = 500;

/**
 * Domains known to block cloud/datacenter IP ranges.
 * Microlink is only invoked for URLs whose hostname matches this list — this
 * replaces an origin-only DNS precheck and eliminates redirect-chain SSRF risk
 * by ensuring we never proxy arbitrary user-controlled URLs to a third party.
 *
 * Matching is suffix-based: "bbc.com" also matches "www.bbc.com" etc.
 */
const MICROLINK_ALLOWED_DOMAINS = new Set([
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "ft.com",
  "bloomberg.com",
  "wsj.com",
  "reuters.com",
  "apnews.com",
  "npr.org",
  "wikipedia.org",
  "booking.com",
  "hotels.com",
  "airbnb.com",
  "tripadvisor.com",
  "cnn.com",
  "cbsnews.com",
  "nbcnews.com",
  "forbes.com",
  "time.com",
  "economist.com",
  "theatlantic.com",
]);

function isMicrolinkAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const domain of MICROLINK_ALLOWED_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
    }
  } catch {
    // invalid URL
  }
  return false;
}

const YOUTUBE_RE =
  /^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts|embed)|youtu\.be)(\/|\?|$)/;
const VIMEO_RE = /^https?:\/\/(www\.)?vimeo\.com\/\d+/;

async function tryOEmbed(url: string): Promise<{
  title: string | null;
  description: string | null;
  imageUrl: string | null;
} | null> {
  let oembedUrl: string | null = null;
  if (YOUTUBE_RE.test(url)) {
    oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  } else if (VIMEO_RE.test(url)) {
    oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  }
  if (!oembedUrl) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
    const resp = await fetch(oembedUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title ?? null,
      description: data.author_name ? `By ${data.author_name}` : null,
      imageUrl: data.thumbnail_url ?? null,
    };
  } catch (err) {
    logger.warn({ url, err }, "messenger: oEmbed fetch failed");
    return null;
  }
}

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? null;
}

interface PreviewResult {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

/**
 * Tries oEmbed discovery by extracting the oEmbed endpoint from an already-fetched
 * HTML page's `<link rel="alternate" type="application/json+oembed" href="...">` tag.
 * This is a generic fallback that works for any CMS/platform that publishes oEmbed
 * endpoints (WordPress, Flickr, Soundcloud, etc.) without us hardcoding their URLs.
 *
 * SSRF safety: The extracted href is validated to be http/https before fetching,
 * then fetched via `fetchJsonSafe` which applies the same private-IP block-list,
 * custom DNS resolver, and redirect guard as the rest of this module's outbound
 * fetches — so internal/private network destinations are consistently rejected.
 */
async function tryOEmbedDiscovery(
  html: string,
  remainingMs: number,
): Promise<PreviewResult | null> {
  if (remainingMs <= MIN_REMAINING_MS) return null;

  const match =
    html.match(
      /<link[^>]+type=["']application\/json\+oembed["'][^>]+href=["']([^"']+)["']/i,
    ) ??
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/json\+oembed["']/i,
    );
  if (!match?.[1]) return null;

  const oembedHref = match[1].trim();
  let oembedUrl: URL;
  try {
    oembedUrl = new URL(oembedHref);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(oembedUrl.protocol)) return null;

  try {
    const data = await fetchJsonSafe<{
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    }>(oembedUrl.toString(), { timeoutMs: remainingMs });
    return {
      title: data.title ?? null,
      description: data.author_name ? `By ${data.author_name}` : null,
      imageUrl: data.thumbnail_url ?? null,
    };
  } catch (err) {
    logger.warn(
      { oembedHref, err },
      "messenger: oEmbed discovery fetch failed",
    );
    return null;
  }
}

/**
 * Microlink.io public API fallback for sites that block datacenter IPs.
 *
 * SSRF safety: Only invoked for URLs whose hostname is in `MICROLINK_ALLOWED_DOMAINS`
 * (a fixed allowlist of known major news/booking sites). This eliminates the
 * redirect-chain SSRF risk that arises when arbitrary user URLs are passed to a
 * third-party fetcher — we never proxy unknown domains. Our server's outbound
 * connection goes only to api.microlink.io (a hardcoded public endpoint).
 *
 * Deadline: accepts an absolute `deadlineTs` timestamp so the fetch budget is
 * computed fresh after any preceding work (DNS check, direct scrape, etc.) and
 * the abort controller covers both headers *and* the full body read.
 *
 * Rate-limit handling: HTTP 429 (Too Many Requests) and 402 (Payment Required)
 * are logged with a distinct warning so operators know to set MICROLINK_API_KEY.
 * When MICROLINK_API_KEY is present in the environment it is forwarded as the
 * `token` query parameter, which unlocks the paid tier and avoids per-IP limits.
 */
async function tryMicrolink(
  url: string,
  deadlineTs: number,
): Promise<PreviewResult | null> {
  if (!isMicrolinkAllowed(url)) return null;

  const remainingMs = deadlineTs - Date.now();
  if (remainingMs <= MIN_REMAINING_MS) return null;

  const apiKey = process.env.MICROLINK_API_KEY;
  const apiUrl = new URL("https://api.microlink.io/");
  apiUrl.searchParams.set("url", url);
  if (apiKey) apiUrl.searchParams.set("token", apiKey);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    let data: {
      status?: string;
      data?: {
        title?: string | null;
        description?: string | null;
        image?: { url?: string | null } | null;
      };
    };
    try {
      const resp = await fetch(apiUrl.toString(), {
        signal: controller.signal,
      });
      if (!resp.ok) {
        if (resp.status === 429 || resp.status === 402) {
          logger.warn(
            { url, status: resp.status },
            "messenger: microlink rate-limited — set MICROLINK_API_KEY to avoid this",
          );
        }
        return null;
      }
      data = (await resp.json()) as typeof data;
    } finally {
      clearTimeout(timer);
    }
    if (data.status !== "success" || !data.data) return null;
    return {
      title: data.data.title ?? null,
      description: data.data.description ?? null,
      imageUrl: data.data.image?.url ?? null,
    };
  } catch (err) {
    logger.warn({ url, err }, "messenger: microlink fallback failed");
    return null;
  }
}

function extractFromHtml(html: string): PreviewResult {
  const title =
    extractMeta(html, "og:title") ??
    extractMeta(html, "twitter:title") ??
    extractTitle(html);
  const description =
    extractMeta(html, "og:description") ??
    extractMeta(html, "twitter:description");
  const imageUrl =
    extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image");
  return { title, description, imageUrl };
}

/**
 * Fetches a link preview using a cascade of strategies that share one absolute
 * wall-clock deadline (PREVIEW_TIMEOUT_MS = 6s), enforced via a `deadlineTs`
 * timestamp passed through all steps so no step can overrun the global budget:
 *
 *   1. oEmbed (YouTube/Vimeo) — fast purpose-built path for video platforms
 *   2. Direct HTML scrape — up to min(3s, remaining) budget
 *   3. oEmbed discovery — if the scraped HTML contains a
 *      `<link rel="alternate" type="application/json+oembed">` tag, fetch that
 *      endpoint; works for WordPress, Flickr, Soundcloud, etc. without hardcoding
 *   4. Microlink.io API fallback — only for allowlisted domains that block
 *      datacenter IPs; uses MICROLINK_API_KEY when set to avoid rate-limits
 */
async function fetchPreview(url: string): Promise<PreviewResult> {
  const deadlineTs = Date.now() + PREVIEW_TIMEOUT_MS;

  const oEmbed = await tryOEmbed(url);
  if (oEmbed) return oEmbed;

  const directBudget = Math.min(
    DIRECT_FETCH_TIMEOUT_MS,
    deadlineTs - Date.now(),
  );
  let scrapedHtml: string | null = null;
  if (directBudget > MIN_REMAINING_MS) {
    try {
      scrapedHtml = await fetchHtmlSafe(url, directBudget);
      if (scrapedHtml) {
        const result = extractFromHtml(scrapedHtml);
        if (result.title || result.description || result.imageUrl) {
          return result;
        }
      }
    } catch (err) {
      logger.warn(
        { url, err },
        "messenger: direct link preview fetch failed, trying fallback",
      );
    }
  }

  if (scrapedHtml) {
    const discovered = await tryOEmbedDiscovery(
      scrapedHtml,
      deadlineTs - Date.now(),
    );
    if (discovered) return discovered;
  }

  const microlink = await tryMicrolink(url, deadlineTs);
  if (microlink) return microlink;

  return { title: null, description: null, imageUrl: null };
}

router.get("/link-preview", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    res.status(400).json({ error: "Only http/https URLs are supported" });
    return;
  }

  const cached = await db
    .select()
    .from(messengerLinkPreviews)
    .where(eq(messengerLinkPreviews.url, url))
    .limit(1);

  if (cached[0]) {
    const row = cached[0];

    // Video platforms (YouTube, Vimeo) always return a thumbnail via oEmbed.
    // A cached entry with no imageUrl means it was scraped before the oEmbed
    // fix and contains bad data — treat it as a cache miss.
    const isVideoUrl = YOUTUBE_RE.test(url) || VIMEO_RE.test(url);
    const hasMeaningfulData = isVideoUrl
      ? row.imageUrl !== null
      : row.title !== null || row.imageUrl !== null;

    // Treat the cached entry as stale (cache miss) if any of these are true:
    //   1. The entry is older than CACHE_MAX_AGE_MS — Microlink may now return
    //      richer metadata than the original scrape produced.
    //   2. The entry has no imageUrl and the URL is eligible for the Microlink
    //      fallback — this covers rows written before Microlink was introduced
    //      that could now get an image from it.
    const ageMs = row.fetchedAt
      ? Date.now() - new Date(row.fetchedAt).getTime()
      : Infinity;
    const isExpired = ageMs > CACHE_MAX_AGE_MS;
    const isMicrolinkStale =
      !isVideoUrl && row.imageUrl === null && isMicrolinkAllowed(url);

    if (hasMeaningfulData && !isExpired && !isMicrolinkStale) {
      res.json({
        url: row.url,
        title: row.title,
        description: row.description,
        imageUrl: row.imageUrl,
      });
      return;
    }
  }

  const preview = await fetchPreview(url);

  // If the fresh fetch produced nothing (e.g. Microlink 429 + direct scrape
  // blocked), fall back to whatever the existing cached row already has.
  // This prevents a failed re-fetch from clobbering non-null cached data with
  // nulls, which would blank the card even though we had good data before.
  const existingRow = cached[0] ?? null;
  const hasFreshData =
    preview.title !== null ||
    preview.description !== null ||
    preview.imageUrl !== null;

  if (!hasFreshData && existingRow) {
    res.json({
      url: existingRow.url,
      title: existingRow.title,
      description: existingRow.description,
      imageUrl: existingRow.imageUrl,
    });
    return;
  }

  // Merge: keep existing cached fields for any dimension the fresh fetch missed.
  const merged: PreviewResult = {
    title: preview.title ?? existingRow?.title ?? null,
    description: preview.description ?? existingRow?.description ?? null,
    imageUrl: preview.imageUrl ?? existingRow?.imageUrl ?? null,
  };

  const [row] = await db
    .insert(messengerLinkPreviews)
    .values({
      url,
      title: merged.title,
      description: merged.description,
      imageUrl: merged.imageUrl,
    })
    .onConflictDoUpdate({
      target: messengerLinkPreviews.url,
      set: {
        title: merged.title,
        description: merged.description,
        imageUrl: merged.imageUrl,
        fetchedAt: new Date(),
      },
    })
    .returning();

  res.json({
    url: row.url,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUrl,
  });
});

export default router;
