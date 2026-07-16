import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  BookOpen,
  MoreVertical,
  RefreshCw,
  CheckSquare,
  Square,
  Pencil,
  ExternalLink,
  Trash2,
  Download,
  ZoomIn,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { downloadCollectionImage } from "@/quilting/lib/svg-export";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";
import { useCollectionPage } from "@/quilting/hooks/useCollectionPage";
import { CollectionPageShell } from "@/quilting/components/CollectionPageShell";

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
          href={`/quilting/patterns/${pattern.id}`}
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
                  onClick={() => navigate(`/quilting/patterns/${pattern.id}`)}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    navigate(`/quilting/patterns/${pattern.id}?edit=1`)
                  }
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
  const [difficultyFilter, setDifficultyFilter] = useState<string | null>(null);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);
  const [categoryEditItem, setCategoryEditItem] =
    useState<PatternSummary | null>(null);
  const queryClient = useQueryClient();

  const {
    data: patternsData,
    isLoading,
    isError,
  } = useListPatterns({ pageSize: 200 });
  const patterns = (patternsData?.items ?? []) as PatternSummary[];

  const { data: categoryApiList } = useListQuiltingCategories();
  const { data: stats } = useGetStats();

  const extraFilter = useCallback(
    (p: PatternSummary) => {
      const matchesDifficulty =
        !difficultyFilter || p.difficulty === difficultyFilter;
      const matchesSourceType =
        !sourceTypeFilter || p.sourceType === sourceTypeFilter;
      return matchesDifficulty && matchesSourceType;
    },
    [difficultyFilter, sourceTypeFilter],
  );

  const searchMatch = useCallback(
    (p: PatternSummary, q: string) =>
      p.name.toLowerCase().includes(q) ||
      (p.designer ?? "").toLowerCase().includes(q),
    [],
  );

  const pageState = useCollectionPage<PatternSummary>({
    items: patterns,
    localStorageKey: "quilting-patterns-page-size",
    searchMatch,
    extraFilter,
    extraHasFilter: difficultyFilter !== null || sourceTypeFilter !== null,
    extraResetFilters: () => {
      setDifficultyFilter(null);
      setSourceTypeFilter(null);
    },
  });

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
        pageState.setSelectedIds(new Set());
        pageState.setIsBulkMode(false);
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

  const difficulties = patterns
    ? Array.from(
        new Set(
          patterns
            .map((p) => p.difficulty)
            .filter((d): d is string => Boolean(d)),
        ),
      ).sort()
    : [];

  const sourceTypes = patterns
    ? Array.from(
        new Set(
          patterns
            .map((p) => p.sourceType)
            .filter((st): st is string => Boolean(st)),
        ),
      ).sort()
    : [];

  usePageAssistantContext(
    "quilting-patterns",
    isLoading
      ? undefined
      : `Patterns page: ${patterns?.length ?? 0} pattern(s) saved${pageState.hasFilter ? ` (${pageState.sorted?.length ?? 0} shown after filters)` : ""}. Visible patterns: ${
          (pageState.sorted ?? [])
            .slice(0, 30)
            .map((p) => `${p.name} (patternId: ${p.id})`)
            .join(", ") || "none"
        }.`,
  );

  const domainFilterPills =
    difficulties.length > 1 || sourceTypes.length > 1 ? (
      <>
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
      </>
    ) : undefined;

  return (
    <CollectionPageShell
      items={patterns}
      isLoading={isLoading}
      isError={isError}
      {...pageState}
      title="Patterns"
      singularNoun="pattern"
      pluralNoun="patterns"
      addHref="/quilting/patterns/add"
      searchPlaceholder="Search by name or designer…"
      emptyIcon={<BookOpen className="h-10 w-10 text-muted-foreground/40" />}
      emptyDescription="Add quilt patterns to your library"
      localStorageKey="quilting-patterns-page-size"
      onBulkReanalyze={(ids) => bulkReanalyze.mutate({ data: { ids } })}
      isBulkReanalyzePending={bulkReanalyze.isPending}
      renderCard={(pattern) => (
        <PatternCard
          key={pattern.id}
          pattern={pattern}
          onDelete={handleDelete}
          onReanalyze={handleReanalyze}
          isBulkMode={pageState.isBulkMode}
          isSelected={pageState.selectedIds.has(pattern.id)}
          onToggleSelect={pageState.toggleSelect}
          onFilterByDifficulty={(d) =>
            setDifficultyFilter((prev) => (prev === d ? null : d))
          }
          onFilterBySourceType={(st) =>
            setSourceTypeFilter((prev) => (prev === st ? null : st))
          }
          onFilterByCategory={(id) =>
            pageState.setCategoryFilter((prev) => (prev === id ? null : id))
          }
          onFilterByColor={(hex) =>
            pageState.setColorFilter((prev) =>
              prev.includes(hex)
                ? prev.filter((c) => c !== hex)
                : [...prev, hex],
            )
          }
          onEditCategories={() => setCategoryEditItem(pattern)}
        />
      )}
      domainFilterPills={domainFilterPills}
      categoryEditItem={categoryEditItem}
      onCloseCategoryEdit={() => setCategoryEditItem(null)}
      allCategoryApiList={categoryApiList ?? []}
      onSaveCategories={(names) => {
        if (categoryEditItem) {
          updatePatternCategories.mutate({
            id: categoryEditItem.id,
            data: { categories: names },
          });
        }
      }}
      isSavingCategories={updatePatternCategories.isPending}
      paletteMatchEntity="pattern"
      stats={stats}
    />
  );
}
