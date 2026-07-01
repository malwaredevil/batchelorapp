import { useState, useRef } from "react";
import { Plus, Trash2, Star, Calendar } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  useListWishlist,
  useCreateWishlistItem,
  useUpdateWishlistItem,
  useDeleteWishlistItem,
  type WishlistItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListWishlistQueryKey } from "@workspace/api-client-react";

function WishlistRow({ item }: { item: WishlistItem }) {
  const qc = useQueryClient();
  const updateItem = useUpdateWishlistItem();
  const removeItem = useDeleteWishlistItem();

  const [editingNotes, setEditingNotes] = useState(false);
  const [draft, setDraft] = useState(item.notes ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });

  function openNotes() {
    setDraft(item.notes ?? "");
    setEditingNotes(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function saveNotes() {
    const trimmed = draft.trim();
    if (trimmed === (item.notes ?? "").trim()) {
      setEditingNotes(false);
      return;
    }
    updateItem.mutate(
      { id: item.id, body: { notes: trimmed || null } },
      {
        onSuccess: () => { invalidate(); setEditingNotes(false); },
        onError: () => toast.error("Failed to save note"),
      },
    );
  }

  function handleDelete() {
    removeItem.mutate(item.id, {
      onSuccess: () => { invalidate(); toast.success("Removed"); },
      onError: () => toast.error("Failed to remove"),
    });
  }

  return (
    <div className="group flex gap-3 px-4 py-4 rounded-xl border border-border/50 bg-card hover:bg-muted/20 transition-colors">
      <Star className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-foreground leading-snug">{item.destination}</p>
          <button
            onClick={handleDelete}
            className="shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {item.targetDate && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {new Date(item.targetDate + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </p>
        )}

        {/* Notes */}
        {editingNotes ? (
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveNotes}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditingNotes(false); setDraft(item.notes ?? ""); }
            }}
            placeholder="Add a note…"
            className="mt-1 text-sm resize-none min-h-[72px]"
            rows={3}
          />
        ) : item.notes ? (
          <p
            onClick={openNotes}
            className="text-sm text-muted-foreground whitespace-pre-wrap cursor-text hover:text-foreground transition-colors"
          >
            {item.notes}
          </p>
        ) : (
          <button
            onClick={openNotes}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors italic"
          >
            Add a note…
          </button>
        )}
      </div>
    </div>
  );
}

export default function Wishlist() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useListWishlist();
  const create = useCreateWishlistItem();

  const [newDest, setNewDest] = useState("");
  const [newDate, setNewDate] = useState("");

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-serif text-2xl text-foreground flex items-center gap-2">
          <Star className="w-6 h-6 text-yellow-500" />
          Wishlist
        </h1>
        <p className="text-muted-foreground mt-1">
          {isLoading ? "Loading…" : `${items.length} place${items.length !== 1 ? "s" : ""} to visit`}
        </p>
      </div>

      {/* Add form */}
      <Card className="border-border/50">
        <CardContent className="pt-4">
          <div className="flex gap-2 flex-col sm:flex-row">
            <Input
              placeholder="Destination…"
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
            />
            <Button onClick={handleAdd} disabled={!newDest.trim() || create.isPending}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Star className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground">No destinations yet — add some places you want to visit!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <WishlistRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
