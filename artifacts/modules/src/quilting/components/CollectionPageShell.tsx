import { Link } from "wouter";
import {
  PlusCircle,
  Search,
  X,
  SortAsc,
  SortDesc,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReactNode } from "react";
import { getCategoryPalette, colorToHex } from "@workspace/web-core";
import { CategoryEditDialog } from "@/quilting/components/CategoryEditDialog";
import { PaletteMatchModal } from "@/quilting/components/PaletteMatchModal";
import { CollectionErrorState } from "@/components/CollectionErrorState";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { SORT_LABELS } from "@/quilting/hooks/useCollectionPage";
import type {
  SortOption,
  CollectionPageItem,
} from "@/quilting/hooks/useCollectionPage";

interface StatsData {
  totalFabrics: number;
  totalPatterns: number;
  totalQuilts: number;
  totalBlocks: number;
  totalLayouts: number;
}

interface CollectionPageShellProps<T extends CollectionPageItem> {
  // Data
  items: T[] | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => Promise<unknown>;

  // Shared page state (from useCollectionPage)
  search: string;
  setSearch: (s: string) => void;
  categoryFilter: number | null;
  setCategoryFilter: (id: number | null) => void;
  colorFilter: string[];
  setColorFilter: React.Dispatch<React.SetStateAction<string[]>>;
  sort: SortOption;
  setSort: (s: SortOption) => void;
  isBulkMode: boolean;
  toggleBulkMode: () => void;
  selectedIds: Set<number>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  paletteMatchOpen: boolean;
  setPaletteMatchOpen: (open: boolean) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  usedColors: string[];
  allCategories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  sorted: T[] | null;
  paged: T[] | null;
  totalPages: number;
  hasFilter: boolean;
  resetFilters: () => void;

  // Copy
  title: string;
  singularNoun: string;
  pluralNoun: string;
  addHref: string;
  searchPlaceholder: string;
  emptyIcon: ReactNode;
  emptyDescription: string;
  errorNoun?: string;
  localStorageKey: string;

  // Bulk actions
  onBulkReanalyze: (ids: number[]) => void;
  isBulkReanalyzePending: boolean;

  // Card renderer
  renderCard: (item: T) => ReactNode;

  // Optional domain-specific filter pills inserted between color swatches and category pills
  domainFilterPills?: ReactNode;

  // Category edit dialog
  categoryEditItem: T | null;
  onCloseCategoryEdit: () => void;
  allCategoryApiList: QuiltingCategory[];
  onSaveCategories: (names: string[]) => void;
  isSavingCategories: boolean;

  // Palette match
  paletteMatchEntity: "pattern" | "quilt" | "fabric";

  // Optional stats bar
  stats?: StatsData;
}

export function CollectionPageShell<T extends CollectionPageItem>({
  items,
  isLoading,
  isError,
  onRetry,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  colorFilter,
  setColorFilter,
  sort,
  setSort,
  isBulkMode,
  toggleBulkMode,
  selectedIds,
  setSelectedIds,
  paletteMatchOpen,
  setPaletteMatchOpen,
  pageSize,
  setPageSize,
  page,
  setPage,
  usedColors,
  allCategories,
  sorted,
  paged,
  totalPages,
  hasFilter,
  resetFilters,
  title,
  singularNoun,
  pluralNoun,
  addHref,
  searchPlaceholder,
  emptyIcon,
  emptyDescription,
  errorNoun,
  localStorageKey,
  onBulkReanalyze,
  isBulkReanalyzePending,
  renderCard,
  domainFilterPills,
  categoryEditItem,
  onCloseCategoryEdit,
  allCategoryApiList,
  onSaveCategories,
  isSavingCategories,
  paletteMatchEntity,
  stats,
}: CollectionPageShellProps<T>) {
  const noun = errorNoun ?? pluralNoun;

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div className="mb-6 hidden sm:grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            {
              label: "Fabrics",
              value: stats.totalFabrics,
              sub: "in your stash",
              href: "/quilting/fabrics",
            },
            {
              label: "Patterns",
              value: stats.totalPatterns,
              sub: "saved",
              href: "/quilting/patterns",
            },
            {
              label: "Quilts",
              value: stats.totalQuilts,
              sub: "in collection",
              href: "/quilting/quilts",
            },
            {
              label: "Blocks",
              value: stats.totalBlocks,
              sub: "designed",
              href: "/quilting/blocks",
            },
            {
              label: "Layouts",
              value: stats.totalLayouts,
              sub: "arranged",
              href: "/quilting/layouts",
            },
          ].map(({ label, value, sub, href }) => (
            <Link
              key={label}
              href={href}
              className="rounded-xl border border-card-border bg-card p-4 block hover:shadow-sm hover:border-primary/30 transition-all"
            >
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">
                {label}
              </p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </Link>
          ))}
        </div>
      )}

      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {sorted
              ? hasFilter
                ? `${sorted.length} of ${items!.length} ${items!.length !== 1 ? pluralNoun : singularNoun}`
                : `${sorted.length} ${sorted.length !== 1 ? pluralNoun : singularNoun}`
              : `Your ${pluralNoun}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {items && items.length > 0 && (
            <Button
              variant={isBulkMode ? "secondary" : "outline"}
              size="sm"
              onClick={toggleBulkMode}
            >
              {isBulkMode ? "Done" : "Select"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaletteMatchOpen(true)}
            title={`Find ${pluralNoun} that match a photo's colour palette`}
          >
            <Sparkles className="mr-0 sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Match from photo</span>
          </Button>
          <Button asChild>
            <Link href={addHref}>
              <PlusCircle className="mr-0 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Add {singularNoun}</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Bulk mode action bar */}
      {isBulkMode && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="flex-1 text-sm font-medium">
            {selectedIds.size === 0
              ? "Tap cards to select"
              : `${selectedIds.size} selected`}
          </span>
          <button
            onClick={() =>
              sorted && setSelectedIds(new Set(sorted.map((i) => i.id)))
            }
            className="text-xs text-primary hover:underline"
          >
            All
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:underline"
          >
            None
          </button>
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              onClick={() => onBulkReanalyze(Array.from(selectedIds))}
              disabled={isBulkReanalyzePending}
            >
              <RefreshCw
                className={`mr-2 h-3.5 w-3.5 ${isBulkReanalyzePending ? "animate-spin" : ""}`}
              />
              Refresh AI ({selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {/* Search + sort + page size toolbar */}
      {items && items.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9 pr-9"
              />
              {search && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                >
                  {sort === "newest" || sort === "za" ? (
                    <SortDesc className="h-3.5 w-3.5" />
                  ) : (
                    <SortAsc className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setSort(s)}
                    className={sort === s ? "font-medium text-primary" : ""}
                  >
                    {SORT_LABELS[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center gap-0.5">
              {([20, 50, 100, 0] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPageSize(n)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    pageSize === n
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {n === 0 ? "All" : n}
                </button>
              ))}
            </div>
          </div>

          {/* Color swatches */}
          {usedColors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {usedColors.map((c) => (
                <button
                  key={c}
                  title={c}
                  onClick={() =>
                    setColorFilter((prev) =>
                      prev.includes(c)
                        ? prev.filter((x) => x !== c)
                        : [...prev, c],
                    )
                  }
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    colorFilter.includes(c)
                      ? "border-primary scale-110 ring-2 ring-primary/40"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: colorToHex(c) }}
                />
              ))}
              {colorFilter.length > 0 && (
                <button
                  onClick={() => setColorFilter([])}
                  className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear colour
                </button>
              )}
            </div>
          )}

          {/* Domain-specific + category filter pills */}
          {(domainFilterPills != null || allCategories.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {domainFilterPills}
              {allCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() =>
                    setCategoryFilter(categoryFilter === cat.id ? null : cat.id)
                  }
                  className="rounded-full border px-3 py-1 text-xs font-medium transition"
                  style={(() => {
                    const palette = cat.bgColor
                      ? {
                          bgColor: cat.bgColor,
                          textColor: cat.textColor ?? "#fff",
                        }
                      : getCategoryPalette(cat.name);
                    const active = categoryFilter === cat.id;
                    return {
                      backgroundColor: active ? palette.bgColor : "transparent",
                      color: active ? palette.textColor : palette.bgColor,
                      borderColor: palette.bgColor,
                    };
                  })()}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-card-border"
            >
              <Skeleton className="aspect-square w-full" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <CollectionErrorState
          onRetry={onRetry}
          message={`Couldn't load your ${noun}. Check your connection and try again.`}
        />
      )}

      {/* Empty collection state */}
      {sorted && sorted.length === 0 && items!.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          {emptyIcon}
          <div className="text-center">
            <p className="font-medium text-foreground">No {pluralNoun} yet</p>
            <p className="text-sm text-muted-foreground">{emptyDescription}</p>
          </div>
          <Button asChild>
            <Link href={addHref}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add {singularNoun}
            </Link>
          </Button>
        </div>
      )}

      {/* No-results state */}
      {sorted && sorted.length === 0 && items!.length > 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <Search className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No {pluralNoun} match your filters
          </p>
          <button
            onClick={resetFilters}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Item grid */}
      {paged && paged.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {paged.map((item) => renderCard(item))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Category edit dialog */}
      <CategoryEditDialog
        open={categoryEditItem !== null}
        onClose={onCloseCategoryEdit}
        title={categoryEditItem?.name ?? ""}
        currentCategories={
          (categoryEditItem?.categories ?? []) as unknown as QuiltingCategory[]
        }
        allCategories={allCategoryApiList}
        onSave={onSaveCategories}
        isSaving={isSavingCategories}
      />

      {/* Palette match modal */}
      <PaletteMatchModal
        entity={paletteMatchEntity}
        open={paletteMatchOpen}
        onClose={() => setPaletteMatchOpen(false)}
      />
    </div>
  );
}
