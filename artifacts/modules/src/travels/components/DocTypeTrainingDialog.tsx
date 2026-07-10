import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, X, Plus } from "lucide-react";
import {
  useCreateCustomDocumentType,
  useSuggestDocumentType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const ICON_LIST = [
  "Plane",
  "Train",
  "Bus",
  "Car",
  "Ship",
  "Anchor",
  "BedDouble",
  "Shield",
  "Globe",
  "Compass",
  "Ticket",
  "UtensilsCrossed",
  "FileText",
  "Receipt",
  "Package",
  "CreditCard",
  "Briefcase",
  "Tag",
  "Building2",
  "MapPin",
  "Camera",
  "Stamp",
  "Leaf",
  "Star",
  "AlertCircle",
] as const;

type IconName = (typeof ICON_LIST)[number];

const COLOR_OPTIONS = [
  {
    key: "blue",
    bg: "bg-blue-100 dark:bg-blue-950",
    fg: "text-blue-600 dark:text-blue-400",
    chip: "bg-blue-500",
  },
  {
    key: "violet",
    bg: "bg-violet-100 dark:bg-violet-950",
    fg: "text-violet-600 dark:text-violet-400",
    chip: "bg-violet-500",
  },
  {
    key: "teal",
    bg: "bg-teal-100 dark:bg-teal-950",
    fg: "text-teal-600 dark:text-teal-400",
    chip: "bg-teal-500",
  },
  {
    key: "orange",
    bg: "bg-orange-100 dark:bg-orange-950",
    fg: "text-orange-600 dark:text-orange-400",
    chip: "bg-orange-500",
  },
  {
    key: "green",
    bg: "bg-green-100 dark:bg-green-950",
    fg: "text-green-600 dark:text-green-400",
    chip: "bg-green-500",
  },
  {
    key: "amber",
    bg: "bg-amber-100 dark:bg-amber-950",
    fg: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500",
  },
  {
    key: "red",
    bg: "bg-red-100 dark:bg-red-950",
    fg: "text-red-600 dark:text-red-400",
    chip: "bg-red-500",
  },
  {
    key: "indigo",
    bg: "bg-indigo-100 dark:bg-indigo-950",
    fg: "text-indigo-600 dark:text-indigo-400",
    chip: "bg-indigo-500",
  },
  {
    key: "rose",
    bg: "bg-rose-100 dark:bg-rose-950",
    fg: "text-rose-600 dark:text-rose-400",
    chip: "bg-rose-500",
  },
  {
    key: "emerald",
    bg: "bg-emerald-100 dark:bg-emerald-950",
    fg: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500",
  },
  {
    key: "sky",
    bg: "bg-sky-100 dark:bg-sky-950",
    fg: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-500",
  },
  {
    key: "slate",
    bg: "bg-slate-100 dark:bg-slate-800",
    fg: "text-slate-500 dark:text-slate-400",
    chip: "bg-slate-500",
  },
] as const;

type ColorKey = (typeof COLOR_OPTIONS)[number]["key"];

function IconPreview({
  iconName,
  colorKey,
}: {
  iconName: IconName | null;
  colorKey: ColorKey;
}) {
  const color =
    COLOR_OPTIONS.find((c) => c.key === colorKey) ??
    COLOR_OPTIONS[COLOR_OPTIONS.length - 1];
  if (!iconName) {
    return (
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center ${color.bg} text-xs ${color.fg} font-medium`}
      >
        ?
      </div>
    );
  }
  return (
    <div
      className={`w-10 h-10 rounded-xl flex items-center justify-center ${color.bg}`}
    >
      <span className={`text-[11px] font-medium ${color.fg}`}>
        {iconName.slice(0, 2)}
      </span>
    </div>
  );
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function DocTypeTrainingDialog({ onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const createType = useCreateCustomDocumentType();
  const suggest = useSuggestDocumentType();

  const [typeName, setTypeName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIcon, setSelectedIcon] = useState<IconName | null>(null);
  const [selectedColor, setSelectedColor] = useState<ColorKey>("slate");
  const [fields, setFields] = useState<{ key: string; label: string }[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState("");

  const handleSuggest = () => {
    if (!typeName.trim()) {
      toast.error("Enter a type name first");
      return;
    }
    suggest.mutate(
      {
        typeName: typeName.trim(),
        description: description.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          if (data.iconName && ICON_LIST.includes(data.iconName as IconName)) {
            setSelectedIcon(data.iconName as IconName);
          }
          if (
            data.colorKey &&
            COLOR_OPTIONS.some((c) => c.key === data.colorKey)
          ) {
            setSelectedColor(data.colorKey as ColorKey);
          }
          if (Array.isArray(data.fields) && data.fields.length > 0) {
            setFields(data.fields);
          }
          toast.success("AI suggestions applied");
        },
        onError: () => toast.error("AI suggestion failed — try again"),
      },
    );
  };

  const addField = () => {
    const label = newFieldLabel.trim();
    if (!label) return;
    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/ +(.)/g, (_, c) => (c as string).toUpperCase());
    setFields((prev) => [...prev, { key, label }]);
    setNewFieldLabel("");
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleConfirm = () => {
    if (!typeName.trim()) {
      toast.error("Type name is required");
      return;
    }
    const typeKey = typeName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/ +/g, "_");

    createType.mutate(
      {
        typeKey,
        typeName: typeName.trim(),
        description: description.trim() || undefined,
        iconName: selectedIcon ?? undefined,
        colorKey: selectedColor,
        fields: fields.length > 0 ? fields : undefined,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["travels", "document-types"] });
          toast.success(`"${typeName.trim()}" saved as a new document type`);
          onSaved();
        },
        onError: () => toast.error("Failed to save document type"),
      },
    );
  };

  const colorObj =
    COLOR_OPTIONS.find((c) => c.key === selectedColor) ??
    COLOR_OPTIONS[COLOR_OPTIONS.length - 1];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Define a new document type</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Name + description */}
          <div className="space-y-1.5">
            <Label htmlFor="dt-name">Name *</Label>
            <Input
              id="dt-name"
              placeholder="e.g. Customs Receipt"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dt-desc">Description (helps AI)</Label>
            <Textarea
              id="dt-desc"
              placeholder="What kind of document is this? What does it confirm?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* AI suggest button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={handleSuggest}
            disabled={suggest.isPending || !typeName.trim()}
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${suggest.isPending ? "animate-pulse" : ""}`}
            />
            {suggest.isPending ? "Asking AI…" : "Ask AI for icon & fields"}
          </Button>

          {/* Icon picker */}
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid grid-cols-7 gap-1">
              {ICON_LIST.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() =>
                    setSelectedIcon(name === selectedIcon ? null : name)
                  }
                  className={`p-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                    selectedIcon === name
                      ? `${colorObj.bg} ${colorObj.fg} ring-1 ring-current`
                      : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
            {selectedIcon && (
              <p className="text-[11px] text-muted-foreground">
                Selected: <strong>{selectedIcon}</strong>
              </p>
            )}
          </div>

          {/* Color picker */}
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  title={c.key}
                  onClick={() => setSelectedColor(c.key)}
                  className={`w-5 h-5 rounded-full ${c.chip} transition-all ${
                    selectedColor === c.key
                      ? "ring-2 ring-offset-2 ring-foreground/40 scale-110"
                      : "opacity-70 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-1.5">
            <Label>Fields to track</Label>
            <div className="space-y-1">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex-1 text-xs bg-muted rounded px-2 py-1">
                    {f.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Input
                placeholder="Add a field…"
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addField();
                  }
                }}
                className="h-7 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={addField}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={createType.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={createType.isPending || !typeName.trim()}
          >
            {createType.isPending ? "Saving…" : "Save type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
