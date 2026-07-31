import { useId, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { Input } from "@workspace/ui/input";
import { Label } from "@workspace/ui/label";
import { cn } from "@workspace/web-core/utils";
import {
  autoTextColor,
  CATEGORY_BG_PALETTE,
  suggestCategoryBgColor,
} from "@workspace/web-core/colors";
import { CategoryChipPicker } from "./category-chip-picker";
import type { CollectionCategory } from "./collection-card";

export interface CreateCategoryInput {
  name: string;
  bgColor?: string;
  textColor?: string;
}

export interface CategoryTagSelectorProps<
  TCategory extends CollectionCategory,
> {
  label?: string;
  categories: TCategory[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onCreate: (input: CreateCategoryInput) => Promise<TCategory>;
  onCreated: (category: TCategory) => void;
  normalizeInput?: (raw: string) => string;
  enableColorPicker?: boolean;
  disabled?: boolean;
}

function defaultNormalize(raw: string): string {
  const value = raw.trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

/** Shared search/select/create interaction with optional category colours. */
export function CategoryTagSelector<TCategory extends CollectionCategory>({
  label = "Categories",
  categories,
  selectedIds,
  onToggle,
  onCreate,
  onCreated,
  normalizeInput = defaultNormalize,
  enableColorPicker = false,
  disabled = false,
}: CategoryTagSelectorProps<TCategory>) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [colorStep, setColorStep] = useState(false);
  const [pickedBg, setPickedBg] = useState("");
  const [creating, setCreating] = useState(false);
  const inputId = useId();

  const normalized = normalizeInput(input);
  const lower = normalized.toLowerCase();
  const matches = categories.filter((category) =>
    category.name.toLowerCase().includes(lower),
  );
  const exactMatch = categories.some(
    (category) => category.name.toLowerCase() === lower,
  );
  const showCreate = normalized.length > 0 && !exactMatch;
  const showDropdown =
    open && normalized.length > 0 && (matches.length > 0 || showCreate);

  function startCreate() {
    if (!enableColorPicker) {
      void confirmCreate();
      return;
    }
    setPickedBg(suggestCategoryBgColor(categories.length));
    setColorStep(true);
  }

  async function confirmCreate() {
    if (!normalized || creating) return;
    setCreating(true);
    try {
      const category = await onCreate({
        name: normalized,
        ...(pickedBg
          ? { bgColor: pickedBg, textColor: autoTextColor(pickedBg) }
          : {}),
      });
      onCreated(category);
      setInput("");
      setOpen(false);
      setColorStep(false);
    } catch {
      // The domain adapter owns user-facing mutation errors.
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </Label>

      {categories.length > 0 && (
        <CategoryChipPicker
          categories={categories}
          selectedIds={selectedIds}
          onToggle={onToggle}
          disabled={disabled}
          size="sm"
          showRemoveIcon
          className="gap-1.5"
        />
      )}

      <div className="relative">
        <Input
          id={inputId}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setColorStep(false);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              setColorStep(false);
            }, 150)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (colorStep) void confirmCreate();
              else if (showCreate) startCreate();
              else if (matches.length === 1) {
                onToggle(matches[0].id);
                setInput("");
                setOpen(false);
              }
            }
            if (event.key === "Escape") {
              if (colorStep) setColorStep(false);
              else {
                setOpen(false);
                setInput("");
              }
            }
          }}
          placeholder="Search or create a category…"
          disabled={disabled || creating}
          autoComplete="off"
          className="text-sm"
        />
        {creating && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-card-border bg-card shadow-lg">
            {!colorStep &&
              matches.map((category) => {
                const selected = selectedIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onToggle(category.id);
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
                    {category.name}
                    {selected && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        tap to remove
                      </span>
                    )}
                  </button>
                );
              })}

            {!colorStep && showCreate && (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  startCreate();
                }}
                className="flex w-full items-center gap-2 border-t border-card-border px-3 py-2 text-sm font-medium text-primary transition hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                Create &ldquo;{normalized}&rdquo;
              </button>
            )}

            {colorStep && showCreate && (
              <div className="space-y-3 p-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: pickedBg,
                      color: autoTextColor(pickedBg),
                    }}
                  >
                    {normalized}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Choose a colour
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_BG_PALETTE.map((background) => (
                    <button
                      key={background}
                      type="button"
                      aria-label={`Use category colour ${background}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setPickedBg(background);
                      }}
                      className={cn(
                        "h-5 w-5 rounded-full border-2 transition-all",
                        pickedBg === background
                          ? "scale-110 border-foreground/60"
                          : "border-transparent hover:scale-105",
                      )}
                      style={{ backgroundColor: background }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setColorStep(false);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      void confirmCreate();
                    }}
                    disabled={creating}
                    className="flex-1 rounded-md bg-primary py-1 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                  >
                    {creating ? "Creating…" : `Create "${normalized}"`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
