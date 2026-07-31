import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdatePottery,
  useDeletePottery,
  useListPotteryCategories as useListCategories,
  getListPotteryQueryKey,
  getGetCollectionStatsQueryKey,
  getGetPotteryQueryKey,
} from "@workspace/api-client-react";
import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CategoryChipPicker,
  QuickEditSheetFrame,
} from "@workspace/collection-ui";
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

interface QuickEditSheetProps {
  item: PotteryItem;
  onClose: () => void;
  onDeleted: () => void;
}

export function QuickEditSheet({
  item,
  onClose,
  onDeleted,
}: QuickEditSheetProps) {
  const queryClient = useQueryClient();
  const { data: allCategories = [] } = useListCategories();

  const [name, setName] = useState(item.name);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    item.categories.map((c) => c.id),
  );

  useEffect(() => {
    setName(item.name);
    setNotes(item.notes ?? "");
    setSelectedCategoryIds(item.categories.map((c) => c.id));
  }, [item]);

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
  }

  const update = useUpdatePottery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetPotteryQueryKey(item.id),
        });
        toast.success("Saved.");
        onClose();
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  const remove = useDeletePottery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetCollectionStatsQueryKey(),
        });
        toast.success("Piece removed.");
        onDeleted();
      },
      onError: () => toast.error("Could not delete this piece."),
    },
  });

  function save() {
    if (!name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    update.mutate({
      id: item.id,
      data: {
        name: name.trim(),
        notes: notes.trim() || null,
        categoryIds: selectedCategoryIds,
      },
    });
  }

  const busy = update.isPending || remove.isPending;

  return (
    <QuickEditSheetFrame
      title={item.name}
      onClose={onClose}
      thumbnail={{ src: item.imageUrl, alt: item.name }}
      footer={
        <>
          <Button
            onClick={save}
            disabled={busy}
            className="flex-1"
            data-testid="button-quickedit-save"
          >
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={busy}
                data-testid="button-quickedit-delete"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this piece?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes "{item.name}" and its photo from your
                  collection. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => remove.mutate({ id: item.id })}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-quickedit-confirm-delete"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="qs-name">Name</Label>
        <Input
          id="qs-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          data-testid="input-quickedit-name"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qs-notes">Notes</Label>
        <Textarea
          id="qs-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          data-testid="input-quickedit-notes"
        />
      </div>

      {allCategories.length > 0 && (
        <div className="space-y-1.5">
          <Label>Categories</Label>
          <CategoryChipPicker
            categories={allCategories}
            selectedIds={selectedCategoryIds}
            onToggle={toggleCategory}
            disabled={busy}
          />
        </div>
      )}
    </QuickEditSheetFrame>
  );
}
