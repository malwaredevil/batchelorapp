import { useState, useId } from "react";
import { Check, Plus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  useCreateQuiltingCategory,
  getListQuiltingCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Normalise typographic / "smart" characters to their plain ASCII equivalents,
 * then capitalise the first letter.  Run on the client before matching or
 * submitting so that curly quotes introduced by mobile autocorrect never
 * produce duplicate categories.
 */
export function normalizeTagInput(raw: string): string {
  const s = raw
    // Curly / double-prime double-quote variants → "
    .replace(
      /[\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u301D\u301E\u02BA\uFF02″]/g,
      '"',
    )
    // Curly / prime single-quote and apostrophe variants → '
    .replace(
      /[\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u02B9\u02BC\uFF07′]/g,
      "'",
    )
    // Em-dash, en-dash, figure dash, horizontal bar → hyphen
    .replace(/[\u2013\u2014\u2015\u2012]/g, "-")
    // Horizontal ellipsis → three dots
    .replace(/\u2026/g, "...")
    .trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface TagSelectorProps {
  label?: string;
  allCategories: QuiltingCategory[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onCreated: (cat: QuiltingCategory) => void;
  disabled?: boolean;
}

export function TagSelector({
  label = "Categories",
  allCategories,
  selectedIds,
  onToggle,
  onCreated,
  disabled,
}: TagSelectorProps) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const queryClient = useQueryClient();

  const create = useCreateQuiltingCategory({
    mutation: {
      onSuccess: (newCat) => {
        queryClient.invalidateQueries({
          queryKey: getListQuiltingCategoriesQueryKey(),
        });
        onCreated(newCat);
        setInput("");
        setOpen(false);
        toast.success(`Category "${newCat.name}" created and added.`);
      },
      onError: () => toast.error("Could not create category."),
    },
  });

  // Normalize the raw input — this is what gets compared and submitted.
  const normalized = normalizeTagInput(input);
  const lc = normalized.toLowerCase();

  const matches = allCategories.filter((c) =>
    c.name.toLowerCase().includes(lc),
  );
  const exactMatch = allCategories.some((c) => c.name.toLowerCase() === lc);
  const showCreate = normalized.length > 0 && !exactMatch;
  const showDropdown =
    open && normalized.length > 0 && (matches.length > 0 || showCreate);

  function handleCreate() {
    if (!normalized || create.isPending) return;
    // Send the normalized form so the server sees a clean, capitalised name.
    create.mutate({ data: { name: normalized } });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </Label>

      {allCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allCategories.map((cat) => {
            const selected = selectedIds.includes(cat.id);
            const hasBg = !!cat.bgColor;
            return (
              <button
                key={cat.id}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(cat.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  !hasBg &&
                    (selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-card-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"),
                  hasBg && "border",
                )}
                style={
                  hasBg
                    ? {
                        backgroundColor: selected
                          ? cat.bgColor!
                          : "transparent",
                        color: selected
                          ? (cat.textColor ?? "#fff")
                          : cat.bgColor!,
                        borderColor: cat.bgColor!,
                      }
                    : undefined
                }
              >
                {cat.name}
                {selected && <X className="h-2.5 w-2.5 opacity-60" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Input
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (showCreate) handleCreate();
              else if (matches.length === 1) {
                onToggle(matches[0].id);
                setInput("");
                setOpen(false);
              }
            }
            if (e.key === "Escape") {
              setOpen(false);
              setInput("");
            }
          }}
          placeholder="Search or create a category…"
          disabled={disabled || create.isPending}
          autoComplete="off"
          className="text-sm"
        />
        {create.isPending && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-card-border bg-card shadow-lg">
            {matches.map((cat) => {
              const selected = selectedIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onToggle(cat.id);
                    setInput("");
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-sm transition hover:bg-muted",
                    selected && "font-medium text-primary",
                  )}
                >
                  {selected ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  {cat.name}
                  {selected && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      tap to remove
                    </span>
                  )}
                </button>
              );
            })}
            {showCreate && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleCreate();
                }}
                className="flex w-full items-center gap-2 border-t border-card-border px-3 py-2 text-sm font-medium text-primary transition hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                {/* Show the normalised form so the user sees what will actually be stored */}
                Create &ldquo;{normalized}&rdquo;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
