import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateQuilt,
  useDeleteQuilt,
  useListQuiltingCategories,
  getListQuiltsQueryKey,
  getGetQuiltQueryKey,
} from "@workspace/api-client-react";
import type { QuiltingFinishedQuilt } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface QuickEditQuiltSheetProps {
  quilt: QuiltingFinishedQuilt;
  onClose: () => void;
  onDeleted: () => void;
}

export function QuickEditQuiltSheet({
  quilt,
  onClose,
  onDeleted,
}: QuickEditQuiltSheetProps) {
  const queryClient = useQueryClient();
  const { data: allCategories = [] } = useListQuiltingCategories();

  const [name, setName] = useState(quilt.name);
  const [recipient, setRecipient] = useState(quilt.recipient ?? "");
  const [completionPct, setCompletionPct] = useState(
    quilt.completionPercentage != null
      ? String(quilt.completionPercentage)
      : "",
  );
  const [notes, setNotes] = useState(quilt.notes ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    (quilt.categories as Array<{ id: number }>).map((c) => c.id),
  );

  useEffect(() => {
    setName(quilt.name);
    setRecipient(quilt.recipient ?? "");
    setCompletionPct(
      quilt.completionPercentage != null
        ? String(quilt.completionPercentage)
        : "",
    );
    setNotes(quilt.notes ?? "");
    setSelectedCategoryIds(
      (quilt.categories as Array<{ id: number }>).map((c) => c.id),
    );
  }, [quilt]);

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
  }

  const update = useUpdateQuilt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetQuiltQueryKey(quilt.id),
        });
        toast.success("Saved.");
        onClose();
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  const remove = useDeleteQuilt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        toast.success("Quilt deleted.");
        onDeleted();
      },
      onError: () => toast.error("Could not delete this quilt."),
    },
  });

  function save() {
    if (!name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    const selectedNames = allCategories
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    update.mutate({
      id: quilt.id,
      data: {
        name: name.trim(),
        recipient: recipient.trim() || null,
        completionPercentage:
          completionPct !== "" ? Number(completionPct) : undefined,
        notes: notes.trim() || null,
        categories: selectedNames,
      },
    });
  }

  const busy = update.isPending || remove.isPending;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-card-border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-card-border bg-background px-4 py-3">
          <p className="max-w-[240px] truncate text-sm font-semibold">
            {quilt.name}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-card-border"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="qeq-name">Name</Label>
            <Input
              id="qeq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qeq-recipient">Recipient</Label>
            <Input
              id="qeq-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={busy}
              placeholder="Who is this for?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qeq-completion">Completion %</Label>
            <Input
              id="qeq-completion"
              type="number"
              min={0}
              max={100}
              value={completionPct}
              onChange={(e) => setCompletionPct(e.target.value)}
              disabled={busy}
              placeholder="0–100"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qeq-notes">Notes</Label>
            <Textarea
              id="qeq-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </div>

          {allCategories.length > 0 && (
            <div className="space-y-1.5">
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-2">
                {allCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleCategory(cat.id)}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                      selectedCategoryIds.includes(cat.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-card-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={busy} className="flex-1">
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" disabled={busy}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this quilt?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes &ldquo;{quilt.name}&rdquo; from
                    your collection. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => remove.mutate({ id: quilt.id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </>
  );
}
