import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, X, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useListOrnamentCategories } from "@workspace/api-client-react";

interface CategorySelectorProps {
  value: number[];
  onChange: (value: number[]) => void;
  className?: string;
}

export function CategorySelector({ value = [], onChange, className }: CategorySelectorProps) {
  const { data: categories = [], isLoading } = useListOrnamentCategories();
  const [open, setOpen] = useState(false);

  const selectedCategories = useMemo(() => {
    return value.map(id => categories.find(c => c.id === id)).filter(Boolean) as typeof categories;
  }, [value, categories]);

  const toggleCategory = (id: number) => {
    const isSelected = value.includes(id);
    if (isSelected) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="justify-between w-full min-h-10 h-auto py-2 font-normal bg-card border-input"
          >
            <div className="flex flex-wrap gap-1 items-center">
              {selectedCategories.length === 0 && (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Tags className="h-4 w-4" /> Select categories...
                </span>
              )}
              {selectedCategories.map((cat) => (
                <Badge 
                  key={cat.id} 
                  variant="secondary"
                  className="rounded-md font-normal px-2 py-0.5 border"
                  style={{
                    backgroundColor: cat.bgColor || "#f3f4f6",
                    color: cat.textColor || "#374151",
                    borderColor: cat.bgColor || "#e5e7eb"
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCategory(cat.id);
                  }}
                >
                  {cat.name}
                  <X className="ml-1 h-3 w-3 opacity-70 hover:opacity-100" />
                </Badge>
              ))}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories..." />
            <CommandList>
              <CommandEmpty>{isLoading ? "Loading..." : "No category found."}</CommandEmpty>
              <CommandGroup>
                {categories.map((cat) => (
                  <CommandItem
                    key={cat.id}
                    value={cat.name}
                    onSelect={() => toggleCategory(cat.id)}
                    className="flex items-center"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value.includes(cat.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div 
                      className="px-2 py-0.5 rounded-md text-sm border"
                      style={{
                        backgroundColor: cat.bgColor || "#f3f4f6",
                        color: cat.textColor || "#374151",
                        borderColor: cat.bgColor || "#e5e7eb"
                      }}
                    >
                      {cat.name}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
