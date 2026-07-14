import { callModel, getModels } from "./ai-client";
import { getConfig } from "./app-config";
import { env } from "./env";
import { withRetry } from "./retry";

/**
 * Live web search / current-events lookups for elAIne, backed by Perplexity
 * Sonar (accessed through OpenRouter, like every other model call in this
 * app — see ai-client.ts). Sonar performs its own web search and grounds its
 * answer in real results, returning source URLs as `citations` on the raw
 * OpenRouter response (a Perplexity-specific extension, not part of the
 * OpenAI response schema — hence the `as` cast below).
 *
 * This is intentionally a single-shot Q&A call, not a scraper: we ask Sonar
 * a natural-language question and get back a synthesized, cited answer. We
 * don't fetch/parse arbitrary pages ourselves, so none of the SSRF-guard
 * machinery in pattern-import.ts / hub.ts applies here — outbound requests
 * only ever go to OpenRouter's API.
 */

export interface WebSearchImage {
  url: string;
  sourceUrl?: string;
}

export interface WebSearchResult {
  answer: string;
  citations: string[];
  images: WebSearchImage[];
}

const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
// Perplexity caps return_images results well above this; we only ever want
// a small, chat-bubble-sized preview, not a gallery.
const MAX_IMAGES = 4;

// Jina Reader API converts any URL to clean markdown text for LLM consumption.
// We trim to 6 000 chars so a long page doesn't blow the context window.
const FETCH_PAGE_MAX_CHARS = 6_000;
const FETCH_PAGE_TIMEOUT_MS = 20_000;

/**
 * Fetch and return the text content of a specific web page using Jina Reader
 * (`r.jina.ai`). Jina converts the page to clean, LLM-friendly markdown.
 * Requires JINA_API_KEY; returns an error string when the key is absent so
 * the model can relay a graceful message instead of crashing.
 */
export async function fetchPage(url: string): Promise<string> {
  if (!env.jinaApiKey) {
    return "Page reading is unavailable right now (no reader API key configured).";
  }
  const cleanUrl = url.trim();
  const readerUrl = `https://r.jina.ai/${cleanUrl}`;
  try {
    const resp = await withRetry(
      () =>
        fetch(readerUrl, {
          headers: {
            Authorization: `Bearer ${env.jinaApiKey}`,
            Accept: "text/plain",
            "X-Return-Format": "markdown",
          },
          signal: AbortSignal.timeout(FETCH_PAGE_TIMEOUT_MS),
        }),
      { label: "jina-reader" },
    );
    if (!resp.ok) {
      return `Could not read that page (HTTP ${resp.status}). The URL may require login or be unavailable.`;
    }
    const text = await resp.text();
    const trimmed = text.trim();
    if (!trimmed) {
      return "The page loaded but contained no readable text content.";
    }
    if (trimmed.length > FETCH_PAGE_MAX_CHARS) {
      return (
        trimmed.slice(0, FETCH_PAGE_MAX_CHARS) +
        "\n\n[...page content truncated for length...]"
      );
    }
    return trimmed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Failed to read the page: ${msg}`;
  }
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) return { answer: "", citations: [], images: [] };

  const models = await getModels();
  const raw = await callModel(models.research, async (client, model) => {
    return client.chat.completions.create(
      {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a live web search tool for a household AI assistant. Answer the user's query using current, up-to-date web results. Be concise and factual (a few sentences to a short paragraph). Prioritize recency for anything time-sensitive (prices, hours, weather, events, news). If you can't find a reliable answer, say so plainly instead of guessing.",
          },
          { role: "user", content: trimmed },
        ],
        max_tokens: 600,
        // `return_images` is a Perplexity-specific request extension (not
        // part of the OpenAI chat-completions schema), passed through
        // OpenRouter to the underlying Sonar model. Cast to bypass the SDK's
        // strict param typing, mirroring the `citations` response cast below.
        ...({ return_images: true } as Record<string, unknown>),
      },
      { timeout: await getConfig("web_search", "search_timeout_ms", 15_000) },
    );
  });

  const answer = raw.choices[0]?.message?.content?.trim() ?? "";
  const citations = Array.isArray((raw as { citations?: unknown }).citations)
    ? ((raw as { citations?: unknown }).citations as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];

  // Best-effort: only present when Perplexity actually returns image results
  // for this query (not guaranteed), each shaped like
  // { image_url, origin_url, height, width }.
  const rawImages = (raw as { images?: unknown }).images;
  const images: WebSearchImage[] = Array.isArray(rawImages)
    ? rawImages
        .filter(
          (img): img is { image_url?: unknown; origin_url?: unknown } =>
            typeof img === "object" && img !== null,
        )
        .map((img) => ({
          url: typeof img.image_url === "string" ? img.image_url : "",
          sourceUrl:
            typeof img.origin_url === "string" ? img.origin_url : undefined,
        }))
        .filter((img) => img.url.length > 0)
        .slice(0, MAX_IMAGES)
    : [];

  return { answer, citations, images };
}
