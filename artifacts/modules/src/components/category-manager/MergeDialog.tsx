import { useState, useEffect, useRef } from "react";
import { Loader2, GitMerge, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { CategoryItem } from "./EditableCategory";

interface MergeDialogProps {
  cat: CategoryItem;
  allCats: CategoryItem[];
  onMerge: (intoId: number) => void;
  isMerging: boolean;
  onDone: () => void;
  itemLabel?: string;
}

export function MergeDialog({
  cat,
  allCats,
  onMerge,
  isMerging,
  onDone,
  itemLabel = "item",
}: MergeDialogProps) {
  const [open, setOpen] = useState(false);
  const [intoId, setIntoId] = useState<string>("");
  const [comboOpen, setComboOpen] = useState(false);
  const prevMerging = useRef(false);

  useEffect(() => {
    if (prevMerging.current && !isMerging) {
      setOpen(false);
      setIntoId("");
      onDone();
    }
    prevMerging.current = isMerging;
  }, [isMerging, onDone]);

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
    onMerge(Number(intoId));
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
          if (!isMerging) {
            setOpen(v);
            if (!v) setIntoId("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Merge category</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Move all {itemLabel}s tagged{" "}
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
              <Button variant="outline" disabled={isMerging}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={!intoId || isMerging}
              onClick={handleMerge}
            >
              {isMerging ? (
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
