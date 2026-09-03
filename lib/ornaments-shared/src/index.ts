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
 * (e.g. "This ornament appraises for $10-$18 in the current collector market."). The
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
  ebayLastSoldPriceUsd?: number | null | undefined;
  aiAppraisal: string | null | undefined;
  retailValueUsd?: number | null | undefined;
}

function validPrice(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

/**
 * Collects the current-market signals that can be compared directly:
 * collector/book value, the midpoint of current eBay asking prices, an eBay
 * sold price when one is saved, and the midpoint of an AI collector appraisal.
 *
 * Retail/MSRP intentionally stays out of this list: it is a useful fallback
 * value, but not a current-market signal.
 */
export function getOrnamentMarketValueSignals(
  inputs: ConsensusValueInputs,
): number[] {
  const sources: number[] = [];

  if (
    validPrice(inputs.ebayPriceMinUsd) &&
    validPrice(inputs.ebayPriceMaxUsd)
  ) {
    sources.push((inputs.ebayPriceMinUsd + inputs.ebayPriceMaxUsd) / 2);
  }

  if (validPrice(inputs.ebayLastSoldPriceUsd)) {
    sources.push(inputs.ebayLastSoldPriceUsd);
  }

  const { low: aiLow, high: aiHigh } = parseAiAppraisalRange(
    inputs.aiAppraisal,
  );
  if (validPrice(aiLow) && validPrice(aiHigh) && aiHigh >= aiLow) {
    sources.push((aiLow + aiHigh) / 2);
  }

  if (validPrice(inputs.bookValue)) {
    sources.push(inputs.bookValue);
  }

  return sources;
}

/**
 * A single item's "consensus" value: the average of every available value
 * market signal (eBay asking-price midpoint, eBay sold price, AI appraisal
 * midpoint, and book value),
 * requiring at least two independent signals to be meaningful. Returns null
 * when fewer than two signals are available.
 */
export function computeConsensusValue(
  inputs: ConsensusValueInputs,
): number | null {
  const sources = getOrnamentMarketValueSignals(inputs);
  if (sources.length < 2) return null;
  return sources.reduce((sum, v) => sum + v, 0) / sources.length;
}

export interface OrnamentEstimatedValue {
  value: number | null;
  source: "market_signals" | "retail_fallback" | null;
  marketSignalCount: number;
}

/**
 * The collection-wide estimate policy for one ornament:
 *
 * 1. Average every valid current-market signal that is available.
 * 2. If no market signal is available, use the saved retail/MSRP value.
 * 3. Leave the value unknown when the ornament has neither.
 *
 * This provides a useful estimate for every supported value users can save or
 * refresh without mixing an original retail price into a current-market
 * average.
 */
export function computeOrnamentEstimatedValue(
  inputs: ConsensusValueInputs,
): OrnamentEstimatedValue {
  const marketSignals = getOrnamentMarketValueSignals(inputs);
  if (marketSignals.length > 0) {
    return {
      value:
        marketSignals.reduce((sum, signal) => sum + signal, 0) /
        marketSignals.length,
      source: "market_signals",
      marketSignalCount: marketSignals.length,
    };
  }

  if (validPrice(inputs.retailValueUsd)) {
    return {
      value: inputs.retailValueUsd,
      source: "retail_fallback",
      marketSignalCount: 0,
    };
  }

  return { value: null, source: null, marketSignalCount: 0 };
}
