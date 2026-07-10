import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  Scissors,
  Search,
  X,
  MoreVertical,
  SortAsc,
  SortDesc,
  RefreshCw,
  CheckSquare,
  Square,
  Pencil,
  ExternalLink,
  Trash2,
  Download,
  ZoomIn,
  Tag,
  Camera,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useBulkAdd } from "@/quilting/contexts/bulk-add-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListFabrics,
  useDeleteFabric,
  useReanalyzeFabric,
  useBulkReanalyzeFabrics,
  getListFabricsQueryKey,
  getGetFabricQueryKey,
  useGetStats,
  useUpdateFabric,
  useListQuiltingCategories,
  useGetUsedFabricIds,
} from "@workspace/api-client-react";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { downloadCollectionImage } from "@/quilting/lib/svg-export";
import { colorToHex, getCategoryPalette } from "@workspace/web-core";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { CategoryEditDialog } from "@/quilting/components/CategoryEditDialog";
import { PaletteMatchModal } from "@/quilting/components/PaletteMatchModal";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

type SortOption = "newest" | "oldest" | "az" | "za";

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Name A → Z",
  za: "Name Z → A",
};

type FabricSummary = {
  id: number;
  name: string;
  imageUrl: string;
  quantity: number;
  quantityUnit: string;
  printType?: string | null;
  designer?: string | null;
  dominantColors: string[];
  motifs: string[];
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  createdAt: Date | string;
};

function FabricCard({
  fabric,
  onDelete,
  onReanalyze,
  isBulkMode,
  isSelected,
  onToggleSelect,
  onFilterByPrintType,
  onFilterByCategory,
  onFilterByColor,
  activeColor,
  onEditCategories,
}: {
  fabric: FabricSummary;
  onDelete: (id: number) => void;
  onReanalyze: (id: number) => void;
  isBulkMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onFilterByPrintType?: (pt: string) => void;
  onFilterByCategory?: (id: number) => void;
  onFilterByColor?: (c: string) => void;
  activeColor?: string[];
  onEditCategories?: () => void;
}) {
  const [, navigate] = useLocation();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  return (
    <>
      <div
        className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md"
        onClick={() => {
          if (isBulkMode) onToggleSelect(fabric.id);
        }}
      >
        {isBulkMode && (
          <div
            className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-colors ${isSelected ? "bg-primary text-primary-foreground" : "bg-background/90 text-muted-foreground"}`}
          >
            {isSelected ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </div>
        )}
        <Link
          href={`/quilting/fabrics/${fabric.id}`}
          className={`block ${isBulkMode ? "pointer-events-none" : ""}`}
        >
          <div className="relative aspect-square overflow-hidden bg-muted">
            <img
              src={fabric.imageUrl}
              alt={fabric.name}
              onLoad={() => setImgLoaded(true)}
              style={{
                filter: imgLoaded ? "none" : "blur(8px)",
                transition: "filter 0.4s ease",
              }}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setZoomOpen(true);
              }}
              className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
              title="Zoom preview"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-3 pr-8">
            <p className="truncate text-sm font-semibold text-foreground">
              {fabric.name}
            </p>
            {fabric.designer && (
              <p className="truncate text-xs text-muted-foreground">
                {fabric.designer}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {fabric.printType && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFilterByPrintType?.(fabric.printType!);
                  }}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
                >
                  {fabric.printType}
                </button>
              )}
              {(fabric.categories ?? []).map((cat) => (
                <button
                  key={cat.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFilterByCategory?.(cat.id);
                  }}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight transition-all hover:opacity-80 cursor-pointer"
                  style={(() => {
                    const p = cat.bgColor
                      ? {
                          bgColor: cat.bgColor,
                          textColor: cat.textColor ?? "#fff",
                        }
                      : getCategoryPalette(cat.name);
                    return { backgroundColor: p.bgColor, color: p.textColor };
                  })()}
                >
                  {cat.name}
                </button>
              ))}
              <span className="ml-auto text-xs font-medium text-primary shrink-0">
                {fabric.quantity} {fabric.quantityUnit}
              </span>
            </div>
            {fabric.dominantColors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {fabric.dominantColors.slice(0, 6).map((c, i) => (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onFilterByColor?.(c);
                    }}
                    title={c}
                    aria-label={`Filter by ${c}`}
                    aria-pressed={(activeColor ?? []).includes(c)}
                    className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                      (activeColor ?? []).includes(c)
                        ? "ring-2 ring-primary ring-offset-1 scale-110"
                        : "border-border/40"
                    }`}
                    style={{ backgroundColor: colorToHex(c) }}
                  />
                ))}
              </div>
            )}
          </div>
        </Link>

        {!isBulkMode && (
          <div className="absolute right-2 top-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full bg-background/80 opacity-100 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:opacity-100"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">Options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => navigate(`/quilting/fabrics/${fabric.id}`)}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    navigate(`/quilting/fabrics/${fabric.id}?edit=1`)
                  }
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReanalyze(fabric.id)}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh AI
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    downloadCollectionImage(fabric.imageUrl, fabric.name)
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Download photo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEditCategories?.()}>
                  <Tag className="mr-2 h-3.5 w-3.5" />
                  Set categories
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(fabric.id)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <PreviewZoomModal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={fabric.name}
      >
        <img
          src={fabric.imageUrl}
          alt={fabric.name}
          className="max-h-[85vh] max-w-[85vw] rounded object-contain"
          draggable={false}
        />
      </PreviewZoomModal>
    </>
  );
}

export default function Fabrics() {
  const [search, setSearch] = useState("");
  const [printTypeFilter, setPrintTypeFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>("newest");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [stashBustMode, setStashBustMode] = useState(false);
  const [pageSize, setPageSize] = useState<number>(() => {
    const s = localStorage.getItem("quilting-fabrics-page-size");
    return s ? parseInt(s, 10) : 20;
  });
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { pendingItems } = useBulkAdd();
  const uploadingItems = pendingItems.filter((i) => i.status === "uploading");
  const {
    data: fabricsData,
    isLoading,
    isError,
  } = useListFabrics({ pageSize: 200 });
  const fabrics = fabricsData?.items ?? [];
  const { data: usedFabricIds } = useGetUsedFabricIds({
    query: {
      enabled: stashBustMode,
      queryKey: ["quilting", "fabrics", "used-ids"],
    },
  });
  const { data: stats } = useGetStats();
  const [categoryEditItem, setCategoryEditItem] =
    useState<FabricSummary | null>(null);
  const [paletteMatchOpen, setPaletteMatchOpen] = useState(false);
  const { data: categoryApiList } = useListQuiltingCategories();

  const updateFabricCategories = useUpdateFabric({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        setCategoryEditItem(null);
        toast.success("Categories saved");
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  const deleteFabric = useDeleteFabric({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("Fabric deleted");
      },
      onError: () => toast.error("Failed to delete fabric."),
    },
  });

  const reanalyzeFabric = useReanalyzeFabric({
    mutation: {
      onSuccess: (data, { id }) => {
        queryClient.setQueryData(getGetFabricQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: () => toast.error("Failed to refresh AI analysis."),
    },
  });

  const bulkReanalyze = useBulkReanalyzeFabrics({
    mutation: {
      onSuccess: ({ succeeded, failed }) => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        setSelectedIds(new Set());
        setIsBulkMode(false);
        if (failed.length === 0) {
          toast.success(
            `Refreshed AI for ${succeeded.length} fabric${succeeded.length !== 1 ? "s" : ""}`,
          );
        } else {
          toast.success(
            `Refreshed ${succeeded.length}, failed ${failed.length}`,
          );
        }
      },
      onError: () => toast.error("Bulk refresh failed."),
    },
  });

  function handleDelete(id: number) {
    if (!confirm("Delete this fabric? This cannot be undone.")) return;
    deleteFabric.mutate({ id });
  }

  function handleReanalyze(id: number) {
    reanalyzeFabric.mutate({ id });
    toast.info("Refreshing AI analysis…");
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

  function selectAll() {
    if (sorted) setSelectedIds(new Set(sorted.map((f) => f.id)));
  }

  const printTypes =
    fabrics && fabrics.length > 0
      ? Array.from(
          new Set(
            fabrics
              .map((f) => f.printType)
              .filter((t): t is string => Boolean(t)),
          ),
        ).sort()
      : [];

  const allCategories = fabrics
    ? Array.from(
        new Map(
          (fabrics as FabricSummary[])
            .flatMap((f) => f.categories ?? [])
            .map((c) => [c.id, c]),
        ).values(),
      )
    : [];

  const usedColors = useMemo(() => {
    if (!fabrics || fabrics.length === 0) return [];
    const freq = new Map<string, number>();
    for (const f of fabrics as FabricSummary[]) {
      for (const c of f.dominantColors ?? []) {
        freq.set(c, (freq.get(c) ?? 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color);
  }, [fabrics]);

  const filtered = fabrics
    ? (fabrics as FabricSummary[]).filter((f) => {
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          f.name.toLowerCase().includes(q) ||
          (f.designer ?? "").toLowerCase().includes(q) ||
          (f.printType ?? "").toLowerCase().includes(q);
        const matchesType = !printTypeFilter || f.printType === printTypeFilter;
        const matchesCat =
          categoryFilter === null ||
          (f.categories ?? []).some((c) => c.id === categoryFilter);
        const matchesColor =
          colorFilter.length === 0 ||
          colorFilter.every((c) => (f.dominantColors ?? []).includes(c));
        const matchesStash =
          !stashBustMode || !(usedFabricIds ?? []).includes(f.id);
        return (
          matchesSearch &&
          matchesType &&
          matchesCat &&
          matchesColor &&
          matchesStash
        );
      })
    : null;

  const sorted = filtered
    ? [...filtered].sort((a, b) => {
        if (sort === "az") return a.name.localeCompare(b.name);
        if (sort === "za") return b.name.localeCompare(a.name);
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return sort === "oldest" ? ta - tb : tb - ta;
      })
    : null;

  const totalPages =
    !sorted || pageSize === 0
      ? 1
      : Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted
    ? pageSize === 0
      ? sorted
      : sorted.slice((page - 1) * pageSize, page * pageSize)
    : null;

  useEffect(() => {
    setPage(1);
  }, [
    search,
    printTypeFilter,
    categoryFilter,
    colorFilter,
    stashBustMode,
    sort,
  ]);

  const hasFilter =
    search.trim().length > 0 ||
    printTypeFilter !== null ||
    categoryFilter !== null ||
    colorFilter.length > 0 ||
    stashBustMode;

  function clearFilters() {
    setSearch("");
    setPrintTypeFilter(null);
    setCategoryFilter(null);
    setColorFilter([]);
    setStashBustMode(false);
  }

  usePageAssistantContext(
    "quilting-fabrics",
    isLoading
      ? undefined
      : `Fabrics page: ${fabrics?.length ?? 0} fabric(s) in the stash${hasFilter ? ` (${sorted?.length ?? 0} shown after filters)` : ""}. Print types: ${printTypes.join(", ") || "none"}. Categories: ${allCategories.map((c) => c.name).join(", ") || "none"}. Visible fabrics: ${
          (sorted ?? [])
            .slice(0, 30)
            .map((f) => `${f.name} (fabricId: ${f.id})`)
            .join(", ") || "none"
        }.`,
  );

  return (
    <div>
      {stats && (
        <div className="mb-6 hidden sm:grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            {
              label: "Fabrics",
              value: stats.totalFabrics,
              sub: "in your stash",
              href: "/fabrics",
            },
            {
              label: "Patterns",
              value: stats.totalPatterns,
              sub: "saved",
              href: "/patterns",
            },
            {
              label: "Quilts",
              value: stats.totalQuilts,
              sub: "in collection",
              href: "/quilts",
            },
            {
              label: "Blocks",
              value: stats.totalBlocks,
              sub: "designed",
              href: "/blocks",
            },
            {
              label: "Layouts",
              value: stats.totalLayouts,
              sub: "arranged",
              href: "/layouts",
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

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fabrics</h1>
          <p className="text-sm text-muted-foreground">
            {sorted
              ? hasFilter
                ? `${sorted.length} of ${fabrics!.length} fabric${fabrics!.length !== 1 ? "s" : ""}`
                : `${sorted.length} fabric${sorted.length !== 1 ? "s" : ""}`
              : "Your fabric collection"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fabrics && fabrics.length > 0 && (
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
            title="Find fabrics that match a photo's colour palette"
          >
            <Sparkles className="mr-0 sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Match from photo</span>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/quilting/fabrics/bulk-add">
              <Camera className="mr-0 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Bulk Add</span>
            </Link>
          </Button>
          <Button asChild>
            <Link href="/quilting/fabrics/add">
              <PlusCircle className="mr-0 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Add fabric</span>
            </Link>
          </Button>
        </div>
      </div>

      {uploadingItems.length > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <p className="text-sm font-medium text-primary">
            Adding {uploadingItems.length} fabric
            {uploadingItems.length !== 1 ? "s" : ""} — AI cataloguing in
            progress…
          </p>
        </div>
      )}

      {isBulkMode && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="flex-1 text-sm font-medium">
            {selectedIds.size === 0
              ? "Tap cards to select"
              : `${selectedIds.size} selected`}
          </span>
          <button
            onClick={selectAll}
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
              onClick={() =>
                bulkReanalyze.mutate({ data: { ids: Array.from(selectedIds) } })
              }
              disabled={bulkReanalyze.isPending}
            >
              <RefreshCw
                className={`mr-2 h-3.5 w-3.5 ${bulkReanalyze.isPending ? "animate-spin" : ""}`}
              />
              Refresh AI ({selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {fabrics && fabrics.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, designer, or type…"
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
            <button
              onClick={() => setStashBustMode((v) => !v)}
              title={
                stashBustMode
                  ? "Stash Bust Mode: ON — showing unused fabrics only. Click to turn off."
                  : "Stash Bust Mode: OFF — click to show only fabrics not yet used in a quilt."
              }
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors shrink-0 ${
                stashBustMode
                  ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Scissors className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Stash Bust</span>
            </button>
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
            {/* Page size selector */}
            <div className="flex items-center gap-0.5">
              {([20, 50, 100, 0] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    localStorage.setItem(
                      "quilting-fabrics-page-size",
                      String(n),
                    );
                    setPageSize(n);
                    setPage(1);
                  }}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${pageSize === n ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background text-muted-foreground hover:bg-accent"}`}
                >
                  {n === 0 ? "All" : n}
                </button>
              ))}
            </div>
          </div>

          {usedColors.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {usedColors.map((color) => (
                <button
                  key={color}
                  onClick={() =>
                    setColorFilter((prev) =>
                      prev.includes(color)
                        ? prev.filter((c) => c !== color)
                        : [...prev, color],
                    )
                  }
                  title={color}
                  aria-label={color}
                  aria-pressed={colorFilter.includes(color)}
                  className={`h-6 w-6 shrink-0 rounded-full border transition-transform hover:scale-110 ${
                    colorFilter.includes(color)
                      ? "ring-2 ring-primary ring-offset-2 scale-110"
                      : "border-border/40"
                  }`}
                  style={{ backgroundColor: colorToHex(color) }}
                />
              ))}
              {colorFilter.length > 0 && (
                <button
                  onClick={() => setColorFilter([])}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear color
                </button>
              )}
            </div>
          )}

          {(printTypes.length > 1 || allCategories.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {printTypes.length > 1 &&
                printTypes.map((pt) => (
                  <button
                    key={pt}
                    onClick={() =>
                      setPrintTypeFilter(printTypeFilter === pt ? null : pt)
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      printTypeFilter === pt
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {pt}
                  </button>
                ))}
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

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
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

      {isError && (
        <div className="flex h-40 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">
            Failed to load fabrics. Please refresh.
          </p>
        </div>
      )}

      {sorted && sorted.length === 0 && fabrics!.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <Scissors className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">No fabrics yet</p>
            <p className="text-sm text-muted-foreground">
              Add your first fabric to get started
            </p>
          </div>
          <Button asChild>
            <Link href="/quilting/fabrics/add">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add fabric
            </Link>
          </Button>
        </div>
      )}

      {sorted && sorted.length === 0 && fabrics!.length > 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <Search className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No fabrics match your filters
          </p>
          <button
            onClick={clearFilters}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {(uploadingItems.length > 0 || (sorted && sorted.length > 0)) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {uploadingItems.map((item) => (
            <div
              key={item.clientId}
              className="relative animate-pulse overflow-hidden rounded-xl border border-primary/40 bg-card"
            >
              <div className="aspect-square overflow-hidden bg-muted">
                <img
                  src={item.preview}
                  alt=""
                  className="h-full w-full object-cover opacity-60"
                />
              </div>
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              </span>
              <div className="p-3">
                <div className="mb-1.5 h-3 w-3/4 rounded-full bg-muted" />
                <div className="h-2.5 w-1/2 rounded-full bg-muted/60" />
              </div>
            </div>
          ))}
          {paged &&
            paged.map((fabric) => (
              <FabricCard
                key={fabric.id}
                fabric={fabric as FabricSummary}
                onDelete={handleDelete}
                onReanalyze={handleReanalyze}
                isBulkMode={isBulkMode}
                isSelected={selectedIds.has(fabric.id)}
                onToggleSelect={toggleSelect}
                activeColor={colorFilter}
                onFilterByPrintType={(pt) =>
                  setPrintTypeFilter((prev) => (prev === pt ? null : pt))
                }
                onFilterByCategory={(id) =>
                  setCategoryFilter((prev) => (prev === id ? null : id))
                }
                onFilterByColor={(c) =>
                  setColorFilter((prev) =>
                    prev.includes(c)
                      ? prev.filter((x) => x !== c)
                      : [...prev, c],
                  )
                }
                onEditCategories={() =>
                  setCategoryEditItem(fabric as FabricSummary)
                }
              />
            ))}
        </div>
      )}
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
      <CategoryEditDialog
        open={categoryEditItem !== null}
        onClose={() => setCategoryEditItem(null)}
        title={categoryEditItem?.name ?? ""}
        currentCategories={
          (categoryEditItem?.categories ?? []) as unknown as QuiltingCategory[]
        }
        allCategories={categoryApiList ?? []}
        onSave={(names) => {
          if (categoryEditItem) {
            updateFabricCategories.mutate({
              id: categoryEditItem.id,
              data: { categories: names },
            });
          }
        }}
        isSaving={updateFabricCategories.isPending}
      />
      <PaletteMatchModal
        open={paletteMatchOpen}
        onClose={() => setPaletteMatchOpen(false)}
      />
    </div>
  );
}
