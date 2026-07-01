import { useState, useRef, useEffect } from "react";
import { X, Plus, Sparkles, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    .trim();
}

interface OneThingInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  existingValues?: string[];
  destination?: string;
  placeholder?: string;
}

export function OneThingInput({
  value,
  onChange,
  existingValues = [],
  destination,
  placeholder = "Add a highlight...",
}: OneThingInputProps) {
  const [input, setInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = existingValues.filter(
    (v) =>
      v.toLowerCase().includes(input.toLowerCase()) &&
      !value.includes(v) &&
      input.length > 0,
  );

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function addTag(raw: string) {
    const tag = toTitleCase(raw);
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
    setInput("");
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  async function suggestFromAI() {
    if (!destination || suggesting) return;
    setSuggesting(true);
    setAiSuggestions([]);
    try {
      const res = await fetch("/api/travels/highlights/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      });
      if (res.ok) {
        const data = (await res.json()) as { suggestions: string[] };
        setAiSuggestions(data.suggestions ?? []);
      }
    } catch {
      // ignore
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      {/* Current tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-1 pr-1 text-xs font-normal"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="rounded-sm hover:text-destructive transition-colors ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input + autocomplete */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered[0] && !input.trim()) return;
                  addTag(input);
                }
                if (e.key === "Escape") setShowDropdown(false);
              }}
              placeholder={placeholder}
              className="pr-2"
            />

            {showDropdown && filtered.length > 0 && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                {filtered.slice(0, 8).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(v);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => addTag(input)}
            disabled={!input.trim()}
          >
            <Plus className="w-4 h-4" />
          </Button>

          {destination && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={suggestFromAI}
              disabled={suggesting}
              className="gap-1.5 shrink-0"
            >
              {suggesting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Suggest
            </Button>
          )}
        </div>
      </div>

      {/* AI suggestions */}
      {aiSuggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Click to add:</p>
          <div className="flex flex-wrap gap-1.5">
            {aiSuggestions.map((s) => {
              const titled = toTitleCase(s);
              const alreadyAdded = value.includes(titled);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => addTag(s)}
                  disabled={alreadyAdded}
                  className={cn(
                    "text-xs px-2 py-1 rounded-full border transition-colors",
                    alreadyAdded
                      ? "border-border text-muted-foreground opacity-50 cursor-default"
                      : "border-primary/40 text-primary hover:bg-primary/10",
                  )}
                >
                  {titled}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
