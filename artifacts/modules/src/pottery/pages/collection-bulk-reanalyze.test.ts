/**
 * Regression tests: usePotteryBulkReanalyze bulk-run lifecycle.
 *
 * WHY: Task 1076 fixed a bug where the Pottery gallery left "Select" mode in
 * a broken state after a bulk job finished. Task 1101 then changed the
 * intended behavior: after a bulk run the gallery STAYS in Select mode (with
 * the selection cleared) so the per-card sticky success/error icons remain
 * visible, and the user presses "Done" (exitBulkMode) to exit the mode and
 * clear those icons. These tests exercise the real hook so that regressing
 * either the stay-in-mode behavior or the Done cleanup will fail.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePotteryBulkReanalyze } from "../lib/use-pottery-bulk-reanalyze";
import { potteryReanalyzeKey } from "../lib/reanalyze-status";
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
      usePotteryBulkReanalyze({ mutateAsync, invalidateQueries }),
    ),
    invalidateQueries,
  };
}

describe("usePotteryBulkReanalyze — bulk-run lifecycle", () => {
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
    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(2);

    await act(() => result.current.runBulkReanalyze());

    // Mode stays active so per-card outcome icons remain visible; selection
    // itself is cleared.
    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(0);
    expect(result.current.bulkStatus).toMatch(/Done/);
    expect(result.current.bulkStatus).toMatch(/2 refreshed/);
    // Sticky per-item outcome statuses persist until "Done"
    expect(getAsyncActionStatus(potteryReanalyzeKey(1))).toBe("success");
    expect(getAsyncActionStatus(potteryReanalyzeKey(2))).toBe("success");

    // exitBulkMode (the "Done" button) exits the mode and clears the icons
    act(() => result.current.exitBulkMode());
    expect(result.current.bulkMode).toBe(false);
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

    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(0);
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

    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(0);
    expect(result.current.bulkStatus).toMatch(/went wrong/i);
    expect(getAsyncActionStatus(potteryReanalyzeKey(5))).toBe("error");

    act(() => result.current.exitBulkMode());
    expect(getAsyncActionStatus(potteryReanalyzeKey(5))).toBeUndefined();
  });

  it("handles invalidateQueries rejecting after a successful mutation", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [7], failed: [] });
    const invalidateQueries = vi
      .fn()
      .mockRejectedValue(new Error("cache error"));
    const { result } = renderHook(() =>
      usePotteryBulkReanalyze({ mutateAsync, invalidateQueries }),
    );

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(7);
    });

    await act(() => result.current.runBulkReanalyze());

    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(0);

    act(() => result.current.exitBulkMode());
    expect(result.current.bulkMode).toBe(false);
  });

  it("does not call mutateAsync and leaves mode active when no items are selected", async () => {
    const mutateAsync = vi.fn();
    const { result } = makeHook(mutateAsync);

    act(() => result.current.enterBulkMode());
    // Do not select any items
    await act(() => result.current.runBulkReanalyze());

    expect(mutateAsync).not.toHaveBeenCalled();
    // Mode stays active — user is in Select mode, just hasn't picked anything
    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(0);
  });

  it("selectAllBulk selects the given ids (capped) and clearBulkSelection empties it", () => {
    const { result } = makeHook(vi.fn());

    act(() => result.current.enterBulkMode());
    act(() =>
      result.current.selectAllBulk(Array.from({ length: 30 }, (_, i) => i + 1)),
    );
    // Capped at the bulk max (20)
    expect(result.current.bulkSelectedIds.size).toBe(20);

    act(() => result.current.clearBulkSelection());
    expect(result.current.bulkSelectedIds.size).toBe(0);
    expect(result.current.bulkMode).toBe(true);
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
    expect(result.current.bulkMode).toBe(false);

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
    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkSelectedIds.size).toBe(0);
    expect(result.current.bulkStatus).toBeNull();
  });
});
