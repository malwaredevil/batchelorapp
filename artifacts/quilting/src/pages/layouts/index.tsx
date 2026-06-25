import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  PlusCircle,
  LayoutGrid,
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
  ZoomIn,
  Tag,
} from "lucide-react";
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
import { parseCell, fmtInch } from "@/lib/cell-parser";
import {
  svgCellStr,
  downloadSvgAsPng,
  downloadSvgAsJpeg,
  downloadAsSvg,
} from "@/lib/svg-export";
import {
  useListLayouts,
  useDeleteLayout,
  useCreateLayout,
  useUpdateLayout,
  useListBlocks,
  useListQuiltingCategories,
  useListFabrics,
  useGetStats,
  getListLayoutsQueryKey,
} from "@workspace/api-client-react";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { buildFabricUrlMap } from "@/components/FabricPicker";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";
import { CategoryEditDialog } from "@/components/CategoryEditDialog";
import { cn } from "@/lib/utils";

type LayoutCell = { blockId: number | null; rotation: 0 | 90 | 180 | 270 };

type LayoutSummary = {
  id: number;
  name: string;
  rows: number;
  cols: number;
  cells: LayoutCell[];
  categories: QuiltingCategory[];
  sashingWidthInches?: number | null;
  sashingColor?: string | null;
  borderWidthInches?: number | null;
  borderColor?: string | null;
  cornerstoneColor?: string | null;
  dominantColors?: string[];
  createdAt: string;
};

type BlockSummary = {
  id: number;
  gridSize: number;
  cells: string[];
  blockSizeInches?: number | null;
};

/** Returns the finished quilt size in inches, or null if no block sizes known. */
function computeQuiltSize(
  layout: LayoutSummary,
  blockMap: Map<number, BlockSummary>,
): { w: number; h: number; mixed: boolean } | null {
  const sizes: number[] = [];
  for (const cell of layout.cells) {
    if (cell.blockId === null) continue;
    const block = blockMap.get(cell.blockId);
    if (block?.blockSizeInches != null) sizes.push(block.blockSizeInches);
  }
  if (sizes.length === 0) return null;
  const freq = new Map<number, number>();
  for (const s of sizes) freq.set(s, (freq.get(s) ?? 0) + 1);
  const blockSz = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const sash = layout.sashingWidthInches ?? 0;
  const border = layout.borderWidthInches ?? 0;
  return {
    w: layout.cols * blockSz + sash * (layout.cols - 1) + border * 2,
    h: layout.rows * blockSz + sash * (layout.rows - 1) + border * 2,
    mixed: freq.size > 1,
  };
}

type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const SORT_LABELS: Record<SortKey, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};

// ---------------------------------------------------------------------------
// SVG rendering (shared with visible thumbnail)
// ---------------------------------------------------------------------------

function SvgCell({
  x,
  y,
  w,
  h,
  cell,
  fabricUrlMap = {},
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: string;
  fabricUrlMap?: Record<number, string>;
}) {
  const p = parseCell(cell);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = Math.max(0.4, w * 0.04);
  const rf = (c: string) => {
    if (c.startsWith("fab:")) {
      const n = parseInt(c.slice(4), 10);
      if (!isNaN(n) && fabricUrlMap[n]) return `url(#fab-${n})`;
      return "#D1D5DB";
    }
    return c || "#FFFFFF";
  };

  switch (p.kind) {
    case "solid":
      return <rect x={x} y={y} width={w} height={h} fill={rf(p.color)} />;
    case "triangle":
      if (p.type === "nwse")
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
    case "quad":
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

function LayoutPreview({
  layout,
  blocks,
  size = 160,
  fabricUrlMap = {},
}: {
  layout: LayoutSummary;
  blocks: BlockSummary[];
  size: number;
  fabricUrlMap?: Record<number, string>;
}) {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const sashW = layout.sashingWidthInches ?? 0;
  const bordW = layout.borderWidthInches ?? 0;
  const sashingColor = layout.sashingColor ?? "#d4c5a9";
  const borderColor = layout.borderColor ?? "#8b6f5e";
  const cornerstoneColor = layout.cornerstoneColor ?? null;

  // Collect all fabric IDs used in all blocks in this layout
  const fabIds = (() => {
    const ids = new Set<number>();
    const FAB_RE = /fab:(\d+)/g;
    for (const lc of layout.cells) {
      if (lc.blockId === null) continue;
      const block = blockMap.get(lc.blockId);
      if (!block) continue;
      for (const c of block.cells) {
        let m: RegExpExecArray | null;
        FAB_RE.lastIndex = 0;
        while ((m = FAB_RE.exec(c)) !== null) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && fabricUrlMap[n]) ids.add(n);
        }
      }
    }
    return Array.from(ids);
  })();

  const unitW = layout.cols + sashW * (layout.cols - 1) + bordW * 2;
  const unitH = layout.rows + sashW * (layout.rows - 1) + bordW * 2;
  const scale = size / Math.max(unitW, unitH);
  const cellPx = scale;
  const sashPx = sashW * scale;
  const borderPx = bordW * scale;
  const W = unitW * scale;
  const H = unitH * scale;

  return (
    <svg
      width={W}
      height={H}
      xmlns="http://www.w3.org/2000/svg"
      className="bg-white"
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
              width={W}
              height={H}
            >
              <image
                href={fabricUrlMap[id]}
                x="0"
                y="0"
                width={W}
                height={H}
                preserveAspectRatio="xMidYMid slice"
              />
            </pattern>
          ))}
        </defs>
      )}
      {borderPx > 0 && (
        <rect x={0} y={0} width={W} height={H} fill={borderColor} />
      )}
      {sashPx > 0 ? (
        <rect
          x={borderPx}
          y={borderPx}
          width={W - borderPx * 2}
          height={H - borderPx * 2}
          fill={sashingColor}
        />
      ) : (
        <rect
          x={borderPx}
          y={borderPx}
          width={W - borderPx * 2}
          height={H - borderPx * 2}
          fill="#FFFFFF"
        />
      )}
      {sashPx > 0 &&
        cornerstoneColor &&
        Array.from({ length: layout.rows - 1 }, (_, r) =>
          Array.from({ length: layout.cols - 1 }, (_, c) => {
            const cx2 = borderPx + (c + 1) * (cellPx + sashPx) - sashPx;
            const cy2 = borderPx + (r + 1) * (cellPx + sashPx) - sashPx;
            return (
              <rect
                key={`cs-${r}-${c}`}
                x={cx2}
                y={cy2}
                width={sashPx}
                height={sashPx}
                fill={cornerstoneColor}
              />
            );
          }),
        )}
      {layout.cells.map((cell, i) => {
        const row = Math.floor(i / layout.cols);
        const col = i % layout.cols;
        const x = borderPx + col * (cellPx + sashPx);
        const y = borderPx + row * (cellPx + sashPx);
        const block = cell.blockId !== null ? blockMap.get(cell.blockId) : null;
        if (!block)
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={cellPx}
              height={cellPx}
              fill="#F5F5F5"
              stroke="#E0E0E0"
              strokeWidth="0.5"
            />
          );
        const bCellPx = cellPx / block.gridSize;
        const cx = x + cellPx / 2;
        const cy = y + cellPx / 2;
        return (
          <g key={i} transform={`rotate(${cell.rotation}, ${cx}, ${cy})`}>
            {block.cells.map((blockCell, j) => {
              const br = Math.floor(j / block.gridSize);
              const bc = j % block.gridSize;
              return (
                <SvgCell
                  key={j}
                  x={x + bc * bCellPx}
                  y={y + br * bCellPx}
                  w={bCellPx}
                  h={bCellPx}
                  cell={blockCell}
                  fabricUrlMap={fabricUrlMap}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function buildLayoutSvgString(
  layout: LayoutSummary,
  blockMap: Map<number, BlockSummary>,
  size: number,
): string {
  const sashW = layout.sashingWidthInches ?? 0;
  const bordW = layout.borderWidthInches ?? 0;
  const sashingColor = layout.sashingColor ?? "#d4c5a9";
  const borderColor = layout.borderColor ?? "#8b6f5e";
  const cornerstoneColorStr = layout.cornerstoneColor ?? null;

  const unitW = layout.cols + sashW * (layout.cols - 1) + bordW * 2;
  const unitH = layout.rows + sashW * (layout.rows - 1) + bordW * 2;
  const scale = size / Math.max(unitW, unitH);
  const cellPx = scale;
  const sashPx = sashW * scale;
  const borderPx = bordW * scale;
  const W = unitW * scale;
  const H = unitH * scale;

  const parts: string[] = [];
  parts.push(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`,
  );
  if (borderPx > 0)
    parts.push(
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${borderColor}"/>`,
    );
  if (sashPx > 0) {
    parts.push(
      `<rect x="${borderPx}" y="${borderPx}" width="${W - borderPx * 2}" height="${H - borderPx * 2}" fill="${sashingColor}"/>`,
    );
  } else {
    parts.push(
      `<rect x="${borderPx}" y="${borderPx}" width="${W - borderPx * 2}" height="${H - borderPx * 2}" fill="#FFFFFF"/>`,
    );
  }
  if (sashPx > 0 && cornerstoneColorStr) {
    for (let r = 0; r < layout.rows - 1; r++) {
      for (let c = 0; c < layout.cols - 1; c++) {
        const cx2 = borderPx + (c + 1) * (cellPx + sashPx) - sashPx;
        const cy2 = borderPx + (r + 1) * (cellPx + sashPx) - sashPx;
        parts.push(
          `<rect x="${cx2}" y="${cy2}" width="${sashPx}" height="${sashPx}" fill="${cornerstoneColorStr}"/>`,
        );
      }
    }
  }
  layout.cells.forEach((cell, i) => {
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    const x = borderPx + col * (cellPx + sashPx);
    const y = borderPx + row * (cellPx + sashPx);
    const block = cell.blockId !== null ? blockMap.get(cell.blockId) : null;
    if (!block) {
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellPx}" height="${cellPx}" fill="#F5F5F5" stroke="#E0E0E0" stroke-width="0.5"/>`,
      );
      return;
    }
    const bCellPx = cellPx / block.gridSize;
    const cx = x + cellPx / 2;
    const cy = y + cellPx / 2;
    parts.push(`<g transform="rotate(${cell.rotation}, ${cx}, ${cy})">`);
    for (let j = 0; j < block.cells.length; j++) {
      const br = Math.floor(j / block.gridSize);
      const bc = j % block.gridSize;
      parts.push(
        svgCellStr(
          x + bc * bCellPx,
          y + br * bCellPx,
          bCellPx,
          bCellPx,
          block.cells[j] ?? "",
        ),
      );
    }
    parts.push(`</g>`);
  });
  parts.push(`</svg>`);
  return parts.join("");
}

async function exportLayoutAsPng(
  layout: LayoutSummary,
  blockMap: Map<number, BlockSummary>,
) {
  const svgStr = buildLayoutSvgString(layout, blockMap, 800);
  const name = (layout.name.trim() || "layout")
    .replace(/\s+/g, "-")
    .toLowerCase();
  try {
    await downloadSvgAsPng(svgStr, `${name}.png`);
    toast.success("Exported as PNG.");
  } catch {
    toast.error("Export failed.");
  }
}

async function exportLayoutAsJpeg(
  layout: LayoutSummary,
  blockMap: Map<number, BlockSummary>,
) {
  const svgStr = buildLayoutSvgString(layout, blockMap, 800);
  const name = (layout.name.trim() || "layout")
    .replace(/\s+/g, "-")
    .toLowerCase();
  try {
    await downloadSvgAsJpeg(svgStr, `${name}.jpg`);
    toast.success("Exported as JPEG.");
  } catch {
    toast.error("Export failed.");
  }
}

function exportLayoutAsSvg(
  layout: LayoutSummary,
  blockMap: Map<number, BlockSummary>,
) {
  const svgStr = buildLayoutSvgString(layout, blockMap, 800);
  const name = (layout.name.trim() || "layout")
    .replace(/\s+/g, "-")
    .toLowerCase();
  downloadAsSvg(svgStr, `${name}.svg`);
  toast.success("Exported as SVG.");
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function LayoutCard({
  layout,
  blocks,
  blockMap,
  onDelete,
  onDuplicate,
  onFilterBySize,
  onFilterByCategory,
  onFilterByColor,
  fabricUrlMap = {},
  onEditCategories,
}: {
  layout: LayoutSummary;
  blocks: BlockSummary[];
  blockMap: Map<number, BlockSummary>;
  onDelete: (id: number) => void;
  onDuplicate: (layout: LayoutSummary) => void;
  onFilterBySize?: (s: string) => void;
  onFilterByCategory?: (id: number) => void;
  onFilterByColor?: (hex: string) => void;
  fabricUrlMap?: Record<number, string>;
  onEditCategories?: () => void;
}) {
  const [, navigate] = useLocation();
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <>
    <div className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md">
      <Link href={`/layouts/${layout.id}`} className="block">
        <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-white p-2">
          <LayoutPreview
            layout={layout}
            blocks={blocks}
            size={160}
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
            {layout.name}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFilterBySize?.(`${layout.rows}×${layout.cols}`);
              }}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
            >
              {layout.rows}×{layout.cols} blocks
            </button>
            {(() => {
              const qs = computeQuiltSize(layout, blockMap);
              if (!qs) return null;
              return (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {fmtInch(qs.w)} × {fmtInch(qs.h)}{qs.mixed ? " (approx)" : ""}
                </span>
              );
            })()}
            {layout.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFilterByCategory?.(cat.id);
                }}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer"
                style={(() => {
                  const palette = cat.bgColor
                    ? { bgColor: cat.bgColor, textColor: cat.textColor ?? "#fff" }
                    : getCategoryPalette(cat.name);
                  return { backgroundColor: palette.bgColor, color: palette.textColor };
                })()}
              >
                {cat.name}
              </button>
            ))}
          </div>
          {(layout.dominantColors ?? []).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(layout.dominantColors ?? []).map((hex) => (
                <button
                  key={hex}
                  title={hex}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFilterByColor?.(hex);
                  }}
                  className="h-4 w-4 rounded-full border border-black/10 transition-transform hover:scale-110"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          )}
        </div>
      </Link>

      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full bg-background/80 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
              <span className="sr-only">Options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`/layouts/${layout.id}`)}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/layouts/${layout.id}/edit`)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(layout)}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="mr-2 h-3.5 w-3.5" />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => void exportLayoutAsPng(layout, blockMap)}
                >
                  <FileImage className="mr-2 h-3.5 w-3.5" />
                  PNG
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void exportLayoutAsJpeg(layout, blockMap)}
                >
                  <FileImage className="mr-2 h-3.5 w-3.5" />
                  JPEG
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => exportLayoutAsSvg(layout, blockMap)}
                >
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  SVG
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
              onClick={() => onDelete(layout.id)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <PreviewZoomModal open={zoomOpen} onClose={() => setZoomOpen(false)} title={layout.name}>
      <LayoutPreview
        layout={layout}
        blocks={blocks}
        size={600}
        fabricUrlMap={fabricUrlMap}
      />
    </PreviewZoomModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Layouts() {
  const queryClient = useQueryClient();
  const { data: layoutList, isLoading, isError } = useListLayouts();
  const { data: blockList } = useListBlocks();
  const { data: allCategories } = useListQuiltingCategories();
  const { data: fabricsList } = useListFabrics();
  const { data: stats } = useGetStats();
  const fabricUrlMap = useMemo(
    () => buildFabricUrlMap(fabricsList ?? []),
    [fabricsList],
  );

  const [categoryEditItem, setCategoryEditItem] = useState<LayoutSummary | null>(null);

  const updateLayoutCategories = useUpdateLayout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        setCategoryEditItem(null);
        toast.success("Categories saved");
      },
      onError: () => toast.error("Failed to save categories"),
    },
  });

  const [sortBy, setSortBy] = useState<SortKey>("date-desc");
  const [activeCatIds, setActiveCatIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [colorFilter, setColorFilter] = useState<string[]>([]);

  const deleteLayout = useDeleteLayout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Layout deleted");
      },
      onError: () => toast.error("Failed to delete layout."),
    },
  });

  const createLayout = useCreateLayout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Layout duplicated");
      },
      onError: () => toast.error("Failed to duplicate layout."),
    },
  });

  function handleDelete(id: number) {
    if (!confirm("Delete this layout? This cannot be undone.")) return;
    deleteLayout.mutate({ id });
  }

  function handleDuplicate(layout: LayoutSummary) {
    createLayout.mutate({
      data: {
        name: `${layout.name} (copy)`,
        rows: layout.rows,
        cols: layout.cols,
        cells: layout.cells,
        sashingWidthInches: layout.sashingWidthInches ?? undefined,
        sashingColor: layout.sashingColor ?? undefined,
        borderWidthInches: layout.borderWidthInches ?? undefined,
        borderColor: layout.borderColor ?? undefined,
        categoryNames: layout.categories.map((c) => c.name),
      },
    });
  }

  const [activeSizes, setActiveSizes] = useState<Set<string>>(new Set());

  function toggleCat(id: number) {
    setActiveCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSize(s: string) {
    setActiveSizes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const blocks: BlockSummary[] = (blockList ?? []) as BlockSummary[];
  const blockMap = new Map(blocks.map((b) => [b.id, b]));

  const usedColors = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const l of (layoutList ?? []) as LayoutSummary[]) {
      for (const c of l.dominantColors ?? []) {
        if (!seen.has(c)) { seen.add(c); result.push(c); }
      }
    }
    return result;
  }, [layoutList]);

  // Filter then sort
  const displayed = ((layoutList ?? []) as LayoutSummary[])
    .filter((l) => {
      const q = search.trim().toLowerCase();
      if (q && !l.name.toLowerCase().includes(q)) return false;
      if (activeSizes.size > 0 && !activeSizes.has(`${l.rows}×${l.cols}`))
        return false;
      if (
        activeCatIds.size > 0 &&
        !l.categories.some((c) => activeCatIds.has(c.id))
      )
        return false;
      if (colorFilter.length > 0 && !colorFilter.every((c) => (l.dominantColors ?? []).includes(c)))
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

  const usedCatIds = new Set(
    ((layoutList ?? []) as LayoutSummary[]).flatMap((l) =>
      l.categories.map((c) => c.id),
    ),
  );
  const filterableCats = (allCategories ?? []).filter((c) =>
    usedCatIds.has(c.id),
  );
  const filterableSizes = Array.from(
    new Set(
      ((layoutList ?? []) as LayoutSummary[]).map((l) => `${l.rows}×${l.cols}`),
    ),
  ).sort();
  const totalCount = (layoutList ?? []).length;

  const hasFilter =
    search.trim().length > 0 ||
    activeCatIds.size > 0 ||
    activeSizes.size > 0 ||
    colorFilter.length > 0;

  function clearFilters() {
    setSearch("");
    setActiveCatIds(new Set());
    setActiveSizes(new Set());
    setColorFilter([]);
  }

  return (
    <div>
      {stats && (
        <div className="mb-6 hidden sm:grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Fabrics", value: stats.totalFabrics, sub: "in your stash", href: "/fabrics" },
            { label: "Patterns", value: stats.totalPatterns, sub: "saved", href: "/patterns" },
            { label: "Quilts", value: stats.totalQuilts, sub: "in collection", href: "/quilts" },
            { label: "Blocks", value: stats.totalBlocks, sub: "designed", href: "/blocks" },
            { label: "Layouts", value: stats.totalLayouts, sub: "arranged", href: "/layouts" },
          ].map(({ label, value, sub, href }) => (
            <Link
              key={label}
              href={href}
              className="rounded-xl border border-card-border bg-card p-4 block hover:shadow-sm hover:border-primary/30 transition-all"
            >
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Quilt Layout Composer
          </h1>
          <p className="text-sm text-muted-foreground">
            {layoutList
              ? hasFilter
                ? `${displayed.length} of ${totalCount} layout${totalCount !== 1 ? "s" : ""}`
                : `${totalCount} layout${totalCount !== 1 ? "s" : ""}`
              : "Arrange block designs into a full quilt layout"}
          </p>
        </div>
        <Button asChild>
          <Link href="/layouts/new">
            <PlusCircle className="mr-0 sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">New layout</span>
          </Link>
        </Button>
      </div>

      {/* Search + sort row */}
      {layoutList && totalCount > 0 && (
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

          {/* Color filter palette */}
          {usedColors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {usedColors.map((hex) => (
                <button
                  key={hex}
                  title={hex}
                  onClick={() =>
                    setColorFilter((prev) =>
                      prev.includes(hex) ? prev.filter((c) => c !== hex) : [...prev, hex]
                    )
                  }
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    colorFilter.includes(hex)
                      ? "border-primary scale-110 ring-2 ring-primary/40"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
              {colorFilter.length > 0 && (
                <button
                  onClick={() => setColorFilter([])}
                  className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear colour
                </button>
              )}
            </div>
          )}

          {/* Size + category filter pills */}
          {(filterableSizes.length > 1 || filterableCats.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {filterableSizes.length > 1 &&
                filterableSizes.map((s) => {
                  const active = activeSizes.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSize(s)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {s} blocks
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
            Failed to load layouts. Please refresh.
          </p>
        </div>
      )}

      {layoutList && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20">
          <LayoutGrid className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="font-medium text-foreground">No layouts yet</p>
            <p className="text-sm text-muted-foreground">
              Arrange your block designs into a quilt layout
            </p>
          </div>
          <Button asChild>
            <Link href="/layouts/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              New layout
            </Link>
          </Button>
        </div>
      )}

      {layoutList && totalCount > 0 && displayed.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
          <p className="text-sm text-muted-foreground">
            No layouts match the selected filters.
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
          {displayed.map((layout) => (
            <LayoutCard
              key={layout.id}
              layout={layout}
              blocks={blocks}
              blockMap={blockMap}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onFilterBySize={toggleSize}
              onFilterByCategory={toggleCat}
              onFilterByColor={(hex) =>
                setColorFilter((prev) =>
                  prev.includes(hex) ? prev.filter((c) => c !== hex) : [...prev, hex]
                )
              }
              fabricUrlMap={fabricUrlMap}
              onEditCategories={() => setCategoryEditItem(layout)}
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
            updateLayoutCategories.mutate({
              id: categoryEditItem.id,
              data: { categoryNames: names },
            });
          }
        }}
        isSaving={updateLayoutCategories.isPending}
      />
    </div>
  );
}
