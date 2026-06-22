import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListQuiltingCategories,
  useCreateQuiltingCategory,
  useDeleteQuiltingCategory,
  useRenameQuiltingCategory,
  useMergeQuiltingCategory,
  useDeleteQuiltingUnusedCategories,
  useUpdateQuiltingCategoryColors,
  getListQuiltingCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { QuiltingCategoryWithCount } from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  Tag,
  Trash2,
  Plus,
  Loader2,
  Pencil,
  Check,
  X,
  GitMerge,
  Palette,
  SortAsc,
  SortDesc,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CATEGORY_BG_PALETTE,
  autoTextColor,
  suggestCategoryBgColor,
} from "@/lib/colors";
import { normalizeTagInput } from "@/components/tag-selector";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Small palette + custom-colour picker shown in a popover on each category row. */
function CategoryColorPicker({
  bgColor,
  textColor,
  onChange,
  disabled,
}: {
  bgColor: string | null | undefined;
  textColor: string | null | undefined;
  onChange: (bg: string, text: string) => void;
  disabled?: boolean;
}) {
  const currentBg = bgColor ?? "";
  return (
    <div className="p-3 space-y-3 w-56">
      <p className="text-xs font-medium text-muted-foreground">
        Background colour
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_BG_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            disabled={disabled}
            title={color}
            onClick={() => onChange(color, autoTextColor(color))}
            className="h-6 w-6 rounded-full transition hover:scale-110 ring-offset-1"
            style={{
              backgroundColor: color,
              outline:
                currentBg === color
                  ? `2px solid ${color}`
                  : "2px solid transparent",
              outlineOffset: "2px",
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Custom:</span>
        <input
          type="color"
          value={currentBg || "#2980b9"}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.value, autoTextColor(e.target.value))
          }
          className="h-6 w-10 cursor-pointer rounded border border-card-border p-0.5 bg-transparent"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Text colour:</span>
        <div className="flex gap-1">
          {(["#000000", "#ffffff"] as const).map((tc) => (
            <button
              key={tc}
              type="button"
              disabled={disabled}
              onClick={() => onChange(currentBg || "#2980b9", tc)}
              className={cn(
                "h-6 w-6 rounded border-2 text-[10px] font-bold transition",
                textColor === tc
                  ? "border-foreground scale-110"
                  : "border-transparent opacity-60 hover:opacity-90",
              )}
              style={{
                backgroundColor: tc === "#000000" ? "#fff" : "#000",
                color: tc,
              }}
            >
              A
            </button>
          ))}
        </div>
      </div>
      {currentBg && (
        <div className="pt-1">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: currentBg,
              color: textColor ?? autoTextColor(currentBg),
            }}
          >
            Preview
          </span>
        </div>
      )}
    </div>
  );
}

function EditableCategory({
  cat,
  onSaved,
}: {
  cat: QuiltingCategoryWithCount;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  const [colorOpen, setColorOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const rename = useRenameQuiltingCategory({
    mutation: {
      onSuccess: () => {
        setEditing(false);
        onSaved();
        toast.success("Category renamed.");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Could not rename category.",
        );
      },
    },
  });

  const updateColors = useUpdateQuiltingCategoryColors({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        });
        setColorOpen(false);
      },
      onError: () => toast.error("Could not update colour."),
    },
  });

  useEffect(() => {
    if (editing) {
      setDraft(cat.name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, cat.name]);

  function commit() {
    const name = draft.trim();
    if (!name || name === cat.name) {
      setEditing(false);
      return;
    }
    rename.mutate({ id: cat.id, data: { name } });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={50}
          disabled={rename.isPending}
          className="h-8 text-sm"
          data-testid={`input-rename-${cat.id}`}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={commit}
          disabled={rename.isPending || !draft.trim()}
          data-testid={`button-confirm-rename-${cat.id}`}
        >
          {rename.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={() => setEditing(false)}
          disabled={rename.isPending}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const hasBg = !!cat.bgColor;

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {/* Coloured chip — click to open colour picker */}
      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Edit colour"
            className={cn(
              "group/chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "hover:ring-2 hover:ring-offset-1",
              !hasBg &&
                "border border-card-border bg-muted text-muted-foreground hover:ring-muted-foreground/40",
              hasBg && "hover:ring-offset-background",
            )}
            style={
              hasBg
                ? {
                    backgroundColor: cat.bgColor!,
                    color: cat.textColor ?? "#fff",
                    // @ts-ignore
                    "--tw-ring-color": cat.bgColor,
                  }
                : undefined
            }
          >
            {updateColors.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                {cat.name}
                <Palette className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-60 transition-opacity shrink-0" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CategoryColorPicker
            bgColor={cat.bgColor}
            textColor={cat.textColor}
            onChange={(bg, text) =>
              updateColors.mutate({
                id: cat.id,
                data: { bgColor: bg, textColor: text },
              })
            }
            disabled={updateColors.isPending}
          />
        </PopoverContent>
      </Popover>

      {(cat.count ?? 0) === 0 ? (
        <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive/70">
          unused
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
          {cat.count}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => setEditing(true)}
        data-testid={`button-rename-${cat.id}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function MergeDialog({
  cat,
  allCats,
  onDone,
}: {
  cat: { id: number; name: string; count?: number };
  allCats: { id: number; name: string; count?: number }[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [intoId, setIntoId] = useState<string>("");
  const [comboOpen, setComboOpen] = useState(false);
  const queryClient = useQueryClient();

  const merge = useMergeQuiltingCategory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        });
        setOpen(false);
        setIntoId("");
        onDone();
        toast.success("Categories merged.");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Could not merge categories.",
        );
      },
    },
  });

  const others = allCats
    .filter((c) => c.id !== cat.id)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const target = others.find((c) => c.id === Number(intoId));

  function handleMerge() {
    if (!intoId) return;
    merge.mutate({ id: cat.id, data: { targetId: Number(intoId) } });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => setOpen(true)}
        title="Merge into another category"
      >
        <GitMerge className="h-4 w-4" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setIntoId("");
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Merge category</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Move all items tagged{" "}
            <span className="font-medium text-foreground">"{cat.name}"</span>{" "}
            into another category, then delete{" "}
            <span className="font-medium text-foreground">"{cat.name}"</span>.
          </p>

          <Popover open={comboOpen} onOpenChange={setComboOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={comboOpen}
                className="w-full justify-between font-normal"
              >
                {target ? target.name : "Choose target category…"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput placeholder="Search categories…" />
                <CommandList>
                  <CommandEmpty>No categories found.</CommandEmpty>
                  <CommandGroup>
                    {others.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.name}
                        onSelect={() => {
                          setIntoId(String(c.id));
                          setComboOpen(false);
                        }}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${intoId === String(c.id) ? "opacity-100" : "opacity-0"}`}
                        />
                        {c.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" disabled={merge.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={!intoId || merge.isPending}
              onClick={handleMerge}
            >
              {merge.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Merge{target ? ` into "${target.name}"` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SortKey = "name-asc" | "name-desc" | "count-desc" | "count-asc";

const SORT_LABELS: Record<SortKey, string> = {
  "count-desc": "Most used first",
  "count-asc": "Least used first",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};

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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("count-desc");

  const { data: cats = [], isLoading } = useListQuiltingCategories();

  // Rotate palette suggestion whenever the list changes size (post-create / delete)
  useEffect(() => {
    const next = suggestCategoryBgColor(cats.length);
    setBgColor(next);
    setTextColor(autoTextColor(next));
  }, [cats.length]);
  const unusedCount = cats.filter((c) => (c.count ?? 0) === 0).length;

  const searchLc = search.trim().toLowerCase();
  const displayedCats = cats
    .filter((c) => !searchLc || c.name.toLowerCase().includes(searchLc))
    .sort((a, b) => {
      if (sort === "name-asc") return a.name.localeCompare(b.name);
      if (sort === "name-desc") return b.name.localeCompare(a.name);
      if (sort === "count-asc") return (a.count ?? 0) - (b.count ?? 0);
      return (b.count ?? 0) - (a.count ?? 0); // count-desc default
    });

  const create = useCreateQuiltingCategory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        });
        setNewName("");
        toast.success("Category added.");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Could not add category.",
        );
      },
    },
  });

  const remove = useDeleteQuiltingCategory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        });
        toast.success("Category removed.");
      },
      onError: () => toast.error("Could not remove category."),
    },
  });

  const deleteUnused = useDeleteQuiltingUnusedCategories({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        });
        const n = data.deleted;
        toast.success(`${n} unused categor${n === 1 ? "y" : "ies"} removed.`);
      },
      onError: () => toast.error("Could not remove unused categories."),
    },
  });

  const normalizedNew = normalizeTagInput(newName);
  const lcNew = normalizedNew.toLowerCase();
  const matchingCats =
    normalizedNew.length > 0
      ? cats.filter((c) => c.name.toLowerCase().includes(lcNew))
      : [];
  const exactMatch = cats.some((c) => c.name.toLowerCase() === lcNew);
  const showDropdown = inputFocused && matchingCats.length > 0;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizedNew || exactMatch) return;
    create.mutate({ data: { name: normalizedNew, bgColor, textColor } });
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-sm text-muted-foreground">
            Organise your collection with categories. They're assigned manually
            on each item or matched automatically when you add a new item.
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
                  This removes all categories that aren't assigned to any item.
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
                          : `${cat.count ?? 0} item${(cat.count ?? 0) === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Button
            type="submit"
            disabled={create.isPending || !normalizedNew || exactMatch}
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
            A category named &ldquo;{normalizedNew}&rdquo; already exists.
          </p>
        )}

        {/* Colour picker for the new category */}
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
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: bgColor, color: textColor }}
          >
            {normalizedNew || "Preview"}
          </span>
        </div>
      </form>

      {/* Search + sort controls */}
      {!isLoading && cats.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search categories…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 pr-9 text-sm"
            />
            {search && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5"
              >
                {sort === "count-desc" || sort === "name-desc" ? (
                  <SortDesc className="h-3.5 w-3.5" />
                ) : (
                  <SortAsc className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => setSort(key)}
                  className={sort === key ? "font-medium text-primary" : ""}
                >
                  {SORT_LABELS[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cats.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
          <Tag className="h-9 w-9 opacity-25" />
          <p className="text-sm">
            No categories yet. Add one above to get started.
          </p>
        </div>
      ) : displayedCats.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
          <p className="text-sm">No categories match &ldquo;{search}&rdquo;</p>
          <button
            onClick={() => setSearch("")}
            className="text-xs text-primary hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card">
          {displayedCats.map((cat) => (
            <li
              key={cat.id}
              className="group flex items-center justify-between gap-2 px-4 py-3"
              data-testid={`category-row-${cat.id}`}
            >
              <EditableCategory
                cat={cat}
                onSaved={() =>
                  queryClient.invalidateQueries({
                    queryKey: getListQuiltingCategoriesQueryKey(),
                  })
                }
              />
              <div className="flex items-center gap-1 shrink-0">
                <MergeDialog
                  cat={cat}
                  allCats={cats}
                  onDone={() =>
                    queryClient.invalidateQueries({
                      queryKey: getListQuiltingCategoriesQueryKey(),
                    })
                  }
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
                        This removes the category from all items in your
                        collection. This cannot be undone.
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
          ))}
        </ul>
      )}
    </div>
  );
}
