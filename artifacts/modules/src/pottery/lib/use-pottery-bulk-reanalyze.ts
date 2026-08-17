import { useState } from "react";

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

  function enterBulkMode() {
    setBulkMode(true);
    setBulkSelectedIds(new Set());
  }

  function exitBulkMode() {
    setBulkMode(false);
    setBulkSelectedIds(new Set());
    setBulkStatus(null);
  }

  function toggleBulkSelect(id: number) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  }

  async function runBulkReanalyze() {
    if (bulkSelectedIds.size === 0) return;
    setBulkStatus("Analysing…");
    try {
      const result = await mutateAsync({
        data: { ids: [...bulkSelectedIds] },
      });
      await invalidateQueries();
      setBulkStatus(
        `Done — ${result.succeeded.length} refreshed${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
      );
      // End Select mode entirely (not just clear the checked items) so the
      // leftover selection circles vanish immediately instead of staying
      // stuck until a reload. The completion message itself is tracked
      // separately in `bulkStatus`, so it keeps showing (and is dismissible)
      // even though Select mode itself has already ended.
      setBulkMode(false);
      setBulkSelectedIds(new Set());
    } catch {
      setBulkStatus("Something went wrong. Please try again.");
      setBulkMode(false);
      setBulkSelectedIds(new Set());
    }
  }

  return {
    bulkMode,
    bulkSelectedIds,
    bulkStatus,
    setBulkStatus,
    enterBulkMode,
    exitBulkMode,
    toggleBulkSelect,
    runBulkReanalyze,
  };
}
