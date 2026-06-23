import { useState, useEffect } from "react";
import { Tag } from "lucide-react";
import { TagSelector } from "@/components/tag-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QuiltingCategory } from "@workspace/api-client-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  currentCategories: QuiltingCategory[];
  allCategories: QuiltingCategory[];
  onSave: (categoryNames: string[]) => void;
  isSaving: boolean;
}

export function CategoryEditDialog({
  open,
  onClose,
  title,
  currentCategories,
  allCategories,
  onSave,
  isSaving,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // Track categories created during this dialog session so that handleSave
  // can resolve their names even if the query hasn't refetched yet.
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);

  useEffect(() => {
    if (open) {
      setSelectedIds(currentCategories.map((c) => c.id));
      setLocalNewCats([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = () => {
    // Merge allCategories (from the query) with any locally-created categories
    // that may not have been included in the refetch yet.
    const merged = [
      ...allCategories,
      ...localNewCats.filter((nc) => !allCategories.some((a) => a.id === nc.id)),
    ];
    const names = merged
      .filter((c) => selectedIds.includes(c.id))
      .map((c) => c.name);
    onSave(names);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            Edit categories
          </DialogTitle>
          <p className="truncate text-xs text-muted-foreground">{title}</p>
        </DialogHeader>
        <div className="py-1">
          <TagSelector
            allCategories={allCategories}
            selectedIds={selectedIds}
            onToggle={(id) =>
              setSelectedIds((prev) =>
                prev.includes(id)
                  ? prev.filter((x) => x !== id)
                  : [...prev, id],
              )
            }
            onCreated={(cat) => {
              setSelectedIds((prev) => [...prev, cat.id]);
              setLocalNewCats((prev) =>
                prev.some((c) => c.id === cat.id) ? prev : [...prev, cat],
              );
            }}
            disabled={isSaving}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
