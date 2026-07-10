import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Plus, Tags, Pencil, Trash2, Merge } from "lucide-react";
import {
  useListOrnamentCategories,
  useCreateOrnamentCategory,
  useUpdateOrnamentCategoryColors,
  useRenameOrnamentCategory,
  useDeleteOrnamentCategory,
  useDeleteOrnamentUnusedCategories,
  useMergeOrnamentCategory,
  getListOrnamentCategoriesQueryKey,
  getListOrnamentsQueryKey,
  getGetOrnamentStatsQueryKey,
} from "@workspace/api-client-react";
import type { OrnamentsCategory as Category } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  bgColor: z.string().optional(),
  textColor: z.string().optional(),
});

function CategoryColorEditor({ category }: { category: Category }) {
  const queryClient = useQueryClient();
  const updateColors = useUpdateOrnamentCategoryColors();

  const [bgColor, setBgColor] = useState(category.bgColor || "#f3f4f6");
  const [textColor, setTextColor] = useState(category.textColor || "#374151");
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = async () => {
    try {
      await updateColors.mutateAsync({
        id: category.id,
        data: { bgColor, textColor },
      });
      queryClient.invalidateQueries({
        queryKey: getListOrnamentCategoriesQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      toast.success("Colors updated");
      setIsEditing(false);
    } catch (err) {
      toast.error("Failed to update colors");
    }
  };

  if (!isEditing) {
    return (
      <Badge
        className="cursor-pointer font-normal rounded-md"
        style={{
          backgroundColor: category.bgColor || "#f3f4f6",
          color: category.textColor || "#374151",
          border: `1px solid ${category.bgColor || "#e5e7eb"}`,
        }}
        onClick={() => setIsEditing(true)}
      >
        {category.name}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg border border-border">
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={bgColor}
          onChange={(e) => setBgColor(e.target.value)}
          className="w-8 h-8 p-0 border-0 rounded cursor-pointer"
          title="Background Color"
        />
        <input
          type="color"
          value={textColor}
          onChange={(e) => setTextColor(e.target.value)}
          className="w-8 h-8 p-0 border-0 rounded cursor-pointer"
          title="Text Color"
        />
      </div>
      <Badge
        className="mx-2 font-normal rounded-md"
        style={{
          backgroundColor: bgColor,
          color: textColor,
          border: `1px solid ${bgColor}`,
        }}
      >
        {category.name}
      </Badge>
      <div className="flex gap-1 ml-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setIsEditing(false)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSave}
          disabled={updateColors.isPending}
        >
          {updateColors.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </div>
  );
}

function CategoryActionMenu({
  category,
  allCategories,
}: {
  category: Category;
  allCategories: Category[];
}) {
  const queryClient = useQueryClient();
  const deleteCat = useDeleteOrnamentCategory();
  const renameCat = useRenameOrnamentCategory();
  const mergeCat = useMergeOrnamentCategory();

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(category.name);

  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);

  const handleDelete = async () => {
    if (
      !confirm(
        `Are you sure you want to delete "${category.name}"? This will remove it from all items.`,
      )
    )
      return;
    try {
      await deleteCat.mutateAsync({ id: category.id });
      queryClient.invalidateQueries({
        queryKey: getListOrnamentCategoriesQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getGetOrnamentStatsQueryKey(),
      });
      toast.success("Category deleted");
    } catch (err) {
      toast.error("Failed to delete category");
    }
  };

  const handleRename = async () => {
    if (!renameValue.trim() || renameValue === category.name) {
      setRenameOpen(false);
      return;
    }
    try {
      await renameCat.mutateAsync({
        id: category.id,
        data: { name: renameValue.trim() },
      });
      queryClient.invalidateQueries({
        queryKey: getListOrnamentCategoriesQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      toast.success("Category renamed");
      setRenameOpen(false);
    } catch (err) {
      toast.error("Failed to rename category");
    }
  };

  const handleMerge = async () => {
    if (!mergeTargetId) return;
    try {
      await mergeCat.mutateAsync({
        id: category.id,
        data: { intoId: mergeTargetId },
      });
      queryClient.invalidateQueries({
        queryKey: getListOrnamentCategoriesQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      toast.success("Categories merged");
      setMergeOpen(false);
    } catch (err) {
      toast.error("Failed to merge categories");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 text-xs font-medium">
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMergeOpen(true)}>
            <Merge className="mr-2 h-4 w-4" /> Merge into...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Category</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label>New name</Label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renameCat.isPending}>
              {renameCat.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Category</DialogTitle>
            <DialogDescription>
              Move all items from "{category.name}" into another category, then
              delete "{category.name}".
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 flex flex-col gap-2 max-h-[300px] overflow-y-auto">
            {allCategories
              .filter((c) => c.id !== category.id)
              .map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mergeTargetId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                  onClick={() => setMergeTargetId(c.id)}
                >
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${mergeTargetId === c.id ? "border-primary" : "border-input"}`}
                  >
                    {mergeTargetId === c.id && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <Badge
                    className="font-normal rounded-md"
                    style={{
                      backgroundColor: c.bgColor || "#f3f4f6",
                      color: c.textColor || "#374151",
                    }}
                  >
                    {c.name}
                  </Badge>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={mergeCat.isPending || !mergeTargetId}
            >
              {mergeCat.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Categories() {
  const { data: categories, isLoading } = useListOrnamentCategories();
  const queryClient = useQueryClient();
  const createCategory = useCreateOrnamentCategory();
  const deleteUnused = useDeleteOrnamentUnusedCategories();

  const [isCreating, setIsCreating] = useState(false);
  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", bgColor: "#fed7aa", textColor: "#9a3412" },
  });

  usePageAssistantContext(
    "ornaments-categories",
    `Categories management page. Current categories: ${categories?.map((c) => c.name).join(", ") || "none"}.`,
  );

  const onSubmit = async (data: z.infer<typeof createSchema>) => {
    try {
      await createCategory.mutateAsync({ data });
      queryClient.invalidateQueries({
        queryKey: getListOrnamentCategoriesQueryKey(),
      });
      toast.success("Category created");
      form.reset();
      setIsCreating(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create category");
    }
  };

  const handleCleanup = async () => {
    if (!confirm("Delete all categories that aren't assigned to any items?"))
      return;
    try {
      await deleteUnused.mutateAsync();
      queryClient.invalidateQueries({
        queryKey: getListOrnamentCategoriesQueryKey(),
      });
      toast.success("Unused categories removed");
    } catch (err) {
      toast.error("Cleanup failed");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Categories
          </h1>
          <p className="text-muted-foreground mt-1">
            Organize your collection with color-coded tags
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleCleanup}
            disabled={deleteUnused.isPending}
          >
            {deleteUnused.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Cleanup unused
          </Button>
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Category
          </Button>
        </div>
      </div>

      {isCreating && (
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 mb-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <Tags className="h-4 w-4" /> Create Category
          </h3>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-wrap items-end gap-4"
          >
            <div className="flex-1 min-w-[200px]">
              <Label className="mb-2 block">Name</Label>
              <Input
                {...form.register("name")}
                autoFocus
                placeholder="e.g. Vintage, Star Wars..."
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive mt-1">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <Label className="mb-2 block">Background</Label>
              <input
                type="color"
                {...form.register("bgColor")}
                className="h-10 w-16 p-1 border rounded cursor-pointer"
              />
            </div>
            <div>
              <Label className="mb-2 block">Text</Label>
              <input
                type="color"
                {...form.register("textColor")}
                className="h-10 w-16 p-1 border rounded cursor-pointer"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createCategory.isPending}>
                {createCategory.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create
              </Button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="flex py-12 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : categories?.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border bg-card">
          <Tags className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No categories yet</h3>
          <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
            Create categories to help filter and organize your ornaments.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setIsCreating(true)}
          >
            Create First Category
          </Button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-card-border shadow-sm divide-y divide-card-border overflow-hidden">
          {categories?.map((cat) => (
            <div
              key={cat.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-4">
                <CategoryColorEditor category={cat} />
                {(cat as any).count !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {(cat as any).count} items
                  </span>
                )}
              </div>
              <div className="flex items-center">
                <CategoryActionMenu category={cat} allCategories={categories} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
