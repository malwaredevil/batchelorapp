/**
 * Shared status-tracking key for a magnet's AI vision re-analysis.
 *
 * Both the gallery card's "Refresh AI" menu item and the detail page's
 * "Refresh AI" button use the same underlying mutation.  Sharing one key
 * through @workspace/collection-ui's async-action-status store prevents
 * duplicate in-flight calls and surfaces a live status badge on whichever
 * surface triggered the refresh.
 */
export const MAGNET_REANALYZE_KEY_PREFIX = "magnet-reanalyze:";

export function magnetReanalyzeKey(id: number): string {
  return `${MAGNET_REANALYZE_KEY_PREFIX}${id}`;
}
