/**
 * Best-effort "book value" (secondary-market/insurance value) lookup for a
 * Hallmark ornament, sourced from hallmarkornaments.com and/or
 * hookedonhallmark.com.
 *
 * #217: Scraping now runs via the `apify/website-content-crawler` Apify actor
 * instead of direct server-side HTTP fetches.  This moves the fragile HTML
 * parsing onto Apify's infrastructure (proxy rotation, retries, run dashboard)
 * and keeps the server from making outbound requests to Hallmark sites directly.
 * The AI extraction step is unchanged.
 */

import { callModel, getModels } from "../ai-client";
import { runApifyActor } from "../apify-client";
import { env } from "../env";
import { logger } from "../logger";

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

/**
 * Fetch page text for a URL via the Apify `apify/website-content-crawler`
 * actor, which handles proxy rotation and retries automatically.
 */
async function fetchPageTextViaApify(url: string): Promise<string | null> {
  const apiToken = env.apifyApiToken;
  if (!apiToken) return null;

  try {
    const items = await runApifyActor(
      "apify/website-content-crawler",
      {
        startUrls: [{ url }],
        maxCrawlPages: 1,
        crawlerType: "cheerio",
        maxCrawlDepth: 0,
        saveMarkdown: true,
        saveHtml: false,
      },
      apiToken,
      { timeoutMs: 60_000, maxItems: 1 },
    );

    const first = items[0];
    if (!first) return null;

    // The actor returns `markdown` or `text` fields
    const text =
      (first.markdown as string | undefined) ??
      (first.text as string | undefined) ??
      (first.content as string | undefined);

    return typeof text === "string" && text.length > 10 ? text : null;
  } catch (err) {
    logger.warn({ err, url }, "book-value: Apify page fetch failed");
    return null;
  }
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
    const pageText = await fetchPageTextViaApify(site.searchUrl(query));
    if (!pageText) continue;

    const value = await extractValueFromText(pageText, input);
    if (value !== null && value > 0) {
      found.push({ value, source: site.source });
    }
  }

  if (found.length === 0) return null;
  return found.reduce((max, r) => (r.value > max.value ? r : max));
}
