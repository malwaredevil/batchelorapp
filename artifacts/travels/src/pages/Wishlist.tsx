import { useState, useCallback } from "react";
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

// ─── Date injection ───────────────────────────────────────────────────────────

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Walk all <li> elements in the saved HTML. If one doesn't already end with
 * a .note-date span, append today's date.
 */
function injectDates(html: string): string {
  if (!html?.trim()) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const today = todayLabel();
  doc.querySelectorAll("li").forEach((li) => {
    if (!li.querySelector(".note-date") && li.textContent?.trim()) {
      const span = doc.createElement("span");
      span.className = "note-date";
      span.textContent = `(${today})`;
      li.appendChild(span);
    }
  });
  return doc.body.innerHTML;
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolBtn({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center w-7 h-7 rounded text-sm transition-colors
        ${active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-border/60 mx-0.5" />;
}

// ─── The TipTap editor panel ──────────────────────────────────────────────────

function NoteEditor({
  initialHtml,
  onSave,
  onCancel,
}: {
  initialHtml: string;
  onSave: (html: string) => void;
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
    content: initialHtml || "",
    autofocus: "end",
  });

  function handleSave() {
    if (!editor) return;
    const raw = editor.getHTML();
    const withDates = injectDates(raw === "<p></p>" ? "" : raw);
    onSave(withDates || "");
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

        {/* Save / Cancel pushed to the right */}
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

      {/* Editor body */}
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

  const handleSave = useCallback(
    (html: string) => {
      const value = html.trim() || null;
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

  const hasNotes = !!item.notes?.trim();

  return (
    <div className="group flex gap-3 px-4 py-4 rounded-xl border border-border/50 bg-card hover:bg-muted/20 transition-colors">
      <Star className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0 space-y-2">
        {/* Header */}
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
        {editing ? (
          <NoteEditor
            initialHtml={item.notes ?? ""}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : hasNotes ? (
          <div
            className="wishlist-note-display cursor-text text-foreground"
            onClick={() => setEditing(true)}
            dangerouslySetInnerHTML={{ __html: item.notes! }}
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
