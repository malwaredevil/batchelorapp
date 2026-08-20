/**
 * Original retail value (MSRP) lookup for a Hallmark ornament, plus a link
 * to its official product page when one can be found.
 *
 * This is distinct from `book-value.ts`, which looks up the
 * collector/secondary-market value from two dedicated scrape targets
 * (hallmarkornaments.com / hookedonhallmark.com). Retail value has no such
 * dedicated site, so this mirrors the manual process the household already
 * uses: ask a web-search-grounded model "what is the retail value of
 * hallmark ornament <name> <year>" and read the answer + its citations.
 *
 * Reuses the existing `webSearch()` helper (Perplexity Sonar via
 * OpenRouter — the same engine behind elAIne's `web_search` tool), so no
 * new API key or integration is required. A second, cheap JSON-mode
 * extraction pass turns the free-text answer + citation list into a typed
 * `{ valueUsd, productUrl }` result.
 */

import { callModel, getModels } from "../ai-client";
import {
  researchOrnament,
  sourceDomainFromUrl,
  type OrnamentResearchIdentity,
} from "./research";

export interface RetailValueLookupInput extends OrnamentResearchIdentity {}

export interface RetailValueResult {
  valueUsd: number;
  productUrl: string | null;
  /** Source domain the value was attributed to (e.g. "hallmark.com"), or
   * "web search" when no single citation could be pinned down. */
  source: string;
}

const EXTRACTION_PROMPT = `You are extracting a Hallmark Keepsake ornament's ORIGINAL RETAIL VALUE (the MSRP it sold for when new — not a current collector/resale value) from a web-search answer and its source citations.

Respond with STRICT JSON only:
{ "valueUsd": number or null, "productUrl": string or null }

Rules:
- "valueUsd" is the original US-dollar retail/list price. Only return a number if you are reasonably confident it refers to the specific ornament described, not an unrelated item.
- "productUrl" should be the single best link to the ornament's official product page (prefer hallmark.com, or a major retailer's product page) taken from the citation list. If no citation clearly matches this ornament, return null.
- If no clear retail value is found, return { "valueUsd": null, "productUrl": null }.`;

async function extractResult(
  input: RetailValueLookupInput,
  answer: string,
  citations: string[],
): Promise<{ valueUsd: number | null; productUrl: string | null }> {
  if (!answer || answer.length < 10)
    return { valueUsd: null, productUrl: null };

  const models = await getModels();
  const completion = await callModel(models.fastVision, (client, model) =>
    client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Ornament: ${input.name}${input.seriesOrCollection ? ` (${input.seriesOrCollection})` : ""}${input.year ? ` — ${input.year}` : ""}\n\nSearch answer:\n${answer}\n\nCitations:\n${citations.join("\n")}`,
        },
      ],
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as {
      valueUsd?: unknown;
      productUrl?: unknown;
    };
    return {
      valueUsd:
        typeof parsed.valueUsd === "number" && Number.isFinite(parsed.valueUsd)
          ? parsed.valueUsd
          : null,
      productUrl:
        typeof parsed.productUrl === "string" && parsed.productUrl.trim()
          ? parsed.productUrl.trim()
          : null,
    };
  } catch {
    return { valueUsd: null, productUrl: null };
  }
}

/**
 * Looks up the original retail value + product page link for an ornament via
 * a grounded web search. Never throws for ordinary "not found" outcomes —
 * callers should treat a null return as "no retail value could be
 * determined" (422 at the route layer, same convention as lookupBookValue).
 */
export async function lookupRetailValue(
  input: RetailValueLookupInput,
): Promise<RetailValueResult | null> {
  const searchResult = await researchOrnament(
    input,
    "Find the original US-dollar retail/list price (MSRP) and the official product page if one exists.",
  );
  if (!searchResult) return null;

  const { valueUsd, productUrl } = await extractResult(
    input,
    searchResult.answer,
    searchResult.citations,
  );
  if (valueUsd === null || valueUsd <= 0) return null;

  let source = "web search";
  if (productUrl) {
    const domain = sourceDomainFromUrl(productUrl);
    if (domain) source = domain;
  }

  return { valueUsd, productUrl, source };
}
