import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  ZoomIn,
  Tag,
  Check,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetLayout,
  useDeleteLayout,
  useUpdateLayout,
  useListBlocks,
  useListFabrics,
  useListQuiltingCategories,
  getListLayoutsQueryKey,
  getGetLayoutQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { fmtInch } from "@/quilting/lib/cell-parser";
import { buildFabricUrlMap } from "@/quilting/components/FabricPicker";
import { LayoutPreviewSvg } from "@/quilting/components/LayoutPreviewSvg";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { TagSelector } from "@/quilting/components/tag-selector";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

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
  dominantColors?: string[];
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
  const [catEditing, setCatEditing] = useState(false);
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>([]);
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);

  const {
    data: layout,
    isLoading,
    isError,
  } = useGetLayout(Number.isFinite(layoutId) ? layoutId : 0);

  usePageAssistantContext(
    "quilting-layout-detail",
    isLoading || !layout
      ? undefined
      : `Layout Detail page (layoutId: ${layout.id}): "${layout.name}", ${layout.rows}x${layout.cols} grid.`,
  );

  const { data: allBlocks = [] } = useListBlocks();
  const { data: fabricsData } = useListFabrics({ pageSize: 200 });
  const fabrics = fabricsData?.items ?? [];
  const { data: allCategories } = useListQuiltingCategories();
  const numMap = buildFabricUrlMap(
    fabrics as Parameters<typeof buildFabricUrlMap>[0],
  );

  const deleteLayout = useDeleteLayout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Layout deleted.");
        navigate("/quilting/layouts");
      },
      onError: () => toast.error("Could not delete this layout."),
    },
  });

  const updateLayoutCategories = useUpdateLayout({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetLayoutQueryKey(layoutId), data);
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Categories saved");
        setCatEditing(false);
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  function enterCatEdit() {
    const l = layout as unknown as LayoutData;
    setSelectedCatIds(l.categories?.map((c) => c.id) ?? []);
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
    updateLayoutCategories.mutate({ id: layoutId, data: { categoryNames } });
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

  if (isError || !layout) {
    return (
      <div className="mx-auto max-w-3xl text-center">
        <p className="py-10 text-sm text-muted-foreground">Layout not found.</p>
        <Button variant="outline" onClick={() => navigate("/quilting/layouts")}>
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
        onClick={() => navigate("/quilting/layouts")}
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
            blocks={
              allBlocks as unknown as {
                id: number;
                gridSize: number;
                cells: string[];
                rotation?: number;
              }[]
            }
            fabricUrlMap={numMap}
            size={280}
            patternPrefix="detail-thumb-"
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
                onClick={() => navigate(`/quilting/layouts/${layoutId}/edit`)}
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

          {/* Colours */}
          {(l.dominantColors ?? []).length > 0 && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Colours
              </p>
              <div className="flex flex-wrap gap-2">
                {(l.dominantColors ?? []).map((hex) => (
                  <div
                    key={hex}
                    title={hex}
                    className="h-7 w-7 rounded-full border border-black/10 shadow-sm"
                    style={{ backgroundColor: hex }}
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
                  disabled={updateLayoutCategories.isPending}
                />
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveCategories}
                    disabled={updateLayoutCategories.isPending}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {updateLayoutCategories.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCatEditing(false)}
                    disabled={updateLayoutCategories.isPending}
                  >
                    <XIcon className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : l.categories.length > 0 ? (
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
        title={l.name}
      >
        <LayoutPreviewSvg
          layout={l}
          blocks={
            allBlocks as unknown as {
              id: number;
              gridSize: number;
              cells: string[];
              rotation?: number;
            }[]
          }
          fabricUrlMap={numMap}
          size={800}
          patternPrefix="detail-zoom-"
        />
      </PreviewZoomModal>
    </div>
  );
}
