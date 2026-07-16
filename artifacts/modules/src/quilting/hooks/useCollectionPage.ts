import { useState, useMemo, useEffect } from "react";

export type SortOption = "newest" | "oldest" | "az" | "za";

export const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Name A → Z",
  za: "Name Z → A",
};

export interface CollectionPageItem {
  id: number;
  name: string;
  createdAt: Date | string;
  categories?: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  dominantColors?: string[];
}

export interface UseCollectionPageOptions<T extends CollectionPageItem> {
  /** All items returned by the server (unfiltered). */
  items: T[] | null | undefined;
  /** localStorage key for persisting pageSize across sessions. */
  localStorageKey: string;
  /**
   * How to decide whether an item matches the text search. The `query` string
   * is already lowercased and trimmed; return true to include the item.
   */
  searchMatch: (item: T, query: string) => boolean;
  /**
   * Optional extra predicate applied after the common search/category/color
   * filters. Use this for domain-specific filters (e.g. difficulty, recipient).
   */
  extraFilter?: (item: T) => boolean;
  /**
   * Whether any domain-specific filter is currently active. Contributes to
   * `hasFilter` (which drives the "X of N items" subtitle) and `resetFilters`.
   */
  extraHasFilter?: boolean;
  /**
   * Called inside `resetFilters` to clear domain-specific filter state.
   */
  extraResetFilters?: () => void;
}

export function useCollectionPage<T extends CollectionPageItem>(
  options: UseCollectionPageOptions<T>,
) {
  const {
    items,
    localStorageKey,
    searchMatch,
    extraFilter,
    extraHasFilter = false,
    extraResetFilters,
  } = options;

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>("newest");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [paletteMatchOpen, setPaletteMatchOpen] = useState(false);
  const [pageSize, setPageSizeState] = useState<number>(() => {
    const saved = localStorage.getItem(localStorageKey);
    return saved ? parseInt(saved, 10) : 20;
  });
  const [page, setPage] = useState(1);

  function setPageSize(n: number) {
    localStorage.setItem(localStorageKey, String(n));
    setPageSizeState(n);
    setPage(1);
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBulkMode() {
    setIsBulkMode((v) => !v);
    setSelectedIds(new Set());
  }

  const usedColors = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items ?? []) {
      for (const c of item.dominantColors ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          result.push(c);
        }
      }
    }
    return result;
  }, [items]);

  const allCategories = useMemo(() => {
    if (!items) return [];
    return Array.from(
      new Map(
        items.flatMap((item) => item.categories ?? []).map((c) => [c.id, c]),
      ).values(),
    );
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !q || searchMatch(item, q);
      const matchesCat =
        categoryFilter === null ||
        (item.categories ?? []).some((c) => c.id === categoryFilter);
      const matchesColor =
        colorFilter.length === 0 ||
        colorFilter.every((c) => (item.dominantColors ?? []).includes(c));
      const matchesExtra = !extraFilter || extraFilter(item);
      return matchesSearch && matchesCat && matchesColor && matchesExtra;
    });
  }, [items, search, categoryFilter, colorFilter, extraFilter, searchMatch]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    return [...filtered].sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name);
      if (sort === "za") return b.name.localeCompare(a.name);
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sort === "oldest" ? ta - tb : tb - ta;
    });
  }, [filtered, sort]);

  const totalPages =
    !sorted || pageSize === 0
      ? 1
      : Math.max(1, Math.ceil(sorted.length / pageSize));

  const paged = useMemo(() => {
    if (!sorted) return null;
    if (pageSize === 0) return sorted;
    return sorted.slice((page - 1) * pageSize, page * pageSize);
  }, [sorted, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, colorFilter, sort, extraHasFilter]);

  const hasFilter =
    search.trim().length > 0 ||
    categoryFilter !== null ||
    colorFilter.length > 0 ||
    extraHasFilter;

  function resetFilters() {
    setSearch("");
    setCategoryFilter(null);
    setColorFilter([]);
    extraResetFilters?.();
  }

  return {
    search,
    setSearch,
    categoryFilter,
    setCategoryFilter,
    colorFilter,
    setColorFilter,
    sort,
    setSort,
    isBulkMode,
    setIsBulkMode,
    selectedIds,
    setSelectedIds,
    paletteMatchOpen,
    setPaletteMatchOpen,
    pageSize,
    setPageSize,
    page,
    setPage,
    toggleSelect,
    toggleBulkMode,
    usedColors,
    allCategories,
    filtered,
    sorted,
    paged,
    totalPages,
    hasFilter,
    resetFilters,
  };
}
