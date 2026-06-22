import { useState } from "react";
import {
  PlusCircle,
  ShoppingCart,
  Check,
  Package,
  Trash2,
  ExternalLink,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShoppingItems,
  useGetShoppingStats,
  useCreateShoppingItem,
  useUpdateShoppingItem,
  useDeleteShoppingItem,
  getListShoppingItemsQueryKey,
  getGetShoppingStatsQueryKey,
} from "@workspace/api-client-react";

type Status = "want" | "ordered" | "bought";

const STATUS_LABEL: Record<Status, string> = {
  want: "Want",
  ordered: "Ordered",
  bought: "Bought",
};

const STATUS_COLORS: Record<Status, string> = {
  want: "bg-amber-100 text-amber-800",
  ordered: "bg-blue-100 text-blue-800",
  bought: "bg-green-100 text-green-800",
};

type Item = {
  id: number;
  name: string;
  notes?: string | null;
  url?: string | null;
  quantity?: number | null;
  unit?: string | null;
  estimatedPriceUsd?: number | null;
  actualPriceUsd?: number | null;
  store?: string | null;
  status: Status;
  priority: number;
  createdAt: string;
};

function fmt(n: number | null | undefined) {
  if (n == null) return null;
  return `$${n.toFixed(2)}`;
}

function AddItemDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("yards");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [store, setStore] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("want");

  const create = useCreateShoppingItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListShoppingItemsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetShoppingStatsQueryKey(),
        });
        toast.success("Item added to shopping list");
        onClose();
      },
      onError: () => toast.error("Failed to add item."),
    },
  });

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    create.mutate({
      data: {
        name: name.trim(),
        url: url || null,
        quantity: quantity ? parseFloat(quantity) : null,
        unit: unit || null,
        estimatedPriceUsd: estimatedPrice ? parseFloat(estimatedPrice) : null,
        store: store || null,
        notes: notes || null,
        status,
        priority: 0,
      },
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add to shopping list</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div>
          <Label className="mb-1 text-xs">Item name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Blue floral print, 44″ wide"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-1 text-xs">Quantity</Label>
            <Input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 2.5"
              type="number"
              min="0"
              step="0.25"
            />
          </div>
          <div>
            <Label className="mb-1 text-xs">Unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "yards",
                  "meters",
                  "fat quarters",
                  "half yards",
                  "pieces",
                  "spools",
                ].map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="mb-1 text-xs">Est. price (USD)</Label>
            <Input
              value={estimatedPrice}
              onChange={(e) => setEstimatedPrice(e.target.value)}
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <Label className="mb-1 text-xs">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as Status)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["want", "ordered", "bought"] as Status[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="mb-1 text-xs">Store / source</Label>
          <Input
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="e.g. Etsy, local quilt shop"
          />
        </div>
        <div>
          <Label className="mb-1 text-xs">Link (optional)</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            type="url"
          />
        </div>
        <div>
          <Label className="mb-1 text-xs">Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra details…"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={create.isPending}>
          Add item
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ItemCard({ item }: { item: Item }) {
  const queryClient = useQueryClient();
  const update = useUpdateShoppingItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListShoppingItemsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetShoppingStatsQueryKey(),
        });
      },
      onError: () => toast.error("Failed to update item."),
    },
  });
  const del = useDeleteShoppingItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListShoppingItemsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetShoppingStatsQueryKey(),
        });
        toast.success("Item removed");
      },
      onError: () => toast.error("Failed to delete item."),
    },
  });

  function cycleStatus() {
    const next: Record<Status, Status> = {
      want: "ordered",
      ordered: "bought",
      bought: "want",
    };
    update.mutate({ id: item.id, data: { status: next[item.status] } });
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
        item.status === "bought"
          ? "border-green-200 bg-green-50/50 opacity-75"
          : "border-card-border bg-card"
      }`}
    >
      {/* Status toggle */}
      <button
        onClick={cycleStatus}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          item.status === "bought"
            ? "border-green-500 bg-green-500 text-white"
            : item.status === "ordered"
              ? "border-blue-400 bg-blue-50"
              : "border-muted-foreground/40 hover:border-primary"
        }`}
        title={`Mark as ${item.status === "want" ? "ordered" : item.status === "ordered" ? "bought" : "want"}`}
      >
        {item.status === "bought" && <Check className="h-3 w-3" />}
        {item.status === "ordered" && (
          <Package className="h-3 w-3 text-blue-400" />
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`text-sm font-medium ${item.status === "bought" ? "text-muted-foreground line-through" : "text-foreground"}`}
          >
            {item.name}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}
          >
            {STATUS_LABEL[item.status]}
          </span>
        </div>

        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {item.quantity != null && (
            <span>
              {item.quantity} {item.unit ?? "yards"}
            </span>
          )}
          {item.store && <span>{item.store}</span>}
          {(item.estimatedPriceUsd != null || item.actualPriceUsd != null) && (
            <span className="flex items-center gap-0.5">
              <DollarSign className="h-3 w-3" />
              {item.actualPriceUsd != null
                ? `Paid ${fmt(item.actualPriceUsd)}`
                : `Est. ${fmt(item.estimatedPriceUsd)}`}
            </span>
          )}
        </div>

        {item.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          onClick={() => {
            if (confirm(`Remove "${item.name}"?`)) del.mutate({ id: item.id });
          }}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function Shopping() {
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"all" | Status>("all");

  const { data: items, isLoading, isError } = useListShoppingItems();
  const { data: stats } = useGetShoppingStats();

  const filtered =
    items?.filter((item) =>
      filter === "all" ? true : item.status === filter,
    ) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shopping List</h1>
          <p className="text-sm text-muted-foreground">
            {stats
              ? `${stats.wantCount} to buy · ${stats.orderedCount} ordered · ${stats.boughtCount} bought`
              : "Track fabrics and supplies you want to buy"}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add item
        </Button>
      </div>

      {/* Budget summary */}
      {stats && stats.totalItems > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Est. remaining",
              value: `$${(stats.totalEstimatedUsd - stats.totalSpentUsd).toFixed(2)}`,
              color: "text-amber-600",
            },
            {
              label: "Total spent",
              value: `$${stats.totalSpentUsd.toFixed(2)}`,
              color: "text-green-600",
            },
            {
              label: "Total estimated",
              value: `$${stats.totalEstimatedUsd.toFixed(2)}`,
              color: "text-foreground",
            },
            {
              label: "Items",
              value: String(stats.totalItems),
              color: "text-foreground",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-card-border bg-card p-3 text-center"
            >
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1.5">
        {(["all", "want", "ordered", "bought"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f === "all"
              ? `All (${items?.length ?? 0})`
              : `${STATUS_LABEL[f as Status]} (${items?.filter((i) => i.status === f).length ?? 0})`}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex h-40 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">
            Failed to load shopping list. Please refresh.
          </p>
        </div>
      )}

      {items && items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <ShoppingCart className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">
              Shopping list is empty
            </p>
            <p className="text-sm text-muted-foreground">
              Add fabrics and supplies you want to buy
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add first item
          </Button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((item) => (
            <ItemCard key={item.id} item={item as Item} />
          ))}
        </div>
      )}

      {items && items.length > 0 && filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No items in this category.
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        {showAdd && <AddItemDialog onClose={() => setShowAdd(false)} />}
      </Dialog>
    </div>
  );
}
