import { useState, useRef, useMemo } from "react";
import {
  useListPottery,
  useGetStragglers,
  bulkReanalyzePottery,
  getListPotteryQueryKey,
  getGetStragglersQueryKey,
} from "@workspace/api-client-react";
import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Check,
  Search,
  X,
  Sparkles,
  AlertTriangle,
  Wand2,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePageAssistantContext } from "@/lib/assistant-context";

type RefreshStatus = "queued" | "processing" | "done" | "error";
type RunSource = "bulk" | "stragglers";

// ---------------------------------------------------------------------------
// RefreshCard
// ---------------------------------------------------------------------------
function RefreshCard({
  item,
  selected,
  status,
  selectable = true,
  onToggle,
}: {
  item: PotteryItem;
  selected: boolean;
  status: RefreshStatus | undefined;
  selectable?: boolean;
  onToggle: (id: number) => void;
}) {
  const interactive =
    selectable && (!status || status === "done" || status === "error");

  return (
    <div
      role={selectable ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={() => interactive && onToggle(item.id)}
      onKeyDown={(e) => e.key === "Enter" && interactive && onToggle(item.id)}
      aria-pressed={selectable ? selected : undefined}
      className={cn(
        "relative select-none overflow-hidden rounded-xl border bg-card shadow-sm transition",
        interactive
          ? selected
            ? "cursor-pointer border-primary ring-2 ring-primary/30"
            : "cursor-pointer border-card-border hover:border-primary/40"
          : "cursor-default border-card-border",
        status === "processing" && "animate-pulse",
      )}
    >
      {/* Thumbnail */}
      <div className="aspect-square overflow-hidden bg-muted">
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]"
        />
      </div>

      {/* Status badge — top-right */}
      {status && (
        <div className="absolute right-1.5 top-1.5">
          {status === "queued" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/40 shadow backdrop-blur-sm">
              <Clock className="h-3.5 w-3.5 text-white" />
            </span>
          )}
          {status === "processing" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary shadow backdrop-blur-sm">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-white" />
            </span>
          )}
          {status === "done" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 shadow backdrop-blur-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
            </span>
          )}
          {status === "error" && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive shadow backdrop-blur-sm">
              <XCircle className="h-3.5 w-3.5 text-white" />
            </span>
          )}
        </div>
      )}

      {/* Selection check — top-left (only when selected and idle) */}
      {selectable && selected && !status && (
        <div className="absolute left-1.5 top-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary shadow">
            <Check className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
      )}

      {/* Name */}
      <div className="p-2">
        <p className="truncate text-xs font-medium leading-tight">
          {item.name}
        </p>
        {status === "error" && (
          <p className="mt-0.5 truncate text-[10px] text-destructive">
            Re-analyse failed
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------
function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maintenance page
// ---------------------------------------------------------------------------
export default function Maintenance() {
  const queryClient = useQueryClient();
  const { data: listData, isLoading } = useListPottery({ pageSize: 200 });
  const data = listData?.items;
  const { data: stragglerData, isLoading: stragglersLoading } =
    useGetStragglers();

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [statuses, setStatuses] = useState<Map<number, RefreshStatus>>(
    new Map(),
  );
  const [isRunning, setIsRunning] = useState(false);
  const [runSource, setRunSource] = useState<RunSource | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const processingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const [wasStopped, setWasStopped] = useState(false);

  // Index pieces by id so we can render straggler thumbnails from the list.
  const itemsById = useMemo(() => {
    const map = new Map<number, PotteryItem>();
    for (const item of data ?? []) map.set(item.id, item);
    return map;
  }, [data]);

  // Stragglers resolved to full pieces (in case any id isn't in the list yet).
  const stragglerItems = useMemo(() => {
    if (!stragglerData) return [];
    return stragglerData.items
      .map((s) => itemsById.get(s.id))
      .filter((i): i is PotteryItem => Boolean(i));
  }, [stragglerData, itemsById]);

  const embeddingCount =
    stragglerData?.items.filter((s) => s.reasons.includes("embedding"))
      .length ?? 0;
  const attributeCount =
    stragglerData?.items.filter((s) => s.reasons.includes("attributes"))
      .length ?? 0;
  const stragglerCount = stragglerData?.items.length ?? 0;

  // Filtered list for the bulk section.
  const displayed = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.shape ?? "").toLowerCase().includes(q) ||
        (item.style ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(displayed.map((i) => i.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Shared re-analyse loop used by both the bulk and straggler sections.
  // Sends up to 20 IDs at a time to the bulk endpoint (which is rate-limited
  // separately from single-item reanalyze) and maps succeeded/failed back to
  // the per-item status display.
  // 2 items per batch keeps each HTTP request well under the Replit proxy's
  // 30-second connection timeout even when AI calls are slow.
  const BATCH_SIZE = 2;
  async function runReanalyze(ids: number[], source: RunSource) {
    if (processingRef.current || ids.length === 0) return;

    stopRequestedRef.current = false;
    setWasStopped(false);
    setStatuses(new Map(ids.map((id) => [id, "queued" as RefreshStatus])));
    processingRef.current = true;
    setIsRunning(true);
    setRunSource(source);
    setProgress({ done: 0, total: ids.length });

    let done = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      if (stopRequestedRef.current) {
        setWasStopped(true);
        break;
      }

      const batch = ids.slice(i, i + BATCH_SIZE);

      // Mark the whole batch as in-progress
      setStatuses((prev) => {
        const next = new Map(prev);
        for (const id of batch) next.set(id, "processing");
        return next;
      });

      try {
        const result = await bulkReanalyzePottery({ ids: batch });
        const succeededSet = new Set(result.succeeded);
        setStatuses((prev) => {
          const next = new Map(prev);
          for (const id of batch)
            next.set(id, succeededSet.has(id) ? "done" : "error");
          return next;
        });
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
      } catch {
        // Network-level failure — mark the whole batch as errored
        setStatuses((prev) => {
          const next = new Map(prev);
          for (const id of batch) next.set(id, "error");
          return next;
        });
      }

      done += batch.length;
      setProgress({ done, total: ids.length });
    }

    queryClient.invalidateQueries({ queryKey: getGetStragglersQueryKey() });
    processingRef.current = false;
    setIsRunning(false);
  }

  function startBulkRefresh() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    clearSelection();
    void runReanalyze(ids, "bulk");
  }

  function startStragglerRefresh() {
    void runReanalyze(
      stragglerData?.items.map((s) => s.id) ?? [],
      "stragglers",
    );
  }

  function resetStatuses() {
    setStatuses(new Map());
    setRunSource(null);
    setProgress({ done: 0, total: 0 });
    setWasStopped(false);
  }

  const totalSelected = selectedIds.size;
  const doneCount = [...statuses.values()].filter((s) => s === "done").length;
  const errorCount = [...statuses.values()].filter((s) => s === "error").length;
  const isFinished = !isRunning && progress.total > 0;

  // Progress / result banner — rendered inside whichever section started the run.
  function StatusBanner({ source }: { source: RunSource }) {
    if (runSource !== source) return null;
    return (
      <>
        {isRunning && (
          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-sm font-medium text-primary">
              <span>
                Refreshing {progress.done} of {progress.total} pieces…
              </span>
              <button
                type="button"
                onClick={() => {
                  stopRequestedRef.current = true;
                }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Stop after current batch finishes"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Stop
              </button>
            </div>
            <ProgressBar done={progress.done} total={progress.total} />
          </div>
        )}

        {isFinished && (
          <div
            className={cn(
              "mt-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm",
              wasStopped
                ? "border-amber-500/20 bg-amber-500/5"
                : errorCount > 0
                  ? "border-destructive/20 bg-destructive/5"
                  : "border-green-500/20 bg-green-500/5",
            )}
          >
            <span
              className={
                wasStopped
                  ? "text-amber-700"
                  : errorCount > 0
                    ? "text-destructive"
                    : "text-green-700"
              }
            >
              {wasStopped
                ? `Stopped — ${doneCount} piece${doneCount === 1 ? "" : "s"} refreshed, ${progress.total - progress.done} skipped.`
                : errorCount > 0
                  ? `${doneCount} refreshed, ${errorCount} failed — failed items are marked in red.`
                  : `All ${doneCount} piece${doneCount === 1 ? "" : "s"} refreshed successfully.`}
            </span>
            <button
              type="button"
              onClick={resetStatuses}
              className="ml-4 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </>
    );
  }

  usePageAssistantContext(
    "pottery-maintenance",
    isLoading || stragglersLoading
      ? undefined
      : `Maintenance page: housekeeping tools for the collection. AI re-analyse stragglers: ${stragglerCount} piece(s) need attention (${embeddingCount} missing similarity data, ${attributeCount} missing details)${isRunning && runSource === "stragglers" ? ` — a straggler refresh is in progress (${progress.done}/${progress.total})` : ""}. Bulk re-analyse: ${data?.length ?? 0} total pieces, ${totalSelected} currently selected for re-analysis${isRunning && runSource === "bulk" ? ` — a bulk refresh is in progress (${progress.done}/${progress.total})` : ""}. Locked fields are never overwritten by re-analysis.`,
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Maintenance</h1>
        <p className="text-sm text-muted-foreground">
          Housekeeping tools for your collection.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* AI re-analyse stragglers section                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Wand2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">AI re-analyse stragglers</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Finds pieces the AI never fully processed — ones with no
              similarity data (so they can&apos;t appear in “Do I own this?”) or
              no extracted details — and fixes just those in one click. Locked
              fields are never overwritten.
            </p>
          </div>
        </div>

        {stragglersLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-9 w-44" />
          </div>
        ) : stragglerCount === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Every piece is fully analysed — nothing needs attention right now.
            </span>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {stragglerCount} piece{stragglerCount === 1 ? "" : "s"} need
                attention
              </span>
              {embeddingCount > 0 && (
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {embeddingCount} missing similarity data
                </span>
              )}
              {attributeCount > 0 && (
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {attributeCount} missing details
                </span>
              )}
              <Button
                size="sm"
                onClick={startStragglerRefresh}
                disabled={isRunning}
                className="ml-auto"
              >
                <Sparkles
                  className={cn("h-4 w-4", isRunning && "animate-pulse")}
                />
                {isRunning && runSource === "stragglers"
                  ? `Re-analysing… (${progress.done}/${progress.total})`
                  : `Re-analyse ${stragglerCount} straggler${stragglerCount === 1 ? "" : "s"}`}
              </Button>
            </div>

            {stragglerItems.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {stragglerItems.map((item) => (
                  <RefreshCard
                    key={item.id}
                    item={item}
                    selected={false}
                    selectable={false}
                    status={statuses.get(item.id)}
                    onToggle={() => {}}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <StatusBanner source="stragglers" />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Bulk re-analyse section                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Bulk re-analyse</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Select any pieces you want the AI to re-examine — colours,
              pattern, shape, dimensions, and maker info will all be refreshed.
              Locked fields are never overwritten.
            </p>
          </div>
        </div>

        <StatusBanner source="bulk" />

        {/* Toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pieces…"
              className="pl-9"
              disabled={isRunning}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={
              totalSelected === displayed.length ? clearSelection : selectAll
            }
            disabled={isRunning || displayed.length === 0}
          >
            {totalSelected === displayed.length && displayed.length > 0
              ? "Deselect all"
              : "Select all"}
          </Button>

          {totalSelected > 0 && !isRunning && (
            <Button variant="outline" size="sm" onClick={clearSelection}>
              Clear ({totalSelected})
            </Button>
          )}

          <Button
            size="sm"
            onClick={startBulkRefresh}
            disabled={isRunning || totalSelected === 0}
            className="ml-auto"
          >
            <RefreshCw className={cn("h-4 w-4", isRunning && "animate-spin")} />
            {isRunning && runSource === "bulk"
              ? `Refreshing… (${progress.done}/${progress.total})`
              : totalSelected > 0
                ? `Refresh ${totalSelected} piece${totalSelected === 1 ? "" : "s"}`
                : "Refresh selected"}
          </Button>
        </div>

        {/* Grid */}
        <div className="mt-4">
          {isLoading ? (
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
          ) : displayed.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pieces found.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {displayed.map((item) => (
                <RefreshCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  status={statuses.get(item.id)}
                  onToggle={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>

        {/* Legend */}
        {statuses.size > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> Queued
            </span>
            <span className="flex items-center gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" /> Processing
            </span>
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" /> Done
            </span>
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="h-3 w-3" /> Error
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
