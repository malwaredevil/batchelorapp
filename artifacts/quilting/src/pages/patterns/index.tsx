import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  BookOpen,
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
  Sparkles,
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
import { getCategoryPalette, colorToHex } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useListPatterns,
  useDeletePattern,
  useReanalyzePattern,
  useBulkReanalyzePatterns,
  getListPatternsQueryKey,
  getGetPatternQueryKey,
  useGetStats,
  useUpdatePattern,
  useListQuiltingCategories,
} from "@workspace/api-client-react";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { downloadCollectionImage } from "@/lib/svg-export";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";
import { CategoryEditDialog } from "@/components/CategoryEditDialog";
import { PaletteMatchModal } from "@/components/PaletteMatchModal";
import { cn } from "@/lib/utils";
import { usePageAssistantContext } from "@/lib/assistant-context";

type SortOption = "newest" | "oldest" | "az" | "za";

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Name A → Z",
  za: "Name Z → A",
};

type PatternSummary = {
  id: number;
  name: string;
  imageUrl?: string | null;
  designer?: string | null;
  difficulty?: string | null;
  blockSize?: string | null;
  sourceType?: string | null;
  dominantColors?: string[];
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  createdAt: Date | string;
};

function PatternCard({
  pattern,
  onDelete,
  onReanalyze,
  isBulkMode,
  isSelected,
  onToggleSelect,
  onFilterByDifficulty,
  onFilterBySourceType,
  onFilterByCategory,
  onFilterByColor,
  onEditCategories,
}: {
  pattern: PatternSummary;
  onDelete: (id: number) => void;
  onReanalyze: (id: number) => void;
  isBulkMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onFilterByDifficulty?: (d: string) => void;
  onFilterBySourceType?: (st: string) => void;
  onFilterByCategory?: (id: number) => void;
  onFilterByColor?: (hex: string) => void;
  onEditCategories?: () => void;
}) {
  const [, navigate] = useLocation();
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <>
      <div
        className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md"
        onClick={() => {
          if (isBulkMode) onToggleSelect(pattern.id);
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
          href={`/patterns/${pattern.id}`}
          className={`block ${isBulkMode ? "pointer-events-none" : ""}`}
        >
          <div className="relative aspect-square overflow-hidden bg-muted">
            {pattern.imageUrl ? (
              <img
                src={pattern.imageUrl}
                alt={pattern.name}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <BookOpen className="h-12 w-12 text-muted-foreground/25" />
              </div>
            )}
            {pattern.imageUrl && (
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
            )}
          </div>
          <div className="p-3 pr-8">
            <p className="truncate text-sm font-semibold text-foreground">
              {pattern.name}
            </p>
            {pattern.designer && (
              <p className="truncate text-xs text-muted-foreground">
                by {pattern.designer}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {pattern.difficulty && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFilterByDifficulty?.(pattern.difficulty!);
                  }}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
                >
                  {pattern.difficulty}
                </button>
              )}
              {pattern.sourceType && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFilterBySourceType?.(pattern.sourceType!);
                  }}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
                >
                  {pattern.sourceType}
                </button>
              )}
              {pattern.blockSize && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {pattern.blockSize}
                </span>
              )}
              {(pattern.categories ?? []).map((cat) => (
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
            </div>
            {(pattern.dominantColors ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(pattern.dominantColors ?? []).map((c) => (
                  <button
                    key={c}
                    title={c}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onFilterByColor?.(c);
                    }}
                    className="h-4 w-4 rounded-full border border-black/10 transition-transform hover:scale-110"
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
                  className="h-7 w-7 rounded-full opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:opacity-100"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">Options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => navigate(`/patterns/${pattern.id}`)}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate(`/patterns/${pattern.id}?edit=1`)}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReanalyze(pattern.id)}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh AI
                </DropdownMenuItem>
                {pattern.imageUrl && (
                  <DropdownMenuItem
                    onClick={() =>
                      downloadCollectionImage(pattern.imageUrl!, pattern.name)
                    }
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    Download photo
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onEditCategories?.()}>
                  <Tag className="mr-2 h-3.5 w-3.5" />
                  Set categories
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(pattern.id)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {pattern.imageUrl && (
        <PreviewZoomModal
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
          title={pattern.name}
        >
          <img
            src={pattern.imageUrl}
            alt={pattern.name}
            className="max-h-[85vh] max-w-[85vw] rounded object-contain"
            draggable={false}
          />
        </PreviewZoomModal>
      )}
    </>
  );
}

export default function Patterns() {
  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<string | null>(null);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>("newest");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [paletteMatchOpen, setPaletteMatchOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: patterns, isLoading, isError } = useListPatterns();
  const [categoryEditItem, setCategoryEditItem] =
    useState<PatternSummary | null>(null);
  const { data: categoryApiList } = useListQuiltingCategories();

  const updatePatternCategories = useUpdatePattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        setCategoryEditItem(null);
        toast.success("Categories saved");
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  const deletePattern = useDeletePattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("Pattern deleted");
      },
      onError: () => toast.error("Failed to delete pattern."),
    },
  });

  const reanalyzePattern = useReanalyzePattern({
    mutation: {
      onSuccess: (data, { id }) => {
        queryClient.setQueryData(getGetPatternQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: () => toast.error("Failed to refresh AI analysis."),
    },
  });

  const bulkReanalyze = useBulkReanalyzePatterns({
    mutation: {
      onSuccess: ({ succeeded, failed }) => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        setSelectedIds(new Set());
        setIsBulkMode(false);
        if (failed.length === 0) {
          toast.success(
            `Refreshed AI for ${succeeded.length} pattern${succeeded.length !== 1 ? "s" : ""}`,
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
    if (!confirm("Delete this pattern? This cannot be undone.")) return;
    deletePattern.mutate({ id });
  }

  function handleReanalyze(id: number) {
    reanalyzePattern.mutate({ id });
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

  const difficulties =
    patterns && patterns.length > 0
      ? Array.from(
          new Set(
            patterns
              .map((p) => p.difficulty)
              .filter((d): d is string => Boolean(d)),
          ),
        ).sort()
      : [];

  const sourceTypes =
    patterns && patterns.length > 0
      ? Array.from(
          new Set(
            (patterns as PatternSummary[])
              .map((p) => p.sourceType)
              .filter((st): st is string => Boolean(st)),
          ),
        ).sort()
      : [];

  const allCategories = patterns
    ? Array.from(
        new Map(
          (patterns as PatternSummary[])
            .flatMap((p) => p.categories ?? [])
            .map((c) => [c.id, c]),
        ).values(),
      )
    : [];

  const usedColors = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const p of (patterns ?? []) as PatternSummary[]) {
      for (const c of p.dominantColors ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          result.push(c);
        }
      }
    }
    return result;
  }, [patterns]);

  const filtered = patterns
    ? (patterns as PatternSummary[]).filter((p) => {
        const q = search.trim().toLowerCase();
        const matchesSearch =
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.designer ?? "").toLowerCase().includes(q);
        const matchesDifficulty =
          !difficultyFilter || p.difficulty === difficultyFilter;
        const matchesSourceType =
          !sourceTypeFilter || p.sourceType === sourceTypeFilter;
        const matchesCat =
          categoryFilter === null ||
          (p.categories ?? []).some((c) => c.id === categoryFilter);
        const matchesColor =
          colorFilter.length === 0 ||
          colorFilter.every((c) => (p.dominantColors ?? []).includes(c));
        return (
          matchesSearch &&
          matchesDifficulty &&
          matchesSourceType &&
          matchesCat &&
          matchesColor
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

  const hasFilter =
    search.trim().length > 0 ||
    difficultyFilter !== null ||
    sourceTypeFilter !== null ||
    categoryFilter !== null ||
    colorFilter.length > 0;

  const { data: stats } = useGetStats();

  usePageAssistantContext(
    "quilting-patterns",
    isLoading
      ? undefined
      : `Patterns page: ${patterns?.length ?? 0} pattern(s) saved${hasFilter ? ` (${sorted?.length ?? 0} shown after filters)` : ""}. Visible patterns: ${(sorted ?? [])
          .slice(0, 30)
          .map((p) => `${p.name} (patternId: ${p.id})`)
          .join(", ") || "none"}.`,
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
          <h1 className="text-2xl font-bold tracking-tight">Patterns</h1>
          <p className="text-sm text-muted-foreground">
            {sorted
              ? hasFilter
                ? `${sorted.length} of ${patterns!.length} pattern${patterns!.length !== 1 ? "s" : ""}`
                : `${sorted.length} pattern${sorted.length !== 1 ? "s" : ""}`
              : "Your pattern library"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {patterns && patterns.length > 0 && (
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
            title="Find patterns that match a photo's colour palette"
          >
            <Sparkles className="mr-0 sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Match from photo</span>
          </Button>
          <Button asChild>
            <Link href="/patterns/add">
              <PlusCircle className="mr-0 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Add pattern</span>
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
              sorted && setSelectedIds(new Set(sorted.map((p) => p.id)))
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

      {patterns && patterns.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name or designer…"
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

          {(difficulties.length > 1 ||
            sourceTypes.length > 1 ||
            allCategories.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {difficulties.length > 1 &&
                difficulties.map((d) => (
                  <button
                    key={d}
                    onClick={() =>
                      setDifficultyFilter(difficultyFilter === d ? null : d)
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${difficultyFilter === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                  >
                    {d}
                  </button>
                ))}
              {sourceTypes.length > 1 &&
                sourceTypes.map((st) => (
                  <button
                    key={st}
                    onClick={() =>
                      setSourceTypeFilter(sourceTypeFilter === st ? null : st)
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${sourceTypeFilter === st ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                  >
                    {st}
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
            Failed to load patterns. Please refresh.
          </p>
        </div>
      )}

      {sorted && sorted.length === 0 && patterns!.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">No patterns yet</p>
            <p className="text-sm text-muted-foreground">
              Add quilt patterns to your library
            </p>
          </div>
          <Button asChild>
            <Link href="/patterns/add">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add pattern
            </Link>
          </Button>
        </div>
      )}

      {sorted && sorted.length === 0 && patterns!.length > 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <Search className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No patterns match your filters
          </p>
          <button
            onClick={() => {
              setSearch("");
              setDifficultyFilter(null);
              setSourceTypeFilter(null);
              setCategoryFilter(null);
              setColorFilter([]);
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {sorted.map((pattern) => (
            <PatternCard
              key={pattern.id}
              pattern={pattern}
              onDelete={handleDelete}
              onReanalyze={handleReanalyze}
              isBulkMode={isBulkMode}
              isSelected={selectedIds.has(pattern.id)}
              onToggleSelect={toggleSelect}
              onFilterByDifficulty={(d) =>
                setDifficultyFilter((prev) => (prev === d ? null : d))
              }
              onFilterBySourceType={(st) =>
                setSourceTypeFilter((prev) => (prev === st ? null : st))
              }
              onFilterByCategory={(id) =>
                setCategoryFilter((prev) => (prev === id ? null : id))
              }
              onFilterByColor={(hex) =>
                setColorFilter((prev) =>
                  prev.includes(hex)
                    ? prev.filter((c) => c !== hex)
                    : [...prev, hex],
                )
              }
              onEditCategories={() => setCategoryEditItem(pattern)}
            />
          ))}
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
            updatePatternCategories.mutate({
              id: categoryEditItem.id,
              data: { categories: names },
            });
          }
        }}
        isSaving={updatePatternCategories.isPending}
      />
      <PaletteMatchModal
        entity="pattern"
        open={paletteMatchOpen}
        onClose={() => setPaletteMatchOpen(false)}
      />
    </div>
  );
}
