/**
 * Regression tests: Pottery's bulk-reanalyze lifecycle, now composed from
 * the shared @workspace/collection-ui hooks (Task 1109 migration) instead of
 * a module-local usePotteryBulkReanalyze hook.
 *
 * WHY: Task 1076 fixed a bug where the Pottery gallery left "Select" mode in
 * a broken state after a bulk job finished. Task 1101 then changed the
 * intended behavior: after a bulk run the gallery STAYS in Select mode (with
 * the selection cleared) so the per-card sticky success/error icons remain
 * visible, and the user presses "Done" (exitBulkMode) to exit the mode and
 * clear those icons. These tests exercise the same composition
 * collection.tsx uses — useMultiSelectMode + useBulkReanalyzeRun wired with
 * pottery's key/status callbacks — so that regressing either the
 * stay-in-mode behavior or the Done cleanup will fail.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import {
  useMultiSelectMode,
  useBulkReanalyzeRun,
  clearSettledAsyncActionStatuses,
  getAsyncActionStatus,
} from "@workspace/collection-ui";
import {
  potteryReanalyzeKey,
  POTTERY_REANALYZE_KEY_PREFIX,
  POTTERY_BULK_MAX,
} from "../lib/reanalyze-status";

// Mirrors the wiring in collection.tsx: the shared selection-mode hook owns
// enter/exit/toggle/select-all/clear, the shared run hook owns run/dismiss
// and per-card statuses, and this harness owns the sticky status message +
// the Done-button composition, exactly like the page component does.
// `invalidate` is passed through unwrapped (no local .catch()) — same as
// the production page's `() => queryClient.invalidateQueries(...)` — so
// these tests exercise the shared hook's own rejection handling, not a
// test-only safety net.
function usePotteryBulkReanalyzeHarness(
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>,
  invalidateQueries: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  const bulkMode = useMultiSelectMode(POTTERY_BULK_MAX);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const bulkRun = useBulkReanalyzeRun({
    mutateAsync,
    keyFor: potteryReanalyzeKey,
    invalidate: invalidateQueries,
    onSettled: ({ succeeded, failed }) => {
      bulkMode.clear();
      setBulkStatus(
        `Done — ${succeeded.length} refreshed${failed.length ? `, ${failed.length} failed` : ""}.`,
      );
    },
    onFailed: () => {
      bulkMode.clear();
      setBulkStatus("Something went wrong. Please try again.");
    },
  });

  function runBulkReanalyze() {
    return bulkRun.run(bulkMode.selectedIds);
  }

  function exitBulkMode() {
    bulkRun.dismiss();
    bulkMode.exit();
    setBulkStatus(null);
    clearSettledAsyncActionStatuses(POTTERY_REANALYZE_KEY_PREFIX);
  }

  return {
    bulkMode,
    bulkStatus,
    setBulkStatus,
    bulkPending: bulkRun.isPending,
    enterBulkMode: bulkMode.enter,
    exitBulkMode,
    toggleBulkSelect: bulkMode.toggle,
    selectAllBulk: bulkMode.selectAll,
    clearBulkSelection: bulkMode.clear,
    runBulkReanalyze,
  };
}

function makeHook(
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>,
  invalidateQueries?: () => Promise<void>,
) {
  return renderHook(() =>
    usePotteryBulkReanalyzeHarness(mutateAsync, invalidateQueries),
  );
}

describe("Pottery bulk-reanalyze — shared-hook composition lifecycle", () => {
  it("stays in Select mode with the selection cleared on full success", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [1, 2], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(1);
      result.current.toggleBulkSelect(2);
    });
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(2);

    await act(() => result.current.runBulkReanalyze());

    // Mode stays active so per-card outcome icons remain visible; selection
    // itself is cleared.
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
    expect(result.current.bulkStatus).toMatch(/Done/);
    expect(result.current.bulkStatus).toMatch(/2 refreshed/);
    // Sticky per-item outcome statuses persist until "Done"
    expect(getAsyncActionStatus(potteryReanalyzeKey(1))).toBe("success");
    expect(getAsyncActionStatus(potteryReanalyzeKey(2))).toBe("success");

    // exitBulkMode (the "Done" button) exits the mode and clears the icons
    act(() => result.current.exitBulkMode());
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkStatus).toBeNull();
    expect(getAsyncActionStatus(potteryReanalyzeKey(1))).toBeUndefined();
    expect(getAsyncActionStatus(potteryReanalyzeKey(2))).toBeUndefined();
  });

  it("marks per-item success/error statuses on partial failure", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [1], failed: [2] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(1);
      result.current.toggleBulkSelect(2);
    });

    await act(() => result.current.runBulkReanalyze());

    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
    expect(result.current.bulkStatus).toMatch(/1 refreshed/);
    expect(result.current.bulkStatus).toMatch(/1 failed/);
    expect(getAsyncActionStatus(potteryReanalyzeKey(1))).toBe("success");
    expect(getAsyncActionStatus(potteryReanalyzeKey(2))).toBe("error");

    act(() => result.current.exitBulkMode());
    expect(getAsyncActionStatus(potteryReanalyzeKey(1))).toBeUndefined();
    expect(getAsyncActionStatus(potteryReanalyzeKey(2))).toBeUndefined();
  });

  it("marks all items failed on a thrown error (network failure, 5xx, etc.)", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Internal Server Error"));
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(5);
    });

    await act(() => result.current.runBulkReanalyze());

    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
    expect(result.current.bulkStatus).toMatch(/went wrong/i);
    expect(getAsyncActionStatus(potteryReanalyzeKey(5))).toBe("error");

    act(() => result.current.exitBulkMode());
    expect(getAsyncActionStatus(potteryReanalyzeKey(5))).toBeUndefined();
  });

  it("handles invalidate() rejecting after a successful mutation without crashing", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [7], failed: [] });
    const invalidateQueries = vi
      .fn()
      .mockRejectedValue(new Error("cache error"));
    const { result } = makeHook(mutateAsync, invalidateQueries);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(7);
    });

    await act(() => result.current.runBulkReanalyze());

    // A cache-refresh failure must not stop the success path: the run still
    // settles normally (sticky success icon + status text), and no
    // unhandled rejection escapes.
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
    expect(result.current.bulkStatus).toMatch(/1 refreshed/);
    expect(getAsyncActionStatus(potteryReanalyzeKey(7))).toBe("success");

    act(() => result.current.exitBulkMode());
    expect(result.current.bulkMode.active).toBe(false);
    expect(getAsyncActionStatus(potteryReanalyzeKey(7))).toBeUndefined();
  });

  it("does not call mutateAsync and leaves mode active when no items are selected", async () => {
    const mutateAsync = vi.fn();
    const { result } = makeHook(mutateAsync);

    act(() => result.current.enterBulkMode());
    // Do not select any items
    await act(() => result.current.runBulkReanalyze());

    expect(mutateAsync).not.toHaveBeenCalled();
    // Mode stays active — user is in Select mode, just hasn't picked anything
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
  });

  it("selectAllBulk selects the given ids (capped) and clearBulkSelection empties it", () => {
    const { result } = makeHook(vi.fn());

    act(() => result.current.enterBulkMode());
    act(() =>
      result.current.selectAllBulk(Array.from({ length: 30 }, (_, i) => i + 1)),
    );
    // Capped at the bulk max (20)
    expect(result.current.bulkMode.selectedIds.length).toBe(POTTERY_BULK_MAX);

    act(() => result.current.clearBulkSelection());
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
    expect(result.current.bulkMode.active).toBe(true);
  });

  it("Done pressed mid-flight: a late success must not resurrect icons", async () => {
    let resolveRun!: (v: { succeeded: number[]; failed: number[] }) => void;
    const mutateAsync = vi.fn().mockReturnValue(
      new Promise<{ succeeded: number[]; failed: number[] }>((res) => {
        resolveRun = res;
      }),
    );
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(1);
      result.current.toggleBulkSelect(2);
    });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.runBulkReanalyze();
    });
    expect(result.current.bulkPending).toBe(true);

    // User dismisses the run before it resolves
    act(() => result.current.exitBulkMode());
    expect(result.current.bulkMode.active).toBe(false);

    await act(async () => {
      resolveRun({ succeeded: [1], failed: [2] });
      await runPromise;
    });

    // The stale completion must not write sticky icons or status text back
    expect(getAsyncActionStatus(potteryReanalyzeKey(1))).toBeUndefined();
    expect(getAsyncActionStatus(potteryReanalyzeKey(2))).toBeUndefined();
    expect(result.current.bulkStatus).toBeNull();
    expect(result.current.bulkPending).toBe(false);
  });

  it("Done pressed mid-flight: a late failure must not resurrect icons", async () => {
    let rejectRun!: (e: Error) => void;
    const mutateAsync = vi.fn().mockReturnValue(
      new Promise((_res, rej) => {
        rejectRun = rej;
      }),
    );
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(7);
    });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.runBulkReanalyze();
    });
    act(() => result.current.exitBulkMode());

    await act(async () => {
      rejectRun(new Error("timeout"));
      await runPromise;
    });

    expect(getAsyncActionStatus(potteryReanalyzeKey(7))).toBeUndefined();
    expect(result.current.bulkStatus).toBeNull();
  });

  it("Done pressed after mutation success but before invalidate() resolves must not resurrect the status message", async () => {
    let resolveInvalidate!: () => void;
    const invalidateQueries = vi.fn().mockReturnValue(
      new Promise<void>((res) => {
        resolveInvalidate = res;
      }),
    );
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [3], failed: [] });
    const { result } = makeHook(mutateAsync, invalidateQueries);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(3);
    });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.runBulkReanalyze();
    });

    // Let the mutation resolve and the sticky icon get written, but leave
    // invalidate() unresolved — this is the narrow window where the user
    // can still press "Done" before the run hook's onSettled callback runs.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getAsyncActionStatus(potteryReanalyzeKey(3))).toBe("success");

    act(() => result.current.exitBulkMode());
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkStatus).toBeNull();
    expect(getAsyncActionStatus(potteryReanalyzeKey(3))).toBeUndefined();

    await act(async () => {
      resolveInvalidate();
      await runPromise;
    });

    // onSettled must not fire after the dismissal — no resurrected status
    // message, and the mode must stay exited.
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkStatus).toBeNull();
    expect(getAsyncActionStatus(potteryReanalyzeKey(3))).toBeUndefined();
  });

  it("a new Select session can start after Done without stale state", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [9], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(9);
    });

    await act(() => result.current.runBulkReanalyze());
    act(() => result.current.exitBulkMode());

    act(() => result.current.enterBulkMode());
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds.length).toBe(0);
    expect(result.current.bulkStatus).toBeNull();
  });
});
