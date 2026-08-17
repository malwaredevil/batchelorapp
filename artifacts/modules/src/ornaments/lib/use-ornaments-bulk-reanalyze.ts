import { useState } from "react";
import {
  useMultiSelectMode,
  markAsyncActionProcessing,
  markAsyncActionSettled,
} from "@workspace/collection-ui";
import { ornamentReanalyzeKey } from "@/ornaments/lib/reanalyze-status";

// ---------------------------------------------------------------------------
// Dependency types — injected so the hook is testable without a real
// QueryClient or API-client provider stack.
// ---------------------------------------------------------------------------

export interface OrnamentsBulkReanalyzeDeps {
  /** The mutation's mutateAsync, from useBulkReanalyzeOrnaments(). */
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>;
  /**
   * A zero-arg wrapper around queryClient.invalidateQueries() that already
   * carries the right query key — e.g.
   *   () => queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() })
   * This avoids threading queryClient itself through the hook.
   */
  invalidateQueries: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// The hook — owns all bulk-select + status state and exposes runBulkReanalyze.
// Used by the Ornaments collection page; tested directly in
// collection-bulk-reanalyze.test.ts.
// ---------------------------------------------------------------------------

export function useOrnamentsBulkReanalyze({
  mutateAsync,
  invalidateQueries,
}: OrnamentsBulkReanalyzeDeps) {
  const bulkMode = useMultiSelectMode(20);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  // Marks each selected card/row "processing" up front (via the same
  // per-item status store the single-item "Refresh AI" badge uses), then
  // splits the one bulk request's succeeded/failed id lists back out across
  // those same keys so every card shows its own working/done/error badge
  // instead of only the aggregate floating-bar text.
  async function runBulkReanalyze() {
    const ids = bulkMode.selectedIds;
    if (ids.length === 0) return;
    const keys = ids.map(ornamentReanalyzeKey);
    keys.forEach(markAsyncActionProcessing);
    setBulkStatus("Analysing…");
    try {
      const result = await mutateAsync({ data: { ids } });
      const succeededIds = new Set(result.succeeded);
      for (const id of ids) {
        markAsyncActionSettled(
          ornamentReanalyzeKey(id),
          succeededIds.has(id) ? "success" : "error",
        );
      }
      await invalidateQueries();
      setBulkStatus(
        `Done — ${result.succeeded.length} refreshed${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
      );
      // End Select mode entirely (not just clear checked items) so the
      // leftover selection circles vanish immediately and each card's own
      // aiStatus badge becomes the visible indicator, without waiting for a
      // reload. The completion message itself is tracked separately in
      // `bulkStatus`, so it stays visible until the user dismisses it.
      bulkMode.exit();
    } catch {
      for (const key of keys) markAsyncActionSettled(key, "error");
      setBulkStatus("Something went wrong. Please try again.");
      bulkMode.exit();
    }
  }

  return { bulkMode, bulkStatus, setBulkStatus, runBulkReanalyze };
}
