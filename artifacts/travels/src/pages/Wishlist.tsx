import { useState, useRef, useCallback } from "react";
import { Plus, Trash2, Star, Calendar } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent } from "../components/ui/card";
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

// ─── Note storage model ───────────────────────────────────────────────────────
// notes column stores JSON: [{text: string, date: string}]
// Legacy plain-text notes are migrated transparently on first edit.

type NoteEntry = { text: string; date: string };

function parseNotes(raw: string | null | undefined): NoteEntry[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (e) => e && typeof (e as Record<string, unknown>).text === "string",
      )
    ) {
      return parsed as NoteEntry[];
    }
  } catch { /* not JSON */ }
  // Legacy plain text — treat each line as an entry (no date yet)
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((text) => ({ text, date: "" }));
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Merge edited lines against existing entries, preserving original dates. */
function mergeLines(existing: NoteEntry[], rawLines: string[]): NoteEntry[] {
  const today = todayLabel();
  const dateByText = new Map(existing.map((e) => [e.text.trim(), e.date]));
  return rawLines
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({ text, date: dateByText.get(text) ?? today }));
}

// ─── Editor helpers ───────────────────────────────────────────────────────────

/** Extract plain-text lines from a contentEditable div. */
function linesFromDiv(el: HTMLElement): string[] {
  // Normalise: each block element = one line; <br> = line break
  const html = el.innerHTML
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|p|li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const txt = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return txt.split("\n");
}

/** Build the innerHTML for the editor from a list of entry texts. */
function buildEditorHtml(entries: NoteEntry[]): string {
  const lines = entries.length ? entries.map((e) => e.text) : [""];
  return lines.map((l) => `<div>${l || "<br>"}</div>`).join("");
}

// ─── WishlistRow ─────────────────────────────────────────────────────────────

function WishlistRow({ item }: { item: WishlistItem }) {
  const qc = useQueryClient();
  const updateItem = useUpdateWishlistItem();
  const removeItem = useDeleteWishlistItem();

  const entries = parseNotes(item.notes);
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });

  const openEditor = useCallback(() => {
    setEditing(true);
    setTimeout(() => {
      if (!editorRef.current) return;
      editorRef.current.innerHTML = buildEditorHtml(entries);
      // Place cursor at end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      editorRef.current.focus();
    }, 0);
  }, [entries]);

  function saveEditor() {
    if (savingRef.current || !editorRef.current) return;
    savingRef.current = true;
    const lines = linesFromDiv(editorRef.current);
    const merged = mergeLines(entries, lines);
    const serialized = merged.length ? JSON.stringify(merged) : null;
    const currentSerialized = item.notes ?? null;
    if (serialized === currentSerialized) {
      setEditing(false);
      savingRef.current = false;
      return;
    }
    updateItem.mutate(
      { id: item.id, body: { notes: serialized } },
      {
        onSuccess: () => { invalidate(); setEditing(false); },
        onError: () => toast.error("Failed to save note"),
        onSettled: () => { savingRef.current = false; },
      },
    );
  }

  function handleDelete() {
    removeItem.mutate(item.id, {
      onSuccess: () => { invalidate(); toast.success("Removed"); },
      onError: () => toast.error("Failed to remove"),
    });
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      setEditing(false);
    }
    // Prevent Shift+Enter from doing anything special
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
    }
  }

  return (
    <div className="group flex gap-3 px-4 py-4 rounded-xl border border-border/50 bg-card hover:bg-muted/20 transition-colors">
      <Star className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0 space-y-2">
        {/* Header row */}
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

        {/* ── Rich-text notes ── */}
        {editing ? (
          <div className="mt-1 rounded-lg border border-primary/40 bg-background shadow-sm focus-within:ring-1 focus-within:ring-primary/30">
            {/* Toolbar hint */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-[10px] text-muted-foreground select-none">
              <span className="font-medium">Notes</span>
              <span>·</span>
              <span>Each line becomes a bullet</span>
              <span>·</span>
              <span>Enter = new line</span>
              <span>·</span>
              <span>Esc = cancel</span>
            </div>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={saveEditor}
              onKeyDown={handleEditorKeyDown}
              className="min-h-[80px] px-3 py-2.5 text-sm text-foreground outline-none leading-relaxed"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            />
          </div>
        ) : entries.length > 0 ? (
          <ul
            onClick={openEditor}
            className="space-y-1 cursor-text pl-1"
          >
            {entries.map((entry, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm text-foreground group/bullet">
                <span className="text-yellow-500 shrink-0 text-base leading-none select-none">•</span>
                <span className="leading-snug">
                  {entry.text}
                  {entry.date && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                      ({entry.date})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <button
            onClick={openEditor}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors italic"
          >
            Add a note…
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
