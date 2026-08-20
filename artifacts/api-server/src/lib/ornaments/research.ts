import { logger } from "../logger";
import { extractCitationDomains, webSearch } from "../web-search";

/**
 * The minimum identity facts used when looking up a published ornament detail.
 * Callers deliberately keep this compact so every ornament fact lookup uses
 * the same query and citation handling.
 */
export interface OrnamentResearchIdentity {
  name: string;
  seriesOrCollection: string | null;
  year: number | null;
}

export interface OrnamentResearchResult {
  answer: string;
  citations: string[];
  citationDomains: Set<string>;
}

export function sourceDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function formatOrnamentIdentity(
  input: OrnamentResearchIdentity,
): string {
  return [
    input.name.trim(),
    input.seriesOrCollection?.trim() || null,
    input.year ? String(input.year) : null,
  ]
    .filter(Boolean)
    .join(" — ");
}

/**
 * Do not spend a web-search request on a generated/descriptive photo label.
 * A printed name plus either a series or year gives the extraction model a
 * concrete catalog identity to verify against the cited result.
 */
export function hasResearchableOrnamentIdentity(
  input: OrnamentResearchIdentity,
): boolean {
  const name = input.name.trim();
  return (
    name.length > 0 &&
    name.toLowerCase() !== "untitled ornament" &&
    (Boolean(input.seriesOrCollection?.trim()) || input.year !== null)
  );
}

/**
 * Performs a grounded ornament catalog lookup. Ordinary unavailable/no-result
 * outcomes intentionally return null so a supplementary fact lookup can never
 * fail photo cataloguing or a refresh.
 */
export async function researchOrnament(
  input: OrnamentResearchIdentity,
  question: string,
): Promise<OrnamentResearchResult | null> {
  const identity = formatOrnamentIdentity(input);
  if (!identity || !question.trim()) return null;

  const query = `${question.trim()} Hallmark Keepsake ornament: ${identity}.`;
  try {
    const result = await webSearch(query);
    if (!result.answer.trim() || result.citations.length === 0) return null;
    const citations = result.citations.filter((citation) =>
      Boolean(sourceDomainFromUrl(citation)),
    );
    if (citations.length === 0) return null;

    return {
      answer: result.answer,
      citations,
      citationDomains: extractCitationDomains(citations),
    };
  } catch (err) {
    logger.warn({ err, query }, "ornament research failed");
    return null;
  }
}
