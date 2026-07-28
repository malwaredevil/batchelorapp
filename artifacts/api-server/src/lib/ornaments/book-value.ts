/**
 * Best-effort "book value" (secondary-market/insurance value) lookup for a
 * Hallmark ornament, sourced from hallmarkornaments.com and/or
 * hookedonhallmark.com.
 *
 * Page fetch uses a two-strategy fallback chain so a single provider failure
 * doesn't silently kill the lookup:
 *
 *   Strategy 1 — Jina Reader (r.jina.ai): converts any public URL to clean
 *     LLM-friendly markdown; handles Cloudflare-protected sites and avoids
 *     outbound fetches from the server.  Requires JINA_API_KEY.
 *
 *   Strategy 2 — Direct HTTP: plain fetch with browser-like headers as a
 *     best-effort fallback when Jina fails or is unconfigured.  Works for
 *     sites that don't block server-side user-agents; returns stripped
 *     plaintext from the raw HTML.
 *
 * If both strategies return no content for a site, that site is skipped.
 * The AI extraction step is identical regardless of which strategy fetched
 * the page.
 *
 * Note on Apify: the account's current plan blocks public actors
 * ("public-actor-disabled"). Private/custom actors still work (the HooH
 * catalog crawler rFw8VLb3KM2g4DVrE is one). A minimal custom fetch actor
 * is a viable future option if both strategies below prove insufficient.
 */

import { callModel, getModels } from "../ai-client";
import { env } from "../env";
import { logger } from "../logger";
import { withRetry } from "../retry";

export interface BookValueLookupInput {
  name: string;
  seriesOrCollection: string | null;
  year: number | null;
}

export interface BookValueResult {
  value: number;
  source: "hallmarkornaments.com" | "hookedonhallmark.com";
}

const SITES: Array<{
  source: BookValueResult["source"];
  searchUrl: (q: string) => string;
}> = [
  {
    source: "hallmarkornaments.com",
    searchUrl: (q) =>
      `https://www.hallmarkornaments.com/?s=${encodeURIComponent(q)}`,
  },
  {
    source: "hookedonhallmark.com",
    searchUrl: (q) =>
      `https://www.hookedonhallmark.com/?s=${encodeURIComponent(q)}`,
  },
];

function buildQuery(input: BookValueLookupInput): string {
  const parts = [input.name];
  if (input.seriesOrCollection) parts.push(input.seriesOrCollection);
  if (input.year) parts.push(String(input.year));
  return parts.join(" ");
}

const EXTRACTION_PROMPT = `You are extracting a Hallmark Keepsake ornament's current secondary-market / insurance value from raw webpage text (a search-results or article page). Look for a US dollar figure that represents this specific ornament's value (mint/complete, in box).

Respond with STRICT JSON only:
{ "value": number or null }

Only return a number if you are reasonably confident it refers to the specific ornament described, not an unrelated item on the page. If no clear value is found, return { "value": null }.`;

async function extractValueFromText(
  pageText: string,
  input: BookValueLookupInput,
): Promise<number | null> {
  if (!pageText || pageText.length < 20) return null;

  const models = await getModels();
  const completion = await callModel(models.fastVision, (client, model) =>
    client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 100,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Ornament: ${buildQuery(input)}\n\nPage text:\n${pageText.slice(0, 4000)}`,
        },
      ],
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { value?: unknown };
    return typeof parsed.value === "number" && Number.isFinite(parsed.value)
      ? parsed.value
      : null;
  } catch {
    return null;
  }
}

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_CHARS = 8_000;

/** Strategy 1: Jina Reader — clean markdown, handles Cloudflare. */
async function fetchPageTextViaJina(url: string): Promise<string | null> {
  if (!env.jinaApiKey) return null;
  try {
    const resp = await withRetry(
      () =>
        fetch(`https://r.jina.ai/${url}`, {
          headers: {
            Authorization: `Bearer ${env.jinaApiKey}`,
            Accept: "text/plain",
            "X-Return-Format": "markdown",
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      { label: "jina-reader-book-value" },
    );
    if (!resp.ok) {
      logger.warn(
        { url, status: resp.status },
        "book-value: Jina fetch non-OK",
      );
      return null;
    }
    const text = (await resp.text()).trim();
    return text.length > 10 ? text.slice(0, FETCH_MAX_CHARS) : null;
  } catch (err) {
    logger.warn({ err, url }, "book-value: Jina fetch threw");
    return null;
  }
}

/** Strategy 2: Direct HTTP — browser-like headers, strips HTML tags. */
async function fetchPageTextDirect(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      logger.warn(
        { url, status: resp.status },
        "book-value: direct fetch non-OK",
      );
      return null;
    }
    const html = await resp.text();
    // Strip scripts, styles, and tags to get rough plaintext
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 100 ? text.slice(0, FETCH_MAX_CHARS) : null;
  } catch (err) {
    logger.warn({ err, url }, "book-value: direct fetch threw");
    return null;
  }
}

/**
 * Fetch page text for a URL using a two-strategy fallback chain:
 * Jina Reader first (clean markdown, Cloudflare-aware), then direct HTTP.
 */
async function fetchPageText(url: string): Promise<string | null> {
  // Strategy 1: Jina Reader
  if (env.jinaApiKey) {
    const text = await fetchPageTextViaJina(url);
    if (text) {
      logger.info({ url }, "book-value: fetched via Jina Reader");
      return text;
    }
    logger.info(
      { url },
      "book-value: Jina returned no content, trying direct fetch",
    );
  } else {
    logger.warn(
      { url },
      "book-value: JINA_API_KEY not configured, trying direct fetch",
    );
  }

  // Strategy 2: Direct HTTP fallback
  const text = await fetchPageTextDirect(url);
  if (text) logger.info({ url }, "book-value: fetched via direct HTTP");
  return text;
}

/**
 * Checks every site and returns the HIGHEST plausible extracted value, not
 * just the first one found. Hallmark secondary-market sites frequently quote
 * different figures for the same ornament, and the household's own manual
 * process is to check both hookedonhallmark.com and hallmarkornaments.com and
 * take the higher of the two — so this mirrors that process rather than
 * short-circuiting on the first hit. Never throws for ordinary "not found"
 * outcomes — callers should treat a null return as "no value could be
 * determined" (422 at the route layer).
 */
export async function lookupBookValue(
  input: BookValueLookupInput,
): Promise<BookValueResult | null> {
  const query = buildQuery(input);
  const found: BookValueResult[] = [];

  for (const site of SITES) {
    const pageText = await fetchPageText(site.searchUrl(query));
    if (!pageText) continue;

    const value = await extractValueFromText(pageText, input);
    if (value !== null && value > 0) {
      found.push({ value, source: site.source });
    }
  }

  if (found.length === 0) return null;
  return found.reduce((max, r) => (r.value > max.value ? r : max));
}
