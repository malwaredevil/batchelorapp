import { useRef, useState } from "react";
import {
  markAsyncActionProcessing,
  markAsyncActionSettled,
  clearSettledAsyncActionStatuses,
  clearAsyncActionStatuses,
} from "@workspace/collection-ui";
import {
  potteryReanalyzeKey,
  POTTERY_REANALYZE_KEY_PREFIX,
} from "@/pottery/lib/reanalyze-status";

// ---------------------------------------------------------------------------
// Dependency types — injected so the hook is testable without a real
// QueryClient or API-client provider stack.
// ---------------------------------------------------------------------------

export interface PotteryBulkReanalyzeDeps {
  /** The mutation's mutateAsync, from useBulkReanalyzePottery(). */
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>;
  /**
   * A zero-arg wrapper around queryClient.invalidateQueries() that already
   * carries the right query key — e.g.
   *   () => queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() })
   */
  invalidateQueries: () => Promise<void>;
}

export const POTTERY_BULK_MAX = 20;

// ---------------------------------------------------------------------------
// The hook — owns all bulk-select + status state for Pottery's gallery page
// and exposes runBulkReanalyze. Tested directly in
// collection-bulk-reanalyze.test.ts.
// ---------------------------------------------------------------------------

export function usePotteryBulkReanalyze({
  mutateAsync,
  invalidateQueries,
}: PotteryBulkReanalyzeDeps) {
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(
    new Set(),
  );
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  // Bumped by exitBulkMode() to invalidate any still-in-flight run: a stale
  // completion must not write sticky icons back after the user dismissed
  // the run (the UI disables "Done" while pending, but this guard makes the
  // lifecycle safe regardless of how exitBulkMode is reached).
  const runGenRef = useRef(0);

  function enterBulkMode() {
    setBulkMode(true);
    setBulkSelectedIds(new Set());
  }

  // The "Done" button: exit Select mode, dismiss the status message, and
  // clear the sticky per-card outcome icons (leaving any still-running
  // single-item refresh badge untouched).
  function exitBulkMode() {
    runGenRef.current += 1;
    setBulkMode(false);
    setBulkSelectedIds(new Set());
    setBulkStatus(null);
    clearSettledAsyncActionStatuses(POTTERY_REANALYZE_KEY_PREFIX);
  }

  function toggleBulkSelect(id: number) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < POTTERY_BULK_MAX) next.add(id);
      return next;
    });
  }

  /** Select every item currently shown in the gallery (capped at the max). */
  function selectAllBulk(ids: number[]) {
    setBulkSelectedIds(new Set(ids.slice(0, POTTERY_BULK_MAX)));
  }

  function clearBulkSelection() {
    setBulkSelectedIds(new Set());
  }

  // Marks each selected card "processing" up front, then splits the bulk
  // request's succeeded/failed id lists back across the per-item keys so
  // every card shows its own spinner/check/X badge. Settled badges are
  // sticky: they persist until the user presses "Done" (exitBulkMode).
  async function runBulkReanalyze() {
    if (bulkSelectedIds.size === 0 || bulkPending) return;
    const gen = runGenRef.current;
    const ids = [...bulkSelectedIds];
    const keys = ids.map(potteryReanalyzeKey);
    keys.forEach(markAsyncActionProcessing);
    setBulkPending(true);
    setBulkStatus("Analysing…");
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
          potteryReanalyzeKey(id),
          succeededIds.has(id) ? "success" : "error",
          { sticky: true },
        );
      }
      await invalidateQueries();
      setBulkStatus(
        `Done — ${result.succeeded.length} refreshed${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
      );
      // Stay in Select mode (with the selection cleared) so the per-card
      // check/X outcome icons stay visible until the user presses "Done".
      setBulkSelectedIds(new Set());
    } catch {
      if (gen !== runGenRef.current) {
        clearAsyncActionStatuses(keys);
        return;
      }
      for (const key of keys) {
        markAsyncActionSettled(key, "error", { sticky: true });
      }
      setBulkStatus("Something went wrong. Please try again.");
      setBulkSelectedIds(new Set());
    } finally {
      setBulkPending(false);
    }
  }

  return {
    bulkMode,
    bulkSelectedIds,
    bulkStatus,
    setBulkStatus,
    bulkPending,
    enterBulkMode,
    exitBulkMode,
    toggleBulkSelect,
    selectAllBulk,
    clearBulkSelection,
    runBulkReanalyze,
  };
}
