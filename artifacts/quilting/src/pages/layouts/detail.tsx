import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Pencil, Trash2, ZoomIn } from "lucide-react";
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
import { fmtInch } from "@/lib/cell-parser";
import { buildFabricUrlMap } from "@/components/FabricPicker";
import { LayoutPreviewSvg } from "@/components/LayoutPreviewSvg";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";

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


export default function LayoutDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const layoutId = Number(id);
  const [zoomOpen, setZoomOpen] = useState(false);

  const {
    data: layout,
    isLoading,
    isError,
  } = useGetLayout(Number.isFinite(layoutId) ? layoutId : 0);

  const { data: allBlocks = [] } = useListBlocks();
  const { data: fabrics = [] } = useListFabrics();
  const numMap = buildFabricUrlMap(fabrics as Parameters<typeof buildFabricUrlMap>[0]);

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
        <div
          className="relative flex aspect-square cursor-zoom-in items-center justify-center overflow-hidden rounded-2xl border border-card-border bg-white p-4 group"
          onClick={() => setZoomOpen(true)}
        >
          <LayoutPreviewSvg
            layout={l}
            blocks={allBlocks as unknown as { id: number; gridSize: number; cells: string[]; rotation?: number }[]}
            fabricUrlMap={numMap}
            size={280}
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
      <PreviewZoomModal open={zoomOpen} onClose={() => setZoomOpen(false)} title={l.name}>
        <LayoutPreviewSvg
          layout={l}
          blocks={allBlocks as unknown as { id: number; gridSize: number; cells: string[]; rotation?: number }[]}
          fabricUrlMap={numMap}
          size={500}
        />
      </PreviewZoomModal>
    </div>
  );
}
