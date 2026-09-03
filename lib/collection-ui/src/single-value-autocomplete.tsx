import { useId, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Input } from "@workspace/ui/input";
import { cn } from "@workspace/web-core/utils";

export interface SingleValueAutocompleteProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A controlled single-value picker. Suggestions are only a convenience:
 * arbitrary input remains valid and is passed through unchanged.
 */
export function SingleValueAutocomplete({
  id,
  value,
  onValueChange,
  suggestions,
  placeholder = "Search or enter a value…",
  disabled = false,
  className,
}: SingleValueAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-suggestions`;

  const uniqueSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return suggestions.filter((suggestion) => {
      const key = suggestion.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [suggestions]);

  const query = value.trim().toLowerCase();
  const matches = uniqueSuggestions.filter((suggestion) =>
    suggestion.toLowerCase().includes(query),
  );
  const showSuggestions = open && matches.length > 0;
  const highlightedOptionId =
    showSuggestions && highlightedIndex >= 0
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  function selectSuggestion(suggestion: string) {
    onValueChange(suggestion);
    setHighlightedIndex(-1);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          setOpen(true);
          setHighlightedIndex(-1);
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            setHighlightedIndex(-1);
          }, 150);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && matches.length > 0) {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((current) =>
              current < matches.length - 1 ? current + 1 : 0,
            );
          } else if (event.key === "ArrowUp" && matches.length > 0) {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((current) =>
              current > 0 ? current - 1 : matches.length - 1,
            );
          } else if (event.key === "Enter" && showSuggestions) {
            const index =
              highlightedIndex >= 0
                ? highlightedIndex
                : matches.length === 1
                  ? 0
                  : -1;
            if (index >= 0) {
              event.preventDefault();
              selectSuggestion(matches[index]);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
            setHighlightedIndex(-1);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showSuggestions}
        aria-controls={showSuggestions ? listboxId : undefined}
        aria-activedescendant={highlightedOptionId}
        aria-autocomplete="list"
        className={className}
      />

      {showSuggestions && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-card-border bg-card shadow-lg"
        >
          {matches.map((suggestion, index) => (
            <button
              key={suggestion}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted",
                index === highlightedIndex && "bg-muted",
              )}
            >
              {suggestion.toLowerCase() === query ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
