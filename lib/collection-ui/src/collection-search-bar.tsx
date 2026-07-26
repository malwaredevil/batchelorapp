import { useState, type ReactNode } from "react";
import { Search, X, ArrowUpDown, Check, LayoutGrid, List } from "lucide-react";
import { cn } from "@workspace/web-core/utils";

export interface SortOption<K extends string = string> {
  key: K;
  label: string;
  group?: string;
}

export interface CollectionCategory {
  id: number;
  name: string;
  bgColor?: string | null;
  textColor?: string | null;
}

export interface CollectionSearchBarProps<K extends string = string> {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  sort: K;
  onSortChange: (v: K) => void;
  sortOptions: SortOption<K>[];
  /** If provided, show view-mode toggle */
  viewMode?: "grid" | "list";
  onViewModeChange?: (v: "grid" | "list") => void;
  /** Category filter pills */
  categories?: CollectionCategory[];
  activeCategoryIds?: Set<number | "none">;
  onCategoryToggle?: (id: number | "none") => void;
  /** Color filter dots */
  colors?: string[];
  activeColor?: string | null;
  onColorToggle?: (color: string) => void;
  colorToHex?: (color: string) => string;
  /** Extra controls rendered after the search/sort row */
  extraControls?: ReactNode;
  /** Page size controls */
  pageSize?: number;
  onPageSizeChange?: (n: number) => void;
  pageSizeOptions?: number[];
  pageSizeStorageKey?: string;
}

export function CollectionSearchBar<K extends string>({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  sort,
  onSortChange,
  sortOptions,
  viewMode,
  onViewModeChange,
  categories = [],
  activeCategoryIds = new Set(),
  onCategoryToggle,
  colors = [],
  activeColor = null,
  onColorToggle,
  colorToHex,
  extraControls,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100, 0],
  pageSizeStorageKey,
}: CollectionSearchBarProps<K>) {
  const [sortOpen, setSortOpen] = useState(false);

  // Group sort options by group label
  const groups: { label: string; options: SortOption<K>[] }[] = [];
  for (const opt of sortOptions) {
    const g = opt.group ?? "";
    const existing = groups.find((x) => x.label === g);
    if (existing) existing.options.push(opt);
    else groups.push({ label: g, options: [opt] });
  }

  const currentSortLabel =
    sortOptions.find((o) => o.key === sort)?.label ?? "Sort";

  return (
    <div className="space-y-2">
      {/* Row: Search + extra controls + sort + view toggle */}
      <div className="flex gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-9 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {extraControls}

        {/* Page size */}
        {onPageSizeChange && pageSize !== undefined && (
          <div className="flex items-center gap-0.5">
            {pageSizeOptions.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  onPageSizeChange(n);
                  if (pageSizeStorageKey)
                    localStorage.setItem(pageSizeStorageKey, String(n));
                }}
                className={cn(
                  "px-2 py-1 text-xs rounded border transition-colors",
                  pageSize === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                {n === 0 ? "All" : n}
              </button>
            ))}
          </div>
        )}

        {/* Sort dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortOpen((o) => !o)}
            className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent"
            title="Sort"
          >
            <ArrowUpDown className="h-4 w-4 shrink-0" />
            <span className="hidden text-sm sm:inline">{currentSortLabel}</span>
          </button>
          {sortOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setSortOpen(false)}
                aria-hidden
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-card-border bg-card shadow-lg">
                <div className="max-h-[min(26rem,80vh)] overflow-y-auto">
                  {groups.map((group, gi) => (
                    <div key={group.label}>
                      {gi > 0 && (
                        <div className="mx-3 border-t border-card-border" />
                      )}
                      {group.label && (
                        <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </p>
                      )}
                      {group.options.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => {
                            onSortChange(opt.key);
                            setSortOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-sm transition hover:bg-muted",
                            sort === opt.key && "text-primary font-medium",
                          )}
                        >
                          {sort === opt.key ? (
                            <Check className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* View mode toggle */}
        {viewMode && onViewModeChange && (
          <div className="flex rounded-md border border-input overflow-hidden">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={cn(
                "flex h-9 w-9 items-center justify-center transition-colors",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent",
              )}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={cn(
                "flex h-9 w-9 items-center justify-center transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent",
              )}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Color filter dots */}
      {colors.length > 0 && onColorToggle && (
        <div className="flex flex-wrap items-center gap-2">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onColorToggle(color)}
              className={cn(
                "h-5 w-5 rounded-full border-2 transition hover:scale-110 focus:outline-none shadow-sm",
                activeColor === color
                  ? "border-primary ring-2 ring-primary/50 scale-110"
                  : "border-black/20 hover:border-black/40",
              )}
              style={{
                backgroundColor: colorToHex ? colorToHex(color) : color,
              }}
              title={color}
              aria-label={`Filter by ${color}`}
              aria-pressed={activeColor === color}
            />
          ))}
          {activeColor !== null && (
            <button
              type="button"
              onClick={() => onColorToggle(activeColor!)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear colour
            </button>
          )}
        </div>
      )}

      {/* Category filter pills */}
      {categories.length > 0 && onCategoryToggle && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              for (const id of [...activeCategoryIds])
                onCategoryToggle(id as number | "none");
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              activeCategoryIds.size === 0
                ? "border-primary bg-primary/10 text-primary"
                : "border-card-border bg-card text-muted-foreground hover:border-primary/40",
            )}
          >
            All
          </button>
          {categories.map((cat) => {
            const active = activeCategoryIds.has(cat.id);
            const hasBg = !!cat.bgColor;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onCategoryToggle(cat.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  !hasBg &&
                    (active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-card-border bg-card text-muted-foreground hover:border-primary/40"),
                  hasBg && "border",
                )}
                style={
                  hasBg
                    ? {
                        backgroundColor: active ? cat.bgColor! : "transparent",
                        color: active
                          ? (cat.textColor ?? "#fff")
                          : cat.bgColor!,
                        borderColor: cat.bgColor!,
                      }
                    : undefined
                }
              >
                {cat.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onCategoryToggle("none")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              activeCategoryIds.has("none")
                ? "border-primary bg-primary/10 text-primary"
                : "border-card-border bg-card text-muted-foreground hover:border-primary/40",
            )}
          >
            Uncategorized
          </button>
        </div>
      )}
    </div>
  );
}
