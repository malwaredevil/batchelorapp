import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateOrnament,
  useDeleteOrnament,
  useListOrnamentCategories,
  getListOrnamentsQueryKey,
  getListOrnamentSeriesQueryKey,
  getGetOrnamentQueryKey,
} from "@workspace/api-client-react";
import type { OrnamentsOrnamentItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CategoryChipPicker,
  QuickEditSheetFrame,
} from "@workspace/collection-ui";
import { SeriesAutocomplete } from "@/ornaments/components/series-autocomplete";
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

interface QuickEditOrnamentSheetProps {
  ornament: OrnamentsOrnamentItem;
  onClose: () => void;
  onDeleted: () => void;
}

export function QuickEditOrnamentSheet({
  ornament,
  onClose,
  onDeleted,
}: QuickEditOrnamentSheetProps) {
  const queryClient = useQueryClient();
  const { data: allCategories = [] } = useListOrnamentCategories();

  const [name, setName] = useState(ornament.name);
  const [brand, setBrand] = useState(ornament.brand);
  const [seriesOrCollection, setSeriesOrCollection] = useState(
    ornament.seriesOrCollection ?? "",
  );
  const [year, setYear] = useState(
    ornament.year != null ? String(ornament.year) : "",
  );
  const [notes, setNotes] = useState(ornament.notes ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    ornament.categories.map((c) => c.id),
  );

  useEffect(() => {
    setName(ornament.name);
    setBrand(ornament.brand);
    setSeriesOrCollection(ornament.seriesOrCollection ?? "");
    setYear(ornament.year != null ? String(ornament.year) : "");
    setNotes(ornament.notes ?? "");
    setSelectedCategoryIds(ornament.categories.map((c) => c.id));
  }, [ornament]);

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
  }

  const update = useUpdateOrnament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getListOrnamentSeriesQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentQueryKey(ornament.id),
        });
        toast.success("Saved.");
        onClose();
      },
      onError: () => toast.error("Could not save."),
    },
  });

  const remove = useDeleteOrnament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getListOrnamentSeriesQueryKey(),
        });
        toast.success("Ornament removed.");
        onDeleted();
      },
      onError: () => toast.error("Could not delete this ornament."),
    },
  });

  function save() {
    if (!name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    update.mutate({
      id: ornament.id,
      data: {
        name: name.trim(),
        brand: brand.trim() || ornament.brand,
        seriesOrCollection: seriesOrCollection.trim() || null,
        year: year !== "" ? Number(year) : null,
        notes: notes.trim() || null,
        categoryIds: selectedCategoryIds,
      },
    });
  }

  const busy = update.isPending || remove.isPending;

  return (
    <QuickEditSheetFrame
      title={ornament.name}
      onClose={onClose}
      thumbnail={
        ornament.imageUrl
          ? { src: ornament.imageUrl, alt: ornament.name }
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
                <AlertDialogTitle>Remove this ornament?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes &ldquo;{ornament.name}&rdquo; from
                  your collection. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => remove.mutate({ id: ornament.id })}
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
        <Label htmlFor="qeo-name">Name</Label>
        <Input
          id="qeo-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qeo-brand">Brand</Label>
        <Input
          id="qeo-brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qeo-series">Series / Collection</Label>
        <SeriesAutocomplete
          id="qeo-series"
          value={seriesOrCollection}
          onValueChange={setSeriesOrCollection}
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="qeo-year">Year</Label>
          <Input
            id="qeo-year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            disabled={busy}
            placeholder="e.g. 1995"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qeo-notes">Notes</Label>
        <Textarea
          id="qeo-notes"
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
