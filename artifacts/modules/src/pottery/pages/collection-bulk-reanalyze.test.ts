/**
 * Regression tests: usePotteryBulkReanalyze must exit Select mode
 * in every completion branch (success, partial-failure, thrown error).
 *
 * WHY: Task 1076 fixed a bug where the Pottery gallery left "Select" mode
 * running forever after a bulk job finished — cards kept showing empty
 * selection circles until a full page reload. The fix is in
 * usePotteryBulkReanalyze (lib/use-pottery-bulk-reanalyze.ts): it calls
 * setBulkMode(false) and setBulkSelectedIds(new Set()) in every branch of
 * runBulkReanalyze. These tests import and exercise that real hook so that
 * removing either setter call from any branch will cause a test failure.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePotteryBulkReanalyze } from "../lib/use-pottery-bulk-reanalyze";

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

describe("usePotteryBulkReanalyze — Select mode exits in every branch", () => {
  it("exits Select mode and sets a completion message on full success", async () => {
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

    // Both pieces of Select mode state must be cleared
    expect(result.current.bulkMode).toBe(false);
    expect(result.current.bulkSelectedIds.size).toBe(0);
    // Completion message must still be visible
    expect(result.current.bulkStatus).toMatch(/Done/);
    expect(result.current.bulkStatus).toMatch(/2 refreshed/);
  });

  it("exits Select mode and reports partial failure when some ids fail", async () => {
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

    expect(result.current.bulkMode).toBe(false);
    expect(result.current.bulkSelectedIds.size).toBe(0);
    expect(result.current.bulkStatus).toMatch(/1 refreshed/);
    expect(result.current.bulkStatus).toMatch(/1 failed/);
  });

  it("exits Select mode on a thrown error (network failure, 5xx, etc.)", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Internal Server Error"));
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(5);
    });

    await act(() => result.current.runBulkReanalyze());

    // Both pieces of Select mode state must be cleared even on throw
    expect(result.current.bulkMode).toBe(false);
    expect(result.current.bulkSelectedIds.size).toBe(0);
    expect(result.current.bulkStatus).toMatch(/went wrong/i);
  });

  it("exits Select mode when invalidateQueries rejects after a successful mutation", async () => {
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

    expect(result.current.bulkMode).toBe(false);
    expect(result.current.bulkSelectedIds.size).toBe(0);
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

  it("clears both bulkMode and bulkSelectedIds (not just one) on success", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [3], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(3);
    });

    await act(() => result.current.runBulkReanalyze());

    // A partial fix that only clears one leaves either lingering circles
    // (selectedIds still populated) or a stuck mode flag (bulkMode still true)
    expect(result.current.bulkMode).toBe(false);
    expect(result.current.bulkSelectedIds.size).toBe(0);
  });

  it("clears both bulkMode and bulkSelectedIds (not just one) on error", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("timeout"));
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(4);
      result.current.toggleBulkSelect(5);
    });

    await act(() => result.current.runBulkReanalyze());

    expect(result.current.bulkMode).toBe(false);
    expect(result.current.bulkSelectedIds.size).toBe(0);
  });

  it("bulkStatus is independently settable after Select mode exits", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [9], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.enterBulkMode();
      result.current.toggleBulkSelect(9);
    });

    await act(() => result.current.runBulkReanalyze());

    // A new Select session can be opened without clearing the old message
    act(() => result.current.enterBulkMode());
    expect(result.current.bulkMode).toBe(true);
    expect(result.current.bulkStatus).toMatch(/Done/);
  });
});
