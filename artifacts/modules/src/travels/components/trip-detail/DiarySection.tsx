import { useState } from "react";
import {
  useListDiaryEntries,
  useCreateDiaryEntry,
  useUpdateDiaryEntry,
  useDeleteDiaryEntry,
  getListDiaryEntriesQueryKey,
  type TravelsDiaryEntry as DiaryEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, NotebookPen } from "lucide-react";
import { toast } from "sonner";

interface DiarySectionProps {
  tripId: number;
}

function todayIso(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function formatEntryDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function DiarySection({ tripId }: DiarySectionProps) {
  const qc = useQueryClient();
  const { data: entries = [], isLoading } = useListDiaryEntries(tripId);

  const [showDialog, setShowDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DiaryEntry | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListDiaryEntriesQueryKey(tripId) });

  const createEntry = useCreateDiaryEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast.success("Diary entry added");
        setShowDialog(false);
      },
      onError: () => toast.error("Failed to add diary entry"),
    },
  });

  const updateEntry = useUpdateDiaryEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast.success("Diary entry updated");
        setShowDialog(false);
      },
      onError: () => toast.error("Failed to update diary entry"),
    },
  });

  const deleteEntry = useDeleteDiaryEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast.success("Diary entry deleted");
        setDeleteTarget(null);
      },
      onError: () => toast.error("Failed to delete diary entry"),
    },
  });

  function openCreateDialog() {
    setEditingEntry(null);
    setEntryDate(todayIso());
    setTitle("");
    setBody("");
    setShowDialog(true);
  }

  function openEditDialog(entry: DiaryEntry) {
    setEditingEntry(entry);
    setEntryDate(entry.entryDate);
    setTitle(entry.title ?? "");
    setBody(entry.body);
    setShowDialog(true);
  }

  function handleSave() {
    if (!entryDate || !body.trim()) {
      toast.error("Date and entry text are required");
      return;
    }
    if (editingEntry) {
      updateEntry.mutate({
        id: tripId,
        entryId: editingEntry.id,
        data: {
          entryDate,
          title: title.trim() ? title.trim() : null,
          body: body.trim(),
        },
      });
    } else {
      createEntry.mutate({
        id: tripId,
        data: {
          entryDate,
          title: title.trim() || undefined,
          body: body.trim(),
        },
      });
    }
  }

  const saving = createEntry.isPending || updateEntry.isPending;

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={openCreateDialog}
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New entry
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No diary entries yet. Jot down a memory from the trip above.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-border/50 px-3 py-2.5 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary">
                    {formatEntryDate(entry.entryDate)}
                  </p>
                  {entry.title && (
                    <h3 className="font-serif text-base text-foreground mt-0.5">
                      {entry.title}
                    </h3>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditDialog(entry)}
                    className="text-muted-foreground hover:text-primary transition-colors p-1"
                    aria-label="Edit entry"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(entry)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-1.5 leading-relaxed">
                {entry.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <NotebookPen className="w-4 h-4" />
              {editingEntry ? "Edit diary entry" : "New diary entry"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="diary-entry-date">Date</Label>
              <Input
                id="diary-entry-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="diary-entry-title">Title (optional)</Label>
              <Input
                id="diary-entry-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. First day in Rome"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="diary-entry-body">Entry</Label>
              <Textarea
                id="diary-entry-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What happened today?"
                rows={8}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !entryDate || !body.trim()}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              {editingEntry ? "Save" : "Add entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this diary entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone.
              {deleteTarget?.title ? ` "${deleteTarget.title}"` : ""} will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteEntry.mutate({ id: tripId, entryId: deleteTarget.id });
                }
              }}
              disabled={deleteEntry.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
