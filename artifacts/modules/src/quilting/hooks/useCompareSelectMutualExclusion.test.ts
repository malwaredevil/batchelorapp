/**
 * Regression test: Compare and Select modes must be mutually exclusive
 * on the Patterns and Quilts gallery pages.
 *
 * WHY: CollectionPageShell's Select button calls a `toggleBulkMode` prop
 * directly. Before this fix, Patterns and Quilts passed pageState.toggleBulkMode
 * raw — so a user who clicked Compare then clicked Select left both modes active
 * simultaneously: the Compare floating bar retained its selection while cards
 * also accumulated in the bulk selection set.
 *
 * Fix: both pages now pass handleToggleBulkMode, which calls compareMode.exit()
 * before enabling bulk mode. These tests verify that contract without needing a
 * full component render.
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiSelectMode } from "@workspace/collection-ui";

function useCompareBulkPair() {
  const compareMode = useMultiSelectMode(5);
  const bulkMode = useMultiSelectMode(20);

  // Mirrors the handleToggleBulkMode helper added to Patterns and Quilts pages:
  // exit Compare first, then toggle bulk.
  function handleToggleBulkMode() {
    if (compareMode.active) compareMode.exit();
    bulkMode.active ? bulkMode.exit() : bulkMode.enter();
  }

  // Mirrors toggleCompareMode: exit bulk first, then enter compare.
  function handleToggleCompareMode() {
    if (compareMode.active) {
      compareMode.exit();
    } else {
      if (bulkMode.active) bulkMode.exit();
      compareMode.enter();
    }
  }

  return {
    compareMode,
    bulkMode,
    handleToggleBulkMode,
    handleToggleCompareMode,
  };
}

describe("Compare ↔ Select mutual exclusion (Patterns / Quilts pages)", () => {
  it("entering Select while Compare is active exits Compare first", () => {
    const { result } = renderHook(() => useCompareBulkPair());

    act(() => result.current.handleToggleCompareMode());
    expect(result.current.compareMode.active).toBe(true);
    expect(result.current.bulkMode.active).toBe(false);

    act(() => result.current.handleToggleBulkMode());
    expect(result.current.compareMode.active).toBe(false);
    expect(result.current.bulkMode.active).toBe(true);
  });

  it("entering Compare while Select is active exits Select first", () => {
    const { result } = renderHook(() => useCompareBulkPair());

    act(() => result.current.handleToggleBulkMode());
    expect(result.current.bulkMode.active).toBe(true);
    expect(result.current.compareMode.active).toBe(false);

    act(() => result.current.handleToggleCompareMode());
    expect(result.current.compareMode.active).toBe(true);
    expect(result.current.bulkMode.active).toBe(false);
  });

  it("both modes are never simultaneously active", () => {
    const { result } = renderHook(() => useCompareBulkPair());

    // Rapid toggling should never leave both modes active at once
    act(() => result.current.handleToggleCompareMode()); // enter compare
    act(() => result.current.handleToggleBulkMode()); // enter bulk (exits compare)
    act(() => result.current.handleToggleCompareMode()); // enter compare (exits bulk)
    act(() => result.current.handleToggleBulkMode()); // enter bulk again

    const neverBoth = !(
      result.current.compareMode.active && result.current.bulkMode.active
    );
    expect(neverBoth).toBe(true);
  });

  it("Select can be exited independently without affecting Compare state", () => {
    const { result } = renderHook(() => useCompareBulkPair());

    // Enter bulk, then exit bulk — compare should still be inactive
    act(() => result.current.handleToggleBulkMode());
    expect(result.current.bulkMode.active).toBe(true);

    act(() => result.current.handleToggleBulkMode()); // toggle off
    expect(result.current.bulkMode.active).toBe(false);
    expect(result.current.compareMode.active).toBe(false);
  });
});
