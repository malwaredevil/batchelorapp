import { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useListPottery,
  useListPotteryCategories as useListCategories,
  useBulkReanalyzePottery,
  useReanalyzePottery,
  getListPotteryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import { topMotifs } from "../lib/motifs";
import {
  PlusCircle,
  ScanSearch,
  Boxes,
  Pencil,
  Search,
  X,
  ArrowUpDown,
  GitCompare,
  Check,
  RefreshCw,
  MoreVertical,
  ExternalLink,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QuickEditSheet } from "@/components/quick-edit-sheet";
import { colorToHex } from "@/lib/colors";
import { usePageAssistantContext } from "@/lib/assistant-context";

// ---------------------------------------------------------------------------
// Collection compare modal
// ---------------------------------------------------------------------------
function CompareModal({
  items,
  onClose,
}: {
  items: PotteryItem[];
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl md:inset-x-4 md:top-20 md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
          <h2 className="font-bold tracking-tight">Side-by-side comparison</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-card-border"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <div
            className="grid h-full min-w-max gap-4 p-4"
            style={{
              gridTemplateColumns: `repeat(${items.length}, minmax(200px, 1fr))`,
            }}
          >
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-3">
                <Link href={`/piece/${item.id}`} onClick={onClose}>
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="aspect-square w-full rounded-xl object-cover border border-card-border hover:opacity-90 transition"
                  />
                </Link>
                <div className="space-y-1.5 text-sm">
                  <p className="font-semibold leading-tight">{item.name}</p>
                  {item.shape && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Shape:
                      </span>{" "}
                      {item.shape}
                    </p>
                  )}
                  {item.style && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Style:
                      </span>{" "}
                      {item.style}
                    </p>
                  )}
                  {item.maker && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Maker:
                      </span>{" "}
                      {item.maker}
                    </p>
                  )}
                  {item.dimensions && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Size:</span>{" "}
                      {item.dimensions}
                    </p>
                  )}
                  {item.dominantColors.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.dominantColors.map((c, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 text-xs"
                        >
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-black/10"
                            style={{ backgroundColor: c }}
                          />
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.motifs.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.motifs.map((m, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {item.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {[...item.categories]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((cat) => (
                          <Badge
                            key={cat.id}
                            variant="outline"
                            className={cn(
                              "text-xs",
                              cat.bgColor && "border-transparent",
                            )}
                            style={
                              cat.bgColor
                                ? {
                                    backgroundColor: cat.bgColor,
                                    color: cat.textColor ?? "#fff",
                                  }
                                : undefined
                            }
                          >
                            {cat.name}
                          </Badge>
                        ))}
                    </div>
                  )}
                  {item.patternDescription && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                      {item.patternDescription}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// PieceCard
// ---------------------------------------------------------------------------
function PieceCard({
  item,
  selecting,
  selected,
  onToggleSelect,
  onQuickEdit,
  onReanalyze,
  onColorFilter,
  activeColor,
}: {
  item: PotteryItem;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onQuickEdit: (item: PotteryItem) => void;
  onReanalyze: (id: number) => void;
  onColorFilter: (color: string) => void;
  activeColor: string | null;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  return (
    <div className="relative group">
      {/* Selection checkbox */}
      {selecting && (
        <button
          type="button"
          onClick={() => onToggleSelect(item.id)}
          className={cn(
            "absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full border-2 transition",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-white/80 bg-black/30 text-transparent hover:border-primary",
          )}
          aria-label={selected ? "Deselect" : "Select for comparison"}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* Card actions menu */}
      {!selecting && (
        <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur"
                aria-label="Options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={`/piece/${item.id}`}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  onQuickEdit(item);
                }}
                data-testid={`button-quick-edit-${item.id}`}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Quick edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onReanalyze(item.id)}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Refresh AI
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <Link
        href={selecting ? "#" : `/piece/${item.id}`}
        onClick={
          selecting
            ? (e) => {
                e.preventDefault();
                onToggleSelect(item.id);
              }
            : undefined
        }
        className={cn(
          "block overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md",
          selected
            ? "border-primary ring-2 ring-primary/30"
            : "border-card-border",
        )}
        data-testid={`card-piece-${item.id}`}
      >
        <div className="aspect-square overflow-hidden bg-muted">
          <img
            src={item.imageUrl}
            alt={item.name}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            style={{ filter: imgLoaded ? "none" : "blur(8px)", transition: "filter 0.4s ease" }}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        </div>
        <div className="space-y-1.5 p-3">
          <p
            className="truncate font-medium text-sm"
            data-testid={`text-piece-name-${item.id}`}
          >
            {item.name}
          </p>
          {item.categories.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {[...item.categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((cat) => (
                  <Badge
                    key={cat.id}
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      cat.bgColor && "border-transparent",
                    )}
                    style={
                      cat.bgColor
                        ? {
                            backgroundColor: cat.bgColor,
                            color: cat.textColor ?? "#fff",
                          }
                        : undefined
                    }
                  >
                    {cat.name}
                  </Badge>
                ))}
            </div>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-dashed text-muted-foreground/70"
            >
              Uncategorized
            </Badge>
          )}
          {item.dominantColors.length > 0 && (
            <div className="flex items-center gap-1">
              {item.dominantColors.slice(0, 5).map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onColorFilter(c);
                  }}
                  className={cn(
                    "h-3.5 w-3.5 rounded-full border transition hover:scale-125 focus:outline-none",
                    activeColor === c
                      ? "border-primary ring-2 ring-primary/50 scale-125"
                      : "border-black/15 hover:border-black/30",
                  )}
                  style={{ backgroundColor: colorToHex(c) }}
                  title={`Filter by ${c}`}
                  aria-label={`Filter by ${c}`}
                />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-1">
            {item.shape ? (
              <p className="truncate text-xs text-muted-foreground">
                {item.shape}
              </p>
            ) : (
              <span />
            )}
            {(item.quantity ?? 1) > 1 && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                ×{item.quantity}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatBar
// ---------------------------------------------------------------------------
function StatBar({
  filteredItems,
  totalCount,
  categoriesCount,
}: {
  filteredItems: PotteryItem[];
  totalCount: number;
  categoriesCount: number;
}) {
  const motifs = useMemo(() => topMotifs(filteredItems, 3), [filteredItems]);
  if (totalCount === 0) return null;

  const totalQuantity = filteredItems.reduce(
    (sum, item) => sum + (item.quantity ?? 1),
    0,
  );
  const isFiltered = filteredItems.length !== totalCount;

  return (
    <div className="mb-4 hidden sm:grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <p className="text-2xl font-bold" data-testid="text-total-items">
          {totalQuantity}
        </p>
        <p className="text-sm font-medium mt-0.5">
          {totalQuantity === 1 ? "Piece" : "Pieces"}
        </p>
        <p className="text-xs text-muted-foreground">
          total owned
          {isFiltered && (
            <span className="ml-1 text-muted-foreground/60">filtered</span>
          )}
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4">
        <p className="text-2xl font-bold">{filteredItems.length}</p>
        <p className="text-sm font-medium mt-0.5">Unique</p>
        <p className="text-xs text-muted-foreground">
          distinct items
          {isFiltered && (
            <span className="ml-1 text-muted-foreground/60">filtered</span>
          )}
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4">
        <p className="text-2xl font-bold">{categoriesCount}</p>
        <p className="text-sm font-medium mt-0.5">Categories</p>
        <p className="text-xs text-muted-foreground">in collection</p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4">
        <p className="text-sm font-medium mb-1">Top motifs</p>
        <p className="truncate text-xs text-muted-foreground">
          {motifs.length ? motifs.map((m) => m.label).join(" · ") : "—"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
function EmptyState() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-card-border bg-card/50 px-6 py-14 text-center">
      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-muted">
        <Boxes className="h-7 w-7 text-primary" />
      </div>
      <h2 className="text-xl font-bold tracking-tight">
        Your collection is empty
      </h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
        Add photos of your pottery to start cataloguing. Each piece is analyzed
        so you can spot duplicates later.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild data-testid="button-add-first">
          <Link href="/add">
            <PlusCircle className="h-4 w-4" />
            Add your first piece
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/compare">
            <ScanSearch className="h-4 w-4" />
            Compare a photo
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------
type SortKey =
  | "added-desc"
  | "added-asc"
  | "acquired-desc"
  | "acquired-asc"
  | "name-asc"
  | "name-desc"
  | "quantity-desc"
  | "quantity-asc"
  | "maker-asc"
  | "maker-desc"
  | "size-desc"
  | "size-asc";

const SORT_GROUPS: { label: string; keys: [SortKey, SortKey] }[] = [
  { label: "Added", keys: ["added-desc", "added-asc"] },
  { label: "Acquired", keys: ["acquired-desc", "acquired-asc"] },
  { label: "Name", keys: ["name-asc", "name-desc"] },
  { label: "Quantity", keys: ["quantity-desc", "quantity-asc"] },
  { label: "Maker", keys: ["maker-asc", "maker-desc"] },
  { label: "Size", keys: ["size-desc", "size-asc"] },
];

const SORT_LABELS: Record<SortKey, string> = {
  "added-desc": "Newest first",
  "added-asc": "Oldest first",
  "acquired-desc": "Newest first",
  "acquired-asc": "Oldest first",
  "name-asc": "A → Z",
  "name-desc": "Z → A",
  "quantity-desc": "Most first",
  "quantity-asc": "Fewest first",
  "maker-asc": "A → Z",
  "maker-desc": "Z → A",
  "size-desc": "Largest first",
  "size-asc": "Smallest first",
};

const SORT_BUTTON_LABELS: Record<SortKey, string> = {
  "added-desc": "Added ↓",
  "added-asc": "Added ↑",
  "acquired-desc": "Acquired ↓",
  "acquired-asc": "Acquired ↑",
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  "quantity-desc": "Qty ↓",
  "quantity-asc": "Qty ↑",
  "maker-asc": "Maker A→Z",
  "maker-desc": "Maker Z→A",
  "size-desc": "Size ↓",
  "size-asc": "Size ↑",
};

/** Pull the first number out of a dimensions string, e.g. "H 14 cm × D 22 cm" → 14 */
function extractFirstNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

/** Push nulls / empty values to the bottom regardless of direction. */
function nullsLast(
  a: string | null | undefined,
  b: string | null | undefined,
  asc: boolean,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return asc ? a.localeCompare(b) : b.localeCompare(a);
}

function sortItems(items: PotteryItem[], key: SortKey): PotteryItem[] {
  return [...items].sort((a, b) => {
    switch (key) {
      case "added-desc":
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case "added-asc":
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      case "acquired-desc": {
        const ta = a.acquiredAt ? new Date(a.acquiredAt).getTime() : -Infinity;
        const tb = b.acquiredAt ? new Date(b.acquiredAt).getTime() : -Infinity;
        if (!a.acquiredAt && !b.acquiredAt) return 0;
        if (!a.acquiredAt) return 1;
        if (!b.acquiredAt) return -1;
        return tb - ta;
      }
      case "acquired-asc": {
        if (!a.acquiredAt && !b.acquiredAt) return 0;
        if (!a.acquiredAt) return 1;
        if (!b.acquiredAt) return -1;
        return (
          new Date(a.acquiredAt).getTime() - new Date(b.acquiredAt).getTime()
        );
      }
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "quantity-desc":
        return (b.quantity ?? 1) - (a.quantity ?? 1);
      case "quantity-asc":
        return (a.quantity ?? 1) - (b.quantity ?? 1);
      case "maker-asc":
        return nullsLast(a.maker, b.maker, true);
      case "maker-desc":
        return nullsLast(a.maker, b.maker, false);
      case "size-desc": {
        const sa = extractFirstNumber(a.dimensions);
        const sb = extractFirstNumber(b.dimensions);
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sb - sa;
      }
      case "size-asc": {
        const sa = extractFirstNumber(a.dimensions);
        const sb = extractFirstNumber(b.dimensions);
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sa - sb;
      }
      default:
        return 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Main Collection page
// ---------------------------------------------------------------------------
export default function Collection() {
  const [, navigate] = useLocation();
  const locationSearch = useSearch();
  const { data, isLoading, isError } = useListPottery();
  const { data: allCategories = [] } = useListCategories();

  const [search, setSearch] = useState("");
  const [filterCategoryIds, setFilterCategoryIds] = useState<
    Set<number | "none">
  >(new Set());
  const [filterColor, setFilterColor] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("added-desc");
  const [groupByMaker, setGroupByMaker] = useState(false);
  const [pageSize, setPageSize] = useState<number>(() => {
    const s = localStorage.getItem("pottery-page-size");
    return s ? parseInt(s, 10) : 20;
  });
  const [page, setPage] = useState(1);

  // On mount: read ?cat=ID, ?color=..., and ?search=... query params so
  // external links (e.g. from Elaine cross-app navigation) can pre-filter the
  // collection. All params are consumed and cleaned from the URL immediately.
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const catParam = params.get("cat");
    const colorParam = params.get("color");
    const searchParam = params.get("search");
    if (catParam) {
      const id = parseInt(catParam, 10);
      if (!isNaN(id)) setFilterCategoryIds(new Set([id]));
    }
    if (colorParam) {
      setFilterColor(decodeURIComponent(colorParam));
    }
    if (searchParam) {
      setSearch(decodeURIComponent(searchParam));
    }
    if (catParam || colorParam || searchParam) {
      navigate("/", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save scroll position when leaving the page so we can restore it on return
  useEffect(() => {
    return () => {
      sessionStorage.setItem("collection-scroll-y", String(window.scrollY));
    };
  }, []);

  // Restore scroll position once data has loaded and the list has rendered
  useEffect(() => {
    if (!data) return;
    const saved = sessionStorage.getItem("collection-scroll-y");
    if (!saved) return;
    sessionStorage.removeItem("collection-scroll-y");
    const y = parseInt(saved, 10);
    if (Number.isFinite(y) && y > 0) {
      requestAnimationFrame(() =>
        window.scrollTo({ top: y, behavior: "instant" }),
      );
    }
  }, [data]);

  // Only show categories that are assigned to at least one item in the full collection.
  // Computed from the unfiltered data so the list stays stable once a filter is active.
  const usedCategories = useMemo(() => {
    if (!data) return allCategories;
    const usedIds = new Set<number>();
    for (const item of data) {
      for (const c of item.categories) usedIds.add(c.id);
    }
    return allCategories.filter((cat) => usedIds.has(cat.id));
  }, [data, allCategories]);

  // Collect unique colors across the full collection, ordered by frequency (desc)
  const usedColors = useMemo(() => {
    if (!data) return [];
    const freq = new Map<string, number>();
    for (const item of data) {
      for (const c of item.dominantColors) {
        freq.set(c, (freq.get(c) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color);
  }, [data]);

  const [sortOpen, setSortOpen] = useState(false);

  // Quick edit
  const [quickEditItem, setQuickEditItem] = useState<PotteryItem | null>(null);

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 5
          ? [...prev, id]
          : prev,
    );
  }

  function exitCompareMode() {
    setCompareMode(false);
    setSelectedIds([]);
  }

  // Bulk reanalyze mode
  const queryClient = useQueryClient();
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(
    new Set(),
  );
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const { mutateAsync: bulkReanalyze, isPending: isBulkPending } =
    useBulkReanalyzePottery();

  const { mutate: reanalyzeItem } = useReanalyzePottery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
      },
    },
  });

  function handleReanalyze(id: number) {
    reanalyzeItem({ id });
  }

  function toggleBulkSelect(id: number) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  }

  function exitBulkMode() {
    setBulkMode(false);
    setBulkSelectedIds(new Set());
    setBulkStatus(null);
  }

  async function runBulkReanalyze() {
    if (bulkSelectedIds.size === 0) return;
    setBulkStatus("Analysing…");
    try {
      const result = await bulkReanalyze({
        data: { ids: [...bulkSelectedIds] },
      });
      await queryClient.invalidateQueries({
        queryKey: getListPotteryQueryKey(),
      });
      setBulkStatus(
        `Done — ${result.succeeded.length} refreshed${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
      );
      setBulkSelectedIds(new Set());
    } catch {
      setBulkStatus("Something went wrong. Please try again.");
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    let result = data;

    // Category filter — AND logic: item must have every selected category.
    // "none" is treated as exclusive (show uncategorized items only when it is
    // the sole selection; real category IDs take precedence when mixed).
    if (filterCategoryIds.size > 0) {
      const realIds = [...filterCategoryIds].filter(
        (id): id is number => id !== "none",
      );
      const noneOnly = filterCategoryIds.has("none") && realIds.length === 0;
      result = result.filter((item) => {
        if (noneOnly) return item.categories.length === 0;
        return realIds.every((id) => item.categories.some((c) => c.id === id));
      });
    }

    // Color filter
    if (filterColor !== null) {
      result = result.filter((item) =>
        item.dominantColors.includes(filterColor),
      );
    }

    // Keyword search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.patternDescription ?? "").toLowerCase().includes(q) ||
          (item.style ?? "").toLowerCase().includes(q) ||
          (item.shape ?? "").toLowerCase().includes(q) ||
          (item.maker ?? "").toLowerCase().includes(q) ||
          item.motifs.some((m) => m.toLowerCase().includes(q)),
      );
    }

    return sortItems(result, sort);
  }, [data, filterCategoryIds, filterColor, search, sort]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [filtered.length, sort]);

  const selectedItems = useMemo(
    () => (data ?? []).filter((item) => selectedIds.includes(item.id)),
    [data, selectedIds],
  );

  const makerGroups = useMemo(() => {
    if (!groupByMaker) return null;
    const groups = new Map<string, PotteryItem[]>();
    for (const item of filtered) {
      const key = item.maker || "Unknown maker";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "Unknown maker") return 1;
      if (b === "Unknown maker") return -1;
      return a.localeCompare(b);
    });
  }, [groupByMaker, filtered]);

  usePageAssistantContext(
    "pottery-collection",
    isLoading
      ? undefined
      : `Pottery Collection page: browsing the household's pottery collection (${data?.length ?? 0} unique piece(s), ${usedCategories.length} categor(y/ies) in use). ${
          filtered.length !== (data?.length ?? 0)
            ? `Currently filtered to ${filtered.length} piece(s)${search.trim() ? ` matching search "${search.trim()}"` : ""}. `
            : ""
        }Visible pieces (itemId: name — key details): ${filtered
          .slice(0, 40)
          .map(
            (item) =>
              `itemId: ${item.id} — "${item.name}"${item.maker ? `, maker: ${item.maker}` : ""}${item.style ? `, style: ${item.style}` : ""}${item.shape ? `, shape: ${item.shape}` : ""}${(item.quantity ?? 1) > 1 ? `, qty: ${item.quantity}` : ""}${item.categories.length ? `, categories: ${item.categories.map((c) => c.name).join(", ")} (categoryIds: ${item.categories.map((c) => c.id).join(", ")})` : ""}`,
          )
          .join("; ")}${filtered.length > 40 ? "; (list truncated, more pieces exist)" : ""}. Available category ids for filtering/assignment: ${usedCategories.map((c) => `${c.name}=${c.id}`).join(", ") || "none"}.`,
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Collection</h1>
          <p className="text-sm font-medium text-muted-foreground">
            Everything you own, in one place
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!compareMode && !bulkMode ? (
            <>
              {data && data.length >= 2 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCompareMode(true)}
                  data-testid="button-compare-mode"
                >
                  <GitCompare className="h-4 w-4" />
                  <span className="hidden sm:inline">Compare</span>
                </Button>
              )}
              {data && data.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkMode(true)}
                  data-testid="button-bulk-reanalyze-mode"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span className="hidden sm:inline">Select</span>
                </Button>
              )}
              <Button
                asChild
                className="hidden sm:inline-flex"
                data-testid="button-add-piece"
              >
                <Link href="/add">
                  <PlusCircle className="h-4 w-4" />
                  Add piece
                </Link>
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={compareMode ? exitCompareMode : exitBulkMode}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <>
          <div className="mb-4 hidden sm:grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-[88px] rounded-xl" />
            <Skeleton className="h-[88px] rounded-xl" />
            <Skeleton className="h-[88px] rounded-xl" />
            <Skeleton className="h-[88px] rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
            ))}
          </div>
        </>
      ) : isError ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Could not load your collection. Please refresh.
        </p>
      ) : !data || data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <StatBar
            filteredItems={filtered}
            totalCount={data.length}
            categoriesCount={usedCategories.length}
          />

          {/* Search + Sort */}
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, pattern, shape, era…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Group by Maker toggle */}
            <Button
              variant={groupByMaker ? "secondary" : "outline"}
              size="icon"
              title={groupByMaker ? "Ungroup" : "Group by maker"}
              onClick={() => setGroupByMaker((g) => !g)}
              className="shrink-0"
              data-testid="button-group-by-maker"
            >
              <Users className="h-4 w-4" />
            </Button>

            {/* Sort dropdown */}
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setSortOpen((o) => !o)}
                className="shrink-0 gap-1.5 pl-2.5 pr-3"
                title="Sort collection"
                data-testid="button-sort"
              >
                <ArrowUpDown className="h-4 w-4 shrink-0" />
                <span className="hidden text-sm sm:inline">
                  {SORT_BUTTON_LABELS[sort]}
                </span>
              </Button>
              {sortOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setSortOpen(false)}
                    aria-hidden
                  />
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-card-border bg-card shadow-lg">
                    <div className="max-h-[min(26rem,80vh)] overflow-y-auto">
                      {SORT_GROUPS.map((group, gi) => (
                        <div key={group.label}>
                          {gi > 0 && (
                            <div className="mx-3 border-t border-card-border" />
                          )}
                          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {group.label}
                          </p>
                          {group.keys.map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setSort(key);
                                setSortOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-2 text-sm transition hover:bg-muted",
                                sort === key && "text-primary font-medium",
                              )}
                            >
                              {sort === key ? (
                                <Check className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <span className="w-3.5 shrink-0" />
                              )}
                              {SORT_LABELS[key]}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Page size selector */}
            <div className="flex items-center gap-0.5">
              {([20, 50, 100, 0] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { const v = n; localStorage.setItem("pottery-page-size", String(v)); setPageSize(v); setPage(1); }}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${pageSize === n ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background text-muted-foreground hover:bg-accent"}`}
                >
                  {n === 0 ? "All" : n}
                </button>
              ))}
            </div>
          </div>

          {/* Color filter circles — shown only when the collection has colour data */}
          {usedColors.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {usedColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() =>
                    setFilterColor(filterColor === color ? null : color)
                  }
                  className={cn(
                    "h-5 w-5 rounded-full border-2 transition hover:scale-110 focus:outline-none shadow-sm",
                    filterColor === color
                      ? "border-primary ring-2 ring-primary/50 scale-110"
                      : "border-black/20 hover:border-black/40",
                  )}
                  style={{ backgroundColor: colorToHex(color) }}
                  title={color}
                  aria-label={`Filter by ${color}`}
                  aria-pressed={filterColor === color}
                />
              ))}
              {filterColor !== null && (
                <button
                  type="button"
                  onClick={() => setFilterColor(null)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Clear colour
                </button>
              )}
            </div>
          )}

          {/* Category filter pills — multiple can be selected (OR logic) */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilterCategoryIds(new Set())}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                filterCategoryIds.size === 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border bg-card text-muted-foreground hover:border-primary/40",
              )}
              data-testid="filter-all"
            >
              All
            </button>
            {usedCategories.map((cat) => {
              const active = filterCategoryIds.has(cat.id);
              const hasBg = !!cat.bgColor;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() =>
                    setFilterCategoryIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat.id)) next.delete(cat.id);
                      else next.add(cat.id);
                      return next;
                    })
                  }
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
                          backgroundColor: active
                            ? cat.bgColor!
                            : "transparent",
                          color: active
                            ? (cat.textColor ?? "#fff")
                            : cat.bgColor!,
                          borderColor: cat.bgColor!,
                        }
                      : undefined
                  }
                  data-testid={`filter-cat-${cat.id}`}
                >
                  {cat.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setFilterCategoryIds((prev) => {
                  const next = new Set(prev);
                  if (next.has("none")) next.delete("none");
                  else next.add("none");
                  return next;
                })
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                filterCategoryIds.has("none")
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border bg-card text-muted-foreground hover:border-primary/40",
              )}
              data-testid="filter-none"
            >
              Uncategorized
            </button>
          </div>

          {compareMode && (
            <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary">
              {selectedIds.length === 0
                ? "Tap up to 5 pieces to compare them side by side."
                : `${selectedIds.length} selected${selectedIds.length === 5 ? " (max)" : ""}`}
            </div>
          )}

          {bulkMode && (
            <div className="mb-3 rounded-xl border border-amber-300/50 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {bulkStatus ??
                (bulkSelectedIds.size === 0
                  ? "Select up to 20 pieces to refresh their AI analysis."
                  : `${bulkSelectedIds.size} selected${bulkSelectedIds.size === 20 ? " (max)" : ""}`)}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No pieces match your search.{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => {
                  setSearch("");
                  setFilterCategoryIds(new Set());
                  setFilterColor(null);
                }}
              >
                Clear filters
              </button>
            </div>
          ) : makerGroups ? (
            <div className="space-y-6">
              {makerGroups.map(([maker, items]) => (
                <div key={maker}>
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{maker}</h3>
                    <span className="text-xs text-muted-foreground">{items.length} piece{items.length !== 1 ? "s" : ""}</span>
                    <div className="flex-1 border-t border-card-border" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {items.map((item) => (
                      <PieceCard
                        key={item.id}
                        item={item}
                        selecting={compareMode || bulkMode}
                        selected={bulkMode ? bulkSelectedIds.has(item.id) : selectedIds.includes(item.id)}
                        onToggleSelect={bulkMode ? toggleBulkSelect : toggleSelect}
                        onQuickEdit={setQuickEditItem}
                        onReanalyze={handleReanalyze}
                        onColorFilter={(c) => setFilterColor(filterColor === c ? null : c)}
                        activeColor={filterColor}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {paged.map((item) => (
                <PieceCard
                  key={item.id}
                  item={item}
                  selecting={compareMode || bulkMode}
                  selected={
                    bulkMode
                      ? bulkSelectedIds.has(item.id)
                      : selectedIds.includes(item.id)
                  }
                  onToggleSelect={bulkMode ? toggleBulkSelect : toggleSelect}
                  onQuickEdit={setQuickEditItem}
                  onReanalyze={handleReanalyze}
                  onColorFilter={(c) =>
                    setFilterColor(filterColor === c ? null : c)
                  }
                  activeColor={filterColor}
                />
              ))}
            </div>
          )}
          {/* Pagination controls */}
          {!groupByMaker && totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Compare floating bar */}
      {compareMode && selectedIds.length >= 2 && (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-3 rounded-full border border-primary/30 bg-background/95 px-5 py-3 shadow-xl backdrop-blur">
            <span className="text-sm font-medium text-muted-foreground">
              {selectedIds.length} pieces selected
            </span>
            <Button
              size="sm"
              onClick={() => setShowCompareModal(true)}
              data-testid="button-open-compare"
            >
              <GitCompare className="h-4 w-4" />
              Compare
            </Button>
          </div>
        </div>
      )}

      {/* Bulk reanalyze floating bar */}
      {bulkMode &&
        bulkSelectedIds.size > 0 &&
        !isBulkPending &&
        !bulkStatus && (
          <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6">
            <div className="flex items-center gap-3 rounded-full border border-amber-300/60 bg-background/95 px-5 py-3 shadow-xl backdrop-blur">
              <span className="text-sm font-medium text-muted-foreground">
                {bulkSelectedIds.size} selected
              </span>
              <Button
                size="sm"
                onClick={runBulkReanalyze}
                data-testid="button-bulk-reanalyze-run"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh AI ({bulkSelectedIds.size})
              </Button>
            </div>
          </div>
        )}

      {/* Bulk pending bar */}
      {isBulkPending && (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-2 rounded-full border border-amber-300/60 bg-background/95 px-5 py-3 shadow-xl backdrop-blur">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
            <span className="text-sm font-medium">Analysing…</span>
          </div>
        </div>
      )}

      {/* Quick edit sheet */}
      {quickEditItem && (
        <QuickEditSheet
          item={quickEditItem}
          onClose={() => setQuickEditItem(null)}
          onDeleted={() => setQuickEditItem(null)}
        />
      )}

      {/* Collection compare modal */}
      {showCompareModal && (
        <CompareModal
          items={selectedItems}
          onClose={() => setShowCompareModal(false)}
        />
      )}
    </div>
  );
}
