import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPotteryCategories as useListCategories,
  useCreatePotteryCategory as useCreateCategory,
  useDeletePotteryCategory as useDeleteCategory,
  useRenamePotteryCategory as useRenameCategory,
  useMergePotteryCategory as useMergeCategory,
  useDeletePotteryUnusedCategories as useDeleteUnusedCategories,
  useUpdatePotteryCategoryColors as useUpdateCategoryColors,
  getListPotteryCategoriesQueryKey as getListCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { PotteryCategory as Category } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Tag, Trash2, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CATEGORY_BG_PALETTE,
  autoTextColor,
  suggestCategoryBgColor,
} from "@/pottery/lib/colors";
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
import {
  EditableCategory,
  type CategoryItem,
} from "@/components/category-manager/EditableCategory";
import { MergeDialog } from "@/components/category-manager/MergeDialog";
import { usePageAssistantContext } from "@/pottery/lib/assistant-context";

// ---------------------------------------------------------------------------
// Per-row component — owns all mutation hooks for a single category
// ---------------------------------------------------------------------------

function PotteryCategoryRow({
  cat,
  allCats,
}: {
  cat: Category;
  allCats: CategoryItem[];
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });

  const rename = useRenameCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast.success("Category renamed.");
      },
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : "Could not rename category.",
        ),
    },
  });

  const updateColors = useUpdateCategoryColors({
    mutation: {
      onSuccess: invalidate,
      onError: () => toast.error("Could not update colour."),
    },
  });

  const merge = useMergeCategory({
    mutation: {
      onSuccess: () => {
        toast.success("Categories merged.");
      },
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : "Could not merge categories.",
        ),
    },
  });

  const remove = useDeleteCategory({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast.success("Category removed.");
      },
      onError: () => toast.error("Could not remove category."),
    },
  });

  return (
    <li
      className="group flex items-center justify-between gap-2 px-4 py-3"
      data-testid={`category-row-${cat.id}`}
    >
      <EditableCategory
        cat={cat}
        onRename={(name) => rename.mutate({ id: cat.id, data: { name } })}
        isRenamePending={rename.isPending}
        onUpdateColors={(bg, text) =>
          updateColors.mutate({
            id: cat.id,
            data: { bgColor: bg, textColor: text },
          })
        }
        isColorPending={updateColors.isPending}
        itemLabel="piece"
      />
      <div className="flex items-center gap-1 shrink-0">
        <MergeDialog
          cat={cat}
          allCats={allCats}
          onMerge={(intoId) => merge.mutate({ id: cat.id, data: { intoId } })}
          isMerging={merge.isPending}
          onDone={invalidate}
          itemLabel="piece"
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove "{cat.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the category from all pieces in your collection.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => remove.mutate({ id: cat.id })}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Categories() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [bgColor, setBgColor] = useState<string>(() =>
    suggestCategoryBgColor(0),
  );
  const [textColor, setTextColor] = useState<string>(() =>
    autoTextColor(suggestCategoryBgColor(0)),
  );

  const { data: cats = [], isLoading } = useListCategories();

  useEffect(() => {
    const next = suggestCategoryBgColor(cats.length);
    setBgColor(next);
    setTextColor(autoTextColor(next));
  }, [cats.length]);

  const unusedCount = cats.filter((c) => (c.count ?? 0) === 0).length;

  const create = useCreateCategory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCategoriesQueryKey(),
        });
        setNewName("");
        toast.success("Category added.");
      },
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : "Could not add category.",
        ),
    },
  });

  const deleteUnused = useDeleteUnusedCategories({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: getListCategoriesQueryKey(),
        });
        const n = data.deleted;
        toast.success(`${n} unused categor${n === 1 ? "y" : "ies"} removed.`);
      },
      onError: () => toast.error("Could not remove unused categories."),
    },
  });

  const trimmedNew = newName.trim();
  const lcNew = trimmedNew.toLowerCase();
  const matchingCats =
    trimmedNew.length > 0
      ? cats.filter((c) => c.name.toLowerCase().includes(lcNew))
      : [];
  const exactMatch = cats.some((c) => c.name.toLowerCase() === lcNew);
  const showDropdown = inputFocused && matchingCats.length > 0;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || exactMatch) return;
    create.mutate({ data: { name, bgColor, textColor } });
  }

  usePageAssistantContext(
    "pottery-categories",
    isLoading
      ? undefined
      : `Categories page: ${cats.length} categor${cats.length === 1 ? "y" : "ies"} in the collection, ${unusedCount} unused. Categories (id, name, piece count): ${cats.map((c) => `${c.id}:"${c.name}" (${c.count ?? 0})`).join(", ") || "none"}.`,
  );

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-sm text-muted-foreground">
            Organise your collection with categories. They're assigned manually
            on each piece or matched automatically when you add a new item.
          </p>
        </div>
        {unusedCount > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10"
                disabled={deleteUnused.isPending}
              >
                {deleteUnused.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Delete {unusedCount} unused
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {unusedCount} unused categor
                  {unusedCount === 1 ? "y" : "ies"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes all categories that aren't assigned to any piece.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteUnused.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete unused
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <form onSubmit={handleAdd} className="mb-6 space-y-1">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              placeholder="New category name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 150)}
              maxLength={50}
              disabled={create.isPending}
              autoComplete="off"
              data-testid="input-new-category"
            />
            {showDropdown && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-card-border bg-card shadow-lg">
                {matchingCats.map((cat) => {
                  const isExact = cat.name.toLowerCase() === lcNew;
                  return (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span
                        className={
                          isExact
                            ? "font-medium text-amber-600 dark:text-amber-400"
                            : "text-foreground"
                        }
                      >
                        {cat.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {isExact
                          ? "already exists"
                          : `${cat.count ?? 0} piece${(cat.count ?? 0) === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Button
            type="submit"
            disabled={create.isPending || !trimmedNew || exactMatch}
            data-testid="button-add-category"
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
        </div>
        {exactMatch && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            A category named &ldquo;{trimmedNew}&rdquo; already exists.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground shrink-0">
            Colour:
          </span>
          <div className="flex flex-wrap gap-1">
            {CATEGORY_BG_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => {
                  setBgColor(color);
                  setTextColor(autoTextColor(color));
                }}
                className="h-5 w-5 rounded-full transition hover:scale-110"
                style={{
                  backgroundColor: color,
                  outline:
                    bgColor === color
                      ? `2px solid ${color}`
                      : "2px solid transparent",
                  outlineOffset: "2px",
                }}
              />
            ))}
            <input
              type="color"
              value={bgColor}
              onChange={(e) => {
                setBgColor(e.target.value);
                setTextColor(autoTextColor(e.target.value));
              }}
              className="h-5 w-8 cursor-pointer rounded border border-card-border bg-transparent p-0.5"
              title="Custom colour"
            />
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            )}
            style={{ backgroundColor: bgColor, color: textColor }}
          >
            {trimmedNew || "Preview"}
          </span>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cats.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
          <Tag className="h-9 w-9 opacity-25" />
          <p className="text-sm">
            No categories yet. Add one above to get started.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card">
          {cats.map((cat) => (
            <PotteryCategoryRow key={cat.id} cat={cat} allCats={cats} />
          ))}
        </ul>
      )}
    </div>
  );
}
