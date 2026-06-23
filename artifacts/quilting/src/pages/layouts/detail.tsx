import { useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetLayout,
  useDeleteLayout,
  useListBlocks,
  useListFabrics,
  getListLayoutsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { svgCellStr } from "@/lib/svg-export";
import { fmtInch } from "@/lib/cell-parser";
import { buildFabricUrlMap } from "@/components/FabricPicker";

type BlockSeamLine = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number;
  clipEnd?: number;
};

type BlockSummary = {
  id: number;
  gridSize: number;
  cells: string[];
  blockSizeInches?: number | null;
  seams?: BlockSeamLine[];
};

type LayoutCellData = { blockId: number | null; rotation: 0 | 90 | 180 | 270 };

type LayoutData = {
  id: number;
  name: string;
  rows: number;
  cols: number;
  cells: LayoutCellData[];
  sashingWidthInches?: number | null;
  sashingColor?: string | null;
  borderWidthInches?: number | null;
  borderColor?: string | null;
  cornerstoneColor?: string | null;
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
};

const SVG_SIZE = 280;

export default function LayoutDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const layoutId = Number(id);

  const {
    data: layout,
    isLoading,
    isError,
  } = useGetLayout(Number.isFinite(layoutId) ? layoutId : 0);

  const { data: allBlocks = [] } = useListBlocks();
  const { data: fabrics = [] } = useListFabrics();
  const numMap = buildFabricUrlMap(fabrics as Parameters<typeof buildFabricUrlMap>[0]);
  const fabricUrlMap: Record<string, string> = Object.fromEntries(
    Object.entries(numMap).map(([k, v]) => [k, v as string]),
  );

  const deleteLayout = useDeleteLayout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Layout deleted.");
        navigate("/layouts");
      },
      onError: () => toast.error("Could not delete this layout."),
    },
  });

  const svgDataUrl = useMemo(() => {
    if (!layout) return "";
    const l = layout as unknown as LayoutData;
    const blockMap = new Map<number, BlockSummary>(
      (allBlocks as unknown as BlockSummary[]).map((b) => [b.id, b]),
    );

    const rows = l.rows;
    const cols = l.cols;
    const blockPxW = SVG_SIZE / cols;
    const blockPxH = SVG_SIZE / rows;

    const shapes: string[] = [];

    for (let li = 0; li < l.cells.length; li++) {
      const layoutCell = l.cells[li];
      const row = Math.floor(li / cols);
      const col = li % cols;
      const bx = col * blockPxW;
      const by = row * blockPxH;

      if (layoutCell.blockId == null) {
        shapes.push(
          `<rect x="${bx}" y="${by}" width="${blockPxW}" height="${blockPxH}" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="0.5"/>`,
        );
        continue;
      }

      const block = blockMap.get(layoutCell.blockId);
      if (!block) {
        shapes.push(
          `<rect x="${bx}" y="${by}" width="${blockPxW}" height="${blockPxH}" fill="#e5e7eb"/>`,
        );
        continue;
      }

      const gs = block.gridSize;
      const gh = Math.max(1, Math.ceil(block.cells.length / gs));
      const cellW = blockPxW / gs;
      const cellH = blockPxH / gh;

      for (let ci = 0; ci < block.cells.length; ci++) {
        const cellRow = Math.floor(ci / gs);
        const cellCol = ci % gs;
        shapes.push(
          svgCellStr(
            bx + cellCol * cellW,
            by + cellRow * cellH,
            cellW,
            cellH,
            block.cells[ci] ?? "",
            fabricUrlMap,
          ),
        );
      }
    }

    const svgStr = `<svg width="${SVG_SIZE}" height="${SVG_SIZE}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${SVG_SIZE}" height="${SVG_SIZE}" fill="#ffffff"/>${shapes.join("")}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
  }, [layout, allBlocks, fabricUrlMap]);

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

  if (isError || !layout) {
    return (
      <div className="mx-auto max-w-3xl text-center">
        <p className="py-10 text-sm text-muted-foreground">Layout not found.</p>
        <Button variant="outline" onClick={() => navigate("/layouts")}>
          Back to layouts
        </Button>
      </div>
    );
  }

  const l = layout as unknown as LayoutData;

  return (
    <div className="mx-auto max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => navigate("/layouts")}
      >
        <ArrowLeft className="h-4 w-4" />
        Layouts
      </Button>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: layout SVG preview */}
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-card-border bg-white p-4">
          {svgDataUrl ? (
            <img
              src={svgDataUrl}
              alt={l.name}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-xs text-muted-foreground">No preview</div>
          )}
        </div>

        {/* Right: info + actions */}
        <div className="flex flex-col gap-4">
          {/* Title row */}
          <div className="flex items-start gap-3">
            <h1 className="flex-1 text-2xl font-bold tracking-tight leading-tight">
              {l.name}
            </h1>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(`/layouts/${layoutId}/edit`)}
                title="Edit in composer"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (confirm("Delete this layout? This cannot be undone."))
                    deleteLayout.mutate({ id: layoutId });
                }}
                disabled={deleteLayout.isPending}
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Layout details */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Layout details
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Grid</span>
                <span className="font-medium">
                  {l.rows} rows × {l.cols} cols
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Blocks placed</span>
                <span className="font-medium">
                  {l.cells.filter((c) => c.blockId != null).length} /{" "}
                  {l.cells.length}
                </span>
              </div>
              {l.sashingWidthInches != null && l.sashingWidthInches > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Sashing</span>
                  <span className="font-medium">
                    {fmtInch(l.sashingWidthInches)}
                  </span>
                </div>
              )}
              {l.borderWidthInches != null && l.borderWidthInches > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Border</span>
                  <span className="font-medium">
                    {fmtInch(l.borderWidthInches)}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Categories */}
          {l.categories.length > 0 && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {l.categories.map((cat) => {
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
    </div>
  );
}
