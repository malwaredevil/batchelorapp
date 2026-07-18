import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  useListOrnaments,
  useListOrnamentCategories,
  useListConnectedCalendars,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  type TravelCalendarEvent,
} from "@workspace/api-client-react";
import {
  Search,
  Plus,
  Filter,
  LayoutGrid,
  List as ListIcon,
  X,
  SlidersHorizontal,
  Image as ImageIcon,
  CalendarHeart,
} from "lucide-react";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { useAppConfigSummary } from "@workspace/elaine-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CollectionErrorState } from "@/components/CollectionErrorState";

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
      const startDate = e.start.slice(0, 10);
      const endDate = (() => {
        if (e.allDay) {
          const d = new Date(e.end + "T00:00:00");
          d.setDate(d.getDate() - 1);
          return d.toISOString().slice(0, 10);
        }
        return e.end.slice(0, 10);
      })();
      return {
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

  return (
    <Link href="/ornaments/hallmark-events">
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
  const [sort, setSort] = useState("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedCat, setSelectedCat] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Use the React Query hook
  // The hook accepts params for pagination/filtering. Adjust to what api actually accepts.
  // Assuming it accepts q, categoryId, etc or we do local filtering.
  // We'll fetch a large page and do local filtering for instant feel,
  // or just pass params to hook.
  // Let's pass params to hook to be safe, assuming Orval typings for ListOrnamentsParams.
  const queryParams: any = { pageSize: 200 };
  if (debouncedSearch) queryParams.q = debouncedSearch;
  if (selectedCat) queryParams.categoryId = selectedCat;

  const { data, isLoading, isError, refetch } = useListOrnaments(queryParams);
  const items = data?.items || [];

  const { data: categories } = useListOrnamentCategories();

  // Local sorting
  const sortedItems = useMemo(() => {
    const copy = [...items];
    switch (sort) {
      case "newest":
        return copy.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      case "oldest":
        return copy.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      case "year-desc":
        return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
      case "year-asc":
        return copy.sort((a, b) => (a.year || 0) - (b.year || 0));
      case "name-asc":
        return copy.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return copy.sort((a, b) => b.name.localeCompare(a.name));
      case "value-desc":
        return copy.sort((a, b) => (b.bookValue || 0) - (a.bookValue || 0));
      default:
        return copy;
    }
  }, [items, sort]);

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "ornaments-collection",
    `Main collection page showing ${items.length} ornaments. Search: "${debouncedSearch}". Category filter: ${selectedCat || "none"}.${configSummary ? `\n\n${configSummary}` : ""}`,
  );

  return (
    <div className="space-y-6">
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
            <Link href="/ornaments/add">
              <Plus className="mr-2 h-4 w-4" /> Add Ornament
            </Link>
          </Button>
        </div>
      </div>

      <NextHallmarkEventCard />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, series, or brand..."
            className="pl-9 bg-card border-card-border shadow-sm h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-10 bg-card border-card-border shadow-sm gap-2"
              >
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <span className="hidden sm:inline">Sort</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                <DropdownMenuRadioItem value="newest">
                  Recently Added
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="oldest">
                  Oldest First
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="year-desc">
                  Release Year (New to Old)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="year-asc">
                  Release Year (Old to New)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name-asc">
                  Name (A-Z)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="value-desc">
                  Highest Value
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-10 bg-card border-card-border shadow-sm gap-2 relative"
              >
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="hidden sm:inline">Category</span>
                {selectedCat && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 max-h-[300px] overflow-y-auto"
            >
              <DropdownMenuLabel>Filter by category</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSelectedCat(null)}
                className={selectedCat === null ? "bg-muted" : ""}
              >
                All Categories
              </DropdownMenuItem>
              {categories?.map((cat) => (
                <DropdownMenuItem
                  key={cat.id}
                  onClick={() => setSelectedCat(cat.id)}
                  className={
                    selectedCat === cat.id ? "bg-muted font-medium" : ""
                  }
                >
                  <div
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: cat.bgColor || "#ccc" }}
                  />
                  {cat.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as any)}
            className="bg-card border border-card-border rounded-md p-1 shadow-sm shrink-0"
          >
            <ToggleGroupItem
              value="grid"
              aria-label="Grid view"
              className="h-8 px-2"
            >
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="list"
              aria-label="List view"
              className="h-8 px-2"
            >
              <ListIcon className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Grid View */}
      {isError && (
        <CollectionErrorState
          onRetry={refetch}
          message="Couldn't load your ornament collection. Check your connection and try again."
        />
      )}

      {viewMode === "grid" && !isError && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {sortedItems.map((item) => (
            <Link
              key={item.id}
              href={`/ornaments/ornament/${item.id}`}
              className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
            >
              <div className="relative aspect-square overflow-hidden rounded-xl bg-muted border border-border group-hover:border-primary/50 transition-colors shadow-sm mb-3">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-secondary/30">
                    <ImageIcon className="h-8 w-8 mb-2 opacity-20" />
                  </div>
                )}
                {item.quantity > 1 && (
                  <div className="absolute top-2 right-2 bg-black/60 text-white backdrop-blur-md px-2 py-0.5 rounded-full text-xs font-medium">
                    x{item.quantity}
                  </div>
                )}
              </div>
              <div>
                <h3 className="font-serif font-bold text-foreground leading-tight line-clamp-1 group-hover:text-primary transition-colors">
                  {item.name}
                </h3>
                <div className="flex items-center text-xs text-muted-foreground mt-1 gap-2">
                  <span className="font-medium text-foreground/70">
                    {item.brand}
                  </span>
                  {item.year && <span>• {item.year}</span>}
                </div>
                {item.seriesOrCollection && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-1">
                    {item.seriesOrCollection}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && !isError && (
        <div className="flex flex-col gap-3">
          {sortedItems.map((item) => (
            <Link
              key={item.id}
              href={`/ornaments/ornament/${item.id}`}
              className="group flex gap-4 p-3 bg-card border border-card-border rounded-xl hover:border-primary/50 transition-colors shadow-sm items-center"
            >
              <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 overflow-hidden rounded-lg bg-muted border border-border">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary/30">
                    <ImageIcon className="h-5 w-5 opacity-30" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 py-1">
                <h3 className="font-serif font-bold text-foreground text-lg leading-tight truncate group-hover:text-primary transition-colors">
                  {item.name}
                </h3>
                <div className="flex flex-wrap items-center text-sm text-muted-foreground mt-1 gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground/80">
                    {item.brand}
                  </span>
                  {item.year && <span>{item.year}</span>}
                  {item.seriesOrCollection && (
                    <span className="italic truncate max-w-[200px]">
                      {item.seriesOrCollection}
                    </span>
                  )}
                  {item.quantity > 1 && (
                    <span className="bg-muted px-1.5 rounded text-xs">
                      Qty: {item.quantity}
                    </span>
                  )}
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-end shrink-0 pl-4">
                {item.bookValue != null && (
                  <span className="font-medium text-primary/80">
                    ${item.bookValue.toFixed(0)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && !isError && sortedItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-border rounded-2xl bg-card shadow-sm">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <ImageIcon className="h-8 w-8 text-muted-foreground opacity-50" />
          </div>
          <h2 className="text-xl font-serif font-bold text-foreground">
            No ornaments found
          </h2>
          <p className="text-muted-foreground mt-2 max-w-md">
            {search || selectedCat
              ? "Try adjusting your search or filters to find what you're looking for."
              : "Your collection is empty. Start by adding your first hallmark keepsake."}
          </p>
          {!search && !selectedCat && (
            <Button asChild className="mt-6 bg-primary text-primary-foreground">
              <Link href="/ornaments/add">
                <Plus className="mr-2 h-4 w-4" /> Add Ornament
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
