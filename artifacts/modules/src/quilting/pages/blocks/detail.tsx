import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Scissors,
  ZoomIn,
  Copy,
  Tag,
  Check,
  X as XIcon,
  Library,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetBlock,
  useDeleteBlock,
  useCreateBlock,
  useUpdateBlock,
  useCreateBlockTemplate,
  useListFabrics,
  useListQuiltingCategories,
  getListBlocksQueryKey,
  getGetBlockQueryKey,
  getListBlockTemplatesQueryKey,
  QuiltingCreateBlockInputGridSize,
  QuiltingBlockSeamLine,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { fmtInch } from "@/quilting/lib/cell-parser";
import { buildFabricUrlMap } from "@/quilting/components/FabricPicker";
import { BlockPreviewSvg } from "@/quilting/components/BlockPreviewSvg";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { TagSelector } from "@/quilting/components/tag-selector";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

export default function BlockDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const blockId = Number(id);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [catEditing, setCatEditing] = useState(false);
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>([]);
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateTagsInput, setTemplateTagsInput] = useState("");

  const {
    data: block,
    isLoading,
    isError,
  } = useGetBlock(Number.isFinite(blockId) ? blockId : 0);

  const { data: fabricsData } = useListFabrics({ pageSize: 200 });
  const fabrics = fabricsData?.items ?? [];
  const { data: allCategories } = useListQuiltingCategories();
  const numMap = buildFabricUrlMap(
    fabrics as Parameters<typeof buildFabricUrlMap>[0],
  );

  usePageAssistantContext(
    "quilting-block-detail",
    isLoading || !block
      ? undefined
      : `Block Detail page (blockId: ${block.id}): "${block.name}", ${block.gridSize}x${block.gridSize} grid.`,
  );

  const deleteBlock = useDeleteBlock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block deleted.");
        navigate("/quilting/blocks");
      },
      onError: () => toast.error("Could not delete this block."),
    },
  });

  const duplicateBlock = useCreateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block duplicated.");
        navigate(`/quilting/blocks/${String(data.id)}`);
      },
      onError: () => toast.error("Could not duplicate this block."),
    },
  });

  const createTemplate = useCreateBlockTemplate({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: getListBlockTemplatesQueryKey(),
        });
        toast.success("Saved to Block Patterns");
        setTemplateDialogOpen(false);
        navigate(`/quilting/library/blocks/${String(data.id)}/edit`);
      },
      onError: () => toast.error("Could not save this block as a template."),
    },
  });

  function handleSaveAsTemplate() {
    if (!block) return;
    const tags = templateTagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    createTemplate.mutate({
      data: {
        name: block.name,
        tags,
        gridW: block.gridSize,
        gridH: Math.max(1, Math.ceil(block.cells.length / block.gridSize)),
        cells: block.cells,
        seams: (block.seams ?? []).map((s) => ({
          axis: s.axis,
          pos: s.pos,
          cellIdx: s.cellIdx,
          clipStart: s.clipStart ?? undefined,
          clipEnd: s.clipEnd ?? undefined,
        })),
        blockSizeInches: block.blockSizeInches ?? undefined,
        seamAllowanceInches: block.seamAllowanceInches ?? undefined,
      },
    });
  }

  const updateBlockCategories = useUpdateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetBlockQueryKey(blockId), data);
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Categories saved");
        setCatEditing(false);
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  function enterCatEdit() {
    const raw = block as unknown as { categories?: Array<{ id: number }> };
    setSelectedCatIds(raw.categories?.map((c) => c.id) ?? []);
    setLocalNewCats([]);
    setCatEditing(true);
  }

  function handleSaveCategories() {
    const merged = [
      ...(allCategories ?? []),
      ...localNewCats.filter(
        (nc) => !(allCategories ?? []).some((a) => a.id === nc.id),
      ),
    ];
    const categoryNames = merged
      .filter((c) => selectedCatIds.includes(c.id))
      .map((c) => c.name);
    updateBlockCategories.mutate({ id: blockId, data: { categoryNames } });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-9 w-24" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !block) {
    return (
      <div className="mx-auto max-w-3xl text-center">
        <p className="py-10 text-sm text-muted-foreground">Block not found.</p>
        <Button variant="outline" onClick={() => navigate("/quilting/blocks")}>
          Back to blocks
        </Button>
      </div>
    );
  }

  const b = block as {
    id: number;
    name: string;
    gridSize: number;
    cells: string[];
    seams?: QuiltingBlockSeamLine[];
    blockSizeInches?: number | null;
    seamAllowanceInches?: number | null;
    dominantColors?: string[];
    categories: Array<{
      id: number;
      name: string;
      bgColor: string | null;
      textColor: string | null;
    }>;
  };

  const cells = b.cells;
  const gridSize = b.gridSize;
  const gridH = Math.max(1, Math.ceil(cells.length / gridSize));

  return (
    <div className="mx-auto max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => navigate("/quilting/blocks")}
      >
        <ArrowLeft className="h-4 w-4" />
        Blocks
      </Button>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: block SVG preview */}
        <div
          className="relative flex aspect-square cursor-zoom-in items-center justify-center overflow-hidden rounded-2xl border border-card-border bg-white p-4 group"
          onClick={() => setZoomOpen(true)}
        >
          <BlockPreviewSvg
            cells={cells}
            gridSize={gridSize}
            size={280}
            tileCount={1}
            fabricUrlMap={numMap}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
            <ZoomIn className="h-10 w-10 text-white drop-shadow-lg" />
          </div>
        </div>

        {/* Right: info + actions */}
        <div className="flex flex-col gap-4">
          {/* Title row */}
          <div className="flex items-start gap-3">
            <h1 className="flex-1 text-2xl font-bold tracking-tight leading-tight">
              {b.name}
            </h1>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(`/quilting/blocks/${blockId}/edit`)}
                title="Edit in designer"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  navigate(`/quilting/blocks/${blockId}/cut-pattern`)
                }
                title="Cut pattern"
              >
                <Scissors className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  setTemplateTagsInput("");
                  setTemplateDialogOpen(true);
                }}
                title="Save as template"
              >
                <Library className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  duplicateBlock.mutate({
                    data: {
                      name: `${b.name} (copy)`,
                      gridSize: b.gridSize as QuiltingCreateBlockInputGridSize,
                      cells: b.cells,
                      seams: b.seams ?? [],
                      blockSizeInches: b.blockSizeInches ?? undefined,
                      seamAllowanceInches: b.seamAllowanceInches ?? undefined,
                      categoryNames: b.categories.map((c) => c.name),
                    },
                  })
                }
                disabled={duplicateBlock.isPending}
                title="Duplicate block"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (confirm("Delete this block? This cannot be undone."))
                    deleteBlock.mutate({ id: blockId });
                }}
                disabled={deleteBlock.isPending}
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Block details */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Block details
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Grid</span>
                <span className="font-medium">
                  {gridSize}×{gridH}
                </span>
              </div>
              {b.blockSizeInches != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Finished size</span>
                  <span className="font-medium">
                    {fmtInch(b.blockSizeInches)}
                  </span>
                </div>
              )}
              {b.seamAllowanceInches != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Seam allowance</span>
                  <span className="font-medium">
                    {fmtInch(b.seamAllowanceInches)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pieces</span>
                <span className="font-medium">{cells.length}</span>
              </div>
            </div>
          </section>

          {/* Colours */}
          {(b.dominantColors ?? []).length > 0 && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Colours
              </p>
              <div className="flex flex-wrap gap-2">
                {(b.dominantColors ?? []).map((color, i) => (
                  <span
                    key={i}
                    className="h-6 w-6 rounded-full border border-border/30 shadow-sm"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Categories */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Tag className="h-3 w-3" /> Categories
              </p>
              {!catEditing && (
                <button
                  onClick={enterCatEdit}
                  className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                  title="Edit categories"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>

            {catEditing ? (
              <>
                <TagSelector
                  allCategories={allCategories ?? []}
                  selectedIds={selectedCatIds}
                  onToggle={(id) =>
                    setSelectedCatIds((prev) =>
                      prev.includes(id)
                        ? prev.filter((x) => x !== id)
                        : [...prev, id],
                    )
                  }
                  onCreated={(cat) => {
                    setSelectedCatIds((prev) => [...prev, cat.id]);
                    setLocalNewCats((prev) =>
                      prev.some((c) => c.id === cat.id) ? prev : [...prev, cat],
                    );
                  }}
                  disabled={updateBlockCategories.isPending}
                />
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveCategories}
                    disabled={updateBlockCategories.isPending}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {updateBlockCategories.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCatEditing(false)}
                    disabled={updateBlockCategories.isPending}
                  >
                    <XIcon className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : b.categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {b.categories.map((cat) => {
                  const palette = cat.bgColor
                    ? {
                        bgColor: cat.bgColor,
                        textColor: cat.textColor ?? "#fff",
                      }
                    : getCategoryPalette(cat.name);
                  return (
                    <Badge
                      key={cat.id}
                      variant="outline"
                      className="border-transparent"
                      style={{
                        backgroundColor: palette.bgColor,
                        color: palette.textColor,
                      }}
                    >
                      {cat.name}
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No categories — click <Pencil className="inline h-2.5 w-2.5" />{" "}
                to add
              </p>
            )}
          </section>
        </div>
      </div>
      <PreviewZoomModal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={b.name}
      >
        <BlockPreviewSvg
          cells={cells}
          gridSize={gridSize}
          size={500}
          tileCount={1}
          fabricUrlMap={numMap}
        />
      </PreviewZoomModal>
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This adds a copy of "{b.name}" to Block Patterns as a reusable
            template. The original block is left untouched.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Tags (comma-separated)
            </label>
            <Input
              value={templateTagsInput}
              onChange={(e) => setTemplateTagsInput(e.target.value)}
              placeholder="e.g. Classic, Star"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateDialogOpen(false)}
              disabled={createTemplate.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAsTemplate}
              disabled={createTemplate.isPending}
            >
              {createTemplate.isPending ? "Saving…" : "Save to library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
