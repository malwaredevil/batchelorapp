import { useState, useRef, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  Grid2X2,
  MoreVertical,
  Copy,
  SortAsc,
  SortDesc,
  Download,
  Search,
  X,
  Pencil,
  ExternalLink,
  Trash2,
  FileImage,
  FileCode2,
  Upload,
  ZoomIn,
  Tag,
} from "lucide-react";
import {
  buildBlockSvgString,
  downloadSvgAsPng,
  downloadSvgAsJpeg,
  downloadAsSvg,
} from "@/lib/svg-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useListBlocks,
  useDeleteBlock,
  useCreateBlock,
  useUpdateBlock,
  useListQuiltingCategories,
  useListFabrics,
  getListBlocksQueryKey,
  QuiltingCreateBlockInputGridSize,
} from "@workspace/api-client-react";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { parseCell, fmtInch } from "@/lib/cell-parser";
import { buildFabricUrlMap } from "@/components/FabricPicker";
import { CategoryEditDialog } from "@/components/CategoryEditDialog";
import { cn } from "@/lib/utils";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";

type BlockSeamLine = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number;
  clipEnd?: number;
};

type BlockSummary = {
  id: number;
  name: string;
  gridSize: number;
  cells: string[];
  seams: BlockSeamLine[];
  blockSizeInches?: number | null;
  seamAllowanceInches?: number | null;
  categories: QuiltingCategory[];
  createdAt: string;
};

type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

/** Render one cell at absolute SVG coordinates (x, y) with pixel dimensions (w × h). */
function SvgCell({
  x,
  y,
  w,
  h,
  cell,
  id,
  fabricUrlMap = {},
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: string;
  id: string;
  fabricUrlMap?: Record<number, string>;
}) {
  const p = parseCell(cell);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = Math.max(0.4, w * 0.04); // seam-line stroke width scales with cell size
  const rf = (c: string) => {
    if (c.startsWith("fab:")) {
      const id = parseInt(c.slice(4), 10);
      if (!isNaN(id) && fabricUrlMap[id]) return `url(#fab-${id})`;
      return "#D1D5DB";
    }
    return c || "#FFFFFF";
  };

  switch (p.kind) {
    case "solid":
      return <rect x={x} y={y} width={w} height={h} fill={rf(p.color)} />;

    case "triangle": {
      // nwse: diagonal from top-left → bottom-right; A = upper-right tri, B = lower-left tri
      // nesw: diagonal from top-right → bottom-left; A = upper-left tri, B = lower-right tri
      if (p.type === "nwse") {
        return (
          <g>
            <polygon
              points={`${x},${y} ${x + w},${y} ${x + w},${y + h}`}
              fill={rf(p.a)}
            />
            <polygon
              points={`${x},${y} ${x},${y + h} ${x + w},${y + h}`}
              fill={rf(p.b)}
            />
          </g>
        );
      }
      return (
        <g>
          <polygon
            points={`${x},${y} ${x + w},${y} ${x},${y + h}`}
            fill={rf(p.a)}
          />
          <polygon
            points={`${x + w},${y} ${x},${y + h} ${x + w},${y + h}`}
            fill={rf(p.b)}
          />
        </g>
      );
    }

    case "quad":
      // Both diagonals → 4 triangles meeting at centre
      return (
        <g>
          <polygon
            points={`${x},${y} ${x + w},${y} ${cx},${cy}`}
            fill={rf(p.top)}
          />
          <polygon
            points={`${x + w},${y} ${x + w},${y + h} ${cx},${cy}`}
            fill={rf(p.right)}
          />
          <polygon
            points={`${x + w},${y + h} ${x},${y + h} ${cx},${cy}`}
            fill={rf(p.bottom)}
          />
          <polygon
            points={`${x},${y + h} ${x},${y} ${cx},${cy}`}
            fill={rf(p.left)}
          />
        </g>
      );

    case "hsplit":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h / 2} fill={rf(p.top)} />
          <rect
            x={x}
            y={y + h / 2}
            width={w}
            height={h / 2}
            fill={rf(p.bottom)}
          />
        </g>
      );

    case "vsplit":
      return (
        <g>
          <rect x={x} y={y} width={w / 2} height={h} fill={rf(p.left)} />
          <rect
            x={x + w / 2}
            y={y}
            width={w / 2}
            height={h}
            fill={rf(p.right)}
          />
        </g>
      );

    case "xsplit":
      return (
        <g>
          <rect x={x} y={y} width={w / 2} height={h / 2} fill={rf(p.tl)} />
          <rect
            x={x + w / 2}
            y={y}
            width={w / 2}
            height={h / 2}
            fill={rf(p.tr)}
          />
          <rect
            x={x}
            y={y + h / 2}
            width={w / 2}
            height={h / 2}
            fill={rf(p.bl)}
          />
          <rect
            x={x + w / 2}
            y={y + h / 2}
            width={w / 2}
            height={h / 2}
            fill={rf(p.br)}
          />
        </g>
      );

    case "line": {
      // Partial seam line along the nwse or nesw diagonal
      const { cs, ce, type } = p;
      const [x1, y1, x2, y2] =
        type === "nwse"
          ? [x + cs * w, y + cs * h, x + ce * w, y + ce * h]
          : [x + (1 - cs) * w, y + cs * h, x + (1 - ce) * w, y + ce * h];
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#555"
            strokeWidth={sw}
          />
        </g>
      );
    }

    case "xline": {
      const { nwseCs, nwseCe, neswCs, neswCe } = p;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />
          {nwseCe > nwseCs && (
            <line
              x1={x + nwseCs * w}
              y1={y + nwseCs * h}
              x2={x + nwseCe * w}
              y2={y + nwseCe * h}
              stroke="#555"
              strokeWidth={sw}
            />
          )}
          {neswCe > neswCs && (
            <line
              x1={x + (1 - neswCs) * w}
              y1={y + neswCs * h}
              x2={x + (1 - neswCe) * w}
              y2={y + neswCe * h}
              stroke="#555"
              strokeWidth={sw}
            />
          )}
        </g>
      );
    }

    default:
      return <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />;
  }
}

function BlockPreviewSvg({
  cells,
  gridSize,
  seams = [],
  size = 120,
  tileCount = 2,
  fabricUrlMap = {},
}: {
  cells: string[];
  gridSize: number;
  seams?: BlockSeamLine[];
  size?: number;
  tileCount?: number;
  fabricUrlMap?: Record<number, string>;
}) {
  const gridH = Math.max(1, Math.ceil(cells.length / gridSize));
  const cellPx = size / (gridSize * tileCount);
  const svgH = gridH * tileCount * cellPx;
  const tiles = Array.from({ length: tileCount * tileCount }, (_, t) => t);
  const sw = Math.max(0.5, cellPx * 0.1);

  // Collect unique fabric IDs used in this block
  const fabIds = (() => {
    const ids = new Set<number>();
    const FAB_RE = /fab:(\d+)/g;
    for (const c of cells) {
      let m: RegExpExecArray | null;
      FAB_RE.lastIndex = 0;
      while ((m = FAB_RE.exec(c)) !== null) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && fabricUrlMap[n]) ids.add(n);
      }
    }
    return Array.from(ids);
  })();

  return (
    <svg
      width={size}
      height={svgH}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
    >
      {fabIds.length > 0 && (
        <defs>
          {fabIds.map((id) => (
            <pattern
              key={id}
              id={`fab-${id}`}
              patternUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={cellPx}
              height={cellPx}
            >
              <image
                href={fabricUrlMap[id]}
                x="0"
                y="0"
                width={cellPx}
                height={cellPx}
                preserveAspectRatio="xMidYMid slice"
              />
            </pattern>
          ))}
        </defs>
      )}
      <rect width={size} height={svgH} fill="#FFFFFF" />
      {tiles.map((tile) => {
        const tr = Math.floor(tile / tileCount);
        const tc = tile % tileCount;
        const offX = tc * gridSize * cellPx;
        const offY = tr * gridH * cellPx;
        return (
          <g key={tile}>
            {cells.map((cell, i) => {
              const row = Math.floor(i / gridSize);
              const col = i % gridSize;
              return (
                <SvgCell
                  key={i}
                  id={`${tile}-${i}`}
                  x={offX + col * cellPx}
                  y={offY + row * cellPx}
                  w={cellPx}
                  h={cellPx}
                  cell={cell}
                  fabricUrlMap={fabricUrlMap}
                />
              );
            })}
            {seams.map((seam, si) => {
              const cs = seam.clipStart ?? 0;
              const ce = seam.clipEnd ?? 1;
              if (seam.axis === "h") {
                const sy = offY + (seam.pos / 2) * cellPx;
                return (
                  <line
                    key={si}
                    x1={offX + (seam.cellIdx + cs) * cellPx}
                    y1={sy}
                    x2={offX + (seam.cellIdx + ce) * cellPx}
                    y2={sy}
                    stroke="#333"
                    strokeWidth={sw}
                    strokeLinecap="round"
                  />
                );
              }
              const sx = offX + (seam.pos / 2) * cellPx;
              return (
                <line
                  key={si}
                  x1={sx}
                  y1={offY + (seam.cellIdx + cs) * cellPx}
                  x2={sx}
                  y2={offY + (seam.cellIdx + ce) * cellPx}
                  stroke="#333"
                  strokeWidth={sw}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function BlockCard({
  block,
  onDelete,
  onDuplicate,
  onFilterByGridSize,
  onFilterByCategory,
  fabricUrlMap = {},
  onEditCategories,
}: {
  block: BlockSummary;
  onDelete: (id: number) => void;
  onDuplicate: (block: BlockSummary) => void;
  onFilterByGridSize?: (gs: number) => void;
  onFilterByCategory?: (id: number) => void;
  fabricUrlMap?: Record<number, string>;
  onEditCategories?: () => void;
}) {
  const [, navigate] = useLocation();
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <>
    <div className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md">
      <Link href={`/blocks/${block.id}`} className="block">
        <div className="relative flex items-center justify-center overflow-hidden bg-white">
          <BlockPreviewSvg
            cells={block.cells}
            gridSize={block.gridSize}
            seams={block.seams}
            size={160}
            tileCount={1}
            fabricUrlMap={fabricUrlMap}
          />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomOpen(true); }}
            className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
            title="Zoom preview"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="border-t border-card-border px-3 py-2 pr-8">
          <p className="truncate text-sm font-semibold text-foreground">
            {block.name}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFilterByGridSize?.(block.gridSize);
              }}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
            >
              {(() => {
                const gH = Math.max(
                  1,
                  Math.ceil(block.cells.length / block.gridSize),
                );
                return gH === block.gridSize
                  ? `${block.gridSize}×${block.gridSize}`
                  : `${block.gridSize}×${gH}`;
              })()}{" "}
              grid
            </button>
            {block.blockSizeInches != null && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {fmtInch(block.blockSizeInches)}
              </span>
            )}
            {block.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFilterByCategory?.(cat.id);
                }}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
                style={{
                  backgroundColor: cat.bgColor ?? "#e5e7eb",
                  color: cat.textColor ?? "#374151",
                }}
              >
                {cat.name}
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
              className="h-7 w-7 rounded-full bg-background/80 opacity-100 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
              <span className="sr-only">Options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`/blocks/${block.id}`)}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/blocks/${block.id}/edit`)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(block)}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="mr-2 h-3.5 w-3.5" />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => void exportBlockAsPng(block)}>
                  <FileImage className="mr-2 h-3.5 w-3.5" />
                  PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportBlockAsJpeg(block)}>
                  <FileImage className="mr-2 h-3.5 w-3.5" />
                  JPEG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportBlockAsSvg(block)}>
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  SVG
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportBlockAsJson(block)}>
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  JSON (design file)
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => onEditCategories?.()}>
              <Tag className="mr-2 h-3.5 w-3.5" />
              Set categories
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(block.id)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <PreviewZoomModal open={zoomOpen} onClose={() => setZoomOpen(false)} title={block.name}>
      <BlockPreviewSvg
        cells={block.cells}
        gridSize={block.gridSize}
        seams={block.seams}
        size={500}
        tileCount={3}
        fabricUrlMap={fabricUrlMap}
      />
    </PreviewZoomModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

async function exportBlockAsPng(block: BlockSummary) {
  const svgStr = buildBlockSvgString(block.cells, block.gridSize, 2, 800);
  const name = (block.name.trim() || "block")
    .replace(/\s+/g, "-")
    .toLowerCase();
  try {
    await downloadSvgAsPng(svgStr, `${name}.png`);
    toast.success("Exported as PNG.");
  } catch {
    toast.error("Export failed.");
  }
}

async function exportBlockAsJpeg(block: BlockSummary) {
  const svgStr = buildBlockSvgString(block.cells, block.gridSize, 2, 800);
  const name = (block.name.trim() || "block")
    .replace(/\s+/g, "-")
    .toLowerCase();
  try {
    await downloadSvgAsJpeg(svgStr, `${name}.jpg`);
    toast.success("Exported as JPEG.");
  } catch {
    toast.error("Export failed.");
  }
}

function exportBlockAsSvg(block: BlockSummary) {
  const svgStr = buildBlockSvgString(block.cells, block.gridSize, 2, 800);
  const name = (block.name.trim() || "block")
    .replace(/\s+/g, "-")
    .toLowerCase();
  downloadAsSvg(svgStr, `${name}.svg`);
  toast.success("Exported as SVG.");
}

function exportBlockAsJson(block: BlockSummary) {
  const payload = {
    exportVersion: 1,
    name: block.name,
    gridSize: block.gridSize,
    cells: block.cells,
    seams: block.seams,
    blockSizeInches: block.blockSizeInches ?? null,
    seamAllowanceInches: block.seamAllowanceInches ?? null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (block.name.trim() || "block").replace(/\s+/g, "-").toLowerCase() +
    ".quilting.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success("Exported as .quilting.json");
}

const SORT_LABELS: Record<SortKey, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};

export default function Blocks() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: blockList, isLoading, isError } = useListBlocks();
  const { data: allCategories } = useListQuiltingCategories();
  const { data: fabricsList } = useListFabrics();
  const fabricUrlMap = useMemo(
    () => buildFabricUrlMap(fabricsList ?? []),
    [fabricsList],
  );

  const [categoryEditItem, setCategoryEditItem] = useState<BlockSummary | null>(null);

  const updateBlockCategories = useUpdateBlock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        setCategoryEditItem(null);
        toast.success("Categories saved");
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  const [sortBy, setSortBy] = useState<SortKey>("date-desc");
  const [activeCatIds, setActiveCatIds] = useState<Set<number>>(new Set());
  const [activeGridSizes, setActiveGridSizes] = useState<Set<number>>(
    new Set(),
  );
  const [search, setSearch] = useState("");

  const importFileRef = useRef<HTMLInputElement>(null);

  const deleteBlock = useDeleteBlock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block design deleted");
      },
      onError: () => toast.error("Failed to delete block design."),
    },
  });

  const createBlock = useCreateBlock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block design duplicated");
      },
      onError: () => toast.error("Failed to duplicate block design."),
    },
  });

  const importBlock = useCreateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block design imported!");
        navigate(`/blocks/${String(data.id)}/edit`);
      },
      onError: () => toast.error("Failed to import block design."),
    },
  });

  function handleDelete(id: number) {
    if (!confirm("Delete this block design? This cannot be undone.")) return;
    deleteBlock.mutate({ id });
  }

  function handleDuplicate(block: BlockSummary) {
    createBlock.mutate({
      data: {
        name: `${block.name} (copy)`,
        gridSize: block.gridSize as QuiltingCreateBlockInputGridSize,
        cells: block.cells,
        seams: block.seams,
        categoryNames: block.categories.map((c) => c.name),
      },
    });
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as Record<
          string,
          unknown
        >;
        const gridSize = Number(json.gridSize);
        const cells = json.cells;
        if (!gridSize || !Array.isArray(cells)) {
          toast.error("Invalid block design file.");
          return;
        }
        importBlock.mutate({
          data: {
            name: typeof json.name === "string" ? json.name : "Imported block",
            gridSize: gridSize as QuiltingCreateBlockInputGridSize,
            cells: cells as string[],
            seams: Array.isArray(json.seams)
              ? (json.seams as BlockSeamLine[])
              : [],
            blockSizeInches:
              typeof json.blockSizeInches === "number"
                ? json.blockSizeInches
                : null,
            seamAllowanceInches:
              typeof json.seamAllowanceInches === "number"
                ? json.seamAllowanceInches
                : null,
          },
        });
      } catch {
        toast.error("Failed to parse block design file.");
      }
    };
    reader.readAsText(file);
  }

  function toggleCat(id: number) {
    setActiveCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Filter then sort
  const displayed = (blockList ?? [])
    .filter((b) => {
      const q = search.trim().toLowerCase();
      if (q && !b.name.toLowerCase().includes(q)) return false;
      if (activeGridSizes.size > 0 && !activeGridSizes.has(b.gridSize))
        return false;
      if (
        activeCatIds.size > 0 &&
        !b.categories.some((c) => activeCatIds.has(c.id))
      )
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

  // Categories and grid sizes that appear on at least one block
  const usedCatIds = new Set(
    (blockList ?? []).flatMap((b) => b.categories.map((c) => c.id)),
  );
  const filterableCats = (allCategories ?? []).filter((c) =>
    usedCatIds.has(c.id),
  );
  const filterableGridSizes = Array.from(
    new Set((blockList ?? []).map((b) => b.gridSize)),
  ).sort((a, b) => a - b);

  const totalCount = blockList?.length ?? 0;
  const hasFilter =
    search.trim().length > 0 ||
    activeCatIds.size > 0 ||
    activeGridSizes.size > 0;

  function clearFilters() {
    setSearch("");
    setActiveCatIds(new Set());
    setActiveGridSizes(new Set());
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Block Designer</h1>
          <p className="text-sm text-muted-foreground">
            {blockList
              ? hasFilter
                ? `${displayed.length} of ${totalCount} design${totalCount !== 1 ? "s" : ""}`
                : `${totalCount} design${totalCount !== 1 ? "s" : ""}`
              : "Design and save quilt block patterns"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,.quilting.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button asChild>
            <Link href="/blocks/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              New design
            </Link>
          </Button>
        </div>
      </div>

      {/* Search + sort row */}
      {blockList && totalCount > 0 && (
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
                  <span className="hidden sm:inline">{SORT_LABELS[sortBy]}</span>
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

          {/* Grid size + category filter pills */}
          {(filterableGridSizes.length > 1 || filterableCats.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {filterableGridSizes.length > 1 &&
                filterableGridSizes.map((gs) => {
                  const active = activeGridSizes.has(gs);
                  return (
                    <button
                      key={gs}
                      onClick={() =>
                        setActiveGridSizes((prev) => {
                          const next = new Set(prev);
                          if (next.has(gs)) next.delete(gs);
                          else next.add(gs);
                          return next;
                        })
                      }
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {gs}×{gs} grid
                    </button>
                  );
                })}
              {filterableCats.map((cat) => {
                const active = activeCatIds.has(cat.id);
                const palette = cat.bgColor
                  ? { bgColor: cat.bgColor, textColor: cat.textColor ?? "#fff" }
                  : getCategoryPalette(cat.name);
                return (
                  <button
                    key={cat.id}
                    onClick={() => toggleCat(cat.id)}
                    className="rounded-full border px-3 py-1 text-xs font-medium transition"
                    style={{
                      backgroundColor: active ? palette.bgColor : "transparent",
                      color: active ? palette.textColor : palette.bgColor,
                      borderColor: palette.bgColor,
                    }}
                  >
                    {cat.name}
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
            Failed to load block designs. Please refresh.
          </p>
        </div>
      )}

      {blockList && blockList.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <Grid2X2 className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">No block designs yet</p>
            <p className="text-sm text-muted-foreground">
              Design a quilt block pattern and save it here
            </p>
          </div>
          <Button asChild>
            <Link href="/blocks/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              New design
            </Link>
          </Button>
        </div>
      )}

      {blockList && blockList.length > 0 && displayed.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <p className="text-sm text-muted-foreground">
            No designs match the selected filters.
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
          {displayed.map((block) => (
            <BlockCard
              key={block.id}
              block={block}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onFilterByGridSize={(gs) =>
                setActiveGridSizes((prev) => {
                  const next = new Set(prev);
                  if (next.has(gs)) next.delete(gs);
                  else next.add(gs);
                  return next;
                })
              }
              onFilterByCategory={toggleCat}
              fabricUrlMap={fabricUrlMap}
              onEditCategories={() => setCategoryEditItem(block)}
            />
          ))}
        </div>
      )}
      <CategoryEditDialog
        open={categoryEditItem !== null}
        onClose={() => setCategoryEditItem(null)}
        title={categoryEditItem?.name ?? ""}
        currentCategories={(categoryEditItem?.categories ?? []) as unknown as QuiltingCategory[]}
        allCategories={allCategories ?? []}
        onSave={(names) => {
          if (categoryEditItem) {
            updateBlockCategories.mutate({
              id: categoryEditItem.id,
              data: { categoryNames: names },
            });
          }
        }}
        isSaving={updateBlockCategories.isPending}
      />
    </div>
  );
}
