import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  Layers,
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
} from "lucide-react";
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
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useListQuilts,
  useDeleteQuilt,
  useReanalyzeQuilt,
  useBulkReanalyzeQuilts,
  getListQuiltsQueryKey,
  getGetQuiltQueryKey,
  useGetStats,
} from "@workspace/api-client-react";
import { downloadCollectionImage } from "@/lib/svg-export";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";

type SortOption = "newest" | "oldest" | "az" | "za";

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Name A → Z",
  za: "Name Z → A",
};

type QuiltSummary = {
  id: number;
  name: string;
  imageUrl: string;
  dateCompleted?: string | null;
  sizeWidth?: number | null;
  sizeHeight?: number | null;
  recipient?: string | null;
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  createdAt: Date | string;
};

function QuiltCard({
  quilt,
  onDelete,
  onReanalyze,
  isBulkMode,
  isSelected,
  onToggleSelect,
  onFilterByRecipient,
  onFilterByCategory,
}: {
  quilt: QuiltSummary;
  onDelete: (id: number) => void;
  onReanalyze: (id: number) => void;
  isBulkMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onFilterByRecipient?: (r: string) => void;
  onFilterByCategory?: (id: number) => void;
}) {
  const [, navigate] = useLocation();
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <>
    <div
      className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md"
      onClick={() => {
        if (isBulkMode) onToggleSelect(quilt.id);
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
        href={`/quilts/${quilt.id}`}
        className={`block ${isBulkMode ? "pointer-events-none" : ""}`}
      >
        <div className="relative aspect-square overflow-hidden bg-muted">
          <img
            src={quilt.imageUrl}
            alt={quilt.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomOpen(true); }}
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
            title="Zoom preview"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="p-3 pr-8">
          <p className="truncate text-sm font-semibold text-foreground">
            {quilt.name}
          </p>
          {quilt.dateCompleted && (
            <p className="truncate text-xs text-muted-foreground">
              {quilt.dateCompleted}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {quilt.recipient && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFilterByRecipient?.(quilt.recipient!);
                }}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
              >
                For {quilt.recipient}
              </button>
            )}
            {quilt.sizeWidth && quilt.sizeHeight && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {quilt.sizeWidth}" × {quilt.sizeHeight}"
              </span>
            )}
            {(quilt.categories ?? []).map((cat) => (
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
                    ? { bgColor: cat.bgColor, textColor: cat.textColor ?? "#fff" }
                    : getCategoryPalette(cat.name);
                  return { backgroundColor: p.bgColor, color: p.textColor };
                })()}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </Link>

      {!isBulkMode && (
        <div className="absolute right-2 top-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full bg-background/80 opacity-100 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">Options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/quilts/${quilt.id}`)}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate(`/quilts/${quilt.id}?edit=1`)}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onReanalyze(quilt.id)}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Refresh AI
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  downloadCollectionImage(quilt.imageUrl, quilt.name)
                }
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Download photo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(quilt.id)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
    <PreviewZoomModal open={zoomOpen} onClose={() => setZoomOpen(false)} title={quilt.name}>
      <img
        src={quilt.imageUrl}
        alt={quilt.name}
        className="max-h-[85vh] max-w-[85vw] rounded object-contain"
        draggable={false}
      />
    </PreviewZoomModal>
    </>
  );
}

export default function Quilts() {
  const [search, setSearch] = useState("");
  const [recipientFilter, setRecipientFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<SortOption>("newest");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { data: quilts, isLoading, isError } = useListQuilts();

  const deleteQuilt = useDeleteQuilt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        toast.success("Quilt deleted");
      },
      onError: () => toast.error("Failed to delete quilt."),
    },
  });

  const reanalyzeQuilt = useReanalyzeQuilt({
    mutation: {
      onSuccess: (data, { id }) => {
        queryClient.setQueryData(getGetQuiltQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: () => toast.error("Failed to refresh AI analysis."),
    },
  });

  const bulkReanalyze = useBulkReanalyzeQuilts({
    mutation: {
      onSuccess: ({ succeeded, failed }) => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        setSelectedIds(new Set());
        setIsBulkMode(false);
        if (failed.length === 0) {
          toast.success(
            `Refreshed AI for ${succeeded.length} quilt${succeeded.length !== 1 ? "s" : ""}`,
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
    if (!confirm("Delete this quilt? This cannot be undone.")) return;
    deleteQuilt.mutate({ id });
  }

  function handleReanalyze(id: number) {
    reanalyzeQuilt.mutate({ id });
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

  const recipients =
    quilts && quilts.length > 0
      ? Array.from(
          new Set(
            (quilts as QuiltSummary[])
              .map((q) => q.recipient)
              .filter((r): r is string => Boolean(r)),
          ),
        ).sort()
      : [];

  const allCategories = quilts
    ? Array.from(
        new Map(
          (quilts as QuiltSummary[])
            .flatMap((q) => q.categories ?? [])
            .map((c) => [c.id, c]),
        ).values(),
      )
    : [];

  const filtered = quilts
    ? (quilts as QuiltSummary[]).filter((q) => {
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query ||
          q.name.toLowerCase().includes(query) ||
          (q.recipient ?? "").toLowerCase().includes(query);
        const matchesRecipient =
          !recipientFilter || q.recipient === recipientFilter;
        const matchesCat =
          categoryFilter === null ||
          (q.categories ?? []).some((c) => c.id === categoryFilter);
        return matchesSearch && matchesRecipient && matchesCat;
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

  const hasFilter =
    search.trim().length > 0 ||
    recipientFilter !== null ||
    categoryFilter !== null;

  const { data: stats } = useGetStats();

  return (
    <div>
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Fabrics", value: stats.totalFabrics, sub: "in stash" },
            { label: "Patterns", value: stats.totalPatterns, sub: "saved" },
            { label: "Quilts", value: stats.totalQuilts, sub: "in collection" },
            { label: "Layouts", value: stats.totalLayouts, sub: "designs" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finished Quilts</h1>
          <p className="text-sm text-muted-foreground">
            {sorted
              ? hasFilter
                ? `${sorted.length} of ${quilts!.length} quilt${quilts!.length !== 1 ? "s" : ""}`
                : `${sorted.length} quilt${sorted.length !== 1 ? "s" : ""} in your collection`
              : "Your finished quilts"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {quilts && quilts.length > 0 && (
            <Button
              variant={isBulkMode ? "secondary" : "outline"}
              size="sm"
              onClick={toggleBulkMode}
            >
              {isBulkMode ? "Done" : "Select"}
            </Button>
          )}
          <Button asChild>
            <Link href="/quilts/add">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add quilt
            </Link>
          </Button>
        </div>
      </div>

      {isBulkMode && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="flex-1 text-sm font-medium">
            {selectedIds.size === 0
              ? "Tap cards to select"
              : `${selectedIds.size} selected`}
          </span>
          <button
            onClick={() =>
              sorted && setSelectedIds(new Set(sorted.map((q) => q.id)))
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

      <div className="mb-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name or recipient…"
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
          </div>

          {(recipients.length > 1 || allCategories.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {recipients.length > 1 &&
                recipients.map((r) => (
                  <button
                    key={r}
                    onClick={() =>
                      setRecipientFilter(recipientFilter === r ? null : r)
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${recipientFilter === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                  >
                    {r}
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
                      ? { bgColor: cat.bgColor, textColor: cat.textColor ?? "#fff" }
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

      {isError && (
        <div className="flex h-40 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">
            Failed to load quilts. Please refresh.
          </p>
        </div>
      )}

      {sorted && sorted.length === 0 && quilts!.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <Layers className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">
              No finished quilts yet
            </p>
            <p className="text-sm text-muted-foreground">
              Record your completed quilts here
            </p>
          </div>
          <Button asChild>
            <Link href="/quilts/add">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add quilt
            </Link>
          </Button>
        </div>
      )}

      {sorted && sorted.length === 0 && quilts!.length > 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <Search className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No quilts match your filters
          </p>
          <button
            onClick={() => {
              setSearch("");
              setRecipientFilter(null);
              setCategoryFilter(null);
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {sorted.map((quilt) => (
            <QuiltCard
              key={quilt.id}
              quilt={quilt}
              onDelete={handleDelete}
              onReanalyze={handleReanalyze}
              isBulkMode={isBulkMode}
              isSelected={selectedIds.has(quilt.id)}
              onToggleSelect={toggleSelect}
              onFilterByRecipient={(r) =>
                setRecipientFilter((prev) => (prev === r ? null : r))
              }
              onFilterByCategory={(id) =>
                setCategoryFilter((prev) => (prev === id ? null : id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
