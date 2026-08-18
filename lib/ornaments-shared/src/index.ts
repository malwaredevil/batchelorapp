/**
 * Pure valuation calculations for the Ornaments collection, shared between
 * the frontend (per-item display on the detail page) and the backend
 * (collection-wide aggregation for the gallery stat bar and Elaine).
 *
 * Keeping this logic in one place avoids the two sides silently drifting —
 * see .agents/memory/copy-pasted-stat-card-base-path-bug.md and
 * always-consolidate-shared-libs.md for why that matters in this repo.
 */

/** A parsed low/high collector-value range extracted from AI appraisal prose. */
export interface AiAppraisalRange {
  low: number | null;
  high: number | null;
}

// Matches "$10 - $18", "$10-$18", "$10 – $18", "$10—$18", "$10.50-$18.25", etc.
const APPRAISAL_RANGE_RE = /\$(\d+(?:\.\d+)?)\s*[-–—]\s*\$(\d+(?:\.\d+)?)/;

/**
 * Extracts a low/high dollar range from the free-text `aiAppraisal` field
 * (e.g. "This ornament appraises for $10-$18 in good condition."). The
 * appraisal is unstructured prose, not a structured value, so this regex
 * parse is the only way to recover the two numbers the AI wrote — returns
 * { low: null, high: null } when no range can be found.
 */
export function parseAiAppraisalRange(
  aiAppraisal: string | null | undefined,
): AiAppraisalRange {
  if (!aiAppraisal) return { low: null, high: null };
  const match = aiAppraisal.match(APPRAISAL_RANGE_RE);
  if (!match) return { low: null, high: null };
  const low = parseFloat(match[1]);
  const high = parseFloat(match[2]);
  if (isNaN(low) || isNaN(high)) return { low: null, high: null };
  return { low, high };
}

export interface ConsensusValueInputs {
  bookValue: number | null | undefined;
  ebayPriceMinUsd: number | null | undefined;
  ebayPriceMaxUsd: number | null | undefined;
  aiAppraisal: string | null | undefined;
}

/**
 * A single item's "consensus" value: the average of every available value
 * signal (eBay asking-price midpoint, AI appraisal midpoint, book value),
 * requiring at least two independent signals to be meaningful. Returns null
 * when fewer than two signals are available.
 */
export function computeConsensusValue(
  inputs: ConsensusValueInputs,
): number | null {
  const sources: number[] = [];

  if (
    inputs.ebayPriceMinUsd != null &&
    inputs.ebayPriceMaxUsd != null &&
    !isNaN(inputs.ebayPriceMinUsd) &&
    !isNaN(inputs.ebayPriceMaxUsd)
  ) {
    sources.push((inputs.ebayPriceMinUsd + inputs.ebayPriceMaxUsd) / 2);
  }

  const { low: aiLow, high: aiHigh } = parseAiAppraisalRange(
    inputs.aiAppraisal,
  );
  if (aiLow != null && aiHigh != null) {
    sources.push((aiLow + aiHigh) / 2);
  }

  if (inputs.bookValue != null && !isNaN(inputs.bookValue)) {
    sources.push(inputs.bookValue);
  }

  if (sources.length < 2) return null;
  return sources.reduce((sum, v) => sum + v, 0) / sources.length;
}
