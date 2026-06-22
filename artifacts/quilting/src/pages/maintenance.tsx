import { useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  RefreshCw,
  Check,
  Clock,
  Scissors,
  BookOpen,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  useListFabrics,
  useReanalyzeFabric,
  getListFabricsQueryKey,
  useListPatterns,
  useReanalyzePattern,
  getListPatternsQueryKey,
  useListQuilts,
  useReanalyzeQuilt,
  getListQuiltsQueryKey,
  getGetStaleCountQueryKey,
} from "@workspace/api-client-react";
import type { ComponentType } from "react";

type RunStatus = "queued" | "processing" | "done" | "error";

type RefreshItem = {
  id: number;
  name: string;
  imageUrl?: string | null;
  /** Extra text (designer, colourway, etc.) folded into the search filter. */
  searchText?: string;
  /**
   * True when the item is missing its AI embedding (e.g. after a DB restore),
   * so similarity search won't find it until it's re-analysed.
   */
  stale?: boolean;
};

// ---------------------------------------------------------------------------
// One selectable card in the grid
// ---------------------------------------------------------------------------

function RefreshCard({
  item,
  selected,
  status,
  onToggle,
  FallbackIcon,
}: {
  item: RefreshItem;
  selected: boolean;
  status?: RunStatus;
  onToggle: (id: number) => void;
  FallbackIcon: ComponentType<{ className?: string }>;
}) {
  // While queued/processing the card is locked so you can't change selection mid-run.
  const interactive = !status || status === "done" || status === "error";

  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-pressed={selected}
      onClick={() => interactive && onToggle(item.id)}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle(item.id);
        }
      }}
      className={`group relative overflow-hidden rounded-xl border bg-card transition-all ${
        interactive ? "cursor-pointer" : "cursor-default"
      } ${
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-card-border hover:border-primary/40"
      } ${status === "processing" ? "animate-pulse" : ""}`}
    >
      <div className="aspect-square overflow-hidden bg-muted">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FallbackIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Selection check (only when selected and no status yet) */}
      {selected && !status && (
        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="h-4 w-4" />
        </div>
      )}

      {/* Stale (missing-embedding) badge — only when no run status yet */}
      {item.stale && !status && (
        <div
          className="absolute left-2 bottom-9 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
          title="Missing AI data — re-analyse to restore similarity search"
        >
          <AlertTriangle className="h-3 w-3" />
          Needs re-analysis
        </div>
      )}

      {/* Status badge */}
      {status && (
        <div className="absolute right-2 top-2">
          {status === "queued" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background shadow-sm">
              <Clock className="h-3.5 w-3.5" />
            </span>
          )}
          {status === "processing" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            </span>
          )}
          {status === "done" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white shadow-sm">
              <Check className="h-3.5 w-3.5" />
            </span>
          )}
          {status === "error" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm">
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      )}

      <div className="p-2">
        <p className="truncate text-xs font-medium text-foreground">
          {item.name}
        </p>
        {status === "error" && (
          <p className="text-[10px] font-medium text-destructive">
            Re-analyse failed
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic re-analyse panel (state + sequential run loop)
// ---------------------------------------------------------------------------

function ReanalyzePanel({
  items,
  isLoading,
  isError,
  noun,
  nounPlural,
  reanalyze,
  listQueryKey,
  FallbackIcon,
}: {
  items: RefreshItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  noun: string;
  nounPlural: string;
  reanalyze: (id: number) => Promise<unknown>;
  listQueryKey: QueryKey;
  FallbackIcon: ComponentType<{ className?: string }>;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statuses, setStatuses] = useState<Map<number, RunStatus>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const processingRef = useRef(false);

  const displayed = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.searchText ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const totalSelected = selectedIds.size;
  const doneCount = useMemo(
    () => [...statuses.values()].filter((s) => s === "done").length,
    [statuses],
  );
  const errorCount = useMemo(
    () => [...statuses.values()].filter((s) => s === "error").length,
    [statuses],
  );
  const hasStatuses = statuses.size > 0;
  const isFinished = !isRunning && progress.total > 0;
  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((it) => selectedIds.has(it.id));

  const staleItems = useMemo(
    () => displayed.filter((it) => it.stale),
    [displayed],
  );
  const staleCount = staleItems.length;

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSelected) {
        for (const it of displayed) next.delete(it.id);
      } else {
        for (const it of displayed) next.add(it.id);
      }
      return next;
    });
  }

  function selectStale() {
    setSelectedIds(new Set(staleItems.map((it) => it.id)));
  }

  function resetStatuses() {
    setStatuses(new Map());
    setProgress({ done: 0, total: 0 });
  }

  async function startRefresh() {
    if (processingRef.current || selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());

    const initial = new Map<number, RunStatus>();
    for (const id of ids) initial.set(id, "queued");
    setStatuses(initial);

    processingRef.current = true;
    setIsRunning(true);
    setProgress({ done: 0, total: ids.length });

    let done = 0;
    for (const id of ids) {
      setStatuses((prev) => new Map(prev).set(id, "processing"));
      try {
        await reanalyze(id);
        setStatuses((prev) => new Map(prev).set(id, "done"));
        queryClient.invalidateQueries({ queryKey: listQueryKey });
        // Refresh the app-shell "needs re-analysis" badge as items clear.
        queryClient.invalidateQueries({
          queryKey: getGetStaleCountQueryKey(),
        });
      } catch {
        setStatuses((prev) => new Map(prev).set(id, "error"));
      }
      done += 1;
      setProgress({ done, total: ids.length });
    }

    processingRef.current = false;
    setIsRunning(false);
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Bulk re-analyse</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Select any {nounPlural} you want the AI to re-examine — descriptions,
        colours, and details will all be refreshed, and similarity data is
        rebuilt. Locked fields are never overwritten.
      </p>

      {/* Progress banner */}
      {isRunning && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Refreshing {progress.done} of {progress.total} {nounPlural}…
          </div>
          <Progress
            value={progress.total ? (progress.done / progress.total) * 100 : 0}
            className="mt-2 h-2"
          />
        </div>
      )}

      {/* Result banner */}
      {isFinished && hasStatuses && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
            errorCount === 0
              ? "border-green-600/30 bg-green-600/5 text-green-700 dark:text-green-400"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          <span className="flex-1">
            {errorCount === 0
              ? `All ${doneCount} ${doneCount === 1 ? noun : nounPlural} refreshed successfully.`
              : `${doneCount} refreshed, ${errorCount} failed — failed items are marked in red.`}
          </span>
          <button
            onClick={resetStatuses}
            aria-label="Dismiss"
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Stale-items banner */}
      {!isRunning && staleCount > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            {staleCount} {staleCount === 1 ? noun : nounPlural}{" "}
            {staleCount === 1 ? "is" : "are"} missing AI similarity data —
            likely after a database restore. Re-analyse{" "}
            {staleCount === 1 ? "it" : "them"} to make{" "}
            {staleCount === 1 ? "it" : "them"} findable in Compare again.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${nounPlural}…`}
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

        <Button
          variant="outline"
          size="sm"
          onClick={toggleSelectAll}
          disabled={displayed.length === 0 || isRunning}
        >
          {allDisplayedSelected ? "Deselect all" : "Select all"}
        </Button>

        {staleCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={selectStale}
            disabled={isRunning}
            className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          >
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
            Select all stale ({staleCount})
          </Button>
        )}

        {totalSelected > 0 && !isRunning && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear ({totalSelected})
          </Button>
        )}

        <Button
          className="ml-auto"
          size="sm"
          onClick={startRefresh}
          disabled={totalSelected === 0 || isRunning}
        >
          <RefreshCw
            className={`mr-2 h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`}
          />
          {isRunning
            ? `Refreshing… (${progress.done}/${progress.total})`
            : `Refresh ${totalSelected} ${totalSelected === 1 ? noun : nounPlural}`}
        </Button>
      </div>

      {/* Grid */}
      <div className="mt-4">
        {isLoading && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-card-border"
              >
                <Skeleton className="aspect-square w-full" />
                <div className="p-2">
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex h-32 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5">
            <p className="text-sm text-destructive">
              Failed to load {nounPlural}. Please refresh.
            </p>
          </div>
        )}

        {!isLoading && !isError && displayed.length === 0 && (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border">
            <p className="text-sm text-muted-foreground">
              No {nounPlural} found.
            </p>
          </div>
        )}

        {!isLoading && !isError && displayed.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {displayed.map((item) => (
              <RefreshCard
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                status={statuses.get(item.id)}
                onToggle={toggleSelect}
                FallbackIcon={FallbackIcon}
              />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      {hasStatuses && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Queued
          </span>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Processing
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-green-600" /> Done
          </span>
          <span className="flex items-center gap-1.5">
            <X className="h-3.5 w-3.5 text-destructive" /> Error
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-entity wrappers (each binds its own list + reanalyze hooks)
// ---------------------------------------------------------------------------

function FabricsPanel() {
  const { data, isLoading, isError } = useListFabrics();
  const reanalyze = useReanalyzeFabric();
  const items = data?.map((f) => ({
    id: f.id,
    name: f.name,
    imageUrl: f.imageUrl,
    searchText: [f.designer, f.colorway, f.printType].filter(Boolean).join(" "),
    stale: !f.hasEmbedding,
  }));
  return (
    <ReanalyzePanel
      items={items}
      isLoading={isLoading}
      isError={isError}
      noun="fabric"
      nounPlural="fabrics"
      reanalyze={(id) => reanalyze.mutateAsync({ id })}
      listQueryKey={getListFabricsQueryKey()}
      FallbackIcon={Scissors}
    />
  );
}

function PatternsPanel() {
  const { data, isLoading, isError } = useListPatterns();
  const reanalyze = useReanalyzePattern();
  const items = data?.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    searchText: [p.designer, p.blockSize, p.difficulty]
      .filter(Boolean)
      .join(" "),
    stale: !p.hasEmbedding,
  }));
  return (
    <ReanalyzePanel
      items={items}
      isLoading={isLoading}
      isError={isError}
      noun="pattern"
      nounPlural="patterns"
      reanalyze={(id) => reanalyze.mutateAsync({ id })}
      listQueryKey={getListPatternsQueryKey()}
      FallbackIcon={BookOpen}
    />
  );
}

function QuiltsPanel() {
  const { data, isLoading, isError } = useListQuilts();
  const reanalyze = useReanalyzeQuilt();
  const items = data?.map((q) => ({
    id: q.id,
    name: q.name,
    imageUrl: q.imageUrl,
    searchText: [q.recipient].filter(Boolean).join(" "),
  }));
  return (
    <ReanalyzePanel
      items={items}
      isLoading={isLoading}
      isError={isError}
      noun="quilt"
      nounPlural="quilts"
      reanalyze={(id) => reanalyze.mutateAsync({ id })}
      listQueryKey={getListQuiltsQueryKey()}
      FallbackIcon={Layers}
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Maintenance() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">Maintenance</h1>
      <p className="text-sm text-muted-foreground">
        Housekeeping tools for your collection.
      </p>

      <Tabs defaultValue="fabrics" className="mt-6">
        <TabsList>
          <TabsTrigger value="fabrics">
            <Scissors className="mr-1.5 h-4 w-4" />
            Fabrics
          </TabsTrigger>
          <TabsTrigger value="patterns">
            <BookOpen className="mr-1.5 h-4 w-4" />
            Patterns
          </TabsTrigger>
          <TabsTrigger value="quilts">
            <Layers className="mr-1.5 h-4 w-4" />
            Quilts
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fabrics" className="mt-4">
          <FabricsPanel />
        </TabsContent>
        <TabsContent value="patterns" className="mt-4">
          <PatternsPanel />
        </TabsContent>
        <TabsContent value="quilts" className="mt-4">
          <QuiltsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
