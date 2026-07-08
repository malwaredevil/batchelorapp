import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  Grid2X2,
  MoreVertical,
  Copy,
  SortAsc,
  SortDesc,
  Search,
  X,
  Pencil,
  Trash2,
  ZoomIn,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListBlockTemplates,
  useDeleteBlockTemplate,
  useCreateBlockTemplate,
  useCreateBlock,
  getListBlockTemplatesQueryKey,
  getListBlocksQueryKey,
  QuiltingCreateBlockInputGridSize,
} from "@workspace/api-client-react";
import type {
  QuiltingBlockTemplate,
  QuiltingBlockTemplateSeamLine,
} from "@workspace/api-client-react";
import { fmtInch } from "@/lib/cell-parser";
import { BlockPreviewSvg } from "@/components/BlockPreviewSvg";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";
import { cn } from "@/lib/utils";
import { usePageAssistantContext } from "@/lib/assistant-context";

type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

function normalizeSeams(seams: QuiltingBlockTemplateSeamLine[]) {
  return seams.map((s) => ({
    axis: s.axis,
    pos: s.pos,
    cellIdx: s.cellIdx,
    clipStart: s.clipStart ?? undefined,
    clipEnd: s.clipEnd ?? undefined,
  }));
}

const SORT_LABELS: Record<SortKey, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};

function TemplateCard({
  template,
  onDelete,
  onDuplicate,
  onUse,
  onFilterByTag,
}: {
  template: QuiltingBlockTemplate;
  onDelete: (id: number) => void;
  onDuplicate: (template: QuiltingBlockTemplate) => void;
  onUse: (template: QuiltingBlockTemplate) => void;
  onFilterByTag?: (tag: string) => void;
}) {
  const [, navigate] = useLocation();
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <>
      <div className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md">
        <Link href={`/library/blocks/${template.id}/edit`} className="block">
          <div className="relative flex items-center justify-center overflow-hidden bg-white">
            <BlockPreviewSvg
              cells={template.cells}
              gridSize={template.gridW}
              gridHeight={template.gridH}
              seams={normalizeSeams(template.seams)}
              size={160}
              tileCount={1}
            />
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setZoomOpen(true);
              }}
              className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
              title="Zoom preview"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="border-t border-card-border px-3 py-2 pr-8">
            <p className="truncate text-sm font-semibold text-foreground">
              {template.name}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {template.gridW}×{template.gridH} grid
              </span>
              {template.blockSizeInches != null && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {fmtInch(template.blockSizeInches)}
                </span>
              )}
              {template.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFilterByTag?.(tag);
                  }}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer",
                    tag === "Classic"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </Link>

        <div className="absolute right-2 top-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full bg-background/80 opacity-100 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 hover:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">Options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onUse(template)}>
                <Wand2 className="mr-2 h-3.5 w-3.5" />
                Use template
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate(`/library/blocks/${template.id}/edit`)}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(template)}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(template.id)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <PreviewZoomModal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={template.name}
      >
        <BlockPreviewSvg
          cells={template.cells}
          gridSize={template.gridW}
          gridHeight={template.gridH}
          seams={normalizeSeams(template.seams)}
          size={500}
          tileCount={1}
        />
      </PreviewZoomModal>
    </>
  );
}

export default function BlockLibrary() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: templateList, isLoading, isError } = useListBlockTemplates();

  usePageAssistantContext(
    "quilting-block-library",
    isLoading
      ? undefined
      : `Block Library page: ${templateList?.length ?? 0} reusable block template(s) (used for cutting patterns / rotary-cutting instructions, distinct from the Block Designer's blocks). No chat action tools exist for creating/editing/deleting these templates yet.`,
  );

  const [sortBy, setSortBy] = useState<SortKey>("name-asc");
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const deleteTemplate = useDeleteBlockTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListBlockTemplatesQueryKey(),
        });
        toast.success("Block template deleted");
      },
      onError: () => toast.error("Failed to delete block template."),
    },
  });

  const createTemplate = useCreateBlockTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListBlockTemplatesQueryKey(),
        });
        toast.success("Block template duplicated");
      },
      onError: () => toast.error("Failed to duplicate block template."),
    },
  });

  const createBlock = useCreateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block created from template");
        navigate(`/blocks/${String(data.id)}/edit`);
      },
      onError: () => toast.error("Failed to create block from template."),
    },
  });

  function handleDelete(id: number) {
    if (!confirm("Delete this block template? This cannot be undone.")) return;
    deleteTemplate.mutate({ id });
  }

  function handleDuplicate(template: QuiltingBlockTemplate) {
    createTemplate.mutate({
      data: {
        name: `${template.name} (copy)`,
        tags: template.tags,
        gridW: template.gridW,
        gridH: template.gridH,
        cells: template.cells,
        seams: template.seams,
        blockSizeInches: template.blockSizeInches,
        seamAllowanceInches: template.seamAllowanceInches,
      },
    });
  }

  function handleUse(template: QuiltingBlockTemplate) {
    if (
      template.gridW !== template.gridH ||
      template.gridW < 1 ||
      template.gridW > 12
    ) {
      toast.error(
        "This template's grid isn't compatible with the block designer (must be square, up to 12×12).",
      );
      return;
    }
    createBlock.mutate({
      data: {
        name: template.name,
        gridSize: template.gridW as QuiltingCreateBlockInputGridSize,
        cells: template.cells,
        seams: normalizeSeams(template.seams),
        blockSizeInches: template.blockSizeInches,
        seamAllowanceInches: template.seamAllowanceInches,
        categoryNames: [],
      },
    });
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const displayed = (templateList ?? [])
    .filter((t) => {
      const q = search.trim().toLowerCase();
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (activeTags.size > 0 && !t.tags.some((tag) => activeTags.has(tag)))
        return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "date-desc")
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      if (sortBy === "date-asc")
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      if (sortBy === "name-asc") return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });

  const filterableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const t of templateList ?? []) {
      for (const tag of t.tags) tags.add(tag);
    }
    return Array.from(tags).sort((a, b) => {
      if (a === "Classic") return -1;
      if (b === "Classic") return 1;
      return a.localeCompare(b);
    });
  }, [templateList]);

  const totalCount = templateList?.length ?? 0;
  const hasFilter = search.trim().length > 0 || activeTags.size > 0;

  function clearFilters() {
    setSearch("");
    setActiveTags(new Set());
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Block Patterns</h1>
          <p className="text-sm text-muted-foreground">
            {templateList
              ? hasFilter
                ? `${displayed.length} of ${totalCount} template${totalCount !== 1 ? "s" : ""}`
                : `${totalCount} template${totalCount !== 1 ? "s" : ""}`
              : "Reusable block templates you can save designs into"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/library/blocks/new">
              <PlusCircle className="mr-0 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">New template</span>
            </Link>
          </Button>
        </div>
      </div>

      {templateList && totalCount > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9 pr-9"
              />
              {search && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                >
                  {sortBy === "date-desc" || sortBy === "name-desc" ? (
                    <SortDesc className="h-3.5 w-3.5" />
                  ) : (
                    <SortAsc className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {SORT_LABELS[sortBy]}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={sortBy === key ? "font-medium text-primary" : ""}
                  >
                    {SORT_LABELS[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {filterableTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filterableTags.map((tag) => {
                const active = activeTags.has(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? tag === "Classic"
                          ? "bg-amber-500 text-white"
                          : "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-card-border"
            >
              <Skeleton className="aspect-square w-full" />
              <div className="space-y-1 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex h-40 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">
            Failed to load block templates. Please refresh.
          </p>
        </div>
      )}

      {templateList && templateList.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <Grid2X2 className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">
              No block templates yet
            </p>
            <p className="text-sm text-muted-foreground">
              Create a reusable template, or save one from a block design
            </p>
          </div>
          <Button asChild>
            <Link href="/library/blocks/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              New template
            </Link>
          </Button>
        </div>
      )}

      {templateList && templateList.length > 0 && displayed.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <p className="text-sm text-muted-foreground">
            No templates match the selected filters.
          </p>
          <button
            onClick={clearFilters}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}

      {displayed.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {displayed.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onUse={handleUse}
              onFilterByTag={toggleTag}
            />
          ))}
        </div>
      )}
    </div>
  );
}
