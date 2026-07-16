import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  Layers,
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
  useListQuilts,
  useDeleteQuilt,
  useReanalyzeQuilt,
  useBulkReanalyzeQuilts,
  getListQuiltsQueryKey,
  getGetQuiltQueryKey,
  useGetStats,
  useUpdateQuilt,
  useListQuiltingCategories,
} from "@workspace/api-client-react";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { downloadCollectionImage } from "@/quilting/lib/svg-export";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";
import { useCollectionPage } from "@/quilting/hooks/useCollectionPage";
import { CollectionPageShell } from "@/quilting/components/CollectionPageShell";

type QuiltSummary = {
  id: number;
  name: string;
  imageUrl: string;
  dateCompleted?: string | null;
  sizeWidth?: number | null;
  sizeHeight?: number | null;
  recipient?: string | null;
  dominantColors?: string[];
  completionPercentage?: number | null;
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
  onFilterByColor,
  onEditCategories,
}: {
  quilt: QuiltSummary;
  onDelete: (id: number) => void;
  onReanalyze: (id: number) => void;
  isBulkMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onFilterByRecipient?: (r: string) => void;
  onFilterByCategory?: (id: number) => void;
  onFilterByColor?: (hex: string) => void;
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
          href={`/quilting/quilts/${quilt.id}`}
          className={`block ${isBulkMode ? "pointer-events-none" : ""}`}
        >
          <div className="relative aspect-square overflow-hidden bg-muted">
            <img
              src={quilt.imageUrl}
              alt={quilt.name}
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
              {quilt.name}
            </p>
            {quilt.dateCompleted ? (
              <p className="truncate text-xs text-muted-foreground">
                {quilt.dateCompleted}
              </p>
            ) : (quilt.completionPercentage ?? 0) > 0 ? (
              <div className="mt-1">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${quilt.completionPercentage ?? 0}%`,
                      backgroundColor:
                        (quilt.completionPercentage ?? 0) >= 80
                          ? "#10b981"
                          : (quilt.completionPercentage ?? 0) >= 40
                            ? "#f59e0b"
                            : "#f87171",
                    }}
                  />
                </div>
              </div>
            ) : null}
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
            {(quilt.dominantColors ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(quilt.dominantColors ?? []).map((c) => (
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
                  className="h-7 w-7 rounded-full bg-background/80 opacity-100 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:opacity-100"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">Options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => navigate(`/quilting/quilts/${quilt.id}`)}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    navigate(`/quilting/quilts/${quilt.id}?edit=1`)
                  }
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
                <DropdownMenuItem onClick={() => onEditCategories?.()}>
                  <Tag className="mr-2 h-3.5 w-3.5" />
                  Set categories
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
      <PreviewZoomModal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={quilt.name}
      >
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
  const [recipientFilter, setRecipientFilter] = useState<string | null>(null);
  const [categoryEditItem, setCategoryEditItem] = useState<QuiltSummary | null>(
    null,
  );
  const queryClient = useQueryClient();

  const {
    data: quiltsData,
    isLoading,
    isError,
  } = useListQuilts({ pageSize: 200 });
  const quilts = (quiltsData?.items ?? []) as QuiltSummary[];

  const { data: categoryApiList } = useListQuiltingCategories();
  const { data: stats } = useGetStats();

  const extraFilter = useCallback(
    (q: QuiltSummary) => !recipientFilter || q.recipient === recipientFilter,
    [recipientFilter],
  );

  const searchMatch = useCallback(
    (q: QuiltSummary, query: string) =>
      q.name.toLowerCase().includes(query) ||
      (q.recipient ?? "").toLowerCase().includes(query),
    [],
  );

  const pageState = useCollectionPage<QuiltSummary>({
    items: quilts,
    localStorageKey: "quilting-quilts-page-size",
    searchMatch,
    extraFilter,
    extraHasFilter: recipientFilter !== null,
    extraResetFilters: () => setRecipientFilter(null),
  });

  const updateQuiltCategories = useUpdateQuilt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        setCategoryEditItem(null);
        toast.success("Categories saved");
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

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
        pageState.setSelectedIds(new Set());
        pageState.setIsBulkMode(false);
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

  const recipients = quilts
    ? Array.from(
        new Set(
          quilts.map((q) => q.recipient).filter((r): r is string => Boolean(r)),
        ),
      ).sort()
    : [];

  usePageAssistantContext(
    "quilting-quilts",
    isLoading
      ? undefined
      : `Quilts page: ${quilts?.length ?? 0} finished/in-progress quilt(s)${pageState.hasFilter ? ` (${pageState.sorted?.length ?? 0} shown after filters)` : ""}. Visible quilts: ${
          (pageState.sorted ?? [])
            .slice(0, 30)
            .map((q) => `${q.name} (quiltId: ${q.id})`)
            .join(", ") || "none"
        }.`,
  );

  const domainFilterPills =
    recipients.length > 1 ? (
      <>
        {recipients.map((r) => (
          <button
            key={r}
            onClick={() => setRecipientFilter(recipientFilter === r ? null : r)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${recipientFilter === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
          >
            {r}
          </button>
        ))}
      </>
    ) : undefined;

  return (
    <CollectionPageShell
      items={quilts}
      isLoading={isLoading}
      isError={isError}
      {...pageState}
      title="Finished Quilts"
      singularNoun="quilt"
      pluralNoun="quilts"
      addHref="/quilting/quilts/add"
      searchPlaceholder="Search by name or recipient…"
      emptyIcon={<Layers className="h-10 w-10 text-muted-foreground/40" />}
      emptyDescription="Record your completed quilts here"
      localStorageKey="quilting-quilts-page-size"
      onBulkReanalyze={(ids) => bulkReanalyze.mutate({ data: { ids } })}
      isBulkReanalyzePending={bulkReanalyze.isPending}
      renderCard={(quilt) => (
        <QuiltCard
          key={quilt.id}
          quilt={quilt}
          onDelete={handleDelete}
          onReanalyze={handleReanalyze}
          isBulkMode={pageState.isBulkMode}
          isSelected={pageState.selectedIds.has(quilt.id)}
          onToggleSelect={pageState.toggleSelect}
          onFilterByRecipient={(r) =>
            setRecipientFilter((prev) => (prev === r ? null : r))
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
          onEditCategories={() => setCategoryEditItem(quilt)}
        />
      )}
      domainFilterPills={domainFilterPills}
      categoryEditItem={categoryEditItem}
      onCloseCategoryEdit={() => setCategoryEditItem(null)}
      allCategoryApiList={categoryApiList ?? []}
      onSaveCategories={(names) => {
        if (categoryEditItem) {
          updateQuiltCategories.mutate({
            id: categoryEditItem.id,
            data: { categories: names },
          });
        }
      }}
      isSavingCategories={updateQuiltCategories.isPending}
      paletteMatchEntity="quilt"
      stats={stats}
    />
  );
}
