import type { SQL } from "drizzle-orm";
import { db, ornamentsItems } from "@workspace/db";
import {
  parseAiAppraisalRange,
  computeConsensusValue,
} from "@workspace/ornaments-shared";

export interface OrnamentValuationTotals {
  /** Sum of each item's parsed AI-appraisal low estimate × quantity. */
  aiAppraisalLowTotal: number;
  /** Sum of each item's parsed AI-appraisal high estimate × quantity. */
  aiAppraisalHighTotal: number;
  /** How many distinct items contributed a parseable AI appraisal range. */
  itemsWithAiAppraisal: number;
  /** Sum of each item's consensus value (avg of available signals) × quantity. */
  consensusValueTotal: number;
  /** How many distinct items had at least two value signals to average. */
  itemsWithConsensusValue: number;
  /** Sum of each item's retail value on file × quantity. */
  retailValueTotal: number;
  /** How many distinct items had a retail value on file. */
  itemsWithRetailValue: number;
}

/**
 * Computes collection-wide valuation totals (AI appraisal low/high,
 * consensus value, and retail value) for whatever set of ornament rows
 * `where` selects. Used by both the gallery stat bar (scoped to the current
 * search/filter) and Elaine's household-data lookup (scoped to the whole
 * active collection).
 *
 * Quantity is applied as a multiplier so totals represent "how many copies
 * I own × what each is worth", matching the existing totalBookValue
 * convention in the dedicated /api/ornaments/stats endpoint.
 */
export async function computeOrnamentValuationTotals(
  where: SQL<unknown>,
): Promise<OrnamentValuationTotals> {
  const rows = await db
    .select({
      quantity: ornamentsItems.quantity,
      bookValue: ornamentsItems.bookValue,
      ebayPriceMinUsd: ornamentsItems.ebayPriceMinUsd,
      ebayPriceMaxUsd: ornamentsItems.ebayPriceMaxUsd,
      aiAppraisal: ornamentsItems.aiAppraisal,
      retailValueUsd: ornamentsItems.retailValueUsd,
    })
    .from(ornamentsItems)
    .where(where);

  let aiAppraisalLowTotal = 0;
  let aiAppraisalHighTotal = 0;
  let itemsWithAiAppraisal = 0;
  let consensusValueTotal = 0;
  let itemsWithConsensusValue = 0;
  let retailValueTotal = 0;
  let itemsWithRetailValue = 0;

  for (const row of rows) {
    const qty = row.quantity ?? 1;
    const bookValue = row.bookValue != null ? parseFloat(row.bookValue) : null;
    const ebayPriceMinUsd =
      row.ebayPriceMinUsd != null ? parseFloat(row.ebayPriceMinUsd) : null;
    const ebayPriceMaxUsd =
      row.ebayPriceMaxUsd != null ? parseFloat(row.ebayPriceMaxUsd) : null;
    const retailValueUsd =
      row.retailValueUsd != null ? parseFloat(row.retailValueUsd) : null;

    const { low, high } = parseAiAppraisalRange(row.aiAppraisal);
    if (low != null && high != null) {
      aiAppraisalLowTotal += low * qty;
      aiAppraisalHighTotal += high * qty;
      itemsWithAiAppraisal += 1;
    }

    const consensus = computeConsensusValue({
      bookValue,
      ebayPriceMinUsd,
      ebayPriceMaxUsd,
      aiAppraisal: row.aiAppraisal,
    });
    if (consensus != null) {
      consensusValueTotal += consensus * qty;
      itemsWithConsensusValue += 1;
    }

    if (retailValueUsd != null) {
      retailValueTotal += retailValueUsd * qty;
      itemsWithRetailValue += 1;
    }
  }

  return {
    aiAppraisalLowTotal,
    aiAppraisalHighTotal,
    itemsWithAiAppraisal,
    consensusValueTotal,
    itemsWithConsensusValue,
    retailValueTotal,
    itemsWithRetailValue,
  };
}
