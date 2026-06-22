import { useState, useRef, useId } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AutocompleteInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
}

export function AutocompleteInput({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const lc = value.toLowerCase();
  const visible =
    value.trim() === ""
      ? suggestions
      : suggestions.filter((s) => s.toLowerCase().includes(lc));

  const showDropdown = open && visible.length > 0;

  return (
    <div className="relative space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-card-border bg-card shadow-lg">
          {visible.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start px-3 py-2 text-sm transition hover:bg-muted",
                s === value && "font-medium text-primary",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
