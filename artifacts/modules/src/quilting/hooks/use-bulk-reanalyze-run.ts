import { useRef, useState } from "react";
import {
  markAsyncActionProcessing,
  markAsyncActionSettled,
  clearAsyncActionStatuses,
} from "@workspace/collection-ui";

// ---------------------------------------------------------------------------
// Shared bulk-run lifecycle for Quilting's quilts and patterns galleries.
//
// Owns the per-card status writes (processing → sticky success/error) and a
// per-invocation generation guard: if the user dismisses Select mode while a
// run is still in flight ("Done" is disabled in the UI, but the guard makes
// the lifecycle safe regardless of how dismiss is reached), the late result
// must not write sticky icons back — its statuses are dropped instead.
// Mirrors the pattern used by the ornaments and pottery bulk hooks.
// ---------------------------------------------------------------------------

export interface BulkReanalyzeRunDeps {
  /** The orval mutation's mutateAsync (useBulkReanalyzeQuilts/Patterns). */
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>;
  /** Per-item status-store key, e.g. quiltReanalyzeKey. */
  keyFor: (id: number) => string;
  /** Refresh the gallery list (called after success, even a dismissed one). */
  invalidate: () => void;
  /** Called with the result of a non-dismissed run (toast + clear selection). */
  onSettled: (result: { succeeded: number[]; failed: number[] }) => void;
  /** Called when a non-dismissed run throws (toast). */
  onFailed: () => void;
}

export function useBulkReanalyzeRun({
  mutateAsync,
  keyFor,
  invalidate,
  onSettled,
  onFailed,
}: BulkReanalyzeRunDeps) {
  const [isPending, setIsPending] = useState(false);
  const genRef = useRef(0);

  /**
   * Run the bulk action. Refuses to start while another run is pending, so
   * two runs' per-card statuses can never interleave.
   */
  async function run(ids: number[]) {
    if (ids.length === 0 || isPending) return;
    const gen = genRef.current;
    const keys = ids.map(keyFor);
    keys.forEach(markAsyncActionProcessing);
    setIsPending(true);
    try {
      const result = await mutateAsync({ data: { ids } });
      if (gen !== genRef.current) {
        // Run was dismissed while in flight — drop its statuses entirely
        // (list data may still have changed server-side, so refresh it).
        clearAsyncActionStatuses(keys);
        invalidate();
        return;
      }
      const succeededIds = new Set(result.succeeded);
      for (const id of ids) {
        markAsyncActionSettled(
          keyFor(id),
          succeededIds.has(id) ? "success" : "error",
          { sticky: true },
        );
      }
      invalidate();
      onSettled(result);
    } catch {
      if (gen !== genRef.current) {
        clearAsyncActionStatuses(keys);
        return;
      }
      for (const key of keys) {
        markAsyncActionSettled(key, "error", { sticky: true });
      }
      onFailed();
    } finally {
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
