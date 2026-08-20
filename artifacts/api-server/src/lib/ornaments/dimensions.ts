import { callModel, getModels } from "../ai-client";
import { asString, parseJson } from "../ai-parse";
import { logger } from "../logger";
import {
  hasResearchableOrnamentIdentity,
  researchOrnament,
  type OrnamentResearchIdentity,
} from "./research";

const INVALID_DIMENSION_TERMS =
  /\b(?:approx(?:imate(?:ly)?)?|about|around|estimate(?:d)?|roughly|box|package|packaging|shipping|carton|unscaled)\b/i;
const MEASUREMENT_VALUE =
  /\d+(?:\.\d+)?(?:\s+\d+\/\d+)?\s*(?:(?:in(?:ches?)?|cm|mm)\b|["″])/i;
const MAX_DIMENSIONS_LENGTH = 100;

/**
 * Accepts only a compact stated physical measurement. It deliberately does
 * not derive scale from an image or clean up a possibly-package measurement
 * into a plausible-looking value.
 */
export function normalizePhysicalOrnamentDimensions(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\s+[×xX]\s+/g, " × ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !normalized ||
    normalized.length > MAX_DIMENSIONS_LENGTH ||
    INVALID_DIMENSION_TERMS.test(normalized) ||
    !MEASUREMENT_VALUE.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

const DIMENSIONS_EXTRACTION_PROMPT = `You extract the PHYSICAL DIMENSIONS of one identified Hallmark Keepsake ornament from a grounded web-search answer and its citations.

Respond with STRICT JSON only:
{ "dimensions": string or null, "citationUrl": string or null, "evidence": string or null }

Rules:
- Return a value only when a citation clearly describes the physical ornament itself and the cited text identifies the same ornament by name plus the available series and/or year.
- Dimensions must be an explicit published measurement of the ornament, never its box, package, shipping carton, display, or storage size.
- Never estimate from photos, product imagery, or unstated scale. Never infer missing width/depth from a single measurement.
- Format an accepted value compactly, for example "3.5 in H × 2 in W × 1.25 in D". Preserve stated units when metric.
- citationUrl must be exactly one URL from the supplied citation list. evidence must be a short quoted or paraphrased measurement claim from that citation.
- If identity, source wording, or physical-object scope is ambiguous or conflicting, return all nulls.`;

async function extractPublishedDimensions(
  identity: OrnamentResearchIdentity,
  answer: string,
  citations: string[],
): Promise<string | null> {
  const models = await getModels();
  const completion = await callModel(models.fastVision, (client, model) =>
    client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 220,
      messages: [
        { role: "system", content: DIMENSIONS_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Ornament: ${identity.name}${identity.seriesOrCollection ? ` (${identity.seriesOrCollection})` : ""}${identity.year ? ` — ${identity.year}` : ""}\n\nSearch answer:\n${answer}\n\nCitations:\n${citations.join("\n")}`,
        },
      ],
    }),
  );

  const parsed = parseJson(completion.choices[0]?.message?.content ?? "{}");
  const citationUrl = asString(parsed?.["citationUrl"]);
  const evidence = asString(parsed?.["evidence"]);
  if (
    !citationUrl ||
    !citations.includes(citationUrl) ||
    !evidence ||
    INVALID_DIMENSION_TERMS.test(evidence)
  ) {
    return null;
  }
  return normalizePhysicalOrnamentDimensions(asString(parsed?.["dimensions"]));
}

export interface ResolveOrnamentDimensionsInput {
  visualDimensions: string | null;
  identity: OrnamentResearchIdentity;
}

/**
 * Uses a confirmed visual dimension first. When the photo does not contain
 * one, asks the shared grounded-research helper for an exact, cited physical
 * dimension. All routine search/model failures are non-fatal by design.
 */
export async function resolveOrnamentDimensions({
  visualDimensions,
  identity,
}: ResolveOrnamentDimensionsInput): Promise<string | null> {
  const visual = normalizePhysicalOrnamentDimensions(visualDimensions);
  if (visual) return visual;
  if (!hasResearchableOrnamentIdentity(identity)) return null;

  const research = await researchOrnament(
    identity,
    "Find the published physical dimensions (height, width, and depth when stated). Cite the exact product/catalog source and exclude box or shipping dimensions.",
  );
  if (!research) return null;

  try {
    return await extractPublishedDimensions(
      identity,
      research.answer,
      research.citations,
    );
  } catch (err) {
    logger.warn(
      { err, identity },
      "ornament dimensions research extraction failed",
    );
    return null;
  }
}
