import { useState, useCallback, useMemo } from "react";
import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Plus,
  Trash2,
  Star,
  Calendar,
} from "lucide-react";
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
import { usePageAssistantContext } from "@/lib/assistant-context";

// ─── Notes JSON format ────────────────────────────────────────────────────────
//
// Stored in the `notes` TEXT column as:
//   {"html":"<clean tiptap html>","dates":["Jul 1, 2026", null, "Jun 15, 2026"]}
//
// `dates` is indexed by <li> position. null = no date yet.
// Dates are injected into HTML only at display time, keeping TipTap content clean.

interface WishlistNotes {
  html: string;
  dates: (string | null)[];
}

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseNotes(raw: string | null | undefined): WishlistNotes {
  if (!raw?.trim()) return { html: "", dates: [] };
  try {
    const p = JSON.parse(raw);
    if (p && typeof p.html === "string" && Array.isArray(p.dates)) {
      return p as WishlistNotes;
    }
  } catch {
    // legacy: raw value is plain HTML (or old [{text,date}] JSON) — load as html, no dates
  }
  return { html: raw, dates: [] };
}

/**
 * Walk the body's direct children and collect content "blocks":
 * - top-level <p> elements count as one block each
 * - <ul>/<ol> contribute one block per <li>
 * Returns an ordered flat array of the DOM elements to be dated.
 */
function getContentBlocks(doc: Document): Element[] {
  const blocks: Element[] = [];
  for (const child of Array.from(doc.body.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "p") {
      blocks.push(child);
    } else if (tag === "ul" || tag === "ol") {
      child.querySelectorAll("li").forEach((li) => blocks.push(li));
    }
    // headings, hr, etc. are intentionally ignored
  }
  return blocks;
}

/** Merge saved dates with new HTML: keep old dates by index, assign today to new blocks. */
function mergeDates(newHtml: string, oldDates: (string | null)[]): (string | null)[] {
  if (!newHtml?.trim()) return [];
  try {
    const doc = new DOMParser().parseFromString(newHtml, "text/html");
    const blocks = getContentBlocks(doc);
    const today = todayLabel();
    return blocks.map((_, i) => oldDates[i] ?? today);
  } catch {
    return [];
  }
}

/**
 * Inject date spans into HTML at display time (never modifies stored HTML),
 * then sanitize the result. This is the only place notes HTML is rendered
 * via dangerouslySetInnerHTML, so sanitizing here covers both the
 * date-annotated and plain-passthrough paths.
 */
function buildDisplayHtml(notes: WishlistNotes): string {
  const { html, dates } = notes;
  if (!html?.trim()) return "";
  if (!dates.some(Boolean)) return DOMPurify.sanitize(html);
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const blocks = getContentBlocks(doc);
    blocks.forEach((block, i) => {
      const d = dates[i];
      if (!d) return;
      // For <li>, append inside its inner <p> so the span stays inline
      const target = block.tagName.toLowerCase() === "li"
        ? (block.querySelector("p") ?? block)
        : block;
      const span = doc.createElement("span");
      span.className = "note-date";
      span.textContent = ` (${d})`;
      target.appendChild(span);
    });
    return DOMPurify.sanitize(doc.body.innerHTML);
  } catch {
    return DOMPurify.sanitize(html);
  }
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center justify-center w-7 h-7 rounded text-sm transition-colors
        ${active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-border/60 mx-0.5" />;
}

// ─── TipTap editor panel ──────────────────────────────────────────────────────

function NoteEditor({
  initialNotes,
  onSave,
  onCancel,
}: {
  initialNotes: WishlistNotes;
  onSave: (notes: WishlistNotes) => void;
  onCancel: () => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false }),
      UnderlineExt,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ["paragraph", "listItem"] }),
      Placeholder.configure({ placeholder: "Add your notes here…" }),
    ],
    content: initialNotes.html || "",
    autofocus: "end",
  });

  function handleSave() {
    if (!editor) return;
    const raw = editor.getHTML();
    const html = raw === "<p></p>" ? "" : raw;
    const dates = mergeDates(html, initialNotes.dates);
    onSave({ html, dates });
  }

  if (!editor) return null;

  return (
    <div className="tiptap-wishlist mt-1.5 rounded-lg border border-primary/40 bg-background shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/50 bg-muted/30 flex-wrap">
        <ToolBtn title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
        </ToolBtn>
        <ToolBtn title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <Underline className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
          <Highlighter className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        <ToolBtn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        <ToolBtn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight className="w-3.5 h-3.5" />
        </ToolBtn>

        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] px-2 py-1 text-muted-foreground hover:text-foreground transition-colors rounded"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Save
        </button>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}

// ─── Wishlist row ─────────────────────────────────────────────────────────────

function WishlistRow({ item }: { item: WishlistItem }) {
  const qc = useQueryClient();
  const updateItem = useUpdateWishlistItem();
  const removeItem = useDeleteWishlistItem();
  const [editing, setEditing] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });

  const notes = parseNotes(item.notes);
  const displayHtml = buildDisplayHtml(notes);
  const hasNotes = !!notes.html.trim();

  const handleSave = useCallback(
    (updated: WishlistNotes) => {
      const value = updated.html.trim() ? JSON.stringify(updated) : null;
      updateItem.mutate(
        { id: item.id, body: { notes: value } },
        {
          onSuccess: () => { invalidate(); setEditing(false); },
          onError: () => toast.error("Failed to save note"),
        },
      );
    },
    [item.id, updateItem],
  );

  function handleDelete() {
    removeItem.mutate(item.id, {
      onSuccess: () => { invalidate(); toast.success("Removed"); },
      onError: () => toast.error("Failed to remove"),
    });
  }

  return (
    <div className="group flex gap-3 px-4 py-4 rounded-xl border border-border/50 bg-card hover:bg-muted/20 transition-colors">
      <Star className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0 space-y-2">
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

        {editing ? (
          <NoteEditor
            initialNotes={notes}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : hasNotes ? (
          <div
            className="wishlist-note-display cursor-text text-foreground"
            onClick={() => setEditing(true)}
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
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

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.destination.localeCompare(b.destination, undefined, { sensitivity: "base" })),
    [items],
  );

  usePageAssistantContext(
    "wishlist",
    `Viewing wishlist with ${items.length} destination(s): ${sortedItems
      .slice(0, 15)
      .map((i) => `${i.destination} (wishlistId: ${i.id}${i.done ? ", done" : ""})`)
      .join(", ")}.` +
      (newDest.trim() ? ` User is currently typing a new wishlist entry: "${newDest.trim()}"${newDate ? ` targeting ${newDate}` : ""}.` : ""),
  );

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
      <div>
        <h1 className="font-serif text-2xl text-foreground flex items-center gap-2">
          <Star className="w-6 h-6 text-yellow-500" />
          Wishlist
        </h1>
        <p className="text-muted-foreground mt-1">
          {isLoading ? "Loading…" : `${items.length} place${items.length !== 1 ? "s" : ""} to visit`}
        </p>
      </div>

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
          {sortedItems.map((item) => (
            <WishlistRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
