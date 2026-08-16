/**
 * Shared status-tracking key for an ornament's AI vision re-analysis.
 *
 * Two different surfaces can trigger this same underlying AI call:
 *  - the gallery card's "Refresh AI" menu item (vision reanalysis only)
 *  - the detail page's "Refresh all" button (which also refreshes vision
 *    analysis, alongside book value / eBay prices / appraisal)
 *
 * Using one shared key (via @workspace/collection-ui's async-action-status
 * store) means either surface can see that the other already has a refresh
 * in flight for the same item, so the user gets a live status badge instead
 * of accidentally re-triggering (and paying for) a duplicate AI call.
 */
export function ornamentReanalyzeKey(id: number): string {
  return `ornament-reanalyze:${id}`;
}
