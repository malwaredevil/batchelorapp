import { useState, useRef, useEffect } from "react";
import { Loader2, Pencil, Check, X, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CategoryColorPicker } from "./CategoryColorPicker";

export interface CategoryItem {
  id: number;
  name: string;
  count?: number | null;
  bgColor?: string | null;
  textColor?: string | null;
}

interface EditableCategoryProps {
  cat: CategoryItem;
  onRename: (name: string) => void;
  isRenamePending: boolean;
  onRenameSuccess?: () => void;
  onUpdateColors: (bg: string, text: string) => void;
  isColorPending: boolean;
  itemLabel?: string;
}

export function EditableCategory({
  cat,
  onRename,
  isRenamePending,
  onRenameSuccess,
  onUpdateColors,
  isColorPending,
  itemLabel = "item",
}: EditableCategoryProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  const [colorOpen, setColorOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevColorPending = useRef(isColorPending);

  useEffect(() => {
    if (prevColorPending.current && !isColorPending) {
      setColorOpen(false);
    }
    prevColorPending.current = isColorPending;
  }, [isColorPending]);

  const prevRenamePending = useRef(isRenamePending);
  useEffect(() => {
    if (prevRenamePending.current && !isRenamePending) {
      setEditing(false);
      onRenameSuccess?.();
    }
    prevRenamePending.current = isRenamePending;
  }, [isRenamePending, onRenameSuccess]);

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
    onRename(name);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  }

  const count = cat.count ?? 0;
  const hasBg = !!cat.bgColor;

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={50}
          disabled={isRenamePending}
          className="h-8 text-sm"
          data-testid={`input-rename-${cat.id}`}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={commit}
          disabled={isRenamePending || !draft.trim()}
          data-testid={`button-confirm-rename-${cat.id}`}
        >
          {isRenamePending ? (
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
          disabled={isRenamePending}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
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
                ? ({
                    backgroundColor: cat.bgColor!,
                    color: cat.textColor ?? "#fff",
                    "--tw-ring-color": cat.bgColor,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {isColorPending ? (
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
            onChange={onUpdateColors}
            disabled={isColorPending}
          />
        </PopoverContent>
      </Popover>

      <span className="text-xs text-muted-foreground tabular-nums">
        {count === 0 ? (
          <span className="text-destructive/70">unused</span>
        ) : (
          `${count} ${itemLabel}${count === 1 ? "" : "s"}`
        )}
      </span>
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
