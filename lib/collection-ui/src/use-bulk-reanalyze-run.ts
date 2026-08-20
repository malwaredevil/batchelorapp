import { useRef, useState } from "react";
import {
  isAsyncActionBusy,
  markAsyncActionProcessing,
  markAsyncActionSettled,
  clearAsyncActionStatuses,
} from "./async-action-status";

// ---------------------------------------------------------------------------
// Shared bulk-run lifecycle for collection galleries (quilts, patterns, and
// any future collection with a bulk "reanalyze" action).
//
// Owns the per-card status writes (processing → sticky success/error) and a
// per-invocation generation guard: if the user dismisses Select mode while a
// run is still in flight ("Done" is disabled in the UI, but the guard makes
// the lifecycle safe regardless of how dismiss is reached), the late result
// must not write sticky icons back — its statuses are dropped instead.
// ---------------------------------------------------------------------------

export interface BulkReanalyzeRunDeps {
  /** The orval mutation's mutateAsync (e.g. useBulkReanalyzeQuilts/Patterns). */
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>;
  /** Per-item status-store key, e.g. quiltReanalyzeKey. */
  keyFor: (id: number) => string;
  /**
   * Refresh the gallery list (called after success, even a dismissed one).
   * May return a promise (e.g. queryClient.invalidateQueries(...)) — a
   * rejection is swallowed so a cache-refresh failure can never surface as
   * an unhandled rejection after an otherwise successful bulk mutation.
   */
  invalidate: () => unknown;
  /** Called with the result of a non-dismissed run (toast + clear selection). */
  onSettled: (result: { succeeded: number[]; failed: number[] }) => void;
  /** Called when a non-dismissed run throws (toast). */
  onFailed: () => void;
}

export interface BulkReanalyzeRunResult {
  succeeded: number[];
  failed: number[];
}

export function useBulkReanalyzeRun({
  mutateAsync,
  keyFor,
  invalidate,
  onSettled,
  onFailed,
}: BulkReanalyzeRunDeps) {
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const genRef = useRef(0);

  // Never let a rejected invalidate() escape as an unhandled rejection —
  // a cache-refresh failure is not fatal to an otherwise-settled bulk run.
  async function safeInvalidate() {
    try {
      await invalidate();
    } catch {
      // ignored — the gallery simply keeps its stale list until the next
      // natural refetch.
    }
  }

  /**
   * Run the bulk action. Refuses to start while another run is pending, so
   * two runs' per-card statuses can never interleave.
   */
  async function run(ids: number[]): Promise<BulkReanalyzeRunResult | null> {
    const uniqueIds = [...new Set(ids)];
    const keys = uniqueIds.map(keyFor);
    if (
      uniqueIds.length === 0 ||
      pendingRef.current ||
      keys.some(isAsyncActionBusy)
    ) {
      return null;
    }
    const gen = genRef.current;
    keys.forEach(markAsyncActionProcessing);
    pendingRef.current = true;
    setIsPending(true);
    try {
      const result = await mutateAsync({ data: { ids: uniqueIds } });
      if (gen !== genRef.current) {
        // Run was dismissed while in flight — drop its statuses entirely
        // (list data may still have changed server-side, so refresh it).
        clearAsyncActionStatuses(keys);
        await safeInvalidate();
        return null;
      }
      const succeededIds = new Set(result.succeeded);
      for (const id of uniqueIds) {
        markAsyncActionSettled(
          keyFor(id),
          succeededIds.has(id) ? "success" : "error",
          { sticky: true },
        );
      }
      await safeInvalidate();
      if (gen !== genRef.current) {
        // Dismissed while the (now-awaited) cache refresh was still in
        // flight — the mutation itself succeeded and its sticky icons were
        // already written above, but the user has left Select mode, so
        // onSettled (which would clear selection / show the status message)
        // must not fire after the fact.
        return null;
      }
      onSettled(result);
      return result;
    } catch {
      if (gen !== genRef.current) {
        clearAsyncActionStatuses(keys);
        return null;
      }
      for (const key of keys) {
        markAsyncActionSettled(key, "error", { sticky: true });
      }
      onFailed();
      return null;
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  /**
   * Invalidate any in-flight run's eventual result (called when Select mode
   * is dismissed). Does NOT reset isPending — a new run cannot start until
   * the old request actually settles, preventing overlapping runs from
   * fighting over the same per-card status keys.
   */
  function dismiss() {
    genRef.current += 1;
  }

  return { run, dismiss, isPending };
}
