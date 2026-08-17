/**
 * Regression tests: useOrnamentsBulkReanalyze must exit Select mode
 * in every completion branch (success, partial-failure, thrown error).
 *
 * WHY: Task 1076 fixed a bug where the Ornaments gallery left "Select" mode
 * running forever after a bulk job finished — cards kept showing empty
 * selection circles until a full page reload. The fix is in
 * useOrnamentsBulkReanalyze (lib/use-ornaments-bulk-reanalyze.ts): it calls
 * bulkMode.exit() in every branch of runBulkReanalyze. These tests import
 * and exercise that real hook so that removing the exit() call from any
 * branch will cause a test failure.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrnamentsBulkReanalyze } from "../lib/use-ornaments-bulk-reanalyze";

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

describe("useOrnamentsBulkReanalyze — Select mode exits in every branch", () => {
  it("exits Select mode and sets a completion message on full success", async () => {
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

    // Select mode must be fully off and selection cleared
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    // Completion message must still be set so the user can see what happened
    expect(result.current.bulkStatus).toMatch(/Done/);
    expect(result.current.bulkStatus).toMatch(/2 refreshed/);
  });

  it("exits Select mode and reports partial failure when some ids fail", async () => {
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

    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    expect(result.current.bulkStatus).toMatch(/1 refreshed/);
    expect(result.current.bulkStatus).toMatch(/1 failed/);
  });

  it("exits Select mode on a thrown error (network failure, 5xx, etc.)", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Internal Server Error"));
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(3);
    });

    await act(() => result.current.runBulkReanalyze());

    // Select mode must be off even though the mutation threw
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
    // Error message must still be visible
    expect(result.current.bulkStatus).toMatch(/went wrong/i);
  });

  it("exits Select mode when invalidateQueries rejects after a successful mutation", async () => {
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

    // invalidateQueries rejection must fall through to the catch branch,
    // which must still exit Select mode
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.bulkMode.selectedIds).toHaveLength(0);
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

  it("bulkStatus is independently settable after Select mode exits", async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ succeeded: [10], failed: [] });
    const { result } = makeHook(mutateAsync);

    act(() => {
      result.current.bulkMode.enter();
      result.current.bulkMode.toggle(10);
    });

    await act(() => result.current.runBulkReanalyze());

    // After exit, a new Select session can be started independently of
    // the old completion message — the two are separate pieces of state
    act(() => result.current.bulkMode.enter());
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.bulkStatus).toMatch(/Done/);
  });
});
