import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Pencil, Trash2, Scissors, ZoomIn, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetBlock,
  useDeleteBlock,
  useCreateBlock,
  useListFabrics,
  getListBlocksQueryKey,
  QuiltingCreateBlockInputGridSize,
  QuiltingBlockSeamLine,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { fmtInch } from "@/lib/cell-parser";
import { buildFabricUrlMap } from "@/components/FabricPicker";
import { BlockPreviewSvg } from "@/components/BlockPreviewSvg";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";

export default function BlockDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const blockId = Number(id);
  const [zoomOpen, setZoomOpen] = useState(false);

  const {
    data: block,
    isLoading,
    isError,
  } = useGetBlock(Number.isFinite(blockId) ? blockId : 0);

  const { data: fabrics = [] } = useListFabrics();
  const numMap = buildFabricUrlMap(fabrics as Parameters<typeof buildFabricUrlMap>[0]);

  const deleteBlock = useDeleteBlock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block deleted.");
        navigate("/blocks");
      },
      onError: () => toast.error("Could not delete this block."),
    },
  });

  const duplicateBlock = useCreateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block duplicated.");
        navigate(`/blocks/${String(data.id)}`);
      },
      onError: () => toast.error("Could not duplicate this block."),
    },
  });

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
        <Button variant="outline" onClick={() => navigate("/blocks")}>
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
    categories: Array<{ id: number; name: string; bgColor: string | null; textColor: string | null }>;
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
        onClick={() => navigate("/blocks")}
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
          <BlockPreviewSvg cells={cells} gridSize={gridSize} size={280} tileCount={1} fabricUrlMap={numMap} />
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
                onClick={() => navigate(`/blocks/${blockId}/edit`)}
                title="Edit in designer"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(`/blocks/${blockId}/cut-pattern`)}
                title="Cut pattern"
              >
                <Scissors className="h-4 w-4" />
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
                  <span className="font-medium">{fmtInch(b.blockSizeInches)}</span>
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

          {/* Categories */}
          {b.categories.length > 0 && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categories
              </p>
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
            </section>
          )}
        </div>
      </div>
      <PreviewZoomModal open={zoomOpen} onClose={() => setZoomOpen(false)} title={b.name}>
        <BlockPreviewSvg cells={cells} gridSize={gridSize} size={500} tileCount={3} fabricUrlMap={numMap} />
      </PreviewZoomModal>
    </div>
  );
}
