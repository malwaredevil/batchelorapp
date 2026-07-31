import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdatePattern,
  useDeletePattern,
  useListQuiltingCategories,
  getListPatternsQueryKey,
  getGetPatternQueryKey,
} from "@workspace/api-client-react";
import type { QuiltingQuiltPattern } from "@workspace/api-client-react";
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

interface QuickEditPatternSheetProps {
  pattern: QuiltingQuiltPattern;
  onClose: () => void;
  onDeleted: () => void;
}

export function QuickEditPatternSheet({
  pattern,
  onClose,
  onDeleted,
}: QuickEditPatternSheetProps) {
  const queryClient = useQueryClient();
  const { data: allCategories = [] } = useListQuiltingCategories();

  const [name, setName] = useState(pattern.name);
  const [designer, setDesigner] = useState(pattern.designer ?? "");
  const [blockSize, setBlockSize] = useState(pattern.blockSize ?? "");
  const [difficulty, setDifficulty] = useState(pattern.difficulty ?? "");
  const [sourceReference, setSourceReference] = useState(
    pattern.sourceReference ?? "",
  );
  const [notes, setNotes] = useState(pattern.notes ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    (pattern.categories as Array<{ id: number }>).map((c) => c.id),
  );

  useEffect(() => {
    setName(pattern.name);
    setDesigner(pattern.designer ?? "");
    setBlockSize(pattern.blockSize ?? "");
    setDifficulty(pattern.difficulty ?? "");
    setSourceReference(pattern.sourceReference ?? "");
    setNotes(pattern.notes ?? "");
    setSelectedCategoryIds(
      (pattern.categories as Array<{ id: number }>).map((c) => c.id),
    );
  }, [pattern]);

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
  }

  const update = useUpdatePattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetPatternQueryKey(pattern.id),
        });
        toast.success("Saved.");
        onClose();
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  const remove = useDeletePattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("Pattern deleted.");
        onDeleted();
      },
      onError: () => toast.error("Could not delete this pattern."),
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
      id: pattern.id,
      data: {
        name: name.trim(),
        designer: designer.trim() || null,
        blockSize: blockSize.trim() || null,
        difficulty: difficulty.trim() || null,
        sourceReference: sourceReference.trim() || null,
        notes: notes.trim() || null,
        categories: selectedNames,
      },
    });
  }

  const busy = update.isPending || remove.isPending;

  return (
    <QuickEditSheetFrame
      title={pattern.name}
      onClose={onClose}
      thumbnail={
        pattern.imageUrl
          ? { src: pattern.imageUrl, alt: pattern.name }
          : undefined
      }
      footer={
        <>
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
                <AlertDialogTitle>Delete this pattern?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes &ldquo;{pattern.name}&rdquo; from
                  your collection. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => remove.mutate({ id: pattern.id })}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
        <Label htmlFor="qep-name">Name</Label>
        <Input
          id="qep-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qep-designer">Designer</Label>
        <Input
          id="qep-designer"
          value={designer}
          onChange={(e) => setDesigner(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="qep-blockSize">Block size</Label>
          <Input
            id="qep-blockSize"
            value={blockSize}
            onChange={(e) => setBlockSize(e.target.value)}
            disabled={busy}
            placeholder='e.g. 12"'
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qep-difficulty">Difficulty</Label>
          <Input
            id="qep-difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            disabled={busy}
            placeholder="e.g. Beginner"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qep-source">Source reference</Label>
        <Input
          id="qep-source"
          value={sourceReference}
          onChange={(e) => setSourceReference(e.target.value)}
          disabled={busy}
          placeholder="e.g. book title, website, magazine"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qep-notes">Notes</Label>
        <Textarea
          id="qep-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
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
