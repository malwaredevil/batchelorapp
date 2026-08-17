/**
 * Shared status-tracking keys for quilting AI re-analysis, mirroring the
 * ornaments/pottery modules. Both a card's "Refresh AI" action and the bulk
 * Select-mode run track per-item status under these keys (via
 * @workspace/collection-ui's async-action-status store), so each card shows
 * its own spinner/check/X badge during and after a run.
 */
export const QUILT_REANALYZE_KEY_PREFIX = "quilt-reanalyze:";
export const PATTERN_REANALYZE_KEY_PREFIX = "pattern-reanalyze:";

export function quiltReanalyzeKey(id: number): string {
  return `${QUILT_REANALYZE_KEY_PREFIX}${id}`;
}

export function patternReanalyzeKey(id: number): string {
  return `${PATTERN_REANALYZE_KEY_PREFIX}${id}`;
}
