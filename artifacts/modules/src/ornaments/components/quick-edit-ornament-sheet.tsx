import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateOrnament,
  useDeleteOrnament,
  useListOrnamentCategories,
  getListOrnamentsQueryKey,
  getGetOrnamentQueryKey,
} from "@workspace/api-client-react";
import type { OrnamentsOrnamentItem } from "@workspace/api-client-react";
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
  const [condition, setCondition] = useState(ornament.condition ?? "");
  const [notes, setNotes] = useState(ornament.notes ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    ornament.categories.map((c) => c.id),
  );

  useEffect(() => {
    setName(ornament.name);
    setBrand(ornament.brand);
    setSeriesOrCollection(ornament.seriesOrCollection ?? "");
    setYear(ornament.year != null ? String(ornament.year) : "");
    setCondition(ornament.condition ?? "");
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
        condition: condition.trim() || null,
        notes: notes.trim() || null,
        categoryIds: selectedCategoryIds,
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
            {ornament.name}
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
            <Input
              id="qeo-series"
              value={seriesOrCollection}
              onChange={(e) => setSeriesOrCollection(e.target.value)}
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
            <div className="space-y-1.5">
              <Label htmlFor="qeo-condition">Condition</Label>
              <Input
                id="qeo-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                disabled={busy}
                placeholder="e.g. Mint, Good, Fair"
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
          </div>
        </div>
      </div>
    </>
  );
}
