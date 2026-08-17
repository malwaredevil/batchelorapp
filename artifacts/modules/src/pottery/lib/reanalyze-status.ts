/**
 * Shared status-tracking key for a pottery piece's AI re-analysis, mirroring
 * the ornaments module's ornamentReanalyzeKey. Both the gallery card's
 * "Refresh AI" menu item and the bulk Select-mode run track their per-item
 * status under this key (via @workspace/collection-ui's async-action-status
 * store), so each card shows its own spinner/check/X badge.
 */
export const POTTERY_REANALYZE_KEY_PREFIX = "pottery-reanalyze:";

export function potteryReanalyzeKey(id: number): string {
  return `${POTTERY_REANALYZE_KEY_PREFIX}${id}`;
}

/** Max number of pieces selectable at once in the bulk Select-mode run. */
export const POTTERY_BULK_MAX = 20;
