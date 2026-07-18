import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Plus,
  Trash2,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useListWatchlistItems,
  useCreateWatchlistItem,
  useDeleteWatchlistItem,
  useScanWatchlistItem,
  useListWatchlistAlerts,
  useDismissWatchlistAlert,
  getListWatchlistItemsQueryKey,
  getListWatchlistAlertsQueryKey,
  type PotteryWatchlistItem,
} from "@workspace/api-client-react";

function formatRelative(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function AlertsPanel({ itemId }: { itemId: number }) {
  const qc = useQueryClient();
  const { data: alerts = [], isLoading } = useListWatchlistAlerts(itemId);
  const dismiss = useDismissWatchlistAlert();

  if (isLoading) {
    return (
      <div className="space-y-1.5 mt-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic mt-2 pl-1">
        No alerts yet — run a scan to check for new listings.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`rounded-lg border px-3 py-2 text-xs flex items-start justify-between gap-2 ${
            alert.dismissed
              ? "bg-muted/30 border-muted text-muted-foreground"
              : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium line-clamp-2">{alert.title}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {alert.priceUsd != null && (
                <span className="text-amber-700">
                  ${parseFloat(alert.priceUsd).toFixed(2)}
                </span>
              )}
              {alert.soldAt && (
                <span className="text-amber-600">
                  {formatRelative(alert.soldAt)}
                </span>
              )}
              {alert.condition && (
                <span className="text-amber-500">{alert.condition}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {alert.listingUrl && (
              <a
                href={alert.listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary"
                title="View listing"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!alert.dismissed && (
              <button
                onClick={async () => {
                  await dismiss.mutateAsync({ id: itemId, alertId: alert.id });
                  qc.invalidateQueries({
                    queryKey: getListWatchlistAlertsQueryKey(itemId),
                  });
                }}
                disabled={dismiss.isPending}
                className="text-amber-400 hover:text-amber-700"
                title="Dismiss"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function WatchlistCard({ item }: { item: PotteryWatchlistItem }) {
  const qc = useQueryClient();
  const del = useDeleteWatchlistItem();
  const scan = useScanWatchlistItem();
  const [expanded, setExpanded] = useState(false);

  async function handleScan() {
    try {
      toast.loading("Scanning eBay…", { id: `scan-${item.id}` });
      const result = await scan.mutateAsync({ id: item.id });
      toast.dismiss(`scan-${item.id}`);
      const newCount = result.newAlerts ?? 0;
      if (newCount > 0) {
        toast.success(
          `Found ${newCount} new listing${newCount !== 1 ? "s" : ""}!`,
        );
        setExpanded(true);
      } else {
        toast.success("Scan complete — no new listings found.");
      }
      qc.invalidateQueries({ queryKey: getListWatchlistItemsQueryKey() });
      qc.invalidateQueries({
        queryKey: getListWatchlistAlertsQueryKey(item.id),
      });
    } catch {
      toast.dismiss(`scan-${item.id}`);
      toast.error("Scan failed. Please try again.");
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove watchlist item "${item.title}"?`)) return;
    await del.mutateAsync({ id: item.id });
    qc.invalidateQueries({ queryKey: getListWatchlistItemsQueryKey() });
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-snug">{item.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">
            {item.keywords}
          </p>
          <div className="flex flex-wrap gap-x-3 mt-0.5">
            {(item.priceMinUsd != null || item.priceMaxUsd != null) && (
              <span className="text-xs text-muted-foreground">
                {item.priceMinUsd ? `$${item.priceMinUsd}` : "any"} –{" "}
                {item.priceMaxUsd ? `$${item.priceMaxUsd}` : "any"}
              </span>
            )}
            {item.lastCheckedAt && (
              <span className="text-xs text-muted-foreground">
                Scanned {formatRelative(item.lastCheckedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scan.isPending}
            className="h-7 px-2 text-xs"
            title="Scan eBay now"
          >
            {scan.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCcw className="h-3 w-3" />
            )}
          </Button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="h-7 w-7 flex items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground"
            title="Show alerts"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={del.isPending}
            className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-3">
          <AlertsPanel itemId={item.id} />
        </div>
      )}
    </div>
  );
}

function AddWatchlistForm() {
  const qc = useQueryClient();
  const create = useCreateWatchlistItem();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !keywords.trim()) return;
    try {
      await create.mutateAsync({
        data: {
          title: title.trim(),
          keywords: keywords.trim(),
          priceMinUsd: minPrice ? parseFloat(minPrice) : undefined,
          priceMaxUsd: maxPrice ? parseFloat(maxPrice) : undefined,
        },
      });
      setTitle("");
      setKeywords("");
      setMinPrice("");
      setMaxPrice("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: getListWatchlistItemsQueryKey() });
      toast.success("Watchlist item added.");
    } catch {
      toast.error("Failed to add watchlist item.");
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Add keyword watch
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card border border-border rounded-xl p-4 space-y-3"
    >
      <p className="text-sm font-medium">New watchlist entry</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Label</Label>
        <Input
          autoFocus
          placeholder="e.g. Blue Wedgwood vase"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">eBay search keywords</Label>
        <Input
          placeholder="e.g. Wedgwood jasperware blue vase vintage"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Min price ($)</Label>
          <Input
            type="number"
            min="0"
            placeholder="0"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max price ($)</Label>
          <Input
            type="number"
            min="0"
            placeholder="any"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || !keywords.trim() || create.isPending}
        >
          {create.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function PotteryWatchlist() {
  const { data: items, isLoading, isError } = useListWatchlistItems();

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Pottery Watchlist</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Track keywords on eBay sold listings and get alerted when matching
          pieces appear.
        </p>
      </div>

      <AddWatchlistForm />

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive text-sm p-4 bg-destructive/10 rounded-xl">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load watchlist. Please refresh.
        </div>
      )}

      {!isLoading && !isError && (!items || items.length === 0) && (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No watchlist items yet.</p>
          <p className="text-xs mt-1">
            Add a keyword above to start tracking eBay sold listings.
          </p>
        </div>
      )}

      {!isLoading && items && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <WatchlistCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
