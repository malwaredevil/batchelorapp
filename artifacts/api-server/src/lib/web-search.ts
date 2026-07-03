import { callModel, MODELS } from "./ai-client";

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

export interface WebSearchResult {
  answer: string;
  citations: string[];
}

const SEARCH_TIMEOUT_MS = 15_000;

export async function webSearch(query: string): Promise<WebSearchResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) return { answer: "", citations: [] };

  const raw = await callModel(MODELS.RESEARCH, async (client, model) => {
    return client.chat.completions.create(
      {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a live web search tool for a travel-planning assistant. Answer the user's query using current, up-to-date web results. Be concise and factual (a few sentences to a short paragraph). Prioritize recency for anything time-sensitive (prices, hours, weather, events, news). If you can't find a reliable answer, say so plainly instead of guessing.",
          },
          { role: "user", content: trimmed },
        ],
        max_tokens: 600,
      },
      { timeout: SEARCH_TIMEOUT_MS },
    );
  });

  const answer = raw.choices[0]?.message?.content?.trim() ?? "";
  const citations = Array.isArray((raw as { citations?: unknown }).citations)
    ? ((raw as { citations?: unknown }).citations as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];

  return { answer, citations };
}
