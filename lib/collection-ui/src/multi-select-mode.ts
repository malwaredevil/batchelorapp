import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Shared "toggle a mode, tap cards to select up to N, then act" state.
//
// Used for both the gallery "Select" bulk-action mode (e.g. bulk AI refresh)
// and the "Compare" side-by-side mode — two independent instances of the
// same interaction shape, first established in Pottery's gallery page.
// ---------------------------------------------------------------------------

export interface MultiSelectMode {
  active: boolean;
  selectedIds: number[];
  /** Toggle an id in the selection, capped at `maxItems`. */
  toggle: (id: number) => void;
  enter: () => void;
  /** Turn the mode off and clear the selection. */
  exit: () => void;
  selectAll: (ids: number[]) => void;
  clear: () => void;
  maxItems: number;
}

export function useMultiSelectMode(maxItems: number): MultiSelectMode {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const toggle = useCallback(
    (id: number) => {
      setSelectedIds((prev) =>
        prev.includes(id)
          ? prev.filter((x) => x !== id)
          : prev.length < maxItems
            ? [...prev, id]
            : prev,
      );
    },
    [maxItems],
  );

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    setSelectedIds([]);
  }, []);
  const selectAll = useCallback(
    (ids: number[]) => setSelectedIds(ids.slice(0, maxItems)),
    [maxItems],
  );
  const clear = useCallback(() => setSelectedIds([]), []);

  return {
    active,
    selectedIds,
    toggle,
    enter,
    exit,
    selectAll,
    clear,
    maxItems,
  };
}
