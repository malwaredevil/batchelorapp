import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateFabric,
  useDeleteFabric,
  useListQuiltingCategories,
  getListFabricsQueryKey,
  getGetFabricQueryKey,
} from "@workspace/api-client-react";
import type { QuiltingFabric } from "@workspace/api-client-react";
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

interface QuickEditFabricSheetProps {
  fabric: QuiltingFabric;
  onClose: () => void;
  onDeleted: () => void;
}

export function QuickEditFabricSheet({
  fabric,
  onClose,
  onDeleted,
}: QuickEditFabricSheetProps) {
  const queryClient = useQueryClient();
  const { data: allCategories = [] } = useListQuiltingCategories();

  const [name, setName] = useState(fabric.name);
  const [colorway, setColorway] = useState(fabric.colorway ?? "");
  const [designer, setDesigner] = useState(fabric.designer ?? "");
  const [manufacturer, setManufacturer] = useState(fabric.manufacturer ?? "");
  const [lineName, setLineName] = useState(fabric.lineName ?? "");
  const [fiberContent, setFiberContent] = useState(fabric.fiberContent ?? "");
  const [widthInches, setWidthInches] = useState(
    fabric.widthInches != null ? String(fabric.widthInches) : "",
  );
  const [notes, setNotes] = useState(fabric.notes ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    (fabric.categories as Array<{ id: number }>).map((c) => c.id),
  );

  useEffect(() => {
    setName(fabric.name);
    setColorway(fabric.colorway ?? "");
    setDesigner(fabric.designer ?? "");
    setManufacturer(fabric.manufacturer ?? "");
    setLineName(fabric.lineName ?? "");
    setFiberContent(fabric.fiberContent ?? "");
    setWidthInches(
      fabric.widthInches != null ? String(fabric.widthInches) : "",
    );
    setNotes(fabric.notes ?? "");
    setSelectedCategoryIds(
      (fabric.categories as Array<{ id: number }>).map((c) => c.id),
    );
  }, [fabric]);

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
  }

  const update = useUpdateFabric({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabric.id),
        });
        toast.success("Saved.");
        onClose();
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  const remove = useDeleteFabric({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("Fabric deleted.");
        onDeleted();
      },
      onError: () => toast.error("Could not delete this fabric."),
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
      id: fabric.id,
      data: {
        name: name.trim(),
        colorway: colorway.trim() || null,
        designer: designer.trim() || null,
        manufacturer: manufacturer.trim() || null,
        lineName: lineName.trim() || null,
        fiberContent: fiberContent.trim() || null,
        widthInches: widthInches !== "" ? Number(widthInches) : null,
        notes: notes.trim() || null,
        categories: selectedNames,
      },
    });
  }

  const busy = update.isPending || remove.isPending;

  return (
    <QuickEditSheetFrame
      title={fabric.name}
      onClose={onClose}
      thumbnail={
        fabric.imageUrl ? { src: fabric.imageUrl, alt: fabric.name } : undefined
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
                <AlertDialogTitle>Delete this fabric?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes &ldquo;{fabric.name}&rdquo; from your
                  collection. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => remove.mutate({ id: fabric.id })}
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
        <Label htmlFor="qef-name">Name</Label>
        <Input
          id="qef-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qef-colorway">Colorway</Label>
        <Input
          id="qef-colorway"
          value={colorway}
          onChange={(e) => setColorway(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="qef-designer">Designer</Label>
          <Input
            id="qef-designer"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qef-manufacturer">Manufacturer</Label>
          <Input
            id="qef-manufacturer"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="qef-lineName">Line</Label>
          <Input
            id="qef-lineName"
            value={lineName}
            onChange={(e) => setLineName(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qef-fiberContent">Fiber content</Label>
          <Input
            id="qef-fiberContent"
            value={fiberContent}
            onChange={(e) => setFiberContent(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qef-width">Width (inches)</Label>
        <Input
          id="qef-width"
          type="number"
          value={widthInches}
          onChange={(e) => setWidthInches(e.target.value)}
          disabled={busy}
          placeholder="e.g. 44"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qef-notes">Notes</Label>
        <Textarea
          id="qef-notes"
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
