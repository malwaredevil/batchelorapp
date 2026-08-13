import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrnaments,
  useListOrnamentCategories,
  useReanalyzeOrnament,
  useDeleteOrnament,
  useUpdateOrnament,
  getListOrnamentsQueryKey,
  useListConnectedCalendars,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  type TravelCalendarEvent,
  type OrnamentsOrnamentItem,
} from "@workspace/api-client-react";
import { CategoryEditDialog } from "@/quilting/components/CategoryEditDialog";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { QuickEditOrnamentSheet } from "@/ornaments/components/quick-edit-ornament-sheet";
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
import { toast } from "sonner";
import {
  Plus,
  Image as ImageIcon,
  CalendarHeart,
  Check,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import {
  formatElaineContextEntity,
  formatElaineContextList,
  useAppConfigSummary,
} from "@workspace/elaine-ui";
import { Button } from "@/components/ui/button";
import { CollectionErrorState } from "@workspace/collection-ui";
import { DominantColorDots } from "@/components/collection/DominantColorDots";
import { colorToHex } from "@workspace/web-core/colors";
import {
  CollectionCard,
  CollectionGrid,
  CollectionListRow,
  CollectionList,
  CollectionSearchBar,
  CollectionStatBar,
  useValidatedCollectionPageSize,
  type SortOption,
} from "@workspace/collection-ui";
import { GalleryPaginator } from "@/components/GalleryPaginator";
import { cn } from "@/lib/utils";

const ORNAMENTS_PAGE_SIZE_KEY = "ornaments-collection-page-size";
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

type OrnamentSortKey =
  | "newest"
  | "oldest"
  | "year-desc"
  | "year-asc"
  | "name-asc"
  | "name-desc"
  | "value-desc";

const SORT_OPTIONS: SortOption<OrnamentSortKey>[] = [
  { key: "newest", label: "Recently added" },
  { key: "oldest", label: "Oldest first" },
  { key: "year-desc", label: "Release year (new → old)" },
  { key: "year-asc", label: "Release year (old → new)" },
  { key: "name-asc", label: "Name A → Z" },
  { key: "name-desc", label: "Name Z → A" },
  { key: "value-desc", label: "Highest value" },
];

function NextHallmarkEventCard() {
  const { data: connectedCalendars = [] } = useListConnectedCalendars();
  const hallmarkCal =
    connectedCalendars.find((c) => c.isHallmarkCalendar) ?? null;

  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setFullYear(end.getFullYear() + 1);
    return { rangeStart: today.toISOString(), rangeEnd: end.toISOString() };
  }, []);

  const { data: gcalEvents = [] } = useListConnectedCalendarEvents(
    hallmarkCal?.id ?? 0,
    rangeStart,
    rangeEnd,
    {
      query: {
        enabled: !!hallmarkCal,
        queryKey: getListConnectedCalendarEventsQueryKey(
          hallmarkCal?.id ?? 0,
          rangeStart,
          rangeEnd,
        ),
      },
    },
  );

  const nowMs = Date.now();

  const upcoming = gcalEvents
    .map((e: TravelCalendarEvent) => {
      // The server's fromGoogleEvent() already converts Google's exclusive
      // all-day end date back to an inclusive one, so e.end is already
      // correct — do not subtract another day here, or a multi-day event
      // loses its last day. The swap below stays as a defensive guard for
      // any event genuinely entered backwards.
      const rawStart = e.start.slice(0, 10);
      const rawEnd = e.end.slice(0, 10);
      const startDate = rawStart <= rawEnd ? rawStart : rawEnd;
      const endDate = rawStart <= rawEnd ? rawEnd : rawStart;
      return {
        gcalId: e.id,
        title: e.title,
        startDate,
        endDate,
        startMs: new Date(`${startDate}T00:00:00`).getTime(),
        endMs: new Date(`${endDate}T23:59:59`).getTime(),
      };
    })
    .filter((e) => e.endMs >= nowMs)
    .sort((a, b) => a.startMs - b.startMs);

  const next = upcoming[0];
  if (!next) return null;

  const isLive = nowMs >= next.startMs && nowMs <= next.endMs;
  const daysAway = isLive
    ? 0
    : Math.max(0, Math.ceil((next.startMs - nowMs) / 86_400_000));

  const dateRangeLabel = `${new Date(
    `${next.startDate}T00:00:00`,
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} – ${new Date(`${next.endDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const eventHref = `/ornaments/hallmark-events?month=${next.startDate.slice(0, 7)}&event=${encodeURIComponent(next.gcalId)}`;

  return (
    <Link href={eventHref}>
      <div className="flex items-center gap-4 rounded-xl border border-rose-200/60 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 p-4 hover:bg-rose-100/70 dark:hover:bg-rose-900/30 transition-colors cursor-pointer">
        <div className="w-12 h-12 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
          <CalendarHeart className="w-6 h-6 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-serif font-semibold truncate">{next.title}</div>
          <div className="text-sm text-muted-foreground">{dateRangeLabel}</div>
        </div>
        <div className="text-center flex-shrink-0">
          <div
            className={`text-3xl font-bold tabular-nums leading-none ${isLive ? "text-red-700 dark:text-red-400" : "text-rose-600 dark:text-rose-400"}`}
          >
            {isLive ? "Live" : daysAway}
          </div>
          {!isLive && (
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              days away
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Collection() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<OrnamentSortKey>("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterCategoryIds, setFilterCategoryIds] = useState<
    Set<number | "none">
  >(new Set());
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [displayPageSize, setDisplayPageSize] = useValidatedCollectionPageSize(
    ORNAMENTS_PAGE_SIZE_KEY,
    PAGE_SIZE_OPTIONS,
    50,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [cachedYears, setCachedYears] = useState<number[]>([]);
  const [quickEditItem, setQuickEditItem] =
    useState<OrnamentsOrnamentItem | null>(null);
  const [categoryEditItem, setCategoryEditItem] = useState<
    (typeof items)[number] | null
  >(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const reanalyze = useReanalyzeOrnament();

  const deleteOrnament = useDeleteOrnament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        setDeleteConfirmId(null);
        setQuickEditItem(null);
        toast.success("Ornament deleted");
      },
      onError: () => toast.error("Failed to delete ornament."),
    },
  });

  const updateOrnamentCategories = useUpdateOrnament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        setCategoryEditItem(null);
        toast.success("Categories saved");
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Filtering, sorting, facets, and pagination are performed against the
  // complete matching set by the API rather than the first client-loaded page.
  const queryParams: Record<string, unknown> = {
    page: currentPage,
    pageSize: displayPageSize,
    sort,
  };
  if (debouncedSearch) queryParams.q = debouncedSearch;
  if (selectedYear) queryParams.year = selectedYear;
  if (activeColor) queryParams.color = activeColor;
  const numericCategoryIds = [...filterCategoryIds].filter(
    (id): id is number => typeof id === "number",
  );
  if (numericCategoryIds.length > 0)
    queryParams.categoryIds = numericCategoryIds;
  if (filterCategoryIds.has("none")) queryParams.uncategorized = true;

  const { data, isLoading, isError, refetch } = useListOrnaments(queryParams);
  const items = data?.items || [];

  const { data: categories } = useListOrnamentCategories();

  // Cache available years from the first full (unfiltered) load so the year
  // dropdown stays populated even when a year filter is active.
  useEffect(() => {
    if (!selectedYear && !debouncedSearch && data?.items) {
      const years = [
        ...new Set(
          data.items.map((i) => i.year).filter((y): y is number => y != null),
        ),
      ].sort((a, b) => b - a);
      if (years.length > 0) setCachedYears(years);
    }
  }, [data?.items, selectedYear, debouncedSearch]);

  // The server returns a globally sorted and filtered page.
  const sortedItems = items;
  const filteredItems = items;

  const uniqueColors = data?.facets.colors ?? [];

  // Stat bar data is computed by the API over the complete matching set.
  const statBarStats = useMemo(() => {
    const minYear = data?.stats.minYear ?? null;
    const maxYear = data?.stats.maxYear ?? null;
    const yearRange =
      minYear !== null && maxYear !== null
        ? minYear === maxYear
          ? String(minYear)
          : `${minYear}–${maxYear}`
        : "—";
    return [
      { value: data?.total ?? 0, label: "Matching ornaments" },
      { value: data?.stats.categoryCount ?? 0, label: "Categories" },
      { value: data?.stats.brandCount ?? 0, label: "Brands" },
      { value: yearRange, label: "Year range" },
    ];
  }, [data]);

  // Pagination metadata is authoritative from the server.
  const totalPages = data?.totalPages ?? 1;
  const pagedItems = filteredItems;

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterCategoryIds, activeColor, selectedYear, sort]);

  function handleCategoryToggle(id: number | "none") {
    setFilterCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleColorToggle(color: string) {
    setActiveColor((prev) => (prev === color ? null : color));
  }

  function handlePageSizeChange(n: number) {
    setDisplayPageSize(n);
    setCurrentPage(1);
  }

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "ornaments-collection",
    `Main collection page showing ${filteredItems.length} of ${data?.total ?? items.length} ornaments. Search: "${debouncedSearch}". Category filter: ${filterCategoryIds.size > 0 ? [...filterCategoryIds].join(", ") : "none"}. Color filter: ${activeColor ?? "none"}. Year filter: ${selectedYear ?? "none"}.\n${formatElaineContextList(
      filteredItems,
      {
        label: "Visible ornaments (itemId — name, key details)",
        formatItem: (item) =>
          formatElaineContextEntity({
            entity: "item",
            id: item.id,
            label: item.name || "Unnamed",
            details: [
              item.brand && `brand: ${item.brand}`,
              item.year ? `year: ${item.year}` : undefined,
              item.seriesOrCollection && `series: ${item.seriesOrCollection}`,
              item.categories?.length
                ? `categories: ${item.categories.map((category) => category.name).join(", ")} (categoryIds: ${item.categories.map((category) => category.id).join(", ")})`
                : undefined,
            ],
          }),
      },
    )}.${configSummary ? `\n\n${configSummary}` : ""}`,
  );

  // Year filter dropdown (passed as extraControls to the search bar)
  const yearFilter = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent relative",
            selectedYear && "border-primary text-primary",
          )}
        >
          <CalendarHeart className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">
            {selectedYear ? String(selectedYear) : "Year"}
          </span>
          {selectedYear && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 rounded-full bg-primary" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-36 max-h-[300px] overflow-y-auto"
      >
        <DropdownMenuLabel>Filter by year</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setSelectedYear(null)}
          className={cn(
            "gap-2",
            selectedYear === null && "font-medium text-primary",
          )}
        >
          {selectedYear === null && <Check className="h-3.5 w-3.5 shrink-0" />}
          {selectedYear !== null && <span className="w-3.5 shrink-0" />}
          All Years
        </DropdownMenuItem>
        {cachedYears.map((y) => (
          <DropdownMenuItem
            key={y}
            onClick={() => setSelectedYear(y)}
            className={cn(
              "gap-2",
              selectedYear === y && "font-medium text-primary",
            )}
          >
            {selectedYear === y && <Check className="h-3.5 w-3.5 shrink-0" />}
            {selectedYear !== y && <span className="w-3.5 shrink-0" />}
            {y}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-serif font-bold tracking-tight text-foreground">
            My Collection
          </h1>
          <p className="text-muted-foreground mt-1">
            {isLoading
              ? "Loading ornaments..."
              : `${data?.total || 0} hallmark keepsake${data?.total !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            asChild
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
          >
            <Link href="/ornaments/camera-add">
              <Plus className="mr-2 h-4 w-4" /> Add Ornament
            </Link>
          </Button>
        </div>
      </div>

      <NextHallmarkEventCard />

      {/* Stat bar */}
      <CollectionStatBar stats={statBarStats} loading={isLoading} />

      {/* Unified search/sort/filter bar */}
      <CollectionSearchBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, series, or brand…"
        sort={sort}
        onSortChange={(v) => setSort(v as OrnamentSortKey)}
        sortOptions={SORT_OPTIONS}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          bgColor: c.bgColor ?? null,
          textColor: c.textColor ?? null,
        }))}
        activeCategoryIds={filterCategoryIds}
        onCategoryToggle={handleCategoryToggle}
        colors={uniqueColors}
        activeColor={activeColor}
        onColorToggle={handleColorToggle}
        colorToHex={colorToHex}
        pageSize={displayPageSize}
        onPageSizeChange={handlePageSizeChange}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageSizeStorageKey={ORNAMENTS_PAGE_SIZE_KEY}
        extraControls={yearFilter}
      />

      {/* Grid View */}
      {viewMode === "grid" && (
        <CollectionGrid>
          {pagedItems.map((item) => (
            <CollectionCard
              key={item.id}
              id={item.id}
              name={item.name}
              imageUrl={item.imageUrl}
              href={`/ornaments/ornament/${item.id}`}
              subtitle={[
                item.brand,
                item.year ? String(item.year) : null,
                item.seriesOrCollection,
              ]
                .filter(Boolean)
                .join(" · ")}
              categories={(item.categories ?? []).map((c) => ({
                id: c.id,
                name: c.name,
                bgColor: c.bgColor ?? null,
                textColor: c.textColor ?? null,
              }))}
              colorDots={
                (item.dominantColors ?? []).length > 0 ? (
                  <DominantColorDots
                    colors={item.dominantColors ?? []}
                    toHex={colorToHex}
                    className="mt-1.5"
                  />
                ) : undefined
              }
              quantityBadge={
                item.quantity > 1 ? (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    ×{item.quantity}
                  </span>
                ) : undefined
              }
              onQuickEdit={() =>
                setQuickEditItem(item as unknown as OrnamentsOrnamentItem)
              }
              onSetCategories={() => setCategoryEditItem(item)}
              onReanalyze={() =>
                void reanalyze.mutateAsync({ id: item.id }).then(() =>
                  queryClient.invalidateQueries({
                    queryKey: getListOrnamentsQueryKey(),
                  }),
                )
              }
              onDelete={() => setDeleteConfirmId(item.id)}
              extraMenuItems={
                <DropdownMenuItem asChild>
                  <Link href={`/ornaments/ornament/${item.id}?edit=1`}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Edit
                  </Link>
                </DropdownMenuItem>
              }
              LinkComponent={Link}
            />
          ))}
        </CollectionGrid>
      )}
      {viewMode === "grid" && totalPages > 1 && (
        <GalleryPaginator
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          className="mt-4"
        />
      )}

      {/* List View */}
      {viewMode === "list" && (
        <CollectionList>
          {pagedItems.map((item) => (
            <CollectionListRow
              key={item.id}
              id={item.id}
              name={item.name}
              imageUrl={item.imageUrl}
              href={`/ornaments/ornament/${item.id}`}
              subtitle={
                <span>
                  {item.brand}
                  {item.year ? ` · ${item.year}` : ""}
                </span>
              }
              detail={
                item.seriesOrCollection ? (
                  <span className="italic">{item.seriesOrCollection}</span>
                ) : undefined
              }
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
              colorDots={
                (item.dominantColors ?? []).length > 0 ? (
                  <DominantColorDots
                    colors={item.dominantColors ?? []}
                    toHex={colorToHex}
                    className="mt-1"
                  />
                ) : undefined
              }
              valueDisplay={
                item.bookValue != null ? (
                  <span className="font-medium text-primary/80">
                    ${item.bookValue.toFixed(0)}
                  </span>
                ) : undefined
              }
              onQuickEdit={() =>
                setQuickEditItem(item as unknown as OrnamentsOrnamentItem)
              }
              onSetCategories={() => setCategoryEditItem(item)}
              onReanalyze={() =>
                void reanalyze.mutateAsync({ id: item.id }).then(() =>
                  queryClient.invalidateQueries({
                    queryKey: getListOrnamentsQueryKey(),
                  }),
                )
              }
              onDelete={() => setDeleteConfirmId(item.id)}
              extraMenuItems={
                <DropdownMenuItem asChild>
                  <Link href={`/ornaments/ornament/${item.id}?edit=1`}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Edit
                  </Link>
                </DropdownMenuItem>
              }
              LinkComponent={Link}
            />
          ))}
        </CollectionList>
      )}
      {viewMode === "list" && totalPages > 1 && (
        <GalleryPaginator
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          className="mt-4"
        />
      )}

      {/* Quick edit sheet */}
      {quickEditItem && (
        <QuickEditOrnamentSheet
          ornament={quickEditItem}
          onClose={() => setQuickEditItem(null)}
          onDeleted={() => setQuickEditItem(null)}
        />
      )}

      {/* Set categories dialog */}
      <CategoryEditDialog
        open={categoryEditItem !== null}
        onClose={() => setCategoryEditItem(null)}
        title={categoryEditItem?.name ?? ""}
        currentCategories={
          (categoryEditItem?.categories ?? []) as unknown as QuiltingCategory[]
        }
        allCategories={(categories ?? []) as unknown as QuiltingCategory[]}
        onSave={(names) => {
          if (categoryEditItem) {
            const cats = (categories ?? [])
              .filter((c) => names.includes(c.name))
              .map((c) => c.id);
            updateOrnamentCategories.mutate({
              id: categoryEditItem.id,
              data: { categoryIds: cats },
            });
          }
        }}
        isSaving={updateOrnamentCategories.isPending}
      />

      {/* Delete confirm dialog */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(o) => !o && setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ornament?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this ornament from your collection. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteConfirmId !== null &&
                deleteOrnament.mutate({ id: deleteConfirmId })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isError && (
        <CollectionErrorState
          onRetry={refetch}
          message="Couldn't load your ornaments — check your connection."
        />
      )}

      {!isLoading && !isError && filteredItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-border rounded-2xl bg-card shadow-sm">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <ImageIcon className="h-8 w-8 text-muted-foreground opacity-50" />
          </div>
          <h2 className="text-xl font-serif font-bold text-foreground">
            No ornaments found
          </h2>
          <p className="text-muted-foreground mt-2 max-md">
            {search || filterCategoryIds.size > 0
              ? "Try adjusting your search or filters to find what you're looking for."
              : "Your collection is empty. Start by adding your first hallmark keepsake."}
          </p>
          {!search && filterCategoryIds.size === 0 && (
            <Button asChild className="mt-6 bg-primary text-primary-foreground">
              <Link href="/ornaments/camera-add">
                <Plus className="mr-2 h-4 w-4" /> Add Ornament
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
