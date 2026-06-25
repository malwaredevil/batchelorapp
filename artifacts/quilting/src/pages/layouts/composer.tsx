import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useRegisterNavGuard } from "@/lib/nav-guard";
import {
  ArrowLeft,
  Save,
  RotateCw,
  Trash2,
  X,
  Download,
  Sliders,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtInch, parseCell } from "@/lib/cell-parser";
import {
  useListBlocks,
  useGetLayout,
  useCreateLayout,
  useUpdateLayout,
  useListQuiltingCategories,
  useListFabrics,
  getListLayoutsQueryKey,
} from "@workspace/api-client-react";
import { FabricPicker, buildFabricUrlMap } from "@/components/FabricPicker";
import type { QuiltingCategory } from "@workspace/api-client-react";
import { TagSelector } from "@/components/tag-selector";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadSvgAsJpeg, downloadSvgAsPng } from "@/lib/svg-export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LayoutCell = { blockId: number | null; rotation: 0 | 90 | 180 | 270 };

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
  seams?: BlockSeamLine[];
  blockSizeInches?: number | null;
};

// ---------------------------------------------------------------------------
// Quilt dimension display — includes sashing + border in total size
// ---------------------------------------------------------------------------

function QuiltDimDisplay({
  rows,
  cols,
  blockMap,
  cells,
  sashingWidthInches,
  borderWidthInches,
}: {
  rows: number;
  cols: number;
  blockMap: Map<number, BlockSummary>;
  cells: LayoutCell[];
  sashingWidthInches: number | null;
  borderWidthInches: number | null;
}) {
  const sizes: number[] = [];
  for (const cell of cells) {
    if (cell.blockId === null) continue;
    const block = blockMap.get(cell.blockId);
    if (block?.blockSizeInches != null) sizes.push(block.blockSizeInches);
  }
  if (sizes.length === 0) return null;

  const freq = new Map<number, number>();
  for (const s of sizes) freq.set(s, (freq.get(s) ?? 0) + 1);
  const blockSz = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const mixed = freq.size > 1;

  const sash = sashingWidthInches ?? 0;
  const border = borderWidthInches ?? 0;
  const qW = cols * blockSz + sash * (cols - 1) + border * 2;
  const qH = rows * blockSz + sash * (rows - 1) + border * 2;

  return (
    <div className="flex items-center gap-1.5 rounded border border-border bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {fmtInch(qW)} × {fmtInch(qH)}
      </span>
      <span>finished quilt{mixed ? " (approx)" : ""}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SvgCell — renders one block sub-cell at absolute SVG coordinates
// ---------------------------------------------------------------------------

function SvgCell({
  x,
  y,
  w,
  h,
  cell,
  id,
  fabricUrlMap = {},
  patternPrefix = "layout-fab",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: string;
  id: string;
  fabricUrlMap?: Record<number, string>;
  patternPrefix?: string;
}) {
  const p = parseCell(cell);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = Math.max(0.4, w * 0.04);
  const rf = (c: string) => {
    if (c.startsWith("fab:")) {
      const n = parseInt(c.slice(4), 10);
      if (!isNaN(n) && fabricUrlMap[n]) return `url(#${patternPrefix}-${n})`;
      return "#D1D5DB";
    }
    return c || "#FFFFFF";
  };

  switch (p.kind) {
    case "solid":
      return <rect x={x} y={y} width={w} height={h} fill={rf(p.color)} />;
    case "triangle":
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

// ---------------------------------------------------------------------------
// Block mini SVG (for palette)
// ---------------------------------------------------------------------------

function BlockMini({
  block,
  size = 48,
  fabricUrlMap = {},
}: {
  block: BlockSummary;
  size?: number;
  fabricUrlMap?: Record<number, string>;
}) {
  const tileCount = 1;
  const gridH = Math.max(1, Math.ceil(block.cells.length / block.gridSize));
  const cellPx = size / (block.gridSize * tileCount);
  const svgH = gridH * tileCount * cellPx;
  const tiles = Array.from({ length: tileCount * tileCount }, (_, t) => t);
  const sw = Math.max(0.3, cellPx * 0.08);

  const fabIds = (() => {
    const ids = new Set<number>();
    const FAB_RE = /fab:(\d+)/g;
    for (const c of block.cells) {
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
    >
      {fabIds.length > 0 && (
        <defs>
          {fabIds.map((fabId) => (
            <pattern
              key={fabId}
              id={`mini-fab-${fabId}`}
              patternUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={size}
              height={svgH}
            >
              <image
                href={fabricUrlMap[fabId]}
                x="0"
                y="0"
                width={size}
                height={svgH}
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
        const offX = tc * block.gridSize * cellPx;
        const offY = tr * gridH * cellPx;
        return (
          <g key={tile}>
            {block.cells.map((cell, i) => {
              const row = Math.floor(i / block.gridSize);
              const col = i % block.gridSize;
              return (
                <SvgCell
                  key={`${tile}-${i}`}
                  id={`${tile}-${i}`}
                  x={offX + col * cellPx}
                  y={offY + row * cellPx}
                  w={cellPx}
                  h={cellPx}
                  cell={cell}
                  fabricUrlMap={fabricUrlMap}
                  patternPrefix="mini-fab"
                />
              );
            })}
            {(block.seams ?? []).map((seam, si) => {
              const cs = seam.clipStart ?? 0,
                ce = seam.clipEnd ?? 1;
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

// ---------------------------------------------------------------------------
// Layout grid SVG — renders blocks with sashing and border
// ---------------------------------------------------------------------------

function resolveFabricFill(color: string, map: Record<number, string>): string {
  if (color.startsWith("fab:")) {
    const id = parseInt(color.slice(4), 10);
    if (!isNaN(id) && map[id]) return `url(#layout-fab-${id})`;
    return "#D1D5DB";
  }
  return color;
}

function LayoutGrid({
  rows,
  cols,
  cells,
  blockMap,
  cellPx,
  sashPx,
  borderPx,
  sashingColor,
  borderColor,
  cornerstoneColor,
  selectedCell,
  onCellClick,
  fabricUrlMap = {},
  imageFilter,
}: {
  rows: number;
  cols: number;
  cells: LayoutCell[];
  blockMap: Map<number, BlockSummary>;
  cellPx: number;
  sashPx: number;
  borderPx: number;
  sashingColor: string;
  borderColor: string;
  cornerstoneColor: string | null;
  selectedCell: number | null;
  onCellClick: (idx: number) => void;
  fabricUrlMap?: Record<number, string>;
  imageFilter?: string;
}) {
  const totalW = borderPx * 2 + cols * cellPx + (cols - 1) * sashPx;
  const totalH = borderPx * 2 + rows * cellPx + (rows - 1) * sashPx;
  const tilePx = Math.max(cellPx, sashPx, 40);

  // Collect unique fabric IDs used in border/sashing/cornerstone AND block cells
  const fabricPatternIds = (() => {
    const ids = new Set<number>();
    for (const c of [borderColor, sashingColor, cornerstoneColor ?? ""]) {
      if (c.startsWith("fab:")) {
        const n = parseInt(c.slice(4), 10);
        if (!isNaN(n) && fabricUrlMap[n]) ids.add(n);
      }
    }
    // Also collect fab IDs from all block cells
    const FAB_RE = /fab:(\d+)/g;
    for (const lc of cells) {
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
    return ids;
  })();

  const rf = (c: string) => resolveFabricFill(c, fabricUrlMap);

  return (
    <svg
      width={totalW}
      height={totalH}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      data-layout-export
      style={{ display: "block", cursor: "pointer" }}
    >
      {/* Fabric fill patterns for layout sashing / border / cornerstone */}
      {fabricPatternIds.size > 0 && (
        <defs>
          {Array.from(fabricPatternIds).map((id) => (
            <pattern
              key={id}
              id={`layout-fab-${id}`}
              patternUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={tilePx}
              height={tilePx}
            >
              <image
                href={fabricUrlMap[id]}
                x="0"
                y="0"
                width={tilePx}
                height={tilePx}
                preserveAspectRatio="xMidYMid slice"
                style={imageFilter ? { filter: imageFilter } : undefined}
              />
            </pattern>
          ))}
        </defs>
      )}

      {/* Border fill */}
      {borderPx > 0 && (
        <rect
          x={0}
          y={0}
          width={totalW}
          height={totalH}
          fill={rf(borderColor)}
        />
      )}
      {/* Sashing fill (covers the whole inner area; blocks will render on top) */}
      {sashPx > 0 && (
        <rect
          x={borderPx}
          y={borderPx}
          width={totalW - borderPx * 2}
          height={totalH - borderPx * 2}
          fill={rf(sashingColor)}
        />
      )}
      {/* White background for no-sashing case */}
      {sashPx === 0 && (
        <rect
          x={borderPx}
          y={borderPx}
          width={totalW - borderPx * 2}
          height={totalH - borderPx * 2}
          fill="#F9FAFB"
        />
      )}

      {/* Cornerstones — coloured squares at every sashing intersection */}
      {sashPx > 0 &&
        cornerstoneColor &&
        Array.from({ length: rows - 1 }, (_, r) =>
          Array.from({ length: cols - 1 }, (_, c) => {
            const cx = borderPx + (c + 1) * (cellPx + sashPx) - sashPx;
            const cy = borderPx + (r + 1) * (cellPx + sashPx) - sashPx;
            return (
              <rect
                key={`cs-${r}-${c}`}
                x={cx}
                y={cy}
                width={sashPx}
                height={sashPx}
                fill={rf(cornerstoneColor)}
              />
            );
          }),
        )}

      {/* Blocks */}
      {cells.map((cell, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const x = borderPx + col * (cellPx + sashPx);
        const y = borderPx + row * (cellPx + sashPx);
        const block = cell.blockId !== null ? blockMap.get(cell.blockId) : null;
        const isSelected = selectedCell === idx;
        const cx = x + cellPx / 2;
        const cy = y + cellPx / 2;

        return (
          <g
            key={idx}
            onClick={() => onCellClick(idx)}
            style={{ cursor: "pointer" }}
          >
            {/* Empty cell bg */}
            {!block && (
              <rect x={x} y={y} width={cellPx} height={cellPx} fill="#F9FAFB" />
            )}
            {/* Block content */}
            {block && (
              <g transform={`rotate(${cell.rotation}, ${cx}, ${cy})`}>
                {block.cells.map((blockCell, j) => {
                  const br = Math.floor(j / block.gridSize);
                  const bc = j % block.gridSize;
                  const bCellPx = cellPx / block.gridSize;
                  return (
                    <SvgCell
                      key={j}
                      id={`${idx}-${j}`}
                      x={x + bc * bCellPx}
                      y={y + br * bCellPx}
                      w={bCellPx}
                      h={bCellPx}
                      cell={blockCell}
                      fabricUrlMap={fabricUrlMap}
                    />
                  );
                })}
                {(block.seams ?? []).map((seam, si) => {
                  const bCellPx = cellPx / block.gridSize;
                  const cs = seam.clipStart ?? 0,
                    ce = seam.clipEnd ?? 1;
                  const sw = Math.max(0.3, bCellPx * 0.08);
                  if (seam.axis === "h") {
                    const sy = y + (seam.pos / 2) * bCellPx;
                    return (
                      <line
                        key={`sm${si}`}
                        x1={x + (seam.cellIdx + cs) * bCellPx}
                        y1={sy}
                        x2={x + (seam.cellIdx + ce) * bCellPx}
                        y2={sy}
                        stroke="#333"
                        strokeWidth={sw}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                    );
                  }
                  const sx = x + (seam.pos / 2) * bCellPx;
                  return (
                    <line
                      key={`sm${si}`}
                      x1={sx}
                      y1={y + (seam.cellIdx + cs) * bCellPx}
                      x2={sx}
                      y2={y + (seam.cellIdx + ce) * bCellPx}
                      stroke="#333"
                      strokeWidth={sw}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  );
                })}
              </g>
            )}
            {/* Selection ring */}
            {isSelected ? (
              <rect
                x={x + 1}
                y={y + 1}
                width={cellPx - 2}
                height={cellPx - 2}
                fill="none"
                stroke="#6366f1"
                strokeWidth={2.5}
              />
            ) : (
              <rect
                x={x}
                y={y}
                width={cellPx}
                height={cellPx}
                fill="none"
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={0.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyCells(rows: number, cols: number): LayoutCell[] {
  return Array<LayoutCell>(rows * cols)
    .fill({ blockId: null, rotation: 0 })
    .map(() => ({
      blockId: null,
      rotation: 0,
    }));
}

function normalizeCells(
  cells: LayoutCell[],
  rows: number,
  cols: number,
): LayoutCell[] {
  const size = rows * cols;
  const result = cells.slice(0, size).map((c) => ({
    blockId: c.blockId,
    rotation: (([0, 90, 180, 270] as number[]).includes(c.rotation)
      ? c.rotation
      : 0) as 0 | 90 | 180 | 270,
  }));
  while (result.length < size) result.push({ blockId: null, rotation: 0 });
  return result;
}

const GRID_SIZES = [3, 4, 5, 6, 7, 8, 10, 12] as const;

const DEFAULT_SASHING_COLOR = "#d4c5a9";
const DEFAULT_BORDER_COLOR = "#8b6f5e";
const DEFAULT_CORNERSTONE_COLOR = "#8b6f5e";

/** Convert sashing width in inches to screen pixels, given block pixel size and assumed block size. */
function inchesToPx(
  inches: number,
  blockPx: number,
  blockSzInches: number,
): number {
  return Math.max(2, Math.round((inches / blockSzInches) * blockPx));
}

// ---------------------------------------------------------------------------
// Main composer
// ---------------------------------------------------------------------------

export default function LayoutComposer() {
  const { id } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const isNew = !id || id === "new";
  const layoutId = isNew ? null : Number(id);

  const { data: existing, isLoading: loadingExisting } = useGetLayout(
    layoutId ?? 0,
  );
  const { data: blockList } = useListBlocks();
  const { data: fabricsList, isLoading: fabricsLoading } = useListFabrics();

  const [name, setName] = useState("Untitled layout");
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(5);
  const [cells, setCells] = useState<LayoutCell[]>(() => makeEmptyCells(5, 5));
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(
    new Set(),
  );

  // Sashing
  const [sashingEnabled, setSashingEnabled] = useState(false);
  const [sashingWidthInches, setSashingWidthInches] = useState(1.5);
  const [sashingColor, setSashingColor] = useState(DEFAULT_SASHING_COLOR);
  // Border
  const [borderEnabled, setBorderEnabled] = useState(false);
  const [borderWidthInches, setBorderWidthInches] = useState(3);
  const [borderColor, setBorderColor] = useState(DEFAULT_BORDER_COLOR);
  // Cornerstones
  const [cornerstoneEnabled, setCornerstoneEnabled] = useState(false);
  const [cornerstoneColor, setCornerstoneColor] = useState(
    DEFAULT_CORNERSTONE_COLOR,
  );

  // Fabric support
  const fabricUrlMap = useMemo(
    () => buildFabricUrlMap(fabricsList ?? []),
    [fabricsList],
  );
  const [activeFabricPicker, setActiveFabricPicker] = useState<
    null | "sashing" | "border" | "cornerstone"
  >(null);

  // View controls (brightness / contrast / saturation) — preview only, persisted to localStorage
  const [viewFilter, setViewFilter] = useState<{
    brightness: number;
    contrast: number;
    saturation: number;
  }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("qlc-view-filter") ?? "{}");
      return {
        brightness: typeof v.brightness === "number" ? v.brightness : 100,
        contrast: typeof v.contrast === "number" ? v.contrast : 100,
        saturation: typeof v.saturation === "number" ? v.saturation : 100,
      };
    } catch {
      return { brightness: 100, contrast: 100, saturation: 100 };
    }
  });
  const [viewControlsOpen, setViewControlsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("qlc-view-filter", JSON.stringify(viewFilter));
  }, [viewFilter]);

  const imageFilter = useMemo(
    () =>
      viewFilter.brightness === 100 &&
      viewFilter.contrast === 100 &&
      viewFilter.saturation === 100
        ? undefined
        : `brightness(${viewFilter.brightness}%) contrast(${viewFilter.contrast}%) saturate(${viewFilter.saturation}%)`,
    [viewFilter],
  );

  // Unsaved-changes guard
  const [isDirty, setIsDirty] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const exitAfterSaveRef = useRef(false);
  const pendingNavRef = useRef<string | null>(null);

  function requestNav(to: string) {
    if (isDirty) {
      pendingNavRef.current = to;
      setShowExitDialog(true);
    } else {
      navigate(to);
    }
  }
  useRegisterNavGuard(requestNav);
  // For new layouts dirty tracking starts immediately; for existing layouts we wait until data is loaded.
  const loadedRef = useRef(isNew);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setRows(existing.rows);
      setCols(existing.cols);
      setCells(
        normalizeCells(
          existing.cells as LayoutCell[],
          existing.rows,
          existing.cols,
        ),
      );
      const sw = existing.sashingWidthInches ?? null;
      setSashingEnabled(sw !== null && sw > 0);
      if (sw !== null && sw > 0) setSashingWidthInches(sw);
      if (existing.sashingColor) setSashingColor(existing.sashingColor);
      const bw = existing.borderWidthInches ?? null;
      setBorderEnabled(bw !== null && bw > 0);
      if (bw !== null && bw > 0) setBorderWidthInches(bw);
      if (existing.borderColor) setBorderColor(existing.borderColor);
      const cc =
        (existing as { cornerstoneColor?: string | null }).cornerstoneColor ??
        null;
      setCornerstoneEnabled(cc !== null && cc !== "");
      if (cc) setCornerstoneColor(cc);
      if (existing.categories) {
        setSelectedCategoryIds(
          new Set((existing.categories as QuiltingCategory[]).map((c) => c.id)),
        );
      }
      loadedRef.current = true;
    }
  }, [existing]);

  // Mark dirty whenever any editable field changes (after initial load)
  useEffect(() => {
    if (!loadedRef.current) return;
    setIsDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    name,
    rows,
    cols,
    cells,
    sashingEnabled,
    sashingWidthInches,
    sashingColor,
    borderEnabled,
    borderWidthInches,
    borderColor,
    cornerstoneEnabled,
    cornerstoneColor,
    selectedCategoryIds,
  ]);

  const blockMap = new Map((blockList ?? []).map((b) => [b.id, b]));

  // Compute dominant block size for pixel scaling
  const placedSizes = cells
    .filter((c) => c.blockId !== null)
    .map((c) => blockMap.get(c.blockId!)?.blockSizeInches ?? null)
    .filter((s): s is number => s !== null);
  const dominantBlockSz =
    placedSizes.length > 0
      ? Array.from(
          placedSizes.reduce(
            (m, s) => m.set(s, (m.get(s) ?? 0) + 1),
            new Map<number, number>(),
          ),
        ).sort((a, b) => b[1] - a[1])[0][0]
      : 12; // assume 12" if no blocks placed yet

  const CELL_PX = Math.min(Math.floor(480 / Math.max(rows, cols)), 72);
  const sashPx = sashingEnabled
    ? inchesToPx(sashingWidthInches, CELL_PX, dominantBlockSz)
    : 0;
  const borderPx = borderEnabled
    ? inchesToPx(borderWidthInches, CELL_PX, dominantBlockSz)
    : 0;

  function handleRowsChange(value: string) {
    const n = Number(value);
    setRows(n);
    setCells((prev) => normalizeCells(prev, n, cols));
    setSelectedCell(null);
  }

  function handleColsChange(value: string) {
    const n = Number(value);
    setCols(n);
    setCells((prev) => normalizeCells(prev, rows, n));
    setSelectedCell(null);
  }

  function handleCellClick(idx: number) {
    if (selectedBlock !== null) {
      setCells((prev) => {
        const next = [...prev];
        next[idx] = { blockId: selectedBlock, rotation: 0 };
        return next;
      });
      setSelectedCell(idx);
    } else {
      setSelectedCell(selectedCell === idx ? null : idx);
    }
  }

  function handleRotateCell(idx: number) {
    setCells((prev) => {
      const next = [...prev];
      const current = next[idx];
      const rotations: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
      const i = rotations.indexOf(current.rotation as 0 | 90 | 180 | 270);
      next[idx] = { ...current, rotation: rotations[(i + 1) % 4] };
      return next;
    });
  }

  function handleClearCell(idx: number) {
    setCells((prev) => {
      const next = [...prev];
      next[idx] = { blockId: null, rotation: 0 };
      return next;
    });
    setSelectedCell(null);
  }

  const createLayout = useCreateLayout({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Layout saved!");
        setIsDirty(false);
        navigate(`/layouts/${data.id}`);
      },
      onError: () => toast.error("Failed to save layout."),
    },
  });

  const updateLayout = useUpdateLayout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLayoutsQueryKey() });
        toast.success("Layout updated!");
        setIsDirty(false);
        if (exitAfterSaveRef.current) {
          exitAfterSaveRef.current = false;
          navigate(layoutId ? `/layouts/${layoutId}` : "/layouts");
        }
      },
      onError: () => toast.error("Failed to update layout."),
    },
  });

  function buildSashingPayload() {
    return {
      sashingWidthInches: sashingEnabled ? sashingWidthInches : null,
      sashingColor: sashingEnabled ? sashingColor : null,
      borderWidthInches: borderEnabled ? borderWidthInches : null,
      borderColor: borderEnabled ? borderColor : null,
      cornerstoneColor:
        cornerstoneEnabled && sashingEnabled ? cornerstoneColor : null,
    };
  }

  const { data: allCategories } = useListQuiltingCategories();

  const handleExport = useCallback(
    async (format: "jpeg" | "png") => {
      const svgEl = document.querySelector<SVGSVGElement>(
        "[data-layout-export]",
      );
      if (!svgEl) {
        toast.error("Could not find layout to export.");
        return;
      }
      const serializer = new XMLSerializer();
      let svgStr = serializer.serializeToString(svgEl);
      if (!svgStr.includes("xmlns="))
        svgStr = svgStr.replace(
          "<svg",
          '<svg xmlns="http://www.w3.org/2000/svg"',
        );
      const filename = `${name.trim() || "layout"}.${format === "jpeg" ? "jpg" : "png"}`;
      try {
        if (format === "jpeg") await downloadSvgAsJpeg(svgStr, filename);
        else await downloadSvgAsPng(svgStr, filename);
        toast.success("Exported!");
      } catch {
        toast.error("Export failed.");
      }
    },
    [name],
  );

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Please enter a name.");
      return;
    }
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCategoryIds.has(c.id))
      .map((c) => c.name);
    const payload = {
      name: trimmed,
      rows,
      cols,
      cells,
      ...buildSashingPayload(),
      categoryNames,
    };
    if (isNew) {
      createLayout.mutate({ data: payload });
    } else if (layoutId) {
      updateLayout.mutate({ id: layoutId, data: payload });
    }
  }

  const isSaving = createLayout.isPending || updateLayout.isPending;

  if (!isNew && loadingExisting) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const selectedCellData = selectedCell !== null ? cells[selectedCell] : null;
  const selectedCellBlock =
    selectedCellData?.blockId !== null &&
    selectedCellData?.blockId !== undefined
      ? blockMap.get(selectedCellData.blockId)
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* Unsaved-changes exit dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this layout. What would you like to
              do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setShowExitDialog(false);
                setIsDirty(false);
                navigate(pendingNavRef.current ?? "/layouts");
                pendingNavRef.current = null;
              }}
            >
              Discard &amp; exit
            </Button>
            <AlertDialogAction
              onClick={() => {
                setShowExitDialog(false);
                exitAfterSaveRef.current = true;
                handleSave();
              }}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save & exit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mobile notice */}
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 md:hidden">
        The layout composer works best on a desktop or tablet with a mouse.
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => requestNav(layoutId ? `/layouts/${layoutId}` : "/layouts")}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 max-w-xs text-base font-semibold"
          placeholder="Layout name…"
        />
        <div className="ml-auto flex items-center gap-2">
          {/* View adjustments */}
          <div className="relative">
            <Button
              variant={viewControlsOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setViewControlsOpen((v) => !v)}
            >
              <Sliders className="mr-1.5 h-3.5 w-3.5" />
              View
              {imageFilter && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Button>
            {viewControlsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-border bg-popover p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold">View adjustments</p>
                  {imageFilter && (
                    <button
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setViewFilter({
                          brightness: 100,
                          contrast: 100,
                          saturation: 100,
                        })
                      }
                    >
                      Reset
                    </button>
                  )}
                </div>
                {(
                  [
                    { key: "brightness", label: "Brightness", min: 50, max: 150 },
                    { key: "contrast", label: "Contrast", min: 50, max: 150 },
                    { key: "saturation", label: "Saturation", min: 0, max: 200 },
                  ] as const
                ).map(({ key, label, min, max }) => (
                  <div key={key} className="mb-3 last:mb-0">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {label}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {viewFilter[key]}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={5}
                      value={viewFilter[key]}
                      onChange={(e) =>
                        setViewFilter((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value),
                        }))
                      }
                      className="h-1.5 w-full cursor-pointer accent-primary"
                    />
                  </div>
                ))}
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  Preview only — doesn't affect saved images
                </p>
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("jpeg")}>
                Download as JPEG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("png")}>
                Download as PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            {isNew ? "Save layout" : "Update"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: grid + controls */}
        <div className="flex flex-col gap-4">
          {/* Dimensions row */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-sm">Rows</Label>
              <Select value={String(rows)} onValueChange={handleRowsChange}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-sm">Cols</Label>
              <Select value={String(cols)} onValueChange={handleColsChange}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <QuiltDimDisplay
              rows={rows}
              cols={cols}
              blockMap={blockMap}
              cells={cells}
              sashingWidthInches={sashingEnabled ? sashingWidthInches : null}
              borderWidthInches={borderEnabled ? borderWidthInches : null}
            />
          </div>

          {/* Sashing + border controls */}
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            {/* Sashing */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sashing-toggle"
                checked={sashingEnabled}
                onChange={(e) => setSashingEnabled(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <Label
                htmlFor="sashing-toggle"
                className="cursor-pointer text-sm"
              >
                Sashing
              </Label>
              {sashingEnabled && (
                <>
                  <Input
                    type="number"
                    min={0.25}
                    max={6}
                    step={0.25}
                    value={sashingWidthInches}
                    onChange={(e) =>
                      setSashingWidthInches(Number(e.target.value))
                    }
                    className="h-7 w-16 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">in</span>
                  {/* Sashing colour / fabric picker */}
                  <div className="relative flex items-center gap-1">
                    <button
                      onClick={() =>
                        setActiveFabricPicker((p) =>
                          p === "sashing" ? null : "sashing",
                        )
                      }
                      className="h-7 w-7 overflow-hidden rounded border border-border shadow-sm"
                      style={
                        sashingColor.startsWith("fab:")
                          ? {}
                          : { backgroundColor: sashingColor }
                      }
                      title="Pick sashing colour or fabric"
                    >
                      {sashingColor.startsWith("fab:") &&
                        (() => {
                          const url =
                            fabricUrlMap[parseInt(sashingColor.slice(4), 10)];
                          return url ? (
                            <img
                              src={url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null;
                        })()}
                    </button>
                    {!sashingColor.startsWith("fab:") && (
                      <input
                        type="color"
                        value={sashingColor}
                        onChange={(e) => setSashingColor(e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-border"
                        title="Sashing colour"
                      />
                    )}
                    {sashingColor.startsWith("fab:") && (
                      <button
                        onClick={() => setSashingColor(DEFAULT_SASHING_COLOR)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                        title="Reset to solid colour"
                      >
                        ✕
                      </button>
                    )}
                    {activeFabricPicker === "sashing" && (
                      <div
                        className="absolute left-0 top-full z-50 mt-1 w-60 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-xl"
                        style={{ maxHeight: 320 }}
                      >
                        <FabricPicker
                          fabrics={fabricsList}
                          activeValue={sashingColor}
                          onSelect={(v) => {
                            setSashingColor(v);
                            setActiveFabricPicker(null);
                          }}
                          placeholder="Sashing fabric"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Border */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="border-toggle"
                checked={borderEnabled}
                onChange={(e) => setBorderEnabled(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <Label htmlFor="border-toggle" className="cursor-pointer text-sm">
                Border
              </Label>
              {borderEnabled && (
                <>
                  <Input
                    type="number"
                    min={0.25}
                    max={6}
                    step={0.25}
                    value={borderWidthInches}
                    onChange={(e) =>
                      setBorderWidthInches(Number(e.target.value))
                    }
                    className="h-7 w-16 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">in</span>
                  {/* Border colour / fabric picker */}
                  <div className="relative flex items-center gap-1">
                    <button
                      onClick={() =>
                        setActiveFabricPicker((p) =>
                          p === "border" ? null : "border",
                        )
                      }
                      className="h-7 w-7 overflow-hidden rounded border border-border shadow-sm"
                      style={
                        borderColor.startsWith("fab:")
                          ? {}
                          : { backgroundColor: borderColor }
                      }
                      title="Pick border colour or fabric"
                    >
                      {borderColor.startsWith("fab:") &&
                        (() => {
                          const url =
                            fabricUrlMap[parseInt(borderColor.slice(4), 10)];
                          return url ? (
                            <img
                              src={url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null;
                        })()}
                    </button>
                    {!borderColor.startsWith("fab:") && (
                      <input
                        type="color"
                        value={borderColor}
                        onChange={(e) => setBorderColor(e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-border"
                        title="Border colour"
                      />
                    )}
                    {borderColor.startsWith("fab:") && (
                      <button
                        onClick={() => setBorderColor(DEFAULT_BORDER_COLOR)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                        title="Reset to solid colour"
                      >
                        ✕
                      </button>
                    )}
                    {activeFabricPicker === "border" && (
                      <div
                        className="absolute left-0 top-full z-50 mt-1 w-60 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-xl"
                        style={{ maxHeight: 320 }}
                      >
                        <FabricPicker
                          fabrics={fabricsList}
                          activeValue={borderColor}
                          onSelect={(v) => {
                            setBorderColor(v);
                            setActiveFabricPicker(null);
                          }}
                          placeholder="Border fabric"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Cornerstones (only when sashing is on) */}
            {sashingEnabled && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cornerstone-toggle"
                  checked={cornerstoneEnabled}
                  onChange={(e) => setCornerstoneEnabled(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <Label
                  htmlFor="cornerstone-toggle"
                  className="cursor-pointer text-sm"
                >
                  Cornerstones
                </Label>
                {cornerstoneEnabled && (
                  <div className="relative flex items-center gap-1">
                    <button
                      onClick={() =>
                        setActiveFabricPicker((p) =>
                          p === "cornerstone" ? null : "cornerstone",
                        )
                      }
                      className="h-7 w-7 overflow-hidden rounded border border-border shadow-sm"
                      style={
                        cornerstoneColor.startsWith("fab:")
                          ? {}
                          : { backgroundColor: cornerstoneColor }
                      }
                      title="Pick cornerstone colour or fabric"
                    >
                      {cornerstoneColor.startsWith("fab:") &&
                        (() => {
                          const url =
                            fabricUrlMap[
                              parseInt(cornerstoneColor.slice(4), 10)
                            ];
                          return url ? (
                            <img
                              src={url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null;
                        })()}
                    </button>
                    {!cornerstoneColor.startsWith("fab:") && (
                      <input
                        type="color"
                        value={cornerstoneColor}
                        onChange={(e) => setCornerstoneColor(e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-border"
                        title="Cornerstone colour"
                      />
                    )}
                    {cornerstoneColor.startsWith("fab:") && (
                      <button
                        onClick={() =>
                          setCornerstoneColor(DEFAULT_CORNERSTONE_COLOR)
                        }
                        className="text-xs text-muted-foreground hover:text-foreground"
                        title="Reset to solid colour"
                      >
                        ✕
                      </button>
                    )}
                    {activeFabricPicker === "cornerstone" && (
                      <div
                        className="absolute left-0 top-full z-50 mt-1 w-60 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-xl"
                        style={{ maxHeight: 320 }}
                      >
                        <FabricPicker
                          fabrics={fabricsList}
                          activeValue={cornerstoneColor}
                          onSelect={(v) => {
                            setCornerstoneColor(v);
                            setActiveFabricPicker(null);
                          }}
                          placeholder="Cornerstone fabric"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cell actions */}
          {selectedCell !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
              <span className="text-xs text-muted-foreground">
                Cell {Math.floor(selectedCell / cols) + 1},
                {(selectedCell % cols) + 1}
                {selectedCellBlock && ` — ${selectedCellBlock.name}`}
              </span>
              <div className="ml-auto flex gap-1.5">
                {selectedCellData?.blockId !== null && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleRotateCell(selectedCell)}
                    >
                      <RotateCw className="mr-1 h-3 w-3" />
                      Rotate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => handleClearCell(selectedCell)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Clear
                    </Button>
                  </>
                )}
                <button
                  onClick={() => setSelectedCell(null)}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Layout grid */}
          <div
            className="overflow-auto rounded border border-border bg-white"
            style={{ width: "fit-content", maxWidth: "100%" }}
          >
            <LayoutGrid
              rows={rows}
              cols={cols}
              cells={cells}
              blockMap={blockMap}
              cellPx={CELL_PX}
              sashPx={sashPx}
              borderPx={borderPx}
              sashingColor={sashingColor}
              borderColor={borderColor}
              cornerstoneColor={
                cornerstoneEnabled && sashingEnabled ? cornerstoneColor : null
              }
              selectedCell={selectedCell}
              onCellClick={handleCellClick}
              fabricUrlMap={fabricUrlMap}
              imageFilter={imageFilter}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Select a block from the palette, then click cells to place it. Click
            a placed cell to select and rotate or clear it.
          </p>
        </div>

        {/* Right: block palette + categories */}
        <div className="flex flex-col gap-3 lg:w-64">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Block palette
          </p>

          <button
            onClick={() => setSelectedBlock(null)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              selectedBlock === null
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            <span className="text-base">◻</span>
            <span>Empty cell (eraser)</span>
          </button>

          {(!blockList || blockList.length === 0) && (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No block designs yet.
              </p>
              <a
                href="/blocks/new"
                className="mt-1 block text-xs text-primary hover:underline"
              >
                Create one in the Block Designer →
              </a>
            </div>
          )}

          {blockList && blockList.length > 0 && fabricsLoading && (
            <div className="flex flex-col gap-2">
              {blockList.map((block) => (
                <div
                  key={block.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-2"
                >
                  <Skeleton className="h-10 w-10 shrink-0 rounded" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {blockList && blockList.length > 0 && !fabricsLoading && (
            <div className="flex flex-col gap-2">
              {blockList.map((block) => (
                <button
                  key={block.id}
                  onClick={() => setSelectedBlock(block.id)}
                  className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                    selectedBlock === block.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="shrink-0 overflow-hidden rounded">
                    <BlockMini
                      block={block}
                      size={40}
                      fabricUrlMap={fabricUrlMap}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{block.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {block.gridSize}×{block.gridSize}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Categories */}
          <div className="pt-2">
            <TagSelector
              allCategories={allCategories ?? []}
              selectedIds={Array.from(selectedCategoryIds)}
              onToggle={(id) =>
                setSelectedCategoryIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onCreated={(cat) =>
                setSelectedCategoryIds((prev) => {
                  const next = new Set(prev);
                  next.add(cat.id);
                  return next;
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
