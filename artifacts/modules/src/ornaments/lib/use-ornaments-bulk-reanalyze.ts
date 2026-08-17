import { useRef, useState } from "react";
import {
  useMultiSelectMode,
  markAsyncActionProcessing,
  markAsyncActionSettled,
  clearSettledAsyncActionStatuses,
  clearAsyncActionStatuses,
} from "@workspace/collection-ui";
import {
  ornamentReanalyzeKey,
  ORNAMENT_REANALYZE_KEY_PREFIX,
} from "@/ornaments/lib/reanalyze-status";

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
  const [bulkPending, setBulkPending] = useState(false);
  // Bumped by finishBulk() to invalidate any still-in-flight run: a stale
  // completion must not write sticky icons back after the user dismissed
  // the run (the UI disables "Done" while pending, but this guard makes the
  // lifecycle safe regardless of how finishBulk is reached).
  const runGenRef = useRef(0);

  // Marks each selected card/row "processing" up front (via the same
  // per-item status store the single-item "Refresh AI" badge uses), then
  // splits the one bulk request's succeeded/failed id lists back out across
  // those same keys so every card shows its own working/done/error badge
  // instead of only the aggregate floating-bar text. The settled badges are
  // sticky: they persist until the user presses "Done" (finishBulk below),
  // so the owner can review which items succeeded or failed.
  async function runBulkReanalyze() {
    const ids = bulkMode.selectedIds;
    if (ids.length === 0 || bulkPending) return;
    const gen = runGenRef.current;
    const keys = ids.map(ornamentReanalyzeKey);
    keys.forEach(markAsyncActionProcessing);
    setBulkPending(true);
    setBulkStatus("Refreshing AI + eBay prices…");
    try {
      const result = await mutateAsync({ data: { ids } });
      if (gen !== runGenRef.current) {
        // Run was dismissed while in flight — drop its statuses entirely.
        clearAsyncActionStatuses(keys);
        await invalidateQueries().catch(() => undefined);
        return;
      }
      const succeededIds = new Set(result.succeeded);
      for (const id of ids) {
        markAsyncActionSettled(
          ornamentReanalyzeKey(id),
          succeededIds.has(id) ? "success" : "error",
          { sticky: true },
        );
      }
      await invalidateQueries();
      setBulkStatus(
        `Done — ${result.succeeded.length} refreshed${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
      );
      // Stay in Select mode (with the selection cleared) so the per-card
      // check/X outcome icons stay visible until the user presses "Done" —
      // which exits the mode and clears the icons via finishBulk().
      bulkMode.clear();
    } catch {
      if (gen !== runGenRef.current) {
        clearAsyncActionStatuses(keys);
        return;
      }
      for (const key of keys) {
        markAsyncActionSettled(key, "error", { sticky: true });
      }
      setBulkStatus("Something went wrong. Please try again.");
      bulkMode.clear();
    } finally {
      setBulkPending(false);
    }
  }

  // The "Done" button: exit Select mode, dismiss the status message, and
  // clear the sticky per-card outcome icons (leaving any still-running
  // single-item refresh badge untouched).
  function finishBulk() {
    runGenRef.current += 1;
    bulkMode.exit();
    setBulkStatus(null);
    clearSettledAsyncActionStatuses(ORNAMENT_REANALYZE_KEY_PREFIX);
  }

  return {
    bulkMode,
    bulkStatus,
    setBulkStatus,
    bulkPending,
    runBulkReanalyze,
    finishBulk,
  };
}
