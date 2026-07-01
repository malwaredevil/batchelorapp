import { useState } from "react";
import { Plus, Check, Trash2, Star, Calendar, ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  useListWishlist,
  useCreateWishlistItem,
  useUpdateWishlistItem,
  useDeleteWishlistItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListWishlistQueryKey } from "@workspace/api-client-react";

export default function Wishlist() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useListWishlist();
  const create = useCreateWishlistItem();
  const update = useUpdateWishlistItem();
  const remove = useDeleteWishlistItem();

  const [newDest, setNewDest] = useState("");
  const [newDate, setNewDate] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "done">("pending");

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });

  function handleAdd() {
    const dest = newDest.trim();
    if (!dest) return;
    create.mutate(
      { destination: dest, targetDate: newDate || undefined },
      {
        onSuccess: () => {
          setNewDest("");
          setNewDate("");
          invalidate();
          toast.success("Added to wishlist");
        },
        onError: () => toast.error("Failed to add"),
      },
    );
  }

  function handleToggleDone(id: number, done: boolean) {
    update.mutate(
      { id, body: { done: !done } },
      {
        onSuccess: () => invalidate(),
        onError: () => toast.error("Failed to update"),
      },
    );
  }

  function handleDelete(id: number) {
    remove.mutate(id, {
      onSuccess: () => {
        invalidate();
        toast.success("Removed");
      },
      onError: () => toast.error("Failed to remove"),
    });
  }

  function handlePlanTrip(destination: string) {
    setLocation(`/trips?new=${encodeURIComponent(destination)}`);
  }

  const filtered = items.filter((item) => {
    if (filter === "pending") return !item.done;
    if (filter === "done") return item.done;
    return true;
  });

  const pendingCount = items.filter((i) => !i.done).length;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-serif text-2xl text-foreground flex items-center gap-2">
          <Star className="w-6 h-6 text-amber-500" />
          Wishlist
        </h1>
        <p className="text-muted-foreground mt-1">
          {pendingCount} places to visit · {doneCount} visited
        </p>
      </div>

      {/* Add form */}
      <Card className="border-border/50">
        <CardContent className="pt-4">
          <div className="flex gap-2 flex-col sm:flex-row">
            <Input
              placeholder="Destination..."
              value={newDest}
              onChange={(e) => setNewDest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1"
            />
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="sm:w-44"
              placeholder="Target date"
            />
            <Button onClick={handleAdd} disabled={!newDest.trim() || create.isPending}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {(["pending", "all", "done"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors capitalize ${
              filter === f
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "pending" ? `Pending (${pendingCount})` : f === "done" ? `Visited (${doneCount})` : `All (${items.length})`}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Star className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground">
            {filter === "pending"
              ? "No pending destinations. Add some places you want to visit!"
              : "No destinations here yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                item.done
                  ? "border-border/30 bg-muted/30"
                  : "border-border/50 bg-card hover:bg-muted/20"
              }`}
            >
              {/* Done toggle */}
              <button
                onClick={() => handleToggleDone(item.id, item.done)}
                className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                  item.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-border hover:border-emerald-400"
                }`}
              >
                {item.done && <Check className="w-3.5 h-3.5" />}
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p
                  className={`font-medium ${
                    item.done ? "line-through text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {item.destination}
                </p>
                {item.targetDate && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Calendar className="w-3 h-3" />
                    {new Date(item.targetDate + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {!item.done && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => handlePlanTrip(item.destination)}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Plan trip
                  </Button>
                )}
                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded-md hover:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
