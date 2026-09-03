import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMagnets,
  useListMagnetCategories,
  useReanalyzeMagnet,
  useDeleteMagnet,
  useUpdateMagnet,
  getListMagnetsQueryKey,
  type MagnetsMagnetItem,
  type MagnetsCategory,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  GitCompare,
  RefreshCw as RefreshCwIcon,
  X,
  Camera,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CollectionCard,
  CollectionGrid,
  CollectionCardSkeleton,
  CollectionListRow,
  CollectionList,
  CollectionSearchBar,
  CollectionStatBar,
  CollectionErrorState,
  BulkActionBar,
  CompareModal,
  CompareFloatingBar,
  useMultiSelectMode,
  useBulkReanalyzeRun,
  clearSettledAsyncActionStatuses,
  trackAsyncAction,
  isAsyncActionBusy,
  useAsyncActionStatus,
  useValidatedCollectionPageSize,
  type SortOption,
} from "@workspace/collection-ui";
import { GalleryPaginationPair } from "@/components/GalleryPaginationPair";
import { cn } from "@/lib/utils";
import { usePageAssistantContext } from "@/magnets/lib/assistant-context";
import {
  formatElaineContextEntity,
  formatElaineContextList,
} from "@workspace/elaine-ui";
import {
  magnetReanalyzeKey,
  MAGNET_REANALYZE_KEY_PREFIX,
} from "@/magnets/lib/reanalyze-status";
import { buildMagnetCompareItems } from "./collection-compare";

// ─── Per-card wrappers ────────────────────────────────────────────────────────
// These exist so each card/row calls its own hook for live AI status, avoiding
// conditional hook calls inside .map().

function MagnetCard(
  props: Omit<React.ComponentProps<typeof CollectionCard>, "aiStatus">,
) {
  const aiStatus = useAsyncActionStatus(magnetReanalyzeKey(props.id));
  return <CollectionCard {...props} aiStatus={aiStatus} />;
}

function MagnetListRow(
  props: Omit<React.ComponentProps<typeof CollectionListRow>, "aiStatus">,
) {
  const aiStatus = useAsyncActionStatus(magnetReanalyzeKey(props.id));
  return <CollectionListRow {...props} aiStatus={aiStatus} />;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAGNETS_PAGE_SIZE_KEY = "magnets-collection-page-size";
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

type MagnetSortKey = "newest" | "oldest" | "name-asc" | "name-desc";

const SORT_OPTIONS: SortOption<MagnetSortKey>[] = [
  { key: "newest", label: "Recently added" },
  { key: "oldest", label: "Oldest first" },
  { key: "name-asc", label: "Name A → Z" },
  { key: "name-desc", label: "Name Z → A" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MagnetsCollectionPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<MagnetSortKey>("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterCategoryIds, setFilterCategoryIds] = useState<
    Set<number | "none">
  >(new Set());
  const [displayPageSize, setDisplayPageSize] = useValidatedCollectionPageSize(
    MAGNETS_PAGE_SIZE_KEY,
    PAGE_SIZE_OPTIONS,
    50,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [quickEditItem, setQuickEditItem] = useState<MagnetsMagnetItem | null>(
    null,
  );
  const [categoryEditId, setCategoryEditId] = useState<number | null>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [selectedCompareItems, setSelectedCompareItems] = useState<
    Map<number, MagnetsMagnetItem>
  >(() => new Map());
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const reanalyze = useReanalyzeMagnet();
  const deleteMutation = useDeleteMagnet();
  const updateMutation = useUpdateMagnet();

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 on filter/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterCategoryIds, sort]);

  // The API applies search, category filtering, sorting, and pagination to
  // the complete collection before returning this page.
  const numericCategoryIds = [...filterCategoryIds].filter(
    (id): id is number => typeof id === "number",
  );
  const wantsUncategorized = filterCategoryIds.has("none");

  const queryParams = {
    page: currentPage,
    pageSize: displayPageSize,
    q: debouncedSearch || undefined,
    categoryIds: numericCategoryIds.length > 0 ? numericCategoryIds : undefined,
    uncategorized: wantsUncategorized || undefined,
    sort,
  };

  const { data, isLoading, isError, refetch } = useListMagnets(queryParams);
  const { data: categories = [] } = useListMagnetCategories();

  // The response page is already globally filtered and sorted. Keep these
  // aliases so the rest of the page can render both views consistently.
  const filteredItems: MagnetsMagnetItem[] = data?.items ?? [];
  const pagedItems = filteredItems;
  const totalPages =
    data?.totalPages ??
    Math.max(1, Math.ceil((data?.total ?? 0) / displayPageSize));

  // ── Reanalyze ──────────────────────────────────────────────────────────────

  function triggerReanalyze(itemId: number) {
    const key = magnetReanalyzeKey(itemId);
    if (isAsyncActionBusy(key)) return;
    trackAsyncAction(
      key,
      reanalyze.mutateAsync({ id: itemId }).then(() =>
        queryClient.invalidateQueries({
          queryKey: getListMagnetsQueryKey(),
        }),
      ),
    );
  }

  // ── Compare mode ──────────────────────────────────────────────────────────

  const compareMode = useMultiSelectMode(5);

  function enterCompareMode() {
    setSelectedCompareItems(new Map());
    compareMode.enter();
  }

  function exitCompareMode() {
    compareMode.exit();
    setSelectedCompareItems(new Map());
  }

  function toggleCompareItem(item: MagnetsMagnetItem) {
    setSelectedCompareItems((previous) => {
      const next = new Map(previous);
      if (compareMode.selectedIds.includes(item.id)) {
        next.delete(item.id);
      } else if (compareMode.selectedIds.length < compareMode.maxItems) {
        next.set(item.id, item);
      }
      return next;
    });
    compareMode.toggle(item.id);
  }

  // ── Bulk Refresh AI mode ───────────────────────────────────────────────────

  const bulkMode = useMultiSelectMode(20);
  const bulkRun = useBulkReanalyzeRun({
    runItem: (id) => reanalyze.mutateAsync({ id }),
    keyFor: magnetReanalyzeKey,
    invalidate: () =>
      queryClient.invalidateQueries({ queryKey: getListMagnetsQueryKey() }),
    onSettled: ({ succeeded, failed }) => {
      bulkMode.clear();
      setBulkStatus(
        `Done — ${succeeded.length} refreshed${failed.length ? `, ${failed.length} failed` : ""}.`,
      );
    },
    onFailed: () => {
      bulkMode.clear();
      setBulkStatus("Something went wrong. Please try again.");
    },
  });

  function runBulkReanalyze() {
    void bulkRun.run(bulkMode.selectedIds);
  }

  function finishBulk() {
    bulkRun.dismiss();
    bulkMode.exit();
    setBulkStatus(null);
    clearSettledAsyncActionStatuses(MAGNET_REANALYZE_KEY_PREFIX);
  }

  const isSelecting = compareMode.active || bulkMode.active;

  function exitSelectionModes() {
    exitCompareMode();
    finishBulk();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function handleDelete(id: number) {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMagnetsQueryKey() });
          setDeleteConfirmId(null);
          toast.success("Magnet deleted");
        },
        onError: () => toast.error("Failed to delete magnet."),
      },
    );
  }

  // ── Category quick-edit ────────────────────────────────────────────────────

  function handleSaveCategories(itemId: number, categoryIds: number[]) {
    updateMutation.mutate(
      { id: itemId, data: { categoryIds } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMagnetsQueryKey() });
          setCategoryEditId(null);
          toast.success("Categories saved");
        },
        onError: () => toast.error("Failed to save categories"),
      },
    );
  }

  // ── Category filter toggling ───────────────────────────────────────────────

  function handleCategoryToggle(id: number | "none") {
    setFilterCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handlePageSizeChange(n: number) {
    setDisplayPageSize(n);
    setCurrentPage(1);
  }

  // ── Stat bar ───────────────────────────────────────────────────────────────

  const statBarStats = useMemo(
    () => [
      {
        value: data?.total ?? 0,
        label:
          !debouncedSearch && filterCategoryIds.size === 0
            ? "Magnets"
            : "Matching",
      },
      {
        value: categories.length,
        label: "Categories",
      },
    ],
    [data?.total, debouncedSearch, filterCategoryIds.size, categories.length],
  );

  usePageAssistantContext(
    "magnets-collection",
    `Magnets collection showing ${filteredItems.length} magnet${filteredItems.length === 1 ? "" : "s"} on this page (${data?.total ?? 0} matching). Search: "${debouncedSearch}". Category filter: ${filterCategoryIds.size ? [...filterCategoryIds].join(", ") : "none"}. ${formatElaineContextList(
      pagedItems,
      {
        label: "Visible magnets (itemId — name, description, categories)",
        formatItem: (magnet) =>
          formatElaineContextEntity({
            entity: "magnet",
            id: magnet.id,
            label: magnet.name,
            details: [
              magnet.description
                ? `description: ${magnet.description.slice(0, 160)}`
                : undefined,
              magnet.categories.length
                ? `categories: ${magnet.categories.map((category) => `${category.name} (categoryId ${category.id})`).join(", ")}`
                : "uncategorized",
            ],
          }),
      },
    )}.`,
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div className="p-4">
        <CollectionErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  const categoryEditItem =
    categoryEditId !== null
      ? (pagedItems.find((i) => i.id === categoryEditId) ??
        filteredItems.find((i) => i.id === categoryEditId))
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-serif font-bold tracking-tight text-foreground">
            Magnets
          </h1>
          <p className="text-muted-foreground mt-1">
            {isLoading
              ? "Loading magnets…"
              : `${data?.total ?? 0} magnet${(data?.total ?? 0) !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex gap-2">
          {!isSelecting ? (
            <>
              {(data?.total ?? 0) >= 2 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={enterCompareMode}
                  data-testid="button-compare-mode"
                >
                  <GitCompare className="h-4 w-4" />
                  <span className="hidden sm:inline">Compare</span>
                </Button>
              )}
              {(data?.total ?? 0) > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={bulkMode.enter}
                  data-testid="button-bulk-reanalyze-mode"
                >
                  <RefreshCwIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Select</span>
                </Button>
              )}
              <Button asChild className="shrink-0 shadow-md">
                <Link href="/magnets/bulk-add">
                  <Camera className="mr-2 h-4 w-4" /> Add Magnets
                </Link>
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={exitSelectionModes}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Stat bar */}
      <CollectionStatBar stats={statBarStats} loading={isLoading} />

      {/* Search / sort / filter bar */}
      <CollectionSearchBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search magnets…"
        sort={sort}
        onSortChange={(v) => setSort(v as MagnetSortKey)}
        sortOptions={SORT_OPTIONS}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          bgColor: c.bgColor ?? null,
          textColor: c.textColor ?? null,
        }))}
        activeCategoryIds={filterCategoryIds}
        onCategoryToggle={handleCategoryToggle}
        pageSize={displayPageSize}
        onPageSizeChange={handlePageSizeChange}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageSizeStorageKey={MAGNETS_PAGE_SIZE_KEY}
      />

      {/* Bulk action bar */}
      {bulkMode.active && (
        <BulkActionBar
          selectedCount={bulkMode.selectedIds.length}
          onSelectAll={() => bulkMode.selectAll(pagedItems.map((i) => i.id))}
          onClearSelection={bulkMode.clear}
          onDone={finishBulk}
          onRun={runBulkReanalyze}
          runLabel={`Refresh AI (${bulkMode.selectedIds.length})`}
          isPending={bulkRun.isPending}
          emptyHint={`Tap cards to select (up to ${bulkMode.maxItems})`}
        />
      )}

      {/* Grid view */}
      {viewMode === "grid" && (
        <>
          <GalleryPaginationPair
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            hasResults={pagedItems.length > 0}
          >
            {isLoading ? (
              <CollectionGrid>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <CollectionCardSkeleton key={i} />
                ))}
              </CollectionGrid>
            ) : pagedItems.length === 0 ? (
              <div className="mt-8 flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-muted-foreground">
                  {filteredItems.length === 0 && (data?.total ?? 0) === 0
                    ? "No magnets yet."
                    : "No magnets match your filters."}
                </p>
                {filteredItems.length === 0 && (data?.total ?? 0) === 0 && (
                  <Button asChild>
                    <Link href="/magnets/bulk-add">
                      <Camera className="mr-2 h-4 w-4" /> Add your first magnet
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <CollectionGrid>
                {pagedItems.map((item) => (
                  <MagnetCard
                    key={item.id}
                    id={item.id}
                    name={item.name}
                    imageUrl={item.imageUrl ?? undefined}
                    href={`/magnets/item/${item.id}`}
                    categories={item.categories.map((c) => ({
                      id: c.id,
                      name: c.name,
                      bgColor: c.bgColor ?? null,
                      textColor: c.textColor ?? null,
                    }))}
                    onQuickEdit={() => setQuickEditItem(item)}
                    onSetCategories={() => setCategoryEditId(item.id)}
                    onReanalyze={() => triggerReanalyze(item.id)}
                    onDelete={() => setDeleteConfirmId(item.id)}
                    extraMenuItems={
                      <DropdownMenuItem asChild>
                        <Link href={`/magnets/item/${item.id}`}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                    }
                    selecting={isSelecting}
                    selected={
                      compareMode.active
                        ? compareMode.selectedIds.includes(item.id)
                        : bulkMode.selectedIds.includes(item.id)
                    }
                    onToggleSelect={
                      compareMode.active
                        ? () => toggleCompareItem(item)
                        : bulkMode.toggle
                    }
                    LinkComponent={Link}
                  />
                ))}
              </CollectionGrid>
            )}
          </GalleryPaginationPair>
        </>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <>
          <GalleryPaginationPair
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            hasResults={pagedItems.length > 0}
          >
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <CollectionCardSkeleton key={i} />
                ))}
              </div>
            ) : pagedItems.length === 0 ? (
              <div className="mt-8 flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-muted-foreground">
                  {filteredItems.length === 0 && (data?.total ?? 0) === 0
                    ? "No magnets yet."
                    : "No magnets match your filters."}
                </p>
              </div>
            ) : (
              <CollectionList>
                {pagedItems.map((item) => (
                  <MagnetListRow
                    key={item.id}
                    id={item.id}
                    name={item.name}
                    imageUrl={item.imageUrl ?? undefined}
                    href={`/magnets/item/${item.id}`}
                    categoryBadges={
                      item.categories.length > 0 ? (
                        <>
                          {[...item.categories]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((cat) => (
                              <span
                                key={cat.id}
                                className={cn(
                                  "inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold",
                                  !cat.bgColor &&
                                    "border-border text-muted-foreground",
                                )}
                                style={
                                  cat.bgColor
                                    ? {
                                        backgroundColor: cat.bgColor,
                                        color: cat.textColor ?? "#fff",
                                        borderColor: "transparent",
                                      }
                                    : undefined
                                }
                              >
                                {cat.name}
                              </span>
                            ))}
                        </>
                      ) : undefined
                    }
                    onQuickEdit={() => setQuickEditItem(item)}
                    onSetCategories={() => setCategoryEditId(item.id)}
                    onReanalyze={() => triggerReanalyze(item.id)}
                    onDelete={() => setDeleteConfirmId(item.id)}
                    extraMenuItems={
                      <DropdownMenuItem asChild>
                        <Link href={`/magnets/item/${item.id}`}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                    }
                    selecting={isSelecting}
                    selected={
                      compareMode.active
                        ? compareMode.selectedIds.includes(item.id)
                        : bulkMode.selectedIds.includes(item.id)
                    }
                    onToggleSelect={
                      compareMode.active
                        ? () => toggleCompareItem(item)
                        : bulkMode.toggle
                    }
                    LinkComponent={Link}
                  />
                ))}
              </CollectionList>
            )}
          </GalleryPaginationPair>
        </>
      )}

      {/* Compare floating bar */}
      {compareMode.active && (
        <CompareFloatingBar
          count={compareMode.selectedIds.length}
          label="magnets selected"
          onCompare={() => setShowCompareModal(true)}
        />
      )}

      {/* Compare modal */}
      {showCompareModal && (
        <CompareModal
          title="Compare magnets"
          items={buildMagnetCompareItems(
            compareMode.selectedIds,
            selectedCompareItems,
          )}
          onClose={() => {
            setShowCompareModal(false);
            exitCompareMode();
          }}
          LinkComponent={Link}
        />
      )}

      {/* Bulk pending / status banner */}
      {(bulkRun.isPending || bulkStatus) && (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-2 rounded-full border border-amber-300/60 bg-background/95 px-5 py-3 shadow-xl backdrop-blur">
            {bulkRun.isPending ? (
              <>
                <RefreshCwIcon className="h-4 w-4 animate-spin text-amber-600" />
                <span className="text-sm font-medium">Refreshing AI…</span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">{bulkStatus}</span>
                <button
                  type="button"
                  onClick={() => setBulkStatus(null)}
                  aria-label="Dismiss"
                  className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this magnet?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the magnet and all its photos. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteConfirmId !== null && handleDelete(deleteConfirmId)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Category quick-edit inline sheet */}
      {categoryEditItem && (
        <CategoryQuickEditDialog
          item={categoryEditItem}
          allCategories={categories}
          isSaving={updateMutation.isPending}
          onClose={() => setCategoryEditId(null)}
          onSave={(ids) => handleSaveCategories(categoryEditItem.id, ids)}
        />
      )}

      {/* Quick edit sheet (name + description + categories) */}
      {quickEditItem && (
        <MagnetQuickEditSheet
          item={quickEditItem}
          categories={categories}
          isSaving={updateMutation.isPending}
          onClose={() => setQuickEditItem(null)}
          onSave={async (payload) => {
            updateMutation.mutate(
              { id: quickEditItem.id, data: payload },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({
                    queryKey: getListMagnetsQueryKey(),
                  });
                  setQuickEditItem(null);
                  toast.success("Saved");
                },
                onError: () => toast.error("Failed to save"),
              },
            );
          }}
        />
      )}
    </div>
  );
}

// ─── Category quick-edit dialog ───────────────────────────────────────────────

function CategoryQuickEditDialog({
  item,
  allCategories,
  isSaving,
  onClose,
  onSave,
}: {
  item: MagnetsMagnetItem;
  allCategories: MagnetsCategory[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (categoryIds: number[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(item.categories.map((c) => c.id)),
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t bg-background p-4 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:w-96 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border">
        <h3 className="mb-3 text-base font-semibold">Set categories</h3>
        <p className="mb-2 text-sm text-muted-foreground truncate">
          {item.name}
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {allCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(cat.id)) next.delete(cat.id);
                  else next.add(cat.id);
                  return next;
                });
              }}
              className={cn(
                "rounded-full px-3 py-1 text-sm transition-colors border",
                selected.has(cat.id)
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "bg-background hover:bg-muted",
              )}
              style={
                selected.has(cat.id) && cat.bgColor
                  ? {
                      backgroundColor: cat.bgColor,
                      color: cat.textColor ?? "#fff",
                      borderColor: "transparent",
                    }
                  : undefined
              }
            >
              {cat.name}
            </button>
          ))}
          {allCategories.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No categories yet.{" "}
              <a href="/magnets/categories" className="underline">
                Create one
              </a>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave([...selected])}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Quick-edit sheet ─────────────────────────────────────────────────────────

function MagnetQuickEditSheet({
  item,
  categories,
  isSaving,
  onClose,
  onSave,
}: {
  item: MagnetsMagnetItem;
  categories: MagnetsCategory[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (payload: {
    name?: string;
    description?: string | null;
    categoryIds?: number[];
  }) => void;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    item.categories.map((c) => c.id),
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t bg-background p-4 shadow-xl md:inset-auto md:right-0 md:top-0 md:h-full md:w-96 md:rounded-none md:border-l">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Quick edit</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Categories</p>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() =>
                    setSelectedCategoryIds((prev) =>
                      prev.includes(cat.id)
                        ? prev.filter((x) => x !== cat.id)
                        : [...prev, cat.id],
                    )
                  }
                  className={cn(
                    "rounded-full px-3 py-1 text-sm transition-colors",
                    selectedCategoryIds.includes(cat.id)
                      ? "bg-primary text-primary-foreground"
                      : "border bg-muted hover:bg-muted/80",
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving || !name.trim()}
              onClick={() =>
                onSave({
                  name: name.trim(),
                  description: description.trim() || null,
                  categoryIds: selectedCategoryIds,
                })
              }
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
