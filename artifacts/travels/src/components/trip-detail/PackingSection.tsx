import { useState, useRef, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useGetPackingList,
  useCreatePackingItem,
  useBulkCreatePackingItems,
  useUpdatePackingItem,
  useDeletePackingItem,
  useReorderPackingItems,
  useLoadPackingTemplate,
  useListPackingTemplates,
  useCreatePackingTemplate,
  useDeletePackingTemplate,
  getGetPackingListQueryKey,
  getListPackingTemplatesQueryKey,
  type TravelsPackingItem as PackingItem,
  type TravelsPackingTemplate as PackingTemplate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  X,
  CheckSquare,
  Square,
  Sparkles,
  BookOpen,
  BookMarked,
  Trash2,
  ChevronDown,
  Loader2,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";

interface PackingSectionProps {
  tripId: number;
}

// ── Sortable item row ─────────────────────────────────────────────────────────

interface SortableItemProps {
  item: PackingItem;
  onToggle: (item: PackingItem) => void;
  onDelete: (id: number) => void;
}

function SortableItem({ item, onToggle, onDelete }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors group"
    >
      {/* drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground focus-visible:text-muted-foreground transition-colors cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {/* packed toggle */}
      <button
        onClick={() => onToggle(item)}
        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
      >
        {item.packed ? (
          <CheckSquare className="w-4 h-4 text-primary" />
        ) : (
          <Square className="w-4 h-4" />
        )}
      </button>

      {/* text */}
      <span
        className={`flex-1 text-sm leading-tight select-none ${
          item.packed ? "line-through text-muted-foreground" : "text-foreground"
        }`}
      >
        {item.text}
      </span>

      {/* delete */}
      <button
        onClick={() => onDelete(item.id)}
        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PackingSection({ tripId }: PackingSectionProps) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetPackingList(tripId);
  const createItem = useCreatePackingItem();
  const bulkCreate = useBulkCreatePackingItems();
  const updateItem = useUpdatePackingItem();
  const deleteItem = useDeletePackingItem();
  const reorderItems = useReorderPackingItems();
  const loadTemplate = useLoadPackingTemplate();
  const { data: templates = [] } = useListPackingTemplates();
  const createTemplate = useCreatePackingTemplate();
  const deleteTemplate = useDeletePackingTemplate();

  const [newItemText, setNewItemText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<string[]>([]);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
  // Optimistic ordered list for DnD — null means use server order
  const [localOrder, setLocalOrder] = useState<PackingItem[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const invalidate = useCallback(() => {
    setLocalOrder(null);
    void qc.invalidateQueries({ queryKey: getGetPackingListQueryKey(tripId) });
  }, [qc, tripId]);

  const serverItems = data?.items ?? [];
  // Prefer local (optimistic) order during/after a drag, until server confirms
  const items = localOrder ?? serverItems;
  const packed = items.filter((i) => i.packed).length;

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    setLocalOrder(reordered); // optimistic update

    reorderItems.mutate(
      { id: tripId, data: { order: reordered.map((i) => i.id) } },
      {
        onSuccess: invalidate,
        onError: () => {
          setLocalOrder(null); // rollback
          toast.error("Failed to reorder items");
        },
      },
    );
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const handleAdd = () => {
    const text = newItemText.trim();
    if (!text) return;
    setNewItemText("");
    createItem.mutate(
      { id: tripId, data: { text } },
      {
        onSuccess: invalidate,
        onError: () => toast.error("Failed to add item"),
      },
    );
  };

  const handleToggle = (item: PackingItem) => {
    updateItem.mutate(
      { id: tripId, itemId: item.id, data: { packed: !item.packed } },
      {
        onSuccess: invalidate,
        onError: () => toast.error("Failed to update item"),
      },
    );
  };

  const handleDelete = (itemId: number) => {
    deleteItem.mutate(
      { id: tripId, itemId },
      {
        onSuccess: invalidate,
        onError: () => toast.error("Failed to remove item"),
      },
    );
  };

  // ── AI Generate ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGeneratedItems([]);
    setShowGenerateDialog(true);
    setGenerating(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/travels/trips/${tripId}/packing/generate`, {
        method: "POST",
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        toast.error("Failed to generate packing list");
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let event = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            event = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            try {
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              if (event === "done" && Array.isArray(parsed.items)) {
                setGeneratedItems(parsed.items as string[]);
              }
            } catch {
              // ignore partial chunks
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error("Generation failed");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleAddGenerated = () => {
    if (generatedItems.length === 0) return;
    const existing = new Set(items.map((i) => i.text.toLowerCase()));
    const toAdd = generatedItems
      .filter((t) => !existing.has(t.toLowerCase()))
      .map((text) => ({ text }));

    if (toAdd.length === 0) {
      toast.info("All suggested items are already on the list");
      setShowGenerateDialog(false);
      return;
    }

    bulkCreate.mutate(
      { id: tripId, data: { items: toAdd } },
      {
        onSuccess: () => {
          invalidate();
          toast.success(`Added ${toAdd.length} item${toAdd.length !== 1 ? "s" : ""}`);
          setShowGenerateDialog(false);
          setGeneratedItems([]);
        },
        onError: () => toast.error("Failed to add items"),
      },
    );
  };

  // ── Templates ─────────────────────────────────────────────────────────────

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    createTemplate.mutate(
      {
        data: {
          name: templateName.trim(),
          items: items.map((i) => i.text),
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListPackingTemplatesQueryKey() });
          toast.success("Template saved");
          setShowSaveTemplateDialog(false);
          setTemplateName("");
        },
        onError: () => toast.error("Failed to save template"),
      },
    );
  };

  const handleLoadTemplate = (template: PackingTemplate) => {
    loadTemplate.mutate(
      { id: tripId, templateId: template.id },
      {
        onSuccess: (result) => {
          invalidate();
          toast.success(
            `Added ${result.added} item${result.added !== 1 ? "s" : ""} from "${template.name}"`,
          );
          setShowTemplatesDialog(false);
        },
        onError: () => toast.error("Failed to load template"),
      },
    );
  };

  const handleDeleteTemplate = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteTemplate.mutate({ templateId: id }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListPackingTemplatesQueryKey() });
        toast.success("Template deleted");
      },
      onError: () => toast.error("Failed to delete template"),
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      {items.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {packed} of {items.length} packed
            </span>
            <span>
              {items.length > 0 ? Math.round((packed / items.length) * 100) : 0}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{
                width: `${items.length > 0 ? (packed / items.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Add item row */}
      <div className="flex gap-2">
        <Input
          placeholder="Add item..."
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), handleAdd())
          }
          className="flex-1 h-8 text-sm"
        />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleAdd}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleGenerate} disabled={generating}>
              <Sparkles className="w-4 h-4 mr-2 text-primary" />
              AI suggestions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowTemplatesDialog(true)}>
              <BookOpen className="w-4 h-4 mr-2" />
              Load template
            </DropdownMenuItem>
            {items.length > 0 && (
              <DropdownMenuItem
                onClick={() => setShowSaveTemplateDialog(true)}
              >
                <BookMarked className="w-4 h-4 mr-2" />
                Save as template
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Item list with DnD */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nothing on the packing list yet. Add items above or try AI
          suggestions.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-0.5">
              {items.map((item) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* AI Generate dialog */}
      <Dialog
        open={showGenerateDialog}
        onOpenChange={(open) => {
          if (!open) {
            abortRef.current?.abort();
            setShowGenerateDialog(false);
            if (generating) setGenerating(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Packing Suggestions
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {generating ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Generating suggestions…
                </p>
              </div>
            ) : generatedItems.length > 0 ? (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {generatedItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 py-1 px-2 rounded text-sm"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No suggestions generated. Try again.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowGenerateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddGenerated}
              disabled={
                generatedItems.length === 0 ||
                generating ||
                bulkCreate.isPending
              }
            >
              {bulkCreate.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add all to list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save template dialog */}
      <Dialog
        open={showSaveTemplateDialog}
        onOpenChange={setShowSaveTemplateDialog}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Template name (e.g. Weekend trip)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveTemplate()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveTemplateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={!templateName.trim() || createTemplate.isPending}
            >
              {createTemplate.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <BookMarked className="w-4 h-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load template dialog */}
      <Dialog
        open={showTemplatesDialog}
        onOpenChange={setShowTemplatesDialog}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Load Template</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-1 max-h-64 overflow-y-auto">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No templates saved yet. Save this list as a template to reuse
                it.
              </p>
            ) : (
              templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/60 cursor-pointer transition-colors group"
                  onClick={() => handleLoadTemplate(tmpl)}
                >
                  <div>
                    <p className="text-sm font-medium">{tmpl.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {tmpl.items.length} item
                      {tmpl.items.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteTemplate(tmpl.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowTemplatesDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
