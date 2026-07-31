import { X } from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import type { CollectionCategory } from "./collection-card";

export interface CategoryChipPickerProps {
  categories: CollectionCategory[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  showRemoveIcon?: boolean;
  className?: string;
}

/**
 * Shared category-selection presentation. Data fetching and mutations remain
 * domain adapters, while selection, colour, and disabled behaviour stay
 * visually identical across collections.
 */
export function CategoryChipPicker({
  categories,
  selectedIds,
  onToggle,
  disabled = false,
  size = "md",
  showRemoveIcon = false,
  className,
}: CategoryChipPickerProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {categories.map((category) => {
        const selected = selectedIds.includes(category.id);
        const hasColor = Boolean(category.bgColor);

        return (
          <button
            key={category.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onToggle(category.id)}
            className={cn(
              "inline-flex items-center rounded-full border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              size === "sm"
                ? "gap-1 px-2.5 py-0.5 text-xs"
                : "gap-1.5 px-3 py-1 text-sm",
              !hasColor &&
                (selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"),
            )}
            style={
              hasColor
                ? {
                    backgroundColor: selected
                      ? (category.bgColor ?? undefined)
                      : "transparent",
                    borderColor: category.bgColor ?? undefined,
                    color: selected
                      ? (category.textColor ?? "#fff")
                      : (category.bgColor ?? undefined),
                  }
                : undefined
            }
          >
            {category.name}
            {selected && showRemoveIcon && (
              <X className="h-3 w-3 opacity-60" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
