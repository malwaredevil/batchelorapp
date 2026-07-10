import { useState } from "react";
import { NotebookPen, Plus, Trash2, X } from "lucide-react";
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  function startEdit(note: OfficeNote) {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditBody("");
  }

  async function saveNewNote() {
    if (!draftTitle.trim()) return;
    await createNote.mutateAsync({
      data: { title: draftTitle.trim(), body: draftBody },
    });
    setDraftTitle("");
    setDraftBody("");
    setComposing(false);
  }

  async function saveEdit(id: number) {
    if (!editTitle.trim()) return;
    await updateNote.mutateAsync({
      id,
      data: { title: editTitle.trim(), body: editBody },
    });
    cancelEdit();
  }

  async function handleDelete(id: number) {
    await deleteNote.mutateAsync({ id });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
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
          <textarea
            className="min-h-[120px] w-full resize-y rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Write a note..."
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setComposing(false);
                setDraftTitle("");
                setDraftBody("");
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
            className="rounded-xl border border-card-border bg-card p-4"
          >
            {editingId === note.id ? (
              <div className="space-y-3">
                <input
                  autoFocus
                  className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
                <textarea
                  className="min-h-[120px] w-full resize-y rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
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
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {note.body}
                    </p>
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
