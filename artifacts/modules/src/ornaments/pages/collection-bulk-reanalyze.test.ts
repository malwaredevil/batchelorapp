/**
 * Regression tests: useOrnamentsBulkReanalyze bulk-run lifecycle.
 *
 * WHY: Task 1076 fixed a bug where the Ornaments gallery left "Select" mode
 * in a broken state after a bulk job finished. Task 1101 then changed the
 * intended behavior: after a bulk run the gallery STAYS in Select mode (with
 * the selection cleared) so the per-card sticky success/error icons remain
 * visible, and the user presses "Done" (finishBulk) to exit the mode and
 * clear those icons. These tests exercise the real hook so that regressing
 * either the stay-in-mode behavior or the Done cleanup will fail.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrnamentsBulkReanalyze } from "../lib/use-ornaments-bulk-reanalyze";
import { ornamentReanalyzeKey } from "../lib/reanalyze-status";
import { getAsyncActionStatus } from "@workspace/collection-ui";

function makeHook(
  mutateAsync: (args: { data: { ids: number[] } }) => Promise<{
    succeeded: number[];
    failed: number[];
  }>,
) {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  return {
    ...renderHook(() =>
      useOrnamentsBulkReanalyze({ mutateAsync, invalidateQueries }),
    ),
    invalidateQueries,
  };
}

describe("useOrnamentsBulkReanalyze — bulk-run lifecycle", () => {
  it("stays in Select mode with the selection cleared on full success", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [1, 2], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(1);
      result.current.bulkMode.toggle(2);
    });
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds).toHaveLength(2);

    await act(() => result.current.runBulkReanalyze());

    // Mode stays active so per-card outcome icons remain visible; selection
    // itself is cleared.
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    // Completion message must still be set so the user can see what happened
    expect(result.current.bulkStatus).toMatch(/Done/);
    expect(result.current.bulkStatus).toMatch(/2 refreshed/);
    // Sticky per-item outcome statuses persist until "Done"
    expect(getAsyncActionStatus(ornamentReanalyzeKey(1))).toBe("success");
    expect(getAsyncActionStatus(ornamentReanalyzeKey(2))).toBe("success");

    // finishBulk (the "Done" button) exits the mode and clears the icons
    act(() => result.current.finishBulk());
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkStatus).toBeNull();
    expect(getAsyncActionStatus(ornamentReanalyzeKey(1))).toBeUndefined();
    expect(getAsyncActionStatus(ornamentReanalyzeKey(2))).toBeUndefined();
  });

  it("marks per-item success/error statuses on partial failure", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [1], failed: [2] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(1);
      result.current.bulkMode.toggle(2);
    });

    await act(() => result.current.runBulkReanalyze());

    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    expect(result.current.bulkStatus).toMatch(/1 refreshed/);
    expect(result.current.bulkStatus).toMatch(/1 failed/);
    expect(getAsyncActionStatus(ornamentReanalyzeKey(1))).toBe("success");
    expect(getAsyncActionStatus(ornamentReanalyzeKey(2))).toBe("error");

    act(() => result.current.finishBulk());
    expect(getAsyncActionStatus(ornamentReanalyzeKey(1))).toBeUndefined();
    expect(getAsyncActionStatus(ornamentReanalyzeKey(2))).toBeUndefined();
  });

  it("marks all items failed on a thrown error (network failure, 5xx, etc.)", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Internal Server Error"));
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(3);
    });

    await act(() => result.current.runBulkReanalyze());

    // Mode stays active so the user can see the error icons; selection cleared
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    expect(result.current.bulkStatus).toMatch(/went wrong/i);
    expect(getAsyncActionStatus(ornamentReanalyzeKey(3))).toBe("error");

    act(() => result.current.finishBulk());
    expect(getAsyncActionStatus(ornamentReanalyzeKey(3))).toBeUndefined();
  });

  it("handles invalidateQueries rejecting after a successful mutation", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [5], failed: [] });
    const invalidateQueries = vi
      .fn()
      .mockRejectedValue(new Error("cache error"));
    const { result } = renderHook(() =>
      useOrnamentsBulkReanalyze({ mutateAsync, invalidateQueries }),
    );

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(5);
    });

    await act(() => result.current.runBulkReanalyze());

    // invalidateQueries rejection falls through to the catch branch, which
    // must still leave a coherent state (mode active, selection cleared)
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);

    act(() => result.current.finishBulk());
    expect(result.current.bulkMode.active).toBe(false);
  });

  it("does not call mutateAsync and leaves mode active when no items are selected", async () => {
    const mutateAsync = vi.fn();
    const { result } = makeHook(mutateAsync);

    act(() => result.current.bulkMode.enter());
    // Do not select anything
    await act(() => result.current.runBulkReanalyze());

    expect(mutateAsync).not.toHaveBeenCalled();
    // Mode stays active — user is in Select mode, just hasn't picked anything
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
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(1);
      result.current.bulkMode.toggle(2);
    });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.runBulkReanalyze();
    });
    expect(result.current.bulkPending).toBe(true);

    // User dismisses the run before it resolves
    act(() => result.current.finishBulk());
    expect(result.current.bulkMode.active).toBe(false);

    await act(async () => {
      resolveRun({ succeeded: [1], failed: [2] });
      await runPromise;
    });

    // The stale completion must not write sticky icons or status text back
    expect(getAsyncActionStatus(ornamentReanalyzeKey(1))).toBeUndefined();
    expect(getAsyncActionStatus(ornamentReanalyzeKey(2))).toBeUndefined();
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
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(7);
    });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.runBulkReanalyze();
    });
    act(() => result.current.finishBulk());

    await act(async () => {
      rejectRun(new Error("timeout"));
      await runPromise;
    });

    expect(getAsyncActionStatus(ornamentReanalyzeKey(7))).toBeUndefined();
    expect(result.current.bulkStatus).toBeNull();
  });

  it("a new Select session can start after Done without stale state", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [10], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(10);
    });

    await act(() => result.current.runBulkReanalyze());
    act(() => result.current.finishBulk());

    act(() => result.current.bulkMode.enter());
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    expect(result.current.bulkStatus).toBeNull();
  });
});
