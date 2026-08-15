import { callModel, getModels } from "./ai-client";
import { getConfig } from "./app-config";
import { env } from "./env";
import { withRetry } from "./retry";
import { extractWebSearchCitations } from "./web-search-citations";

/**
 * Live web search / current-events lookups for elAIne, backed by Perplexity
 * Sonar (accessed through OpenRouter, like every other model call in this
 * app — see ai-client.ts). Sonar performs its own web search and grounds its
 * answer in real results. OpenRouter standardizes returned source URLs as
 * `url_citation` message annotations; the parser also retains the older
 * Perplexity-specific top-level `citations` extension for compatibility.
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

/**
 * Corroboration status for web-search results:
 * - "corroborated": both searches answered, ≥ 2 distinct source domains cited,
 *   and the content-level agreement check confirms the key claims match.
 * - "conflicting": both searches answered and cite ≥ 2 distinct domains, but
 *   the agreement check finds the two answers partially or fully contradict
 *   each other. Elaine must present both perspectives and must NOT state either
 *   side as settled fact.
 * - "single_source": only one search returned content, or both returned answers
 *   but citations span only one domain (no independent corroboration).
 * - "no_reliable_answer": neither search found an answer.
 */
export type CorroborationStatus =
  | "corroborated"
  | "conflicting"
  | "single_source"
  | "no_reliable_answer";

export interface WebSearchCorroboratedResult {
  primaryAnswer: string;
  secondaryAnswer: string;
  /** All unique citations from both searches, primary order first. */
  citations: string[];
  /** Images from the primary search only. */
  images: WebSearchImage[];
  corroboration: CorroborationStatus;
}

/** Extract unique hostnames (sans www.) from a list of citation URLs. */
export function extractCitationDomains(citations: string[]): Set<string> {
  const domains = new Set<string>();
  for (const url of citations) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      if (hostname) domains.add(hostname);
    } catch {
      // ignore malformed URLs
    }
  }
  return domains;
}

/**
 * Pure function that decides corroboration status from two search results and
 * an optional content-level agreement verdict.
 *
 * Domain diversity establishes source independence; the agreement verdict
 * distinguishes corroborated (sources agree on the claim) from conflicting
 * (sources contradict or only partially agree). When no verdict is supplied
 * (e.g. in unit tests that don't call a model), the function conservatively
 * returns "corroborated" for domain-diverse results — callers that need
 * conflict detection must supply the verdict from checkAnswerAgreement().
 *
 * Exported for unit testing; see webSearchWithCorroboration for the full flow.
 */
export function assessCorroboration(
  primary: { answer: string; citations: string[] },
  secondary: { answer: string; citations: string[] },
  agreementVerdict?: "agree" | "partial" | "conflict",
): CorroborationStatus {
  const primaryHasAnswer = primary.answer.trim().length > 0;
  const secondaryHasAnswer = secondary.answer.trim().length > 0;

  if (!primaryHasAnswer && !secondaryHasAnswer) return "no_reliable_answer";
  if (!primaryHasAnswer || !secondaryHasAnswer) return "single_source";

  // Both searches answered — check domain diversity.
  const allCitations = [...primary.citations, ...secondary.citations];
  const allDomains = extractCitationDomains(allCitations);
  if (allDomains.size < 2) return "single_source";

  // Domain diversity established; use the agreement verdict (when present) to
  // distinguish genuine corroboration from conflicting sources.
  if (agreementVerdict === "conflict" || agreementVerdict === "partial") {
    return "conflicting";
  }
  return "corroborated";
}

/**
 * Ask a fast model (Gemini Flash) whether two search-result summaries agree,
 * partially agree, or contradict each other on the key factual claim.
 *
 * Returns "agree" on any error so that a failed comparison does not silently
 * block the reply — callers should treat a successful "corroborated" result
 * from this path as best-effort, not a guarantee.
 */
export async function checkAnswerAgreement(
  primaryAnswer: string,
  secondaryAnswer: string,
): Promise<"agree" | "partial" | "conflict"> {
  const models = await getModels();
  try {
    const raw = await callModel(models.fastVision, async (client, model) => {
      return client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You compare two short search-result summaries and decide whether their key factual claims agree, partially agree, or contradict each other. Reply with exactly one word: AGREE, PARTIAL, or CONFLICT. Do not add any other text.",
          },
          {
            role: "user",
            content: `Summary 1:\n${primaryAnswer.slice(0, 500)}\n\nSummary 2:\n${secondaryAnswer.slice(0, 500)}`,
          },
        ],
        max_tokens: 5,
      });
    });
    const verdict =
      raw.choices[0]?.message?.content?.trim().toUpperCase() ?? "";
    if (verdict.startsWith("AGREE")) return "agree";
    if (verdict.startsWith("PARTIAL")) return "partial";
    // Unexpected or empty response — treat as conflict so the caller must
    // hedge rather than stating the claim with normal confidence.
    return "conflict";
  } catch {
    // On model error or rate-limit, fail closed: the caller must present
    // both answers and hedge rather than asserting a corroborated fact.
    return "conflict";
  }
}

/**
 * Build the tool-result text string sent back to the model after a
 * corroborated web search. Pure function — extracted here so it can be
 * unit-tested independently of the full turn machinery.
 */
export function buildWebSearchToolResult(
  primaryAnswer: string,
  secondaryAnswer: string,
  citations: string[],
  corroboration: CorroborationStatus,
): string {
  if (!primaryAnswer && !secondaryAnswer) {
    return "No results found for this search.";
  }
  const primarySection = primaryAnswer
    ? `Primary search result:\n${primaryAnswer}`
    : "(no answer from primary search)";
  const secondarySection = secondaryAnswer
    ? `\n\nVerification search result:\n${secondaryAnswer}`
    : "\n\n(verification search found no answer)";
  const sourceList =
    citations.length > 0
      ? `\n\nSources:\n${citations.map((url, i) => `[${i + 1}] ${url}`).join("\n")}`
      : "";
  const corroborationNote = `\n\n[CORROBORATION: ${corroboration}]`;
  return `${primarySection}${secondarySection}${sourceList}${corroborationNote}`;
}

/**
 * Rephrase a query for a second independent search pass, encouraging the
 * underlying search model to surface different source paths.
 */
function rephraseForCorroboration(query: string): string {
  return `Verify and provide sources confirming or contradicting: ${query}`;
}

/**
 * Run two independent web searches for the same factual question, then check
 * whether the two answers agree on the key claim. Both searches run in
 * parallel; the agreement check is sequential (depends on both results) but
 * uses a fast model (Gemini Flash) so the added latency is small.
 *
 * Used for open factual questions in the web-chat path only. Voice/SMS/
 * Slack/email use the cheaper single-shot webSearch() instead (separate
 * restricted-channel path).
 */
export async function webSearchWithCorroboration(
  query: string,
): Promise<WebSearchCorroboratedResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) {
    return {
      primaryAnswer: "",
      secondaryAnswer: "",
      citations: [],
      images: [],
      corroboration: "no_reliable_answer",
    };
  }

  // Fire both searches in parallel — added latency ≈ max(t1, t2), not t1 + t2.
  const [primary, secondary] = await Promise.all([
    webSearch(trimmed),
    webSearch(rephraseForCorroboration(trimmed)),
  ]);

  // Merge unique citations, primary order first.
  const seen = new Set<string>();
  const citations: string[] = [];
  for (const url of [...primary.citations, ...secondary.citations]) {
    if (!seen.has(url)) {
      seen.add(url);
      citations.push(url);
    }
  }

  // Content-level agreement check: only needed when both searches returned
  // answers (single_source / no_reliable_answer branches skip it).
  let agreementVerdict: "agree" | "partial" | "conflict" | undefined;
  if (primary.answer.trim() && secondary.answer.trim()) {
    agreementVerdict = await checkAnswerAgreement(
      primary.answer,
      secondary.answer,
    );
  }

  return {
    primaryAnswer: primary.answer,
    secondaryAnswer: secondary.answer,
    citations,
    images: primary.images,
    corroboration: assessCorroboration(primary, secondary, agreementVerdict),
  };
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
        // OpenRouter to the underlying Sonar model.
        ...({ return_images: true } as Record<string, unknown>),
      },
      { timeout: await getConfig("web_search", "search_timeout_ms", 15_000) },
    );
  });

  const answer = raw.choices[0]?.message?.content?.trim() ?? "";
  const citations = extractWebSearchCitations(raw);

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
