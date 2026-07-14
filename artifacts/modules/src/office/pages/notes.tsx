import { useState } from "react";
import DOMPurify from "dompurify";
import { NotebookPen, Plus, Trash2, X, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useListNotes,
  getListNotesQueryKey,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  type OfficeNote,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { RichTextEditor } from "@/travels/components/RichTextEditor";

// Preset background colours for note cards
const NOTE_COLORS: { label: string; value: string | null; hex: string }[] = [
  { label: "Default", value: null, hex: "transparent" },
  { label: "Yellow", value: "#fef9c3", hex: "#fef9c3" },
  { label: "Blue", value: "#dbeafe", hex: "#dbeafe" },
  { label: "Green", value: "#dcfce7", hex: "#dcfce7" },
  { label: "Pink", value: "#fce7f3", hex: "#fce7f3" },
  { label: "Purple", value: "#ede9fe", hex: "#ede9fe" },
  { label: "Orange", value: "#ffedd5", hex: "#ffedd5" },
  { label: "Red", value: "#fee2e2", hex: "#fee2e2" },
];

function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (c: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Palette className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      {NOTE_COLORS.map((c) => (
        <button
          key={c.label}
          type="button"
          title={c.label}
          onClick={() => onChange(c.value)}
          className="h-5 w-5 rounded-full border transition-all flex-shrink-0"
          style={{
            backgroundColor: c.hex === "transparent" ? "white" : c.hex,
            borderColor: value === c.value ? "#6366f1" : "rgba(0,0,0,0.15)",
            boxShadow: value === c.value ? "0 0 0 2px #6366f1" : undefined,
          }}
          aria-pressed={value === c.value}
        />
      ))}
    </div>
  );
}

/** Render note body: plain-text legacy content or TipTap HTML. */
function renderBody(body: string): string {
  if (!body) return "";
  // If it looks like HTML, sanitize and return as-is
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return DOMPurify.sanitize(body, { USE_PROFILES: { html: true } });
  }
  // Plain-text fallback: escape and convert newlines to <br>
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return DOMPurify.sanitize(escaped.replace(/\n/g, "<br>"));
}

// Household-shared notes: any authenticated user can create/edit/delete any
// note. createdByUserId is attribution-only (who created it), matching the
// household-sharing model used across pottery/quilting/travels/ornaments.
export default function OfficeNotes() {
  const queryClient = useQueryClient();
  const { data: notes = [], isLoading } = useListNotes({
    query: { queryKey: getListNotesQueryKey() },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });

  const createNote = useCreateNote({
    mutation: { onSuccess: invalidate },
  });
  const updateNote = useUpdateNote({
    mutation: { onSuccess: invalidate },
  });
  const deleteNote = useDeleteNote({
    mutation: { onSuccess: invalidate },
  });

  const [composing, setComposing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftBgColor, setDraftBgColor] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBgColor, setEditBgColor] = useState<string | null>(null);

  function startEdit(note: OfficeNote) {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.body);
    setEditBgColor(note.backgroundColor ?? null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditBody("");
    setEditBgColor(null);
  }

  async function saveNewNote() {
    if (!draftTitle.trim()) return;
    await createNote.mutateAsync({
      data: {
        title: draftTitle.trim(),
        body: draftBody,
        backgroundColor: draftBgColor,
      },
    });
    setDraftTitle("");
    setDraftBody("");
    setDraftBgColor(null);
    setComposing(false);
  }

  async function saveEdit(id: number) {
    if (!editTitle.trim()) return;
    await updateNote.mutateAsync({
      id,
      data: {
        title: editTitle.trim(),
        body: editBody,
        backgroundColor: editBgColor,
      },
    });
    cancelEdit();
  }

  async function handleDelete(id: number) {
    await deleteNote.mutateAsync({ id });
  }

  return (
    <div className="py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-2xl text-foreground">
            <NotebookPen className="h-6 w-6" />
            Notes
          </h1>
          <p className="text-sm text-muted-foreground">
            Shared household notes — anyone can add, edit, or delete.
          </p>
        </div>
        {!composing && (
          <Button className="gap-2" onClick={() => setComposing(true)}>
            <Plus className="h-4 w-4" />
            New note
          </Button>
        )}
      </div>

      {composing && (
        <div className="space-y-3 rounded-xl border border-card-border bg-card p-4">
          <input
            autoFocus
            className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
          />
          <RichTextEditor
            value={draftBody}
            onChange={setDraftBody}
            placeholder="Write a note…"
          />
          <ColorPicker value={draftBgColor} onChange={setDraftBgColor} />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setComposing(false);
                setDraftTitle("");
                setDraftBody("");
                setDraftBgColor(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={saveNewNote}
              disabled={!draftTitle.trim() || createNote.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading notes...</p>
      )}

      {!isLoading && notes.length === 0 && !composing && (
        <p className="text-sm text-muted-foreground">
          No notes yet. Create one to get started.
        </p>
      )}

      <div className="space-y-3">
        {notes.map((note) => (
          <div
            key={note.id}
            className="rounded-xl border border-card-border p-4 transition-colors"
            style={{ backgroundColor: note.backgroundColor ?? undefined }}
          >
            {editingId === note.id ? (
              <div className="space-y-3">
                <input
                  autoFocus
                  className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
                <RichTextEditor
                  value={editBody}
                  onChange={setEditBody}
                  placeholder="Write a note…"
                />
                <ColorPicker value={editBgColor} onChange={setEditBgColor} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit}>
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    onClick={() => saveEdit(note.id)}
                    disabled={!editTitle.trim() || updateNote.isPending}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => startEdit(note)}
                  >
                    <h2 className="truncate font-medium text-foreground">
                      {note.title}
                    </h2>
                    {note.body && (
                      <div
                        className="mt-1 text-sm text-muted-foreground prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-0.5 [&_li]:my-0"
                        dangerouslySetInnerHTML={{
                          __html: renderBody(note.body),
                        }}
                      />
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(note.id)}
                    disabled={deleteNote.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {note.createdByName ? `By ${note.createdByName} · ` : ""}
                  Updated {new Date(note.updatedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
