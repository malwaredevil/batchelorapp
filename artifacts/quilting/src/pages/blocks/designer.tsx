import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import { useLocation, useParams } from "wouter";
import { useRegisterNavGuard } from "@/lib/nav-guard";
import { usePageAssistantContext } from "@/lib/assistant-context";
import {
  ArrowLeft,
  Save,
  Copy,
  Trash2,
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Pipette,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Upload,
  X as XIcon,
  Paintbrush,
  Eraser,
  Scissors,
  PaintBucket,
  Eye,
  EyeOff,
  FileDown,
  FilePlus2,
  GripVertical,
  Minus,
  Wand2,
  ImageIcon,
  Download,
  Ruler,
  Hand,
  ZoomIn,
  ZoomOut,
  Check,
  Sliders,
  BookmarkPlus,
  Library,
  Trash2 as Trash2Icon,
  Tag,
  Pencil,
  FolderOpen,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useGetBlock,
  useCreateBlock,
  useUpdateBlock,
  useListQuiltingCategories,
  getListBlocksQueryKey,
  getGetBlockQueryKey,
  useListFabrics,
} from "@workspace/api-client-react";
import type {
  QuiltingCategory,
  QuiltingBlock,
} from "@workspace/api-client-react";
import { TagSelector } from "@/components/tag-selector";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBlockTemplates,
  useCreateBlockTemplate,
  useDeleteBlockTemplate,
  useGetBlockTemplate,
  usePatchBlockTemplate,
  getListBlockTemplatesQueryKey,
  getGetBlockTemplateQueryKey,
  type QuiltingBlockTemplate,
  type QuiltingBlockTemplateSeamLine,
} from "@workspace/api-client-react";
import { BlockPreviewSvg } from "@/components/BlockPreviewSvg";
import {
  parseCell,
  encodeXline,
  applyDiagClip,
  floodFillSolid,
  toggleQuarterLine,
  quarterDirForClick,
  type ParsedCell,
  type QDir,
} from "@/lib/cell-parser";
import { CellShape } from "@/components/CellShape";
import {
  FabricPicker,
  computeFabricTally,
  buildFabricUrlMap,
} from "@/components/FabricPicker";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const PALETTE: string[] = [
  "#FFFFFF",
  "#FFF8F0",
  "#F5EFE7",
  "#EDE0D4",
  "#C0392B",
  "#E74C3C",
  "#FF6B6B",
  "#FF8FA3",
  "#D63384",
  "#FF69B4",
  "#F48FB1",
  "#F8BBD0",
  "#E67E22",
  "#F39C12",
  "#FFB347",
  "#FFE066",
  "#FFF176",
  "#F9A825",
  "#FFECB3",
  "#FFD54F",
  "#27AE60",
  "#2ECC71",
  "#82C91E",
  "#C5E1A5",
  "#80CBC4",
  "#4DB6AC",
  "#26A69A",
  "#00897B",
  "#2980B9",
  "#3498DB",
  "#5DADE2",
  "#90CAF9",
  "#1565C0",
  "#283593",
  "#5C6BC0",
  "#7986CB",
  "#8E44AD",
  "#9B59B6",
  "#CE93D8",
  "#E1BEE7",
  "#7B1FA2",
  "#6A1B9A",
  "#BA68C8",
  "#F3E5F5",
  "#795548",
  "#8D6E63",
  "#A1887F",
  "#D7CCC8",
  "#FFF3E0",
  "#EFEBE9",
  "#BCAAA4",
  "#6D4C41",
  "#212121",
  "#424242",
  "#757575",
  "#BDBDBD",
  "#E0E0E0",
  "#F5F5F5",
  "#263238",
  "#546E7A",
];

// ---------------------------------------------------------------------------
// Types & cell helpers
// ---------------------------------------------------------------------------

type Tool =
  | "paint"
  | "erase"
  | "fill"
  | "eyedropper"
  | "pan"
  | "tri-nwse"
  | "tri-nesw"
  | "line-nwse"
  | "line-nesw"
  | "qline-back"
  | "qline-fwd"
  | "seam-h"
  | "seam-v"
  | "seam-snip";
type GridSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * Seam line segment drawn by the user (session-only — not saved with the block).
 * axis  : "h" = horizontal, "v" = vertical
 * pos   : perpendicular position in half-cell units (0 = top/left edge, 2N = bottom/right edge)
 *          even = on a grid line, odd = at the midpoint of that row/column
 * cellIdx: which cell the segment lives in, along the parallel axis
 *          H-seam: column index (0..N-1)   V-seam: row index (0..N-1)
 * The segment spans exactly one cell in the parallel direction.
 */
export type SeamLine = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number;
  clipEnd?: number;
};

export const SEAM_COLOR = "#4f46e5";

// ParsedCell and parseCell are imported from @/lib/cell-parser above.

export function encodeTriangle(
  type: "nwse" | "nesw",
  a: string,
  b: string,
): string {
  return `${type}:${a}:${b}`;
}

// encodeXline and applyDiagClip are imported from @/lib/cell-parser above.

function encodeQuad(
  top: string,
  right: string,
  bottom: string,
  left: string,
): string {
  return `quad:${top}:${right}:${bottom}:${left}`;
}
function encodeHSplit(top: string, bottom: string): string {
  return `hsplit:${top}:${bottom}`;
}
function encodeVSplit(left: string, right: string): string {
  return `vsplit:${left}:${right}`;
}
function encodeXSplit(tl: string, tr: string, bl: string, br: string): string {
  return `xsplit:${tl}:${tr}:${bl}:${br}`;
}

// ---------------------------------------------------------------------------
// Block transform helpers — rotate 90° CW, flip H, flip V
// ---------------------------------------------------------------------------

const QCYCLE: Record<string, string> = {
  ne: "se",
  se: "sw",
  sw: "nw",
  nw: "ne",
};
const QFLIP_H: Record<string, string> = {
  ne: "nw",
  nw: "ne",
  se: "sw",
  sw: "se",
};
const QFLIP_V: Record<string, string> = {
  ne: "se",
  se: "ne",
  nw: "sw",
  sw: "nw",
};

function rotateQlines(dirs: string[], map: Record<string, string>): string {
  const QORDER = ["ne", "se", "sw", "nw"];
  const next = dirs.map((d) => map[d] ?? d);
  const sorted = QORDER.filter((d) => next.includes(d));
  return sorted.length === 0 ? "" : `qlines:${sorted.join(":")}`;
}

function encodeLineCell(type: "nwse" | "nesw", cs: number, ce: number): string {
  const prefix = type === "nwse" ? "nwse-line" : "nesw-line";
  return cs === 0 && ce === 1 ? prefix : `${prefix}:${cs}:${ce}`;
}

/** Transform a single cell's *content* for a 90° clockwise rotation. */
function rotateCellContent90CW(cell: string): string {
  const p = parseCell(cell);
  switch (p.kind) {
    case "solid":
      return cell;
    case "triangle":
      // nwse(A=upper-right, B=lower-left) → nesw(A=upper-left, B=lower-right): A→B-slot, B→A-slot
      // nesw(A=upper-left, B=lower-right) → nwse(A=upper-right, B=lower-left): A→A-slot, B→B-slot
      return p.type === "nwse" ? `nesw:${p.b}:${p.a}` : `nwse:${p.a}:${p.b}`;
    case "quad":
      // Each triangle rotates CW: T→R, R→B, B→L, L→T → new quad T'=L, R'=T, B'=R, L'=B
      return `quad:${p.left}:${p.top}:${p.right}:${p.bottom}`;
    case "hsplit":
      // Top goes right, bottom goes left → vsplit(left=B, right=T)
      return `vsplit:${p.bottom}:${p.top}`;
    case "vsplit":
      // Left goes top, right goes bottom → hsplit(top=L, bottom=R)
      return `hsplit:${p.left}:${p.right}`;
    case "xsplit":
      // Corners rotate CW: TL→TR, TR→BR, BR→BL, BL→TL → new TL=BL, TR=TL, BR=TR, BL=BR
      return `xsplit:${p.bl}:${p.tl}:${p.br}:${p.tr}`;
    case "line":
      // nwse diagonal rotates to nesw (and vice-versa); fractional position unchanged
      return p.type === "nwse"
        ? encodeLineCell("nesw", p.cs, p.ce)
        : encodeLineCell("nwse", p.cs, p.ce);
    case "xline":
      // nwse ↔ nesw swap
      return encodeXline(p.neswCs, p.neswCe, p.nwseCs, p.nwseCe);
    case "midline":
      if (p.h && p.v) return "seam-midline-hv";
      return p.h ? "seam-midline-v" : "seam-midline-h";
    case "qlines":
      return rotateQlines(p.dirs, QCYCLE);
    default:
      return cell;
  }
}

/** Transform a single cell's *content* for a horizontal flip (mirror left↔right). */
function flipCellContentH(cell: string): string {
  const p = parseCell(cell);
  switch (p.kind) {
    case "solid":
      return cell;
    case "triangle":
      // Diagonal direction flips; each colour stays in the same relative position (A→A, B→B)
      return p.type === "nwse" ? `nesw:${p.a}:${p.b}` : `nwse:${p.a}:${p.b}`;
    case "quad":
      // L↔R, T and B stay
      return `quad:${p.top}:${p.left}:${p.bottom}:${p.right}`;
    case "hsplit":
      return cell; // horizontal split — unchanged by H-flip
    case "vsplit":
      return `vsplit:${p.right}:${p.left}`;
    case "xsplit":
      return `xsplit:${p.tr}:${p.tl}:${p.br}:${p.bl}`;
    case "line":
      return p.type === "nwse"
        ? encodeLineCell("nesw", p.cs, p.ce)
        : encodeLineCell("nwse", p.cs, p.ce);
    case "xline":
      return encodeXline(p.neswCs, p.neswCe, p.nwseCs, p.nwseCe);
    case "midline":
      return cell;
    case "qlines":
      return rotateQlines(p.dirs, QFLIP_H);
    default:
      return cell;
  }
}

/** Transform a single cell's *content* for a vertical flip (mirror top↔bottom). */
function flipCellContentV(cell: string): string {
  const p = parseCell(cell);
  switch (p.kind) {
    case "solid":
      return cell;
    case "triangle":
      // Diagonal direction flips; A and B swap slots
      return p.type === "nwse" ? `nesw:${p.b}:${p.a}` : `nwse:${p.b}:${p.a}`;
    case "quad":
      // T↔B, L and R stay
      return `quad:${p.bottom}:${p.right}:${p.top}:${p.left}`;
    case "hsplit":
      return `hsplit:${p.bottom}:${p.top}`;
    case "vsplit":
      return cell; // vertical split — unchanged by V-flip
    case "xsplit":
      return `xsplit:${p.bl}:${p.br}:${p.tl}:${p.tr}`;
    case "line":
      return p.type === "nwse"
        ? encodeLineCell("nesw", p.cs, p.ce)
        : encodeLineCell("nwse", p.cs, p.ce);
    case "xline":
      return encodeXline(p.neswCs, p.neswCe, p.nwseCs, p.nwseCe);
    case "midline":
      return cell;
    case "qlines":
      return rotateQlines(p.dirs, QFLIP_V);
    default:
      return cell;
  }
}

/**
 * Rotate all cells + seams 90° clockwise.
 * For non-square grids gridW and gridH swap.
 */
function applyRotate90CW(
  cells: string[],
  seams: SeamLine[],
  gridW: number,
  gridH: number,
): { cells: string[]; seams: SeamLine[]; newW: number; newH: number } {
  const newW = gridH;
  const newH = gridW;
  const newCells: string[] = new Array(newW * newH).fill("");
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const newRow = col;
      const newCol = gridH - 1 - row;
      newCells[newRow * newW + newCol] = rotateCellContent90CW(
        cells[row * gridW + col] ?? "",
      );
    }
  }
  const newSeams: SeamLine[] = seams.map((s) =>
    s.axis === "h"
      ? { ...s, axis: "v" as const, pos: 2 * gridH - s.pos, cellIdx: s.cellIdx }
      : {
          ...s,
          axis: "h" as const,
          pos: s.pos,
          cellIdx: gridH - 1 - s.cellIdx,
        },
  );
  return { cells: newCells, seams: newSeams, newW, newH };
}

/** Flip all cells + seams horizontally (mirror left↔right). */
function applyFlipH(
  cells: string[],
  seams: SeamLine[],
  gridW: number,
  gridH: number,
): { cells: string[]; seams: SeamLine[] } {
  const newCells = cells.map((c, idx) => {
    const row = Math.floor(idx / gridW);
    const col = idx % gridW;
    const mirrorIdx = row * gridW + (gridW - 1 - col);
    return flipCellContentH(cells[mirrorIdx] ?? "");
  });
  const newSeams: SeamLine[] = seams.map((s) =>
    s.axis === "h"
      ? { ...s, cellIdx: gridW - 1 - s.cellIdx }
      : { ...s, pos: 2 * gridW - s.pos },
  );
  return { cells: newCells, seams: newSeams };
}

/** Flip all cells + seams vertically (mirror top↔bottom). */
function applyFlipV(
  cells: string[],
  seams: SeamLine[],
  gridW: number,
  gridH: number,
): { cells: string[]; seams: SeamLine[] } {
  const newCells = cells.map((c, idx) => {
    const row = Math.floor(idx / gridW);
    const col = idx % gridW;
    const mirrorIdx = (gridH - 1 - row) * gridW + col;
    return flipCellContentV(cells[mirrorIdx] ?? "");
  });
  const newSeams: SeamLine[] = seams.map((s) =>
    s.axis === "h"
      ? { ...s, pos: 2 * gridH - s.pos }
      : { ...s, cellIdx: gridH - 1 - s.cellIdx },
  );
  return { cells: newCells, seams: newSeams };
}

/** Return the colour of one of the four sub-quadrants of a cell (for seam fill mapping). */
function getSubCellColor(
  parsed: ParsedCell,
  pos: "tl" | "tr" | "bl" | "br",
): string {
  const W = "#FFFFFF";
  if (parsed.kind === "solid") return parsed.color || W;
  if (parsed.kind === "hsplit")
    return pos === "tl" || pos === "tr" ? parsed.top : parsed.bottom;
  if (parsed.kind === "vsplit")
    return pos === "tl" || pos === "bl" ? parsed.left : parsed.right;
  if (parsed.kind === "xsplit") return parsed[pos];
  return W; // triangle / quad / line — treat as white for partial-fill merging
}

/**
 * Seam-bounded "cloth" fill.
 *
 * Floods the contiguous region the click lands in, stopping at every seam:
 * drawn H/V seam lines AND the internal seams baked into a cell's shape — a
 * diagonal, the X of an xline/quad, or the mid-splits of an hsplit / vsplit /
 * xsplit. The flood crosses a cell boundary only where no drawn seam blocks
 * that half-edge, so a fill behaves like a single piece of cloth: it spreads
 * into a neighbouring triangle or quarter when they are joined and stops where
 * a seam would be sewn.
 *
 * Model: every cell is split into 8 octants fanning from its centre to the 4
 * corners + 4 edge-midpoints, numbered clockwise from the top-left:
 *
 *      O7 O0 | O1 O2        top edge:    O0 left  O1 right
 *      ------+------        right edge:  O2 top   O3 bottom
 *      O6 O5 | O4 O3        bottom edge: O5 left  O4 right
 *                           left edge:   O7 top   O6 bottom
 *
 * A shape contributes internal seam segments between consecutive octants
 * (SEP_CW). The BFS walks octant→octant inside a cell unless a seam separates
 * them, and octant→octant across a boundary unless a drawn seam blocks that
 * half-edge. Filled octants are then re-encoded back to the most specific cell
 * shape (solid / triangle / quad / h|v|x-split), preserving the seam lines.
 *
 * qlines and curve cells have no centre-fan representation, so they flood as a
 * single region (previous behaviour) and are out of scope here.
 *
 * clickGridX/Y are in cell-unit coordinates (0..gridSize).
 */
export function seamFill(
  cells: string[],
  gridW: number,
  gridH: number,
  clickGridX: number,
  clickGridY: number,
  color: string,
  seams: SeamLine[],
): string[] {
  type Sep = "nwse" | "nesw" | "hmid" | "vmid";

  // Drawn H/V seams block individual half-edges.
  //   hEdges key "pos:sc": crossing the horizontal sub-row boundary `pos` in
  //     sub-col `sc` is blocked.  vEdges key "sr:pos": vertical sub-col boundary.
  const hEdges = new Set<string>();
  const vEdges = new Set<string>();
  for (const seam of seams) {
    const cs = seam.clipStart ?? 0,
      ce = seam.clipEnd ?? 1;
    if (seam.axis === "h") {
      if (cs < 0.5) hEdges.add(`${seam.pos}:${seam.cellIdx * 2}`);
      if (ce > 0.5) hEdges.add(`${seam.pos}:${seam.cellIdx * 2 + 1}`);
    } else {
      if (cs < 0.5) vEdges.add(`${seam.cellIdx * 2}:${seam.pos}`);
      if (ce > 0.5) vEdges.add(`${seam.cellIdx * 2 + 1}:${seam.pos}`);
    }
  }

  // A drawn seam that runs along a cell's *internal* midline (odd `pos`) divides
  // that single cell into two halves, exactly like an hsplit/vsplit cell shape —
  // the even-`pos` boundary edges above only block *cross-cell* flow, so without
  // this an internal midline seam (the only kind possible on a 1×1 block) is
  // ignored and the fill floods the whole cell. Only full-span midline seams
  // divide cleanly; clipped ones have no "partial divide + colour" encoding so
  // they keep their pass-through behaviour.
  const seamSeps = new Map<number, Set<Sep>>();
  const addSeamSep = (k: number, s: Sep) => {
    let set = seamSeps.get(k);
    if (!set) seamSeps.set(k, (set = new Set()));
    set.add(s);
  };
  for (const seam of seams) {
    if (seam.pos % 2 !== 1) continue; // internal midlines only
    const cs = seam.clipStart ?? 0,
      ce = seam.clipEnd ?? 1;
    if (cs > 0.001 || ce < 0.999) continue; // full-span only
    if (seam.axis === "h") {
      const r = (seam.pos - 1) / 2;
      if (r < 0 || r >= gridH || seam.cellIdx < 0 || seam.cellIdx >= gridW)
        continue;
      addSeamSep(r * gridW + seam.cellIdx, "hmid");
    } else {
      const c = (seam.pos - 1) / 2;
      if (c < 0 || c >= gridW || seam.cellIdx < 0 || seam.cellIdx >= gridH)
        continue;
      addSeamSep(seam.cellIdx * gridW + c, "vmid");
    }
  }

  // Internal seam segment between octant o and (o+1)%8 (clockwise).
  const SEP_CW: Sep[] = [
    "vmid", // O0|O1  upper vertical midline
    "nesw", // O1|O2  upper-right diagonal
    "hmid", // O2|O3  right horizontal midline
    "nwse", // O3|O4  lower-right diagonal
    "vmid", // O4|O5  lower vertical midline
    "nesw", // O5|O6  lower-left diagonal
    "hmid", // O6|O7  left horizontal midline
    "nwse", // O7|O0  upper-left diagonal
  ];

  // Which internal seams a cell's shape contains.
  function cellSeps(p: ParsedCell): Sep[] {
    switch (p.kind) {
      case "line":
      case "triangle":
        return [p.type];
      case "xline":
      case "quad":
        return ["nwse", "nesw"];
      case "hsplit":
        return ["hmid"];
      case "vsplit":
        return ["vmid"];
      case "xsplit":
        return ["hmid", "vmid"];
      case "midline":
        return [
          ...(p.h ? (["hmid"] as Sep[]) : []),
          ...(p.v ? (["vmid"] as Sep[]) : []),
        ];
      default:
        return []; // solid / qlines → single region
    }
  }

  // Existing colour of each of the 8 octants ("" when uncoloured / white).
  function octColors(p: ParsedCell): string[] {
    switch (p.kind) {
      case "solid":
        return Array(8).fill(p.color || "");
      case "triangle":
        return p.type === "nwse"
          ? [p.a, p.a, p.a, p.a, p.b, p.b, p.b, p.b]
          : [p.a, p.a, p.b, p.b, p.b, p.b, p.a, p.a];
      case "quad":
        return [
          p.top,
          p.top,
          p.right,
          p.right,
          p.bottom,
          p.bottom,
          p.left,
          p.left,
        ];
      case "hsplit":
        return [
          p.top,
          p.top,
          p.top,
          p.bottom,
          p.bottom,
          p.bottom,
          p.bottom,
          p.top,
        ];
      case "vsplit":
        return [
          p.left,
          p.right,
          p.right,
          p.right,
          p.right,
          p.left,
          p.left,
          p.left,
        ];
      case "xsplit":
        return [p.tl, p.tr, p.tr, p.br, p.br, p.bl, p.bl, p.tl];
      default:
        return Array(8).fill(""); // line / xline / midline / qlines
    }
  }

  // Re-encode a cell from its seam set + 8 octant colours, preserving seams.
  function encodeOct(seps: Sep[], oc: string[]): string {
    const has = (s: Sep) => seps.includes(s);
    if (has("nwse") && has("nesw")) {
      const t = oc[0],
        r = oc[2],
        b = oc[4],
        l = oc[6];
      if (!t && !r && !b && !l) return "xline";
      return encodeQuad(t, r, b, l);
    }
    if (has("hmid") && has("vmid")) {
      const tl = oc[0],
        tr = oc[1],
        br = oc[3],
        bl = oc[5];
      if (!tl && !tr && !br && !bl) return "seam-midline-hv";
      return encodeXSplit(tl, tr, bl, br);
    }
    if (has("nwse") || has("nesw")) {
      const type: "nwse" | "nesw" = has("nwse") ? "nwse" : "nesw";
      const a = oc[0],
        b = type === "nwse" ? oc[4] : oc[2];
      if (!a && !b) return `${type}-line`;
      return a === b ? a : encodeTriangle(type, a, b);
    }
    if (has("hmid")) {
      const t = oc[0],
        b = oc[3];
      if (!t && !b) return "seam-midline-h";
      return t === b ? t : encodeHSplit(t, b);
    }
    if (has("vmid")) {
      const l = oc[0],
        r = oc[1];
      if (!l && !r) return "seam-midline-v";
      return l === r ? l : encodeVSplit(l, r);
    }
    return oc[0]; // solid (single region)
  }

  // Which octant (0..7) a local click (x,y in 0..1) lands in.
  function octantOf(x: number, y: number): number {
    const a = (Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI;
    let t = (a + 135) % 360;
    if (t < 0) t += 360;
    return Math.floor(t / 45) % 8;
  }

  // Per-cell parse + seam-set caches.
  const parsedCache = new Array<ParsedCell | undefined>(cells.length);
  const sepCache = new Array<Sep[] | undefined>(cells.length);
  const getParsed = (k: number): ParsedCell =>
    (parsedCache[k] ??= parseCell(cells[k] ?? ""));
  const getSeps = (k: number): Sep[] => {
    const cached = sepCache[k];
    if (cached) return cached;
    const base = cellSeps(getParsed(k));
    const extra = seamSeps.get(k);
    const merged = extra ? Array.from(new Set<Sep>([...base, ...extra])) : base;
    return (sepCache[k] = merged);
  };

  const startRow = Math.max(0, Math.min(gridH - 1, Math.floor(clickGridY)));
  const startCol = Math.max(0, Math.min(gridW - 1, Math.floor(clickGridX)));
  const startK = startRow * gridW + startCol;
  const startOct = octantOf(clickGridX - startCol, clickGridY - startRow);

  // BFS over (cellIndex, octant).
  const visited = new Map<number, Set<number>>();
  const enqueue = (k: number, o: number): boolean => {
    let s = visited.get(k);
    if (!s) visited.set(k, (s = new Set()));
    if (s.has(o)) return false;
    s.add(o);
    return true;
  };

  const queue: Array<[number, number]> = [[startK, startOct]];
  enqueue(startK, startOct);

  while (queue.length > 0) {
    const [k, o] = queue.shift()!;
    const r = Math.floor(k / gridW);
    const c = k % gridW;
    const seps = getSeps(k);

    // Within-cell: clockwise + counter-clockwise ring neighbours, unless an
    // internal seam segment separates them.
    const cw = (o + 1) % 8;
    if (!seps.includes(SEP_CW[o]) && enqueue(k, cw)) queue.push([k, cw]);
    const ccw = (o + 7) % 8;
    if (!seps.includes(SEP_CW[ccw]) && enqueue(k, ccw)) queue.push([k, ccw]);

    // Across the cell boundary via this octant's outer half-edge.
    let nk = -1,
      no = -1,
      blocked = false;
    switch (o) {
      case 0: // top edge, left half → cell above, its O5
        if (r > 0) {
          nk = k - gridW;
          no = 5;
          blocked = hEdges.has(`${2 * r}:${c * 2}`);
        }
        break;
      case 1: // top edge, right half → above, O4
        if (r > 0) {
          nk = k - gridW;
          no = 4;
          blocked = hEdges.has(`${2 * r}:${c * 2 + 1}`);
        }
        break;
      case 2: // right edge, top half → right, O7
        if (c < gridW - 1) {
          nk = k + 1;
          no = 7;
          blocked = vEdges.has(`${r * 2}:${2 * (c + 1)}`);
        }
        break;
      case 3: // right edge, bottom half → right, O6
        if (c < gridW - 1) {
          nk = k + 1;
          no = 6;
          blocked = vEdges.has(`${r * 2 + 1}:${2 * (c + 1)}`);
        }
        break;
      case 4: // bottom edge, right half → below, O1
        if (r < gridH - 1) {
          nk = k + gridW;
          no = 1;
          blocked = hEdges.has(`${2 * (r + 1)}:${c * 2 + 1}`);
        }
        break;
      case 5: // bottom edge, left half → below, O0
        if (r < gridH - 1) {
          nk = k + gridW;
          no = 0;
          blocked = hEdges.has(`${2 * (r + 1)}:${c * 2}`);
        }
        break;
      case 6: // left edge, bottom half → left, O3
        if (c > 0) {
          nk = k - 1;
          no = 3;
          blocked = vEdges.has(`${r * 2 + 1}:${2 * c}`);
        }
        break;
      case 7: // left edge, top half → left, O2
        if (c > 0) {
          nk = k - 1;
          no = 2;
          blocked = vEdges.has(`${r * 2}:${2 * c}`);
        }
        break;
    }
    if (nk >= 0 && !blocked && enqueue(nk, no)) queue.push([nk, no]);
  }

  // A partially-snipped diagonal (clip range ≠ 0..1) does not cleanly divide
  // the cell, and the cell format has no "clipped diagonal + colour"
  // representation. Leave such cells untouched rather than silently promoting
  // them to a full diagonal / quad and losing the user's snip.
  const isClippedDiagonal = (p: ParsedCell): boolean =>
    (p.kind === "line" && (p.cs !== 0 || p.ce !== 1)) ||
    (p.kind === "xline" &&
      (p.nwseCs !== 0 || p.nwseCe !== 1 || p.neswCs !== 0 || p.neswCe !== 1));

  // Apply: paint the filled octants, then re-encode each touched cell.
  const next = [...cells];
  for (const [k, octs] of visited) {
    const p = getParsed(k);
    if (isClippedDiagonal(p)) continue;
    const oc = octColors(p);
    for (const o of octs) oc[o] = color;
    next[k] = encodeOct(getSeps(k), oc);
  }
  return next;
}

/**
 * Which of the 4 triangles was the click in?
 * Both diagonals divide the cell into top / right / bottom / left:
 *   above nwse-line AND above nesw-line → top
 *   above nwse-line AND below nesw-line → right
 *   below nwse-line AND below nesw-line → bottom
 *   below nwse-line AND above nesw-line → left
 */
function quadRegion(
  cx: number,
  cy: number,
  W: number,
  H: number,
): "top" | "right" | "bottom" | "left" {
  const aboveNwse = cy < cx * (H / W); // above the NW→SE diagonal
  const aboveNesw = cy < H - cx * (H / W); // above the NE→SW diagonal
  if (aboveNwse && aboveNesw) return "top";
  if (aboveNwse && !aboveNesw) return "right";
  if (!aboveNwse && !aboveNesw) return "bottom";
  return "left";
}

/** Which half of a NWSE cell was the click in? */
function nwseHalf(cx: number, cy: number, W: number, H: number): "a" | "b" {
  // Diagonal from (0,0) to (W,H). "a"=upper-right if cy < cx*(H/W)
  return cy < cx * (H / W) ? "a" : "b";
}

/** Which half of a NESW cell was the click in? */
function neswHalf(cx: number, cy: number, W: number, H: number): "a" | "b" {
  // Diagonal from (W,0) to (0,H). "a"=upper-left if cx*(H/W)+cy < H
  return cx * (H / W) + cy < H ? "a" : "b";
}

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex
    .replace("#", "")
    .match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyCells(w: number, h: number): string[] {
  return Array<string>(w * h).fill("");
}

function normalizeCells(cells: string[], total: number): string[] {
  const result = cells.slice(0, total).map((c) => c || "");
  while (result.length < total) result.push("");
  return result;
}

// CellShape is imported from @/components/CellShape above.

// ---------------------------------------------------------------------------
// Block grid (SVG)
// ---------------------------------------------------------------------------

export function BlockGrid({
  cells,
  gridW,
  gridH,
  onCellAction,
  gridLineOpacity,
  disabled,
  bgImage,
  bgVisible,
  bgScale = 1,
  bgOffX = 0,
  bgOffY = 0,
  bgAdjusting = false,
  onBgChange,
  panTool = false,
  seams = [],
  seamTool,
  onSeamToggle,
  snipTool,
  onSeamSnip,
  onDiagSnip,
  diagTool,
  seamOnly = false,
  cellPx: cellPxProp,
  blockBoundaryGridSize,
  blockBoundaryOpacity = 0,
  fabricUrlMap = {},
  imageFilter,
}: {
  cells: string[];
  gridW: number;
  gridH: number;
  onCellAction: (
    idx: number,
    cellX: number,
    cellY: number,
    cellPx: number,
  ) => void;
  gridLineOpacity: number;
  disabled?: boolean;
  bgImage?: string | null;
  bgVisible?: boolean;
  bgScale?: number;
  bgOffX?: number;
  bgOffY?: number;
  bgAdjusting?: boolean;
  onBgChange?: (offX: number, offY: number, scale: number) => void;
  panTool?: boolean;
  seams?: SeamLine[];
  seamTool?: "h" | "v" | null;
  onSeamToggle?: (axis: "h" | "v", pos: number, cellIdx: number) => void;
  snipTool?: boolean;
  onSeamSnip?: (
    idx: number,
    clipStart: number,
    clipEnd: number,
    tailIndices?: number[],
  ) => void;
  onDiagSnip?: (
    idx: number,
    diagType: "nwse" | "nesw",
    removeStart: number,
    removeEnd: number,
  ) => void;
  diagTool?: "nwse" | "nesw" | "qback" | "qfwd" | null;
  seamOnly?: boolean;
  cellPx?: number;
  blockBoundaryGridSize?: number;
  blockBoundaryOpacity?: number;
  fabricUrlMap?: Record<number, string>;
  imageFilter?: string;
}) {
  const isPainting = useRef(false);
  const containerRef = useRef<SVGSVGElement>(null);
  const bgDragRef = useRef<{
    startX: number;
    startY: number;
    ox: number;
    oy: number;
  } | null>(null);
  const [seamPreview, setSeamPreview] = useState<{
    pos: number;
    cellIdx: number;
  } | null>(null);
  const [diagPreview, setDiagPreview] = useState<{
    row: number;
    col: number;
    corner?: QDir;
  } | null>(null);
  type SnipPreview =
    | { kind: "seam"; seamIdx: number; removeStart: number; removeEnd: number }
    | {
        kind: "diag";
        row: number;
        col: number;
        diagType: "nwse" | "nesw";
        removeStart: number;
        removeEnd: number;
      };
  const [snipPreview, setSnipPreview] = useState<SnipPreview | null>(null);

  const CELL_PX =
    cellPxProp ?? Math.min(Math.floor(400 / Math.max(gridW, gridH)), 56);
  const HALF_PX = CELL_PX / 2;
  const totalPxW = CELL_PX * gridW;
  const totalPxH = CELL_PX * gridH;

  const strokeColor = `rgba(0,0,0,${gridLineOpacity / 100})`;
  const strokeWidth = gridLineOpacity === 0 ? 0 : 0.5;
  const hasBg = !!(bgImage && bgVisible && !seamOnly);
  const emptyFill = hasBg ? "transparent" : "#FFFFFF";

  const HIT = 10; // px proximity for snip hit-test

  function svgPos(
    e: React.MouseEvent<SVGSVGElement>,
  ): { x: number; y: number } | null {
    const svg = containerRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Snap to nearest half-cell in the perpendicular axis; determine the parallel cell index. */
  function getSeamTarget(
    e: React.MouseEvent<SVGSVGElement>,
  ): { pos: number; cellIdx: number } | null {
    const p = svgPos(e);
    if (!p) return null;
    if (seamTool === "h") {
      const pos = Math.max(0, Math.min(gridH * 2, Math.round(p.y / HALF_PX)));
      const cellIdx = Math.floor(p.x / CELL_PX);
      if (cellIdx < 0 || cellIdx >= gridW) return null;
      return { pos, cellIdx };
    } else if (seamTool === "v") {
      const pos = Math.max(0, Math.min(gridW * 2, Math.round(p.x / HALF_PX)));
      const cellIdx = Math.floor(p.y / CELL_PX);
      if (cellIdx < 0 || cellIdx >= gridH) return null;
      return { pos, cellIdx };
    }
    return null;
  }

  /**
   * For the snip tool: find the seam nearest the mouse (H/V SeamLine OR a diagonal cell seam),
   * locate its intersection with any crossing seam, and return which portion the click would remove.
   */
  function computeSnip(mouseX: number, mouseY: number): SnipPreview | null {
    // 1. Find the closest H/V SeamLine within HIT pixels
    let bestIdx = -1;
    let bestDist = Infinity;
    seams.forEach((seam, idx) => {
      const cs = seam.clipStart ?? 0,
        ce = seam.clipEnd ?? 1;
      if (seam.axis === "h") {
        const y = seam.pos * HALF_PX;
        const x1 = seam.cellIdx * CELL_PX + cs * CELL_PX,
          x2 = seam.cellIdx * CELL_PX + ce * CELL_PX;
        const dy = Math.abs(mouseY - y);
        if (
          dy < HIT &&
          mouseX >= x1 - HIT &&
          mouseX <= x2 + HIT &&
          dy < bestDist
        ) {
          bestDist = dy;
          bestIdx = idx;
        }
      } else {
        const x = seam.pos * HALF_PX;
        const y1 = seam.cellIdx * CELL_PX + cs * CELL_PX,
          y2 = seam.cellIdx * CELL_PX + ce * CELL_PX;
        const dx = Math.abs(mouseX - x);
        if (
          dx < HIT &&
          mouseY >= y1 - HIT &&
          mouseY <= y2 + HIT &&
          dx < bestDist
        ) {
          bestDist = dx;
          bestIdx = idx;
        }
      }
    });

    if (bestIdx !== -1) {
      // 2. Collect intersections of this H/V seam with crossing seams + diagonal cells
      const seam = seams[bestIdx];
      const cs = seam.clipStart ?? 0,
        ce = seam.clipEnd ?? 1;
      const intersections: number[] = [];

      seams.forEach((other, otherIdx) => {
        if (otherIdx === bestIdx) return;
        if (seam.axis === "h" && other.axis === "v") {
          const hc = seam.cellIdx,
            hp = seam.pos,
            vc = other.cellIdx,
            vp = other.pos;
          const ocs = other.clipStart ?? 0,
            oce = other.clipEnd ?? 1;
          if (
            vp >= 2 * hc &&
            vp <= 2 * (hc + 1) &&
            hp >= 2 * vc &&
            hp <= 2 * (vc + 1)
          ) {
            const frac = (vp - 2 * hc) / 2,
              otherFrac = (hp - 2 * vc) / 2;
            if (otherFrac >= ocs && otherFrac <= oce && frac > cs && frac < ce)
              intersections.push(frac);
          }
        } else if (seam.axis === "v" && other.axis === "h") {
          const vc = seam.cellIdx,
            vp = seam.pos,
            hc = other.cellIdx,
            hp = other.pos;
          const ocs = other.clipStart ?? 0,
            oce = other.clipEnd ?? 1;
          if (
            hp >= 2 * vc &&
            hp <= 2 * (vc + 1) &&
            vp >= 2 * hc &&
            vp <= 2 * (hc + 1)
          ) {
            const frac = (hp - 2 * vc) / 2,
              otherFrac = (vp - 2 * hc) / 2;
            if (otherFrac >= ocs && otherFrac <= oce && frac > cs && frac < ce)
              intersections.push(frac);
          }
        }
      });

      // Also check diagonal seam cells in the cell this seam passes through
      if (seam.axis === "h") {
        const hRow = Math.floor(seam.pos / 2),
          hCol = seam.cellIdx;
        if (hRow >= 0 && hRow < gridH && hCol >= 0 && hCol < gridW) {
          const p = parseCell(cells[hRow * gridW + hCol] ?? "");
          const rowFrac = (seam.pos - 2 * hRow) / 2;
          if (p.kind === "line" || p.kind === "xline") {
            const hasNwse =
              p.kind === "xline" ? p.nwseCe > p.nwseCs : p.type === "nwse";
            const hasNesw =
              p.kind === "xline" ? p.neswCe > p.neswCs : p.type === "nesw";
            if (hasNwse) {
              const xf = rowFrac;
              if (xf > cs && xf < ce) intersections.push(xf);
            }
            if (hasNesw) {
              const xf = 1 - rowFrac;
              if (xf > cs && xf < ce && !intersections.includes(xf))
                intersections.push(xf);
            }
          }
        }
      } else {
        const vCol = Math.floor(seam.pos / 2),
          vRow = seam.cellIdx;
        if (vRow >= 0 && vRow < gridH && vCol >= 0 && vCol < gridW) {
          const p = parseCell(cells[vRow * gridW + vCol] ?? "");
          const colFrac = (seam.pos - 2 * vCol) / 2;
          if (p.kind === "line" || p.kind === "xline") {
            const hasNwse =
              p.kind === "xline" ? p.nwseCe > p.nwseCs : p.type === "nwse";
            const hasNesw =
              p.kind === "xline" ? p.neswCe > p.neswCs : p.type === "nesw";
            if (hasNwse) {
              const yf = colFrac;
              if (yf > cs && yf < ce) intersections.push(yf);
            }
            if (hasNesw) {
              const yf = 1 - colFrac;
              if (yf > cs && yf < ce && !intersections.includes(yf))
                intersections.push(yf);
            }
          }
        }
      }

      const clickFrac =
        seam.axis === "h"
          ? (mouseX - seam.cellIdx * CELL_PX) / CELL_PX
          : (mouseY - seam.cellIdx * CELL_PX) / CELL_PX;

      if (intersections.length > 0) {
        intersections.sort((a, b) => a - b);
        let nearestFrac = intersections[0];
        for (const f of intersections) {
          if (Math.abs(clickFrac - f) < Math.abs(clickFrac - nearestFrac))
            nearestFrac = f;
        }
        return clickFrac <= nearestFrac
          ? {
              kind: "seam",
              seamIdx: bestIdx,
              removeStart: cs,
              removeEnd: nearestFrac,
            }
          : {
              kind: "seam",
              seamIdx: bestIdx,
              removeStart: nearestFrac,
              removeEnd: ce,
            };
      }

      // No crossing seam — cut at click position, remove the tail toward the nearest end
      const mid = (cs + ce) / 2;
      return clickFrac <= mid
        ? {
            kind: "seam",
            seamIdx: bestIdx,
            removeStart: cs,
            removeEnd: clickFrac,
          }
        : {
            kind: "seam",
            seamIdx: bestIdx,
            removeStart: clickFrac,
            removeEnd: ce,
          };
    }

    // 3. Check for diagonal seam cells (nwse-line / nesw-line / xline)
    const col = Math.floor(mouseX / CELL_PX);
    const row = Math.floor(mouseY / CELL_PX);
    if (col >= 0 && col < gridW && row >= 0 && row < gridH) {
      const p = parseCell(cells[row * gridW + col] ?? "");
      const cellX = mouseX - col * CELL_PX;
      const cellY = mouseY - row * CELL_PX;
      // Perpendicular distance to each diagonal
      const dNwse = Math.abs(cellY - cellX) / Math.SQRT2;
      const dNesw = Math.abs(cellY + cellX - CELL_PX) / Math.SQRT2;

      type DiagCandidate = {
        diagType: "nwse" | "nesw";
        dist: number;
        cs: number;
        ce: number;
      };
      const candidates: DiagCandidate[] = [];
      if (p.kind === "line" && dNwse < HIT && p.type === "nwse")
        candidates.push({ diagType: "nwse", dist: dNwse, cs: p.cs, ce: p.ce });
      if (p.kind === "line" && dNesw < HIT && p.type === "nesw")
        candidates.push({ diagType: "nesw", dist: dNesw, cs: p.cs, ce: p.ce });
      if (p.kind === "xline") {
        if (dNwse < HIT)
          candidates.push({
            diagType: "nwse",
            dist: dNwse,
            cs: p.nwseCs,
            ce: p.nwseCe,
          });
        if (dNesw < HIT)
          candidates.push({
            diagType: "nesw",
            dist: dNesw,
            cs: p.neswCs,
            ce: p.neswCe,
          });
      }

      if (candidates.length > 0) {
        const { diagType, cs, ce } = candidates.sort(
          (a, b) => a.dist - b.dist,
        )[0];
        // Find H/V seam intersections with this diagonal in this cell
        const diagIntersections: number[] = [];
        for (const s of seams) {
          if (s.axis === "h" && s.cellIdx === col) {
            const sp = s.pos;
            if (sp > 2 * row && sp < 2 * (row + 1)) {
              const t = (sp - 2 * row) / 2; // H seam crosses both diagonals at same rowFrac
              if (t > cs && t < ce) diagIntersections.push(t);
            }
          } else if (s.axis === "v" && s.cellIdx === row) {
            const sp = s.pos;
            if (sp > 2 * col && sp < 2 * (col + 1)) {
              const tRaw = (sp - 2 * col) / 2;
              const t = diagType === "nesw" ? 1 - tRaw : tRaw;
              if (t > cs && t < ce) diagIntersections.push(t);
            }
          }
        }
        // Always include the half-cell midpoint as a virtual snap target so you can
        // snip a diagonal exactly in half even without a crossing H/V seam present.
        if (0.5 > cs && 0.5 < ce && !diagIntersections.includes(0.5))
          diagIntersections.push(0.5);
        // Click fraction along the diagonal (projection onto its direction)
        const clickFrac =
          diagType === "nwse"
            ? (cellX + cellY) / (2 * CELL_PX)
            : (cellY + CELL_PX - cellX) / (2 * CELL_PX);
        if (diagIntersections.length === 0) {
          // No snap points available — cut at exact click position
          const mid = (cs + ce) / 2;
          return clickFrac <= mid
            ? {
                kind: "diag",
                row,
                col,
                diagType,
                removeStart: cs,
                removeEnd: clickFrac,
              }
            : {
                kind: "diag",
                row,
                col,
                diagType,
                removeStart: clickFrac,
                removeEnd: ce,
              };
        }
        diagIntersections.sort((a, b) => a - b);
        let nearest = diagIntersections[0];
        for (const f of diagIntersections) {
          if (Math.abs(clickFrac - f) < Math.abs(clickFrac - nearest))
            nearest = f;
        }
        return clickFrac <= nearest
          ? {
              kind: "diag",
              row,
              col,
              diagType,
              removeStart: cs,
              removeEnd: nearest,
            }
          : {
              kind: "diag",
              row,
              col,
              diagType,
              removeStart: nearest,
              removeEnd: ce,
            };
      }
    }

    return null;
  }

  function dataFromEvent(
    e: React.MouseEvent<SVGSVGElement>,
  ): { idx: number; cellX: number; cellY: number } | null {
    const p = svgPos(e);
    if (!p) return null;
    const col = Math.floor(p.x / CELL_PX);
    const row = Math.floor(p.y / CELL_PX);
    if (col < 0 || col >= gridW || row < 0 || row >= gridH) return null;
    return {
      idx: row * gridW + col,
      cellX: p.x - col * CELL_PX,
      cellY: p.y - row * CELL_PX,
    };
  }

  function fire(e: React.MouseEvent<SVGSVGElement>) {
    if (disabled) return;
    const d = dataFromEvent(e);
    if (d) onCellAction(d.idx, d.cellX, d.cellY, CELL_PX);
  }

  const cursorClass = snipTool
    ? "cursor-pointer"
    : panTool
      ? "cursor-grab"
      : "cursor-crosshair";

  return (
    <svg
      ref={containerRef}
      width={totalPxW}
      height={totalPxH}
      className={`touch-none select-none rounded border border-border ${cursorClass}`}
      style={{ maxWidth: "100%" }}
      data-grid-export="true"
      onMouseDown={(e) => {
        if (panTool) return;
        if (snipTool) {
          const p = svgPos(e);
          if (p) {
            const preview = computeSnip(p.x, p.y);
            if (preview) {
              if (preview.kind === "seam") {
                const seam = seams[preview.seamIdx];
                const cs = seam.clipStart ?? 0,
                  ce = seam.clipEnd ?? 1;
                const removedRight = Math.abs(preview.removeEnd - ce) < 0.001;
                const removedLeft = Math.abs(preview.removeStart - cs) < 0.001;
                const newCS = removedRight ? cs : preview.removeEnd;
                const newCE = removedRight ? preview.removeStart : ce;
                // Collect consecutive adjacent segments in the tail direction so the
                // entire tail (not just the clipped cell) is removed in one click.
                const tailIndices: number[] = [];
                const step = removedRight ? 1 : removedLeft ? -1 : 0;
                if (step !== 0) {
                  const peerMap = new Map<number, number>();
                  seams.forEach((s, i) => {
                    if (
                      i !== preview.seamIdx &&
                      s.axis === seam.axis &&
                      s.pos === seam.pos
                    )
                      peerMap.set(s.cellIdx, i);
                  });
                  let curr = seam.cellIdx + step;
                  while (peerMap.has(curr)) {
                    tailIndices.push(peerMap.get(curr)!);
                    curr += step;
                  }
                }
                onSeamSnip?.(preview.seamIdx, newCS, newCE, tailIndices);
              } else {
                onDiagSnip?.(
                  preview.row * gridW + preview.col,
                  preview.diagType,
                  preview.removeStart,
                  preview.removeEnd,
                );
              }
              setSnipPreview(null);
            }
          }
          return;
        }
        if (seamTool) {
          const t = getSeamTarget(e);
          if (t) onSeamToggle?.(seamTool, t.pos, t.cellIdx);
          return;
        }
        if (diagTool) {
          fire(e);
          return;
        }
        if (disabled) return;
        isPainting.current = true;
        fire(e);
      }}
      onMouseMove={(e) => {
        if (snipTool) {
          const p = svgPos(e);
          setSnipPreview(p ? computeSnip(p.x, p.y) : null);
          return;
        }
        if (seamTool) {
          setSeamPreview(getSeamTarget(e));
          return;
        }
        if (diagTool) {
          const p = svgPos(e);
          if (p) {
            const col = Math.floor(p.x / CELL_PX);
            const row = Math.floor(p.y / CELL_PX);
            const inBounds = col >= 0 && col < gridW && row >= 0 && row < gridH;
            const corner =
              (diagTool === "qback" || diagTool === "qfwd") && inBounds
                ? quarterDirForClick(
                    diagTool === "qback" ? "back" : "fwd",
                    (p.x - col * CELL_PX) / CELL_PX,
                    (p.y - row * CELL_PX) / CELL_PX,
                  )
                : undefined;
            setDiagPreview(inBounds ? { row, col, corner } : null);
          }
          return;
        }
        if (disabled || !isPainting.current) return;
        fire(e);
      }}
      onMouseUp={() => {
        isPainting.current = false;
      }}
      onMouseLeave={() => {
        isPainting.current = false;
        setSeamPreview(null);
        setSnipPreview(null);
        setDiagPreview(null);
      }}
    >
      {hasBg && (
        <image
          href={bgImage!}
          x={bgOffX}
          y={bgOffY}
          width={totalPxW * bgScale}
          height={totalPxH * bgScale}
          preserveAspectRatio="xMidYMid slice"
        />
      )}
      {/* Fabric fill patterns — one <pattern> per unique fabric found in cells */}
      {fabricUrlMap &&
        (() => {
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
          if (ids.size === 0) return null;
          return (
            <defs>
              {Array.from(ids).map((id) => (
                <pattern
                  key={id}
                  id={`fab-${id}`}
                  patternUnits="objectBoundingBox"
                  patternContentUnits="objectBoundingBox"
                  x="0"
                  y="0"
                  width="1"
                  height="1"
                >
                  <image
                    href={fabricUrlMap[id]}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="xMidYMid slice"
                    style={imageFilter ? { filter: imageFilter } : undefined}
                  />
                </pattern>
              ))}
            </defs>
          );
        })()}
      {cells.map((cell, i) => {
        const row = Math.floor(i / gridW);
        const col = i % gridW;
        const displayCell = seamOnly
          ? (() => {
              const p = parseCell(cell);
              if (p.kind === "line" || p.kind === "xline") return cell;
              if (p.kind === "triangle")
                return p.type === "nwse" ? "nwse-line" : "nesw-line";
              if (p.kind === "quad") return "xline";
              if (p.kind === "hsplit") return "seam-midline-h";
              if (p.kind === "vsplit") return "seam-midline-v";
              if (p.kind === "xsplit") return "seam-midline-hv";
              return "";
            })()
          : cell;
        return (
          <CellShape
            key={i}
            x={col * CELL_PX}
            y={row * CELL_PX}
            W={CELL_PX}
            H={CELL_PX}
            cell={displayCell}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            emptyFill={emptyFill}
            fabricUrlMap={fabricUrlMap}
          />
        );
      })}
      {/* Drawn seam segments — each spans exactly one cell; optionally clipped at an intersection */}
      {seams.map(({ axis, pos, cellIdx, clipStart, clipEnd }, i) => {
        const coord = pos * HALF_PX;
        const cs = clipStart ?? 0;
        const ce = clipEnd ?? 1;
        if (axis === "h") {
          const x1 = cellIdx * CELL_PX + cs * CELL_PX;
          const x2 = cellIdx * CELL_PX + ce * CELL_PX;
          return (
            <line
              key={`h:${pos}:${cellIdx}:${i}`}
              x1={x1}
              y1={coord}
              x2={x2}
              y2={coord}
              stroke={SEAM_COLOR}
              strokeWidth={1.5}
            />
          );
        } else {
          const y1 = cellIdx * CELL_PX + cs * CELL_PX;
          const y2 = cellIdx * CELL_PX + ce * CELL_PX;
          return (
            <line
              key={`v:${pos}:${cellIdx}:${i}`}
              x1={coord}
              y1={y1}
              x2={coord}
              y2={y2}
              stroke={SEAM_COLOR}
              strokeWidth={1.5}
            />
          );
        }
      })}
      {/* Hover snap preview (seam placement) */}
      {seamPreview !== null &&
        seamTool &&
        (() => {
          const { pos, cellIdx } = seamPreview;
          const coord = pos * HALF_PX;
          if (seamTool === "h") {
            const x1 = cellIdx * CELL_PX,
              x2 = (cellIdx + 1) * CELL_PX;
            return (
              <line
                x1={x1}
                y1={coord}
                x2={x2}
                y2={coord}
                stroke={SEAM_COLOR}
                strokeWidth={1.5}
                strokeDasharray="5,3"
                opacity={0.5}
                pointerEvents="none"
              />
            );
          } else {
            const y1 = cellIdx * CELL_PX,
              y2 = (cellIdx + 1) * CELL_PX;
            return (
              <line
                x1={coord}
                y1={y1}
                x2={coord}
                y2={y2}
                stroke={SEAM_COLOR}
                strokeWidth={1.5}
                strokeDasharray="5,3"
                opacity={0.5}
                pointerEvents="none"
              />
            );
          }
        })()}
      {/* Hover snap preview (diagonal seam placement — full corner-to-corner) */}
      {diagPreview !== null &&
        diagTool &&
        (() => {
          const { row, col } = diagPreview;
          const x = col * CELL_PX,
            y = row * CELL_PX;
          const W = CELL_PX,
            H = CELL_PX;
          const dp = {
            stroke: SEAM_COLOR,
            strokeWidth: 1.5,
            strokeDasharray: "5,3",
            opacity: 0.5,
            pointerEvents: "none" as const,
          };
          if (diagTool === "nwse")
            return <line {...dp} x1={x} y1={y} x2={x + W} y2={y + H} />;
          if (diagTool === "nesw")
            return <line {...dp} x1={x + W} y1={y} x2={x} y2={y + H} />;
          const c = diagPreview.corner;
          if (c === "ne")
            return (
              <line {...dp} x1={x + W / 2} y1={y} x2={x + W} y2={y + H / 2} />
            );
          if (c === "se")
            return (
              <line
                {...dp}
                x1={x + W}
                y1={y + H / 2}
                x2={x + W / 2}
                y2={y + H}
              />
            );
          if (c === "sw")
            return (
              <line {...dp} x1={x + W / 2} y1={y + H} x2={x} y2={y + H / 2} />
            );
          if (c === "nw")
            return <line {...dp} x1={x} y1={y + H / 2} x2={x + W / 2} y2={y} />;
          return null;
        })()}
      {/* Snip preview — red dashed overlay on the portion that would be removed */}
      {snipTool &&
        snipPreview &&
        (() => {
          if (snipPreview.kind === "seam") {
            const seam = seams[snipPreview.seamIdx];
            if (!seam) return null;
            const coord = seam.pos * HALF_PX;
            if (seam.axis === "h") {
              const x1 =
                seam.cellIdx * CELL_PX + snipPreview.removeStart * CELL_PX;
              const x2 =
                seam.cellIdx * CELL_PX + snipPreview.removeEnd * CELL_PX;
              return (
                <line
                  x1={x1}
                  y1={coord}
                  x2={x2}
                  y2={coord}
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  strokeDasharray="4,2"
                  opacity={0.85}
                  pointerEvents="none"
                />
              );
            } else {
              const y1 =
                seam.cellIdx * CELL_PX + snipPreview.removeStart * CELL_PX;
              const y2 =
                seam.cellIdx * CELL_PX + snipPreview.removeEnd * CELL_PX;
              return (
                <line
                  x1={coord}
                  y1={y1}
                  x2={coord}
                  y2={y2}
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  strokeDasharray="4,2"
                  opacity={0.85}
                  pointerEvents="none"
                />
              );
            }
          } else {
            // Diagonal snip preview
            const { row, col, diagType, removeStart, removeEnd } = snipPreview;
            const ox = col * CELL_PX,
              oy = row * CELL_PX;
            if (diagType === "nwse") {
              return (
                <line
                  x1={ox + removeStart * CELL_PX}
                  y1={oy + removeStart * CELL_PX}
                  x2={ox + removeEnd * CELL_PX}
                  y2={oy + removeEnd * CELL_PX}
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  strokeDasharray="4,2"
                  opacity={0.85}
                  pointerEvents="none"
                />
              );
            } else {
              return (
                <line
                  x1={ox + (1 - removeStart) * CELL_PX}
                  y1={oy + removeStart * CELL_PX}
                  x2={ox + (1 - removeEnd) * CELL_PX}
                  y2={oy + removeEnd * CELL_PX}
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  strokeDasharray="4,2"
                  opacity={0.85}
                  pointerEvents="none"
                />
              );
            }
          }
        })()}

      {/* Block boundary overlay (whole-quilt mode) */}
      {!!blockBoundaryGridSize &&
        blockBoundaryOpacity > 0 &&
        (() => {
          const bgs = blockBoundaryGridSize;
          const bop = blockBoundaryOpacity / 100;
          const numCols = Math.round(gridW / bgs);
          const numRows = Math.round(gridH / bgs);
          return (
            <>
              {Array.from({ length: numCols - 1 }, (_, i) => (
                <line
                  key={`bvc-${i}`}
                  x1={(i + 1) * bgs * CELL_PX}
                  y1={0}
                  x2={(i + 1) * bgs * CELL_PX}
                  y2={totalPxH}
                  stroke={SEAM_COLOR}
                  strokeWidth={2}
                  opacity={bop}
                  pointerEvents="none"
                />
              ))}
              {Array.from({ length: numRows - 1 }, (_, i) => (
                <line
                  key={`bhr-${i}`}
                  x1={0}
                  y1={(i + 1) * bgs * CELL_PX}
                  x2={totalPxW}
                  y2={(i + 1) * bgs * CELL_PX}
                  stroke={SEAM_COLOR}
                  strokeWidth={2}
                  opacity={bop}
                  pointerEvents="none"
                />
              ))}
              <rect
                x={0}
                y={0}
                width={totalPxW}
                height={totalPxH}
                fill="none"
                stroke={SEAM_COLOR}
                strokeWidth={2.5}
                opacity={bop}
                pointerEvents="none"
              />
            </>
          );
        })()}

      {/* Drag overlay — active when adjusting background position or pan tool is selected */}
      {(bgAdjusting || panTool) && hasBg && (
        <rect
          x={0}
          y={0}
          width={totalPxW}
          height={totalPxH}
          fill="transparent"
          style={{ cursor: bgDragRef.current ? "grabbing" : "grab" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            bgDragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              ox: bgOffX,
              oy: bgOffY,
            };
          }}
          onPointerMove={(e) => {
            if (!bgDragRef.current) return;
            const dx = e.clientX - bgDragRef.current.startX;
            const dy = e.clientY - bgDragRef.current.startY;
            onBgChange?.(
              bgDragRef.current.ox + dx,
              bgDragRef.current.oy + dy,
              bgScale,
            );
          }}
          onPointerUp={() => {
            bgDragRef.current = null;
          }}
          onWheel={(e) => {
            e.preventDefault();
            const svg = containerRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const cx = (e.clientX - rect.left) * (totalPxW / rect.width);
            const cy = (e.clientY - rect.top) * (totalPxH / rect.height);
            const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newScale = Math.min(4, Math.max(0.25, bgScale * delta));
            const newOffX = cx - (cx - bgOffX) * (newScale / bgScale);
            const newOffY = cy - (cy - bgOffY) * (newScale / bgScale);
            onBgChange?.(newOffX, newOffY, newScale);
          }}
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tiled preview
// ---------------------------------------------------------------------------

function TiledPreview({
  cells,
  gridW,
  gridH,
  tileCols = 3,
  tileRows = 3,
  maxPx = 224,
  cellPx: cellPxProp,
  seams = [],
  seamOnly = false,
  bgImage,
  bgVisible = true,
  bgScale = 1,
  bgOffX = 0,
  bgOffY = 0,
  fabricUrlMap = {},
  imageFilter,
}: {
  cells: string[];
  gridW: number;
  gridH: number;
  tileCols?: number;
  tileRows?: number;
  maxPx?: number;
  cellPx?: number;
  seams?: SeamLine[];
  seamOnly?: boolean;
  bgImage?: string | null;
  bgVisible?: boolean;
  bgScale?: number;
  bgOffX?: number;
  bgOffY?: number;
  fabricUrlMap?: Record<number, string>;
  imageFilter?: string;
}) {
  const cellPx =
    cellPxProp ??
    Math.floor(maxPx / (Math.max(gridW, gridH) * Math.max(tileCols, tileRows)));
  const svgW = cellPx * gridW * tileCols;
  const svgH = cellPx * gridH * tileRows;
  const seamSW = Math.max(0.5, (1.5 * cellPx) / 28);
  const hasBg = !!(bgImage && bgVisible && !seamOnly);
  // Designer uses CELL_PX = min(floor(400/max(gridW,gridH)), 56); derive ratio to scale bg coords
  const CELL_PX_D = Math.min(Math.floor(400 / Math.max(gridW, gridH)), 56);
  const ratio = CELL_PX_D > 0 ? cellPx / CELL_PX_D : 1;
  const tileW = gridW * cellPx;
  const tileH = gridH * cellPx;
  return (
    <svg
      width={svgW}
      height={svgH}
      className="rounded border border-border bg-white"
    >
      {hasBg && (
        <defs>
          <pattern
            id="bgTile"
            x="0"
            y="0"
            width={tileW}
            height={tileH}
            patternUnits="userSpaceOnUse"
          >
            <image
              href={bgImage!}
              x={bgOffX * ratio}
              y={bgOffY * ratio}
              width={tileW * bgScale}
              height={tileH * bgScale}
              preserveAspectRatio="xMidYMid slice"
            />
          </pattern>
        </defs>
      )}
      {hasBg && <rect width={svgW} height={svgH} fill="url(#bgTile)" />}
      {/* Fabric fill patterns for tiled preview */}
      {Object.keys(fabricUrlMap).length > 0 &&
        (() => {
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
          if (ids.size === 0) return null;
          return (
            <defs>
              {Array.from(ids).map((id) => (
                <pattern
                  key={id}
                  id={`fab-${id}`}
                  patternUnits="objectBoundingBox"
                  patternContentUnits="objectBoundingBox"
                  x="0"
                  y="0"
                  width="1"
                  height="1"
                >
                  <image
                    href={fabricUrlMap[id]}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="xMidYMid slice"
                    style={imageFilter ? { filter: imageFilter } : undefined}
                  />
                </pattern>
              ))}
            </defs>
          );
        })()}
      {Array.from({ length: tileCols * tileRows }).map((_, tile) => {
        const tr = Math.floor(tile / tileCols);
        const tc = tile % tileCols;
        const ox = tc * gridW * cellPx;
        const oy = tr * gridH * cellPx;
        return (
          <g key={tile}>
            {cells.map((cell, i) => {
              const row = Math.floor(i / gridW);
              const col = i % gridW;
              const displayCell = seamOnly
                ? (() => {
                    const p = parseCell(cell);
                    if (p.kind === "line" || p.kind === "xline") return cell;
                    if (p.kind === "triangle")
                      return p.type === "nwse" ? "nwse-line" : "nesw-line";
                    if (p.kind === "quad") return "xline";
                    if (p.kind === "hsplit") return "seam-midline-h";
                    if (p.kind === "vsplit") return "seam-midline-v";
                    if (p.kind === "xsplit") return "seam-midline-hv";
                    return "";
                  })()
                : cell;
              return (
                <CellShape
                  key={i}
                  x={ox + col * cellPx}
                  y={oy + row * cellPx}
                  W={cellPx}
                  H={cellPx}
                  cell={displayCell}
                  stroke="rgba(0,0,0,0)"
                  strokeWidth={0}
                  emptyFill={hasBg ? "transparent" : "#FFFFFF"}
                  fabricUrlMap={fabricUrlMap}
                />
              );
            })}
            {seams.map((seam, si) => {
              const cs = seam.clipStart ?? 0,
                ce = seam.clipEnd ?? 1;
              if (seam.axis === "h") {
                const coord = oy + seam.pos * (cellPx / 2);
                const x1 = ox + seam.cellIdx * cellPx + cs * cellPx;
                const x2 = ox + seam.cellIdx * cellPx + ce * cellPx;
                return (
                  <line
                    key={si}
                    x1={x1}
                    y1={coord}
                    x2={x2}
                    y2={coord}
                    stroke="#4f46e5"
                    strokeWidth={seamSW}
                  />
                );
              } else {
                const coord = ox + seam.pos * (cellPx / 2);
                const y1 = oy + seam.cellIdx * cellPx + cs * cellPx;
                const y2 = oy + seam.cellIdx * cellPx + ce * cellPx;
                return (
                  <line
                    key={si}
                    x1={coord}
                    y1={y1}
                    x2={coord}
                    y2={y2}
                    stroke="#4f46e5"
                    strokeWidth={seamSW}
                  />
                );
              }
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Custom colour picker (hex + RGB)
// ---------------------------------------------------------------------------

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  // `previewColor` is what the user is currently mixing — updated live as they type.
  // It only becomes the active paint colour when they click "Use this colour".
  const [previewColor, setPreviewColor] = useState(value);
  const previewRgb = hexToRgb(previewColor) ?? [255, 255, 255];
  const [hexInput, setHexInput] = useState(value);
  const [rInput, setRInput] = useState(String(previewRgb[0]));
  const [gInput, setGInput] = useState(String(previewRgb[1]));
  const [bInput, setBInput] = useState(String(previewRgb[2]));

  // When the active colour changes from outside (palette click, eyedropper),
  // sync the preview to match so the picker feels in step.
  useEffect(() => {
    setPreviewColor(value);
    setHexInput(value);
    const c = hexToRgb(value);
    if (c) {
      setRInput(String(c[0]));
      setGInput(String(c[1]));
      setBInput(String(c[2]));
    }
  }, [value]);

  /** Update previewColor from a hex string (live, no apply yet). */
  function updatePreviewFromHex(raw: string) {
    const hex = raw.startsWith("#") ? raw : "#" + raw;
    const c = hexToRgb(hex);
    if (c) {
      const normalized = hex.toLowerCase();
      setPreviewColor(normalized);
      setRInput(String(c[0]));
      setGInput(String(c[1]));
      setBInput(String(c[2]));
    }
  }

  /** Update previewColor from R/G/B values (live, no apply yet). */
  function updatePreviewFromRgb(r: string, g: string, b: string) {
    const hex = rgbToHex(parseInt(r) || 0, parseInt(g) || 0, parseInt(b) || 0);
    setPreviewColor(hex);
    setHexInput(hex);
  }

  /** Push the preview colour to the active paint colour. */
  function applyPreview() {
    onChange(previewColor);
  }

  const previewMatchesCurrent =
    previewColor.toLowerCase() === value.toLowerCase();

  return (
    <div className="space-y-3">
      {/* Preview swatch + apply button */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
        {/* Current colour */}
        <div className="flex flex-col items-center gap-0.5">
          <div
            className="h-8 w-8 rounded border border-border shadow-sm"
            style={{ backgroundColor: value }}
            title="Current active colour"
          />
          <span className="text-[10px] text-muted-foreground">Active</span>
        </div>
        <span className="text-muted-foreground">→</span>
        {/* Preview colour */}
        <div className="flex flex-col items-center gap-0.5">
          <div
            className="h-8 w-8 rounded border-2 border-primary shadow-sm"
            style={{ backgroundColor: previewColor }}
            title="Preview of colour being mixed"
          />
          <span className="text-[10px] text-muted-foreground">Preview</span>
        </div>
        <Button
          size="sm"
          className="ml-auto h-8 text-xs"
          onClick={applyPreview}
          disabled={previewMatchesCurrent}
          title="Set this as the active paint colour"
        >
          Use this colour
        </Button>
      </div>

      {/* Hex input */}
      <div className="flex items-center gap-2">
        <Label className="w-7 shrink-0 text-xs text-muted-foreground">
          Hex
        </Label>
        <Input
          value={hexInput}
          onChange={(e) => {
            setHexInput(e.target.value);
            updatePreviewFromHex(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && applyPreview()}
          className="h-7 font-mono text-xs"
          maxLength={7}
          placeholder="#RRGGBB"
        />
      </div>
      {/* Native colour wheel — applies immediately since it's already visual */}
      <div className="flex items-center gap-2">
        <Label className="w-7 shrink-0 text-xs text-muted-foreground">
          Wheel
        </Label>
        <input
          type="color"
          value={previewColor}
          onChange={(e) => {
            const hex = e.target.value;
            setPreviewColor(hex);
            setHexInput(hex);
            const c = hexToRgb(hex);
            if (c) {
              setRInput(String(c[0]));
              setGInput(String(c[1]));
              setBInput(String(c[2]));
            }
          }}
          className="h-7 w-16 cursor-pointer rounded border border-border bg-transparent p-0.5"
          title="Colour wheel — updates preview"
        />
      </div>
      {/* RGB inputs */}
      {(
        [
          ["R", rInput, setRInput],
          ["G", gInput, setGInput],
          ["B", bInput, setBInput],
        ] as [string, string, (v: string) => void][]
      ).map(([label, val, set]) => (
        <div key={label} className="flex items-center gap-2">
          <Label className="w-7 shrink-0 text-xs text-muted-foreground">
            {label}
          </Label>
          <Input
            value={val}
            onChange={(e) => {
              set(e.target.value);
              updatePreviewFromRgb(
                label === "R" ? e.target.value : rInput,
                label === "G" ? e.target.value : gInput,
                label === "B" ? e.target.value : bInput,
              );
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyPreview();
            }}
            type="number"
            min={0}
            max={255}
            className="h-7 text-xs"
          />
          <div
            className="h-4 flex-1 rounded"
            style={{
              background:
                label === "R"
                  ? `linear-gradient(to right, ${rgbToHex(0, parseInt(gInput) || 0, parseInt(bInput) || 0)}, ${rgbToHex(255, parseInt(gInput) || 0, parseInt(bInput) || 0)})`
                  : label === "G"
                    ? `linear-gradient(to right, ${rgbToHex(parseInt(rInput) || 0, 0, parseInt(bInput) || 0)}, ${rgbToHex(parseInt(rInput) || 0, 255, parseInt(bInput) || 0)})`
                    : `linear-gradient(to right, ${rgbToHex(parseInt(rInput) || 0, parseInt(gInput) || 0, 0)}, ${rgbToHex(parseInt(rInput) || 0, parseInt(gInput) || 0, 255)})`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main designer page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inch formatting helper
// ---------------------------------------------------------------------------

function fmtInch(val: number): string {
  if (val === 0) return `0"`;
  const eighths = Math.round(val * 8) / 8;
  const whole = Math.floor(eighths);
  const frac = Math.round((eighths - whole) * 8);
  const fracMap: Record<number, string> = {
    1: "⅛",
    2: "¼",
    3: "⅜",
    4: "½",
    5: "⅝",
    6: "¾",
    7: "⅞",
  };
  if (frac === 0) return `${whole}"`;
  const fracStr = fracMap[frac] ?? `${frac}/8`;
  return whole > 0 ? `${whole}${fracStr}"` : `${fracStr}"`;
}

// ---------------------------------------------------------------------------
// Ruler strip (overlaid above and to the left of BlockGrid)
// ---------------------------------------------------------------------------

export const RULER_THICK = 22; // px, thickness of the ruler strip

export function BlockRuler({
  count,
  cellPx,
  blockSizeInches,
  orientation,
}: {
  count: number;
  cellPx: number;
  blockSizeInches: number | null;
  orientation: "h" | "v";
}) {
  const totalPx = cellPx * count;
  const cellInches = blockSizeInches !== null ? blockSizeInches / count : null;

  if (orientation === "h") {
    return (
      <svg
        width={totalPx}
        height={RULER_THICK}
        style={{ display: "block", userSelect: "none" }}
      >
        <rect
          width={totalPx}
          height={RULER_THICK}
          fill="hsl(var(--muted) / 0.5)"
        />
        {cellInches !== null
          ? // Size mode: label sits ON each tick line (0" … total"), aligned to stay in-bounds
            Array.from({ length: count + 1 }, (_, i) => {
              const x = i * cellPx;
              const anchor = i === 0 ? "start" : i === count ? "end" : "middle";
              return (
                <g key={i}>
                  <line
                    x1={x}
                    y1={RULER_THICK}
                    x2={x}
                    y2={RULER_THICK - 9}
                    stroke="#555"
                    strokeWidth={0.75}
                  />
                  <text
                    x={x}
                    y={RULER_THICK - 11}
                    textAnchor={anchor}
                    fontSize={8}
                    fill="#111"
                  >
                    {fmtInch(i * cellInches!)}
                  </text>
                </g>
              );
            })
          : // No-size mode: show cell index at cell centers
            Array.from({ length: count }, (_, i) => {
              const x = i * cellPx;
              return (
                <g key={i}>
                  <line
                    x1={x}
                    y1={RULER_THICK}
                    x2={x}
                    y2={RULER_THICK - 9}
                    stroke="#555"
                    strokeWidth={0.75}
                  />
                  <text
                    x={x + cellPx / 2}
                    y={RULER_THICK - 11}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#111"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
        <line
          x1={0}
          y1={RULER_THICK - 0.5}
          x2={totalPx}
          y2={RULER_THICK - 0.5}
          stroke="hsl(var(--border))"
          strokeWidth={0.5}
        />
      </svg>
    );
  }

  // Vertical ruler — labels rotated -90°.
  // After -90° rotation around (cx, y): textAnchor "end" → text extends downward in screen,
  // "start" → extends upward. So for i=0 (top edge) use "end", for i=count (bottom) use "start".
  return (
    <svg
      width={RULER_THICK}
      height={totalPx}
      style={{ display: "block", userSelect: "none" }}
    >
      <rect
        width={RULER_THICK}
        height={totalPx}
        fill="hsl(var(--muted) / 0.5)"
      />
      {cellInches !== null
        ? Array.from({ length: count + 1 }, (_, i) => {
            const y = i * cellPx;
            const anchor = i === 0 ? "end" : i === count ? "start" : "middle";
            return (
              <g key={i}>
                <line
                  y1={y}
                  x1={RULER_THICK}
                  y2={y}
                  x2={RULER_THICK - 9}
                  stroke="#555"
                  strokeWidth={0.75}
                />
                <text
                  x={RULER_THICK / 2}
                  y={y}
                  textAnchor={anchor}
                  dominantBaseline="central"
                  fontSize={8}
                  fill="#111"
                  transform={`rotate(-90 ${RULER_THICK / 2} ${y})`}
                >
                  {fmtInch(i * cellInches!)}
                </text>
              </g>
            );
          })
        : Array.from({ length: count }, (_, i) => {
            const y = i * cellPx;
            return (
              <g key={i}>
                <line
                  y1={y}
                  x1={RULER_THICK}
                  y2={y}
                  x2={RULER_THICK - 9}
                  stroke="#555"
                  strokeWidth={0.75}
                />
                <text
                  x={RULER_THICK / 2}
                  y={y + cellPx / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8}
                  fill="#111"
                  transform={`rotate(-90 ${RULER_THICK / 2} ${y + cellPx / 2})`}
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
      <line
        x1={RULER_THICK - 0.5}
        y1={0}
        x2={RULER_THICK - 0.5}
        y2={totalPx}
        stroke="hsl(var(--border))"
        strokeWidth={0.5}
      />
    </svg>
  );
}

export default function BlockDesigner() {
  const { id } = useParams<{ id?: string }>();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const isNew = !id || id === "new";
  const blockId = isNew ? null : Number(id);
  const templateMode = location.startsWith("/library/blocks");

  const { data: existingBlock, isLoading: loadingExistingBlock } = useGetBlock(
    !templateMode ? (blockId ?? 0) : 0,
    {
      query: {
        enabled: !templateMode,
        queryKey: getGetBlockQueryKey(!templateMode ? (blockId ?? 0) : 0),
      },
    },
  );
  const { data: existingTemplate, isLoading: loadingExistingTemplate } =
    useGetBlockTemplate(templateMode ? (blockId ?? 0) : 0, {
      query: {
        enabled: templateMode,
        queryKey: getGetBlockTemplateQueryKey(
          templateMode ? (blockId ?? 0) : 0,
        ),
      },
    });
  const existing = templateMode ? existingTemplate : existingBlock;
  const loadingExisting = templateMode
    ? loadingExistingTemplate
    : loadingExistingBlock;

  usePageAssistantContext(
    "quilting-block-designer",
    `Block Designer page (${templateMode ? "block library template" : "block"} ${
      isNew ? "creation" : `edit, id ${blockId}`
    }). This is a visual pixel-grid drawing tool for designing a quilt block's fabric layout, cell-by-cell — it cannot be operated via chat. If the user wants to design or edit a block's actual pattern/geometry here, tell them to use this page directly; you can create/delete blocks by name+size via tools, but you cannot draw or edit their grid content.`,
  );

  const [name, setName] = useState("Untitled block");
  const [templateTagsInput, setTemplateTagsInput] = useState("");
  const [blockSizeInches, setBlockSizeInches] = useState<number | null>(null);
  const [seamAllowanceInches, setSeamAllowanceInches] = useState<number>(0.25);
  const [gridW, setGridW] = useState(8);
  const [gridH, setGridH] = useState(8);
  const [cells, setCells] = useState<string[]>(() => makeEmptyCells(8, 8));
  const [selectedColor, setSelectedColor] = useState<string>("#c0392b");
  const [selectedColorB, setSelectedColorB] = useState<string>("#2980B9");
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const [tool, setTool] = useState<Tool>("paint");
  const [history, setHistory] = useState<
    Array<{ cells: string[]; seams: SeamLine[] }>
  >([]);
  const [gridLineOpacity, setGridLineOpacity] = useState(30);
  const [tileCols, setTileCols] = useState(3);
  const [tileRows, setTileRows] = useState(3);
  const [previewPane, setPreviewPane] = useState<
    "normal" | "collapsed" | "maximized"
  >("normal");
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgVisible, setBgVisible] = useState(true);
  const [bgScale, setBgScale] = useState(1);
  const [bgOffX, setBgOffX] = useState(0);
  const [bgOffY, setBgOffY] = useState(0);
  const [bgAdjusting, setBgAdjusting] = useState(false);
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const [viewFilter, setViewFilter] = useState<{
    brightness: number;
    contrast: number;
    saturation: number;
  }>({ brightness: 100, contrast: 100, saturation: 100 });
  const imageFilter = useMemo(
    () =>
      viewFilter.brightness === 100 &&
      viewFilter.contrast === 100 &&
      viewFilter.saturation === 100
        ? null
        : `brightness(${viewFilter.brightness}%) contrast(${viewFilter.contrast}%) saturate(${viewFilter.saturation}%)`,
    [viewFilter],
  );
  const prevToolRef = useRef<Tool | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const scanImportRef = useRef<HTMLInputElement>(null);
  const bgImgElRef = useRef<HTMLImageElement | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const dirtyEnabledRef = useRef(false);
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
  // Prevent background React Query refetches from overwriting the user's unsaved edits.
  // Set to true after the first successful data load; reset automatically on unmount (ref lifetime = component lifetime).
  const loadedOnceRef = useRef(false);
  // Canvas auto-sizing: measure the available grid area and compute the largest cell size that fits
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [canvasCellPx, setCanvasCellPx] = useState<number | null>(null);
  const [seams, setSeams] = useState<SeamLine[]>([]);
  // Popout zoom / pan (reset whenever popout opens)
  const [popZoom, setPopZoom] = useState(1);
  const [popPan, setPopPan] = useState({ x: 0, y: 0 });
  const popDragRef = useRef<{
    startX: number;
    startY: number;
    px: number;
    py: number;
  } | null>(null);
  // Measured size of the maximized preview viewport so the tiled layout can be
  // fitted to it while preserving its aspect ratio (square cells).
  const popViewRef = useRef<HTMLDivElement | null>(null);
  const [popViewSize, setPopViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (previewPane !== "maximized") return;
    const el = popViewRef.current;
    if (!el) return;
    const measure = () =>
      setPopViewSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewPane]);
  // Seams-only view: hide all colour fills, show only seam lines
  const [seamOnly, setSeamOnly] = useState(false);
  // Last active tool in each toolbar flyout group (Photoshop-style)
  const [lastSeamTool, setLastSeamTool] = useState<
    | "seam-h"
    | "seam-v"
    | "line-nwse"
    | "line-nesw"
    | "qline-back"
    | "qline-fwd"
    | "seam-snip"
  >("seam-h");
  const [lastTriTool, setLastTriTool] = useState<"tri-nwse" | "tri-nesw">(
    "tri-nwse",
  );
  // Floating panel windows in the right column
  type PanelId =
    | "tiled-preview"
    | "palette"
    | "custom-color"
    | "fabrics"
    | "categories";
  interface PanelWin {
    id: PanelId;
    title: string;
    open: boolean;
    minimized: boolean;
  }
  const [panels, setPanels] = useState<PanelWin[]>([
    {
      id: "tiled-preview",
      title: "Tiled Preview",
      open: true,
      minimized: false,
    },
    { id: "palette", title: "Palette", open: true, minimized: false },
    {
      id: "custom-color",
      title: "Custom Colour",
      open: true,
      minimized: false,
    },
    { id: "fabrics", title: "My Fabrics", open: true, minimized: false },
    ...(templateMode
      ? []
      : [
          {
            id: "categories" as const,
            title: "Categories",
            open: true,
            minimized: false,
          },
        ]),
  ]);
  const [dragPanelId, setDragPanelId] = useState<PanelId | null>(null);
  const [dragOverId, setDragOverId] = useState<PanelId | null>(null);

  function selectTool(t: Tool) {
    setTool(t);
    if (
      (
        [
          "seam-h",
          "seam-v",
          "line-nwse",
          "line-nesw",
          "qline-back",
          "qline-fwd",
          "seam-snip",
        ] as Tool[]
      ).includes(t)
    )
      setLastSeamTool(t as typeof lastSeamTool);
    if ((["tri-nwse", "tri-nesw"] as Tool[]).includes(t))
      setLastTriTool(t as "tri-nwse" | "tri-nesw");
  }

  function togglePanel(id: PanelId, key: "open" | "minimized") {
    setPanels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [key]: !p[key] } : p)),
    );
  }

  function movePanelUp(id: PanelId) {
    setPanels((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function movePanelDown(id: PanelId) {
    setPanels((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  const enterBgAdjust = useCallback(() => {
    prevToolRef.current = null;
    setTool((cur) => {
      prevToolRef.current = cur;
      return "pan";
    });
    setBgAdjusting(true);
  }, []);

  const exitBgAdjust = useCallback(() => {
    setBgAdjusting(false);
    setTool(prevToolRef.current ?? "paint");
    prevToolRef.current = null;
  }, []);

  const handleBgImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result;
        if (typeof result === "string") {
          setBgImage(result);
          setBgVisible(true);
          setBgScale(1);
          setBgOffX(0);
          setBgOffY(0);
          prevToolRef.current = null;
          setTool((cur) => {
            prevToolRef.current = cur;
            return "pan";
          });
          setBgAdjusting(true);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [],
  );

  const handleScanImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        canvas.width = gridW;
        canvas.height = gridH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          toast.error("Canvas not available.");
          return;
        }
        ctx.drawImage(img, 0, 0, gridW, gridH);
        const newCells: string[] = [];
        for (let row = 0; row < gridH; row++) {
          for (let col = 0; col < gridW; col++) {
            const [r, g, b, a] = ctx.getImageData(col, row, 1, 1).data;
            if ((a ?? 0) < 64) {
              newCells.push("");
            } else {
              newCells.push(
                `#${(r ?? 0).toString(16).padStart(2, "0")}${(g ?? 0).toString(16).padStart(2, "0")}${(b ?? 0).toString(16).padStart(2, "0")}`,
              );
            }
          }
        }
        setCells(newCells);
        toast.success(`Imported ${gridW}×${gridH} pixel colours from image.`);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast.error("Failed to load image for scan import.");
      };
      img.src = url;
    },
    [gridW, gridH],
  );

  const { data: fabricsList } = useListFabrics();
  const fabricUrlMap = useMemo(
    () => buildFabricUrlMap(fabricsList ?? []),
    [fabricsList],
  );
  const fabricTally = useMemo(
    () => computeFabricTally(cells, fabricsList ?? []),
    [cells, fabricsList],
  );
  const { data: allCategories } = useListQuiltingCategories();

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  useEffect(() => {
    // Only apply server data on the FIRST successful load per mount.
    // Background refetches (window focus, stale revalidation) must NOT overwrite
    // the user's in-progress edits — that would silently discard unsaved changes.
    if (existing && !loadedOnceRef.current) {
      loadedOnceRef.current = true;
      dirtyEnabledRef.current = false;
      setName(existing.name);
      if (templateMode) {
        const tpl = existing as QuiltingBlockTemplate;
        setGridW(tpl.gridW);
        setGridH(tpl.gridH);
        setCells(normalizeCells(tpl.cells, tpl.gridW * tpl.gridH));
        setSeams((tpl.seams as SeamLine[]) ?? []);
        setBlockSizeInches(tpl.blockSizeInches ?? null);
        setSeamAllowanceInches(tpl.seamAllowanceInches ?? 0.25);
        setTemplateTagsInput((tpl.tags ?? []).join(", "));
      } else {
        const blk = existing as QuiltingBlock;
        const w = blk.gridSize;
        const total = blk.cells.length;
        const h = total > 0 && total % w === 0 ? total / w : w;
        setGridW(w);
        setGridH(h);
        setCells(normalizeCells(blk.cells, w * h));
        setSeams((blk.seams as SeamLine[]) ?? []);
        setBlockSizeInches(blk.blockSizeInches ?? null);
        setSeamAllowanceInches(blk.seamAllowanceInches ?? 0.25);
        setSelectedCategoryIds(
          (blk.categories ?? []).map((c: QuiltingCategory) => c.id),
        );
      }
      setIsDirty(false);
      setTimeout(() => {
        dirtyEnabledRef.current = true;
      }, 0);
    }
  }, [existing]);

  // Enable dirty tracking for new blocks after initial render
  useEffect(() => {
    if (!isNew) return;
    const id = requestAnimationFrame(() => {
      dirtyEnabledRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark dirty whenever any user-editable state changes
  useEffect(() => {
    if (!dirtyEnabledRef.current) return;
    setIsDirty(true);
  }, [cells, name, seams, blockSizeInches, seamAllowanceInches]);

  // Measure the canvas container and derive the largest cell size that fits within it.
  // useLayoutEffect ensures we measure before the browser paints, eliminating the size flash.
  useLayoutEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const PADDING = 24; // p-3 = 12 px each side
    const RULER_SPACE = RULER_THICK + 4;
    const compute = () => {
      const availW = el.clientWidth - PADDING - RULER_SPACE;
      const availH = el.clientHeight - PADDING - RULER_SPACE;
      const cellW = Math.floor(availW / gridW);
      const cellH = Math.floor(availH / gridH);
      setCanvasCellPx(Math.max(20, Math.min(cellW, cellH)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridW, gridH]);

  // Pre-load the background image so the eyedropper can sample pixels from it
  useEffect(() => {
    if (!bgImage) {
      bgImgElRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImgElRef.current = img;
    };
    img.src = bgImage;
  }, [bgImage]);

  const pushHistory = useCallback(
    (prevCells: string[], prevSeams: SeamLine[]) =>
      setHistory((h) => [
        ...h.slice(-30),
        { cells: prevCells, seams: prevSeams },
      ]),
    [],
  );

  const handleCellAction = useCallback(
    (idx: number, cellX: number, cellY: number, cellPx: number) => {
      setCells((prev) => {
        const current = prev[idx] ?? "";

        if (tool === "eyedropper") {
          const setSlotColor =
            activeSlot === "a" ? setSelectedColor : setSelectedColorB;
          // When a background image is visible, sample its pixel at the click point
          const img = bgImgElRef.current;
          if (img && bgVisible) {
            const svgX = (idx % gridW) * cellPx + cellX;
            const svgY = Math.floor(idx / gridW) * cellPx + cellY;
            const fracX = (svgX - bgOffX) / (gridW * cellPx * bgScale);
            const fracY = (svgY - bgOffY) / (gridH * cellPx * bgScale);
            if (fracX >= 0 && fracX <= 1 && fracY >= 0 && fracY <= 1) {
              try {
                const offscreen = document.createElement("canvas");
                offscreen.width = 1;
                offscreen.height = 1;
                const ctx = offscreen.getContext("2d");
                if (ctx) {
                  ctx.drawImage(
                    img,
                    -Math.round(fracX * img.naturalWidth),
                    -Math.round(fracY * img.naturalHeight),
                  );
                  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                  setSlotColor(
                    `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
                  );
                  setTool("paint");
                  return prev;
                }
              } catch {
                /* fall through */
              }
            }
          }
          // No background (or outside bg bounds) — sample the cell's painted colour
          const parsed = parseCell(current);
          if (parsed.kind === "solid") {
            setSlotColor(parsed.color || "#FFFFFF");
          } else if (parsed.kind === "triangle") {
            const half =
              parsed.type === "nwse"
                ? nwseHalf(cellX, cellY, cellPx, cellPx)
                : neswHalf(cellX, cellY, cellPx, cellPx);
            setSlotColor((half === "a" ? parsed.a : parsed.b) || "#FFFFFF");
          } else if (parsed.kind === "quad") {
            setSlotColor(
              parsed[quadRegion(cellX, cellY, cellPx, cellPx)] || "#FFFFFF",
            );
          } else if (parsed.kind === "hsplit") {
            setSlotColor(
              (cellY < cellPx / 2 ? parsed.top : parsed.bottom) || "#FFFFFF",
            );
          } else if (parsed.kind === "vsplit") {
            setSlotColor(
              (cellX < cellPx / 2 ? parsed.left : parsed.right) || "#FFFFFF",
            );
          } else if (parsed.kind === "xsplit") {
            const subPos =
              cellX < cellPx / 2
                ? cellY < cellPx / 2
                  ? "tl"
                  : "bl"
                : cellY < cellPx / 2
                  ? "tr"
                  : "br";
            setSlotColor(parsed[subPos] || "#FFFFFF");
          }
          setTool("paint");
          return prev;
        }

        if (tool === "fill") {
          pushHistory(prev, seams);
          const row = Math.floor(idx / gridW);
          const col = idx % gridW;
          return seamFill(
            prev,
            gridW,
            gridH,
            col + cellX / cellPx,
            row + cellY / cellPx,
            selectedColor,
            seams,
          );
        }

        if (tool === "erase") {
          if (current === "") return prev;
          pushHistory(prev, seams);
          const next = [...prev];
          next[idx] = "";
          return next;
        }

        if (tool === "paint") {
          if (current === selectedColor) return prev;
          pushHistory(prev, seams);
          const next = [...prev];
          next[idx] = selectedColor;
          return next;
        }

        if (tool === "tri-nwse" || tool === "tri-nesw") {
          const triType = tool === "tri-nwse" ? "nwse" : "nesw";
          // Always paint "a" half with the L/T colour (selectedColor) and
          // "b" half with the R/B colour (selectedColorB). Click position
          // determines which cell to paint, not which colour goes where.
          const newCell = encodeTriangle(
            triType,
            selectedColor,
            selectedColorB,
          );
          if (current === newCell) return prev;
          pushHistory(prev, seams);
          const next = [...prev];
          next[idx] = newCell;
          return next;
        }

        if (tool === "line-nwse" || tool === "line-nesw") {
          const mineType =
            tool === "line-nwse" ? ("nwse" as const) : ("nesw" as const);
          const parsed = parseCell(current);

          // Extract current spans for both diagonals (invalid range = absent).
          let nwseCs = 1,
            nwseCe = 0,
            neswCs = 1,
            neswCe = 0;
          if (parsed.kind === "xline") {
            nwseCs = parsed.nwseCs;
            nwseCe = parsed.nwseCe;
            neswCs = parsed.neswCs;
            neswCe = parsed.neswCe;
          } else if (parsed.kind === "line") {
            if (parsed.type === "nwse") {
              nwseCs = parsed.cs;
              nwseCe = parsed.ce;
            } else {
              neswCs = parsed.cs;
              neswCe = parsed.ce;
            }
          }

          // Toggle: if this diagonal is already present (any span), remove it;
          // otherwise add the full corner-to-corner span (cs=0, ce=1).
          const present =
            mineType === "nwse"
              ? nwseCe > nwseCs + 0.001
              : neswCe > neswCs + 0.001;
          const newCs = present ? 1 : 0;
          const newCe = present ? 0 : 1;

          const next_val = encodeXline(
            mineType === "nwse" ? newCs : nwseCs,
            mineType === "nwse" ? newCe : nwseCe,
            mineType === "nesw" ? newCs : neswCs,
            mineType === "nesw" ? newCe : neswCe,
          );

          if (current === next_val) return prev;
          pushHistory(prev, seams);
          const nx = [...prev];
          nx[idx] = next_val;
          return nx;
        }

        if (tool === "qline-back" || tool === "qline-fwd") {
          const pair =
            tool === "qline-back" ? ("back" as const) : ("fwd" as const);
          const dir = quarterDirForClick(pair, cellX / cellPx, cellY / cellPx);
          const next = toggleQuarterLine(prev, idx, dir);
          if (next[idx] === current) return prev;
          pushHistory(prev, seams);
          return next;
        }

        return prev;
      });
    },
    [
      tool,
      selectedColor,
      selectedColorB,
      activeSlot,
      gridW,
      gridH,
      pushHistory,
      seams,
      bgVisible,
      bgOffX,
      bgOffY,
      bgScale,
    ],
  );

  const handleSeamToggle = useCallback(
    (axis: "h" | "v", pos: number, cellIdx: number) => {
      setSeams((prev) => {
        pushHistory(cells, prev);
        const exists = prev.some(
          (s) => s.axis === axis && s.pos === pos && s.cellIdx === cellIdx,
        );
        return exists
          ? prev.filter(
              (s) =>
                !(s.axis === axis && s.pos === pos && s.cellIdx === cellIdx),
            )
          : [...prev, { axis, pos, cellIdx }];
      });
    },
    [cells, pushHistory],
  );

  const handleSeamSnip = useCallback(
    (
      idx: number,
      clipStart: number,
      clipEnd: number,
      tailIndices: number[] = [],
    ) => {
      setSeams((prev) => {
        pushHistory(cells, prev);
        const deleteSet = new Set<number>(tailIndices);
        if (clipStart >= clipEnd - 0.001) deleteSet.add(idx);
        return prev
          .map((s, i) =>
            i === idx && clipStart < clipEnd - 0.001
              ? { ...s, clipStart, clipEnd }
              : s,
          )
          .filter((_, i) => !deleteSet.has(i));
      });
    },
    [cells, pushHistory],
  );

  const handleDiagSnip = useCallback(
    (
      idx: number,
      diagType: "nwse" | "nesw",
      removeStart: number,
      removeEnd: number,
    ) => {
      setCells((prev) => {
        pushHistory(prev, seams);
        const next = [...prev];
        const p = parseCell(next[idx] ?? "");
        // Determine clip range for this diagonal
        let cs = 0,
          ce = 1;
        if (p.kind === "line") {
          cs = p.cs;
          ce = p.ce;
        } else if (p.kind === "xline") {
          if (diagType === "nwse") {
            cs = p.nwseCs;
            ce = p.nwseCe;
          } else {
            cs = p.neswCs;
            ce = p.neswCe;
          }
        }
        // The portion to keep is the opposite side of what we're removing
        const keepCs = Math.abs(removeStart - cs) < 0.001 ? removeEnd : cs;
        const keepCe = Math.abs(removeEnd - ce) < 0.001 ? removeStart : ce;
        next[idx] = applyDiagClip(p, diagType, keepCs, keepCe);
        return next;
      });
    },
    [],
  );

  const handleAutoSeam = useCallback(
    (mode: "grid" | "contiguous") => {
      const newSeams: SeamLine[] = [];
      if (mode === "grid") {
        for (let row = 1; row < gridH; row++) {
          for (let col = 0; col < gridW; col++) {
            newSeams.push({ axis: "h", pos: 2 * row, cellIdx: col });
          }
        }
        for (let col = 1; col < gridW; col++) {
          for (let row = 0; row < gridH; row++) {
            newSeams.push({ axis: "v", pos: 2 * col, cellIdx: row });
          }
        }
      } else {
        // Contiguous: seam at every boundary between cells with different content
        for (let row = 0; row < gridH - 1; row++) {
          for (let col = 0; col < gridW; col++) {
            if (
              (cells[row * gridW + col] ?? "") !==
              (cells[(row + 1) * gridW + col] ?? "")
            ) {
              newSeams.push({ axis: "h", pos: 2 * (row + 1), cellIdx: col });
            }
          }
        }
        for (let row = 0; row < gridH; row++) {
          for (let col = 0; col < gridW - 1; col++) {
            if (
              (cells[row * gridW + col] ?? "") !==
              (cells[row * gridW + col + 1] ?? "")
            ) {
              newSeams.push({ axis: "v", pos: 2 * (col + 1), cellIdx: row });
            }
          }
        }
      }
      setSeams((prev) => {
        pushHistory(cells, prev);
        const existing = new Set(
          prev.map((s) => `${s.axis}:${s.pos}:${s.cellIdx}`),
        );
        return [
          ...prev,
          ...newSeams.filter(
            (s) => !existing.has(`${s.axis}:${s.pos}:${s.cellIdx}`),
          ),
        ];
      });
    },
    [gridW, gridH, cells, pushHistory],
  );

  function handleUndo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const entry = h[h.length - 1];
      setCells(entry.cells);
      setSeams(entry.seams);
      return h.slice(0, -1);
    });
  }

  function handleRotateCW() {
    pushHistory(cells, seams);
    const {
      cells: c,
      seams: s,
      newW,
      newH,
    } = applyRotate90CW(cells, seams, gridW, gridH);
    setGridW(newW);
    setGridH(newH);
    setCells(c);
    setSeams(s);
    setIsDirty(true);
  }

  function handleRotateCCW() {
    pushHistory(cells, seams);
    let c = cells,
      s = seams,
      w = gridW,
      h = gridH;
    for (let i = 0; i < 3; i++) {
      const r = applyRotate90CW(c, s, w, h);
      c = r.cells;
      s = r.seams;
      w = r.newW;
      h = r.newH;
    }
    setGridW(w);
    setGridH(h);
    setCells(c);
    setSeams(s);
    setIsDirty(true);
  }

  function handleRotate180() {
    pushHistory(cells, seams);
    let c = cells,
      s = seams,
      w = gridW,
      h = gridH;
    for (let i = 0; i < 2; i++) {
      const r = applyRotate90CW(c, s, w, h);
      c = r.cells;
      s = r.seams;
      w = r.newW;
      h = r.newH;
    }
    setGridW(w);
    setGridH(h);
    setCells(c);
    setSeams(s);
    setIsDirty(true);
  }

  function handleFlipHorizontal() {
    pushHistory(cells, seams);
    const { cells: c, seams: s } = applyFlipH(cells, seams, gridW, gridH);
    setCells(c);
    setSeams(s);
    setIsDirty(true);
  }

  function handleFlipVertical() {
    pushHistory(cells, seams);
    const { cells: c, seams: s } = applyFlipV(cells, seams, gridW, gridH);
    setCells(c);
    setSeams(s);
    setIsDirty(true);
  }

  function handleClear() {
    if (!confirm("Clear all cells?")) return;
    pushHistory(cells, seams);
    setCells(makeEmptyCells(gridW, gridH));
    setSeams([]);
  }

  function handleGridSizeChange(value: string) {
    const newSize = Number(value) as GridSize;
    setGridW(newSize);
    setGridH(newSize);
    setCells(makeEmptyCells(newSize, newSize));
    setHistory([]);
    setSeams([]);
  }

  function handleCustomGridChange(w: number, h: number) {
    setGridW(w);
    setGridH(h);
    setCells(makeEmptyCells(w, h));
    setHistory([]);
    setSeams([]);
  }

  const createBlock = useCreateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        setIsDirty(false);
        exitAfterSaveRef.current
          ? ((exitAfterSaveRef.current = false), navigate("/blocks"))
          : (toast.success("Block design saved!"),
            navigate(`/blocks/${data.id}`));
      },
      onError: () => {
        exitAfterSaveRef.current = false;
        toast.error("Failed to save block design.");
      },
    },
  });

  const updateBlock = useUpdateBlock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        if (blockId)
          queryClient.invalidateQueries({
            queryKey: getGetBlockQueryKey(blockId),
          });
        setIsDirty(false);
        if (exitAfterSaveRef.current) {
          exitAfterSaveRef.current = false;
          navigate(blockId ? `/blocks/${blockId}` : "/blocks");
        } else {
          toast.success("Block design updated!");
        }
      },
      onError: () => {
        exitAfterSaveRef.current = false;
        toast.error("Failed to update block design.");
      },
    },
  });

  function resolvedCategoryNames(): string[] {
    return selectedCategoryIds
      .map((id) => (allCategories ?? []).find((c) => c.id === id)?.name)
      .filter((n): n is string => Boolean(n));
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(
        templateMode
          ? "Please enter a name for this template."
          : "Please enter a name for this design.",
      );
      return;
    }
    if (templateMode) {
      const tags = templateTagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (isNew) {
        createTemplate.mutate(
          {
            data: {
              name: trimmed,
              tags,
              gridW,
              gridH,
              cells,
              seams: seams as QuiltingBlockTemplateSeamLine[],
              blockSizeInches: blockSizeInches ?? null,
              seamAllowanceInches: seamAllowanceInches ?? null,
            },
          },
          {
            onSuccess: (data) => {
              invalidateBlockTemplates();
              setIsDirty(false);
              if (exitAfterSaveRef.current) {
                exitAfterSaveRef.current = false;
                navigate("/library/blocks");
              } else {
                toast.success("Template saved!");
                navigate(`/library/blocks/${data.id}/edit`);
              }
            },
            onError: () => {
              exitAfterSaveRef.current = false;
              toast.error("Failed to save template.");
            },
          },
        );
      } else if (blockId) {
        patchTemplate.mutate(
          {
            id: blockId,
            data: {
              name: trimmed,
              tags,
              gridW,
              gridH,
              cells,
              seams: seams as QuiltingBlockTemplateSeamLine[],
              blockSizeInches: blockSizeInches ?? null,
              seamAllowanceInches: seamAllowanceInches ?? null,
            },
          },
          {
            onSuccess: () => {
              invalidateBlockTemplates();
              void queryClient.invalidateQueries({
                queryKey: getGetBlockTemplateQueryKey(blockId),
              });
              setIsDirty(false);
              if (exitAfterSaveRef.current) {
                exitAfterSaveRef.current = false;
                navigate("/library/blocks");
              } else {
                toast.success("Template updated!");
              }
            },
            onError: () => {
              exitAfterSaveRef.current = false;
              toast.error("Failed to update template.");
            },
          },
        );
      }
      return;
    }
    const categoryNames = resolvedCategoryNames();
    if (isNew) {
      createBlock.mutate({
        data: {
          name: trimmed,
          gridSize: gridW as GridSize,
          cells,
          seams,
          blockSizeInches: blockSizeInches,
          seamAllowanceInches,
          categoryNames,
        },
      });
    } else if (blockId) {
      updateBlock.mutate({
        id: blockId,
        data: {
          name: trimmed,
          gridSize: gridW as GridSize,
          cells,
          seams,
          blockSizeInches: blockSizeInches,
          seamAllowanceInches,
          categoryNames,
        },
      });
    }
  }

  function handleSaveAs() {
    const suggestion = name.trim() ? `${name.trim()} (copy)` : "Untitled copy";
    const newName = window.prompt("Save a copy as:", suggestion);
    if (newName === null) return; // cancelled
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Please enter a name for the copy.");
      return;
    }
    const categoryNames = resolvedCategoryNames();
    createBlock.mutate({
      data: {
        name: trimmed,
        gridSize: gridW as GridSize,
        cells,
        seams,
        blockSizeInches: blockSizeInches,
        seamAllowanceInches,
        categoryNames,
      },
    });
  }

  const isSaving = createBlock.isPending || updateBlock.isPending;

  // ── Block Patterns ─────────────────────────────────────────────────────────
  const invalidateBlockTemplates = () =>
    void queryClient.invalidateQueries({
      queryKey: getListBlockTemplatesQueryKey(),
    });
  const createTemplate = useCreateBlockTemplate();
  const deleteTemplate = useDeleteBlockTemplate();
  const { data: templates } = useListBlockTemplates();
  const patchTemplate = usePatchBlockTemplate();
  const [saveToLibOpen, setSaveToLibOpen] = useState(false);
  const [libBrowserOpen, setLibBrowserOpen] = useState(false);
  const [libSaveName, setLibSaveName] = useState("");
  const [libSaveTags, setLibSaveTags] = useState("");
  const isSavingToLib = createTemplate.isPending;
  const [editTemplateId, setEditTemplateId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [libTagFilter, setLibTagFilter] = useState<Set<string>>(new Set());

  const libraryTagOptions = Array.from(
    new Set((templates ?? []).flatMap((tpl) => tpl.tags)),
  ).sort((a, b) => a.localeCompare(b));

  const filteredTemplates = (templates ?? []).filter(
    (tpl) =>
      libTagFilter.size === 0 || tpl.tags.some((tag) => libTagFilter.has(tag)),
  );

  function toggleLibTagFilter(tag: string) {
    setLibTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function closeLibBrowser() {
    setLibBrowserOpen(false);
    setLibTagFilter(new Set());
  }

  function openSaveToLib() {
    setLibSaveName(name.trim() || "Untitled block");
    setLibSaveTags("");
    setSaveToLibOpen(true);
  }

  function handleSaveToLibrary() {
    const templateName = libSaveName.trim();
    if (!templateName) {
      toast.error("Please enter a name for the template.");
      return;
    }
    const tags = libSaveTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    createTemplate.mutate(
      {
        data: {
          name: templateName,
          tags,
          gridW,
          gridH,
          cells,
          seams: seams as QuiltingBlockTemplateSeamLine[],
          blockSizeInches: blockSizeInches ?? null,
          seamAllowanceInches: seamAllowanceInches ?? null,
        },
      },
      {
        onSuccess: () => {
          invalidateBlockTemplates();
          setSaveToLibOpen(false);
          toast.success(`"${templateName}" saved to block library`);
        },
        onError: () => toast.error("Failed to save to library"),
      },
    );
  }

  function handleLoadTemplate(tpl: QuiltingBlockTemplate) {
    if (
      isDirty &&
      !confirm("This will replace your current unsaved design. Continue?")
    ) {
      return;
    }
    setCells(
      tpl.cells.length > 0 ? tpl.cells : makeEmptyCells(tpl.gridW, tpl.gridH),
    );
    setGridW(tpl.gridW);
    setGridH(tpl.gridH);
    setSeams(tpl.seams as SeamLine[]);
    if (tpl.blockSizeInches != null) setBlockSizeInches(tpl.blockSizeInches);
    if (tpl.seamAllowanceInches != null)
      setSeamAllowanceInches(tpl.seamAllowanceInches);
    setIsDirty(true);
    closeLibBrowser();
    toast.success(`Loaded template "${tpl.name}"`);
  }

  async function handleExport(format: "png" | "jpeg" | "gif" | "pdf") {
    const svgEl = document.querySelector<SVGSVGElement>("[data-grid-export]");
    if (!svgEl) {
      toast.error("Could not find the grid to export.");
      return;
    }
    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(svgEl);
    if (!svgStr.includes("xmlns="))
      svgStr = svgStr.replace(
        "<svg",
        '<svg xmlns="http://www.w3.org/2000/svg"',
      );
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = svgUrl;
    });
    URL.revokeObjectURL(svgUrl);
    // Collect color usage for legend
    const colorCount = new Map<string, number>();
    cells.forEach((c) => {
      const p = parseCell(c);
      const cs: string[] = [];
      if (p.kind === "solid" && p.color) cs.push(p.color);
      else if (p.kind === "triangle") {
        if (p.a) cs.push(p.a);
        if (p.b) cs.push(p.b);
      } else if (p.kind === "quad") {
        [p.top, p.right, p.bottom, p.left]
          .filter(Boolean)
          .forEach((v) => cs.push(v));
      } else if (p.kind === "hsplit") {
        if (p.top) cs.push(p.top);
        if (p.bottom) cs.push(p.bottom);
      } else if (p.kind === "vsplit") {
        if (p.left) cs.push(p.left);
        if (p.right) cs.push(p.right);
      } else if (p.kind === "xsplit") {
        [p.tl, p.tr, p.bl, p.br].filter(Boolean).forEach((v) => cs.push(v));
      }
      cs.forEach((col) => colorCount.set(col, (colorCount.get(col) ?? 0) + 1));
    });
    const colorEntries = [...colorCount.entries()]
      .filter(([c]) => c && c !== "#FFFFFF" && c !== "#ffffff")
      .sort((a, b) => b[1] - a[1]);
    const SWATCH = 18,
      ROW_H = 24,
      PAD = 16;
    const legendH =
      PAD * 2 + ROW_H * 2 + ROW_H * Math.max(colorEntries.length, 1) + 8;
    const W = Math.max(img.naturalWidth, 300);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = img.naturalHeight + legendH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    // Legend
    let ly = img.naturalHeight + PAD;
    ctx.fillStyle = "#111827";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(
      `${name.trim() || "Untitled"} — ${gridW}×${gridH} block`,
      PAD,
      ly + 13,
    );
    ly += ROW_H;
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      `${seams.length} seam segment${seams.length !== 1 ? "s" : ""} · ${colorEntries.length} colour${colorEntries.length !== 1 ? "s" : ""}`,
      PAD,
      ly + 13,
    );
    ly += ROW_H + 4;
    if (colorEntries.length === 0) {
      ctx.fillStyle = "#6b7280";
      ctx.font = "11px sans-serif";
      ctx.fillText("No fabric colours used", PAD, ly + 13);
    }
    colorEntries.forEach(([color, count]) => {
      ctx.fillStyle = color;
      ctx.fillRect(PAD, ly, SWATCH, SWATCH);
      ctx.strokeStyle = "#d1d5db";
      ctx.lineWidth = 0.75;
      ctx.strokeRect(PAD, ly, SWATCH, SWATCH);
      ctx.fillStyle = "#111827";
      ctx.font = "11px monospace";
      ctx.fillText(
        `${color}  (${count} cell${count !== 1 ? "s" : ""})`,
        PAD + SWATCH + 8,
        ly + 13,
      );
      ly += ROW_H;
    });
    if (format === "pdf") {
      const imgData = canvas.toDataURL("image/png");
      const win = window.open("", "_blank");
      if (!win) {
        toast.error("Allow pop-ups to export PDF.");
        return;
      }
      win.document.write(
        `<html><head><title>${name}</title><style>body{margin:0;background:#fff}img{max-width:100%;display:block}</style></head><body><img src="${imgData}"></body></html>`,
      );
      win.document.close();
      setTimeout(() => {
        win.print();
      }, 400);
      return;
    }
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const ext = format === "gif" ? "gif" : format;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error("Export failed.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(name.trim() || "block").replace(/\s+/g, "-").toLowerCase()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`Exported as ${ext.toUpperCase()}.`);
      },
      mime,
      format === "jpeg" ? 0.95 : undefined,
    );
  }

  if (!isNew && loadingExisting) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-[400px]" />
      </div>
    );
  }

  const toolHint: string = (() => {
    if (bgAdjusting)
      return "📷 Background adjust — drag the photo to reposition it, use the zoom buttons on the left, then press ✓ Done when finished.";
    if (seamOnly)
      return "👁 Seams-only view: fabric colours are hidden so only seam lines are visible. Click the eye icon or press the toggle again to restore colours.";
    if (tool === "paint")
      return "🖌 Paint — click or drag across cells to fill them with the selected colour. Hold and drag to paint multiple cells in one stroke.";
    if (tool === "fill")
      return "🪣 Fill — click a cell to flood-fill all connected cells that share the same colour.";
    if (tool === "erase")
      return "⬜ Erase — click or drag to clear cells back to empty (white). Also removes any diagonal seam inside the cell.";
    if (tool === "eyedropper")
      return bgImage && bgVisible
        ? "💉 Sample — click anywhere on the grid to pick the exact colour from the background photo at that spot. Switches back to Paint automatically."
        : "💉 Sample — click any cell to pick its painted colour. Switches back to Paint automatically when done.";
    if (tool === "pan")
      return bgImage
        ? "✋ Pan — click and drag to reposition the background photo. Switch back to Paint when you're done moving it."
        : "✋ Pan — no background photo loaded yet. Use Background → Import photo… to load one first.";
    if (tool === "tri-nwse" || tool === "tri-nesw")
      return `△ Half-cell — click a cell to fill it with two colours: L/T side gets the top-left colour (${selectedColor || "transparent"}), R/B side gets the bottom-right colour (${selectedColorB || "transparent"}). Pick each colour in the toolbar.`;
    if (tool === "line-nwse")
      return "╲ Diagonal seam — click a cell to draw the \\ seam line. Click again to remove it.";
    if (tool === "line-nesw")
      return "╱ Diagonal seam — click a cell to draw the / seam line. Click again to remove it.";
    if (tool === "qline-back")
      return "◹ Quarter seam ╲ — click the top-right of a cell for the NE line, the bottom-left for the SW line. Place any/all four to form a diamond; click again to remove.";
    if (tool === "qline-fwd")
      return "◸ Quarter seam ╱ — click the top-left of a cell for the NW line, the bottom-right for the SE line. Place any/all four to form a diamond; click again to remove.";
    if (tool === "seam-h")
      return "─ H seam — click the grid to place a horizontal seam line; snaps to cell edges and midpoints. Click an existing line to remove it.";
    if (tool === "seam-v")
      return "│ V seam — click the grid to place a vertical seam line; snaps to cell edges and midpoints. Click an existing line to remove it.";
    if (tool === "seam-snip")
      return "✂ Trim — hover over a seam crossing; the section to remove turns red. Click to snip it at that intersection.";
    return "Select a tool on the left to start designing.";
  })();

  const menuBtnCls =
    "flex items-center rounded px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const SEAM_TOOLS = [
    "seam-h",
    "seam-v",
    "line-nwse",
    "line-nesw",
    "qline-back",
    "qline-fwd",
    "seam-snip",
  ] as const;
  const TRI_TOOLS = ["tri-nwse", "tri-nesw"] as const;
  const isSeamActive = (SEAM_TOOLS as readonly Tool[]).includes(tool);
  const isTriActive = (TRI_TOOLS as readonly Tool[]).includes(tool);
  const seamDisplay = isSeamActive
    ? (tool as typeof lastSeamTool)
    : lastSeamTool;
  const triDisplay = isTriActive ? (tool as typeof lastTriTool) : lastTriTool;
  const SEAM_ICONS: Record<typeof lastSeamTool, React.ReactNode> = {
    "seam-h": (
      <span className="text-sm font-bold leading-none select-none">─</span>
    ),
    "seam-v": (
      <span className="text-sm font-bold leading-none select-none">│</span>
    ),
    "line-nwse": (
      <span className="text-sm font-bold leading-none select-none">╲</span>
    ),
    "line-nesw": (
      <span className="text-sm font-bold leading-none select-none">╱</span>
    ),
    "qline-back": (
      <span className="text-sm font-bold leading-none select-none">◹</span>
    ),
    "qline-fwd": (
      <span className="text-sm font-bold leading-none select-none">◸</span>
    ),
    "seam-snip": <Scissors className="h-4 w-4" />,
  };
  const TRI_ICONS: Record<typeof lastTriTool, React.ReactNode> = {
    "tri-nwse": <span className="text-base leading-none select-none">◪</span>,
    "tri-nesw": <span className="text-base leading-none select-none">◩</span>,
  };

  function TB({
    id,
    icon,
    label,
  }: {
    id: Tool;
    icon: React.ReactNode;
    label: string;
  }) {
    return (
      <button
        onClick={() => selectTool(id)}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded transition-colors ${
          tool === id
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {icon}
      </button>
    );
  }

  function TBAction({
    icon,
    label,
    onClick,
    active = false,
    disabled = false,
  }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
  }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded transition-colors disabled:opacity-40 ${
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {icon}
      </button>
    );
  }

  function TSep() {
    return <div className="my-1 h-px w-7 self-center bg-border" />;
  }

  return (
    <div
      className="-mx-4 -mt-6 flex flex-col overflow-hidden sm:-mx-6 lg:-mx-8"
      style={{ height: "calc(100vh - 4rem)" }}
    >
      {/* ── Mobile notice ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 md:hidden">
        <span>
          The block designer works best on a desktop or tablet with a mouse.
        </span>
      </div>

      {/* ── Unsaved-changes exit dialog ────────────────────────────────── */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this block design. What would you like
              to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setShowExitDialog(false);
                setIsDirty(false);
                navigate(
                  pendingNavRef.current ??
                    (templateMode ? "/library/blocks" : "/blocks"),
                );
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

      {/* ── Title bar ─────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() =>
            requestNav(
              templateMode
                ? "/library/blocks"
                : blockId
                  ? `/blocks/${blockId}`
                  : "/blocks",
            )
          }
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 max-w-[220px] text-sm font-semibold"
          placeholder={templateMode ? "Template name…" : "Block name…"}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {!templateMode && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={openSaveToLib}
                title="Save current design as a reusable library template"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Save to Library</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLibBrowserOpen(true)}
                title="Browse block library"
              >
                <Library className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="sm"
            className="h-8"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {templateMode
              ? isNew
                ? "Save Template"
                : "Update Template"
              : isNew
                ? "Save"
                : "Update"}
          </Button>
        </div>
      </div>
      {templateMode && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/10 px-3 py-1.5">
          <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Label className="shrink-0 text-xs text-muted-foreground">Tags</Label>
          <Input
            value={templateTagsInput}
            onChange={(e) => setTemplateTagsInput(e.target.value)}
            className="h-6 max-w-sm px-2 text-xs"
            placeholder="Comma-separated, e.g. Classic, Star, 4x4"
          />
        </div>
      )}

      {/* ── Block dimensions bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-muted/10 px-3 py-1">
        <Ruler className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Label className="shrink-0 text-xs text-muted-foreground">
          Finished size
        </Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={1}
            max={120}
            step={0.5}
            value={blockSizeInches ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setBlockSizeInches(
                v === "" ? null : Math.max(1, Math.min(120, Number(v))),
              );
            }}
            className="h-6 w-16 px-2 text-xs"
            placeholder="e.g. 12"
          />
          <span className="text-xs text-muted-foreground">in</span>
        </div>
        <span className="text-muted-foreground/40">|</span>
        <Label className="shrink-0 text-xs text-muted-foreground">
          Seam allow.
        </Label>
        <Select
          value={String(seamAllowanceInches)}
          onValueChange={(v) => setSeamAllowanceInches(Number(v))}
        >
          <SelectTrigger className="h-6 w-24 px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.125">⅛ in</SelectItem>
            <SelectItem value="0.25">¼ in (standard)</SelectItem>
            <SelectItem value="0.375">⅜ in</SelectItem>
            <SelectItem value="0.5">½ in</SelectItem>
          </SelectContent>
        </Select>
        {blockSizeInches !== null && (
          <span className="ml-auto text-xs text-muted-foreground">
            {gridW}×{gridH} cells · each cell {fmtInch(blockSizeInches / gridW)}
            {gridW !== gridH
              ? ` × ${fmtInch(blockSizeInches / gridH)}`
              : ""}{" "}
            finished
          </span>
        )}
      </div>

      {/* ── Menu bar ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center border-b bg-muted/20 px-1">
        {/* File */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>File</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={handleSave} disabled={isSaving}>
              <Save className="mr-2 h-3.5 w-3.5" />
              {templateMode
                ? isNew
                  ? "Save Template"
                  : "Update Template"
                : isNew
                  ? "Save"
                  : "Update"}
              <span className="ml-auto text-[10px] text-muted-foreground">
                ⌘S
              </span>
            </DropdownMenuItem>
            {!templateMode && (
              <DropdownMenuItem onClick={handleSaveAs} disabled={isSaving}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Save As…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => bgFileRef.current?.click()}>
              <Upload className="mr-2 h-3.5 w-3.5" />
              Import background…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => scanImportRef.current?.click()}>
              <ImageIcon className="mr-2 h-3.5 w-3.5" />
              Import from image (scan-to-grid)…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {!isNew && blockId && !templateMode && (
              <DropdownMenuItem
                onClick={() => navigate(`/blocks/${blockId}/cut-pattern`)}
              >
                <Scissors className="mr-2 h-3.5 w-3.5" />
                Cut Pattern…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FileDown className="mr-2 h-3.5 w-3.5" />
                Export as…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => void handleExport("png")}>
                  PNG image + legend
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleExport("jpeg")}>
                  JPEG image + legend
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleExport("gif")}>
                  GIF image + legend
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleExport("pdf")}>
                  PDF blueprint…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Edit</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem
              onClick={handleUndo}
              disabled={history.length === 0}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Undo
              <span className="ml-auto text-[10px] text-muted-foreground">
                ⌘Z
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRotateCW}>
              <RotateCw className="mr-2 h-3.5 w-3.5" />
              Rotate 90° clockwise
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRotateCCW}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Rotate 90° counter-clockwise
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRotate180}>
              <RotateCw className="mr-2 h-3.5 w-3.5" />
              Rotate 180°
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleFlipHorizontal}>
              <FlipHorizontal2 className="mr-2 h-3.5 w-3.5" />
              Flip horizontal
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleFlipVertical}>
              <FlipVertical2 className="mr-2 h-3.5 w-3.5" />
              Flip vertical
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleClear}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Clear canvas…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View — placed right after Edit */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>View</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuCheckboxItem
              checked={seamOnly}
              onCheckedChange={() => setSeamOnly((v) => !v)}
            >
              {seamOnly ? (
                <EyeOff className="mr-2 h-3.5 w-3.5" />
              ) : (
                <Eye className="mr-2 h-3.5 w-3.5" />
              )}
              Seams only (hide colours)
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">
              Tiled preview
            </DropdownMenuLabel>
            <div
              className="flex items-center gap-2 px-2 py-1.5 text-xs"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-muted-foreground">Cols</span>
              <input
                type="number"
                min={1}
                max={12}
                value={tileCols}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1 && n <= 12) setTileCols(n);
                }}
                className="h-6 w-12 rounded border border-input bg-background px-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">×</span>
              <input
                type="number"
                min={1}
                max={12}
                value={tileRows}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1 && n <= 12) setTileRows(n);
                }}
                className="h-6 w-12 rounded border border-input bg-background px-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">tiles</span>
            </div>
            <div
              className="flex flex-col gap-1.5 px-2 py-1.5 text-xs"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-muted-foreground">Finished quilt size</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={
                    blockSizeInches !== null
                      ? +(blockSizeInches * tileCols).toFixed(2)
                      : ""
                  }
                  placeholder="W"
                  onChange={(e) => {
                    const w = parseFloat(e.target.value);
                    if (!isNaN(w) && w > 0)
                      setBlockSizeInches(+(w / tileCols).toFixed(3));
                  }}
                  className="h-6 w-16 rounded border border-input bg-background px-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-muted-foreground">W ×</span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={
                    blockSizeInches !== null
                      ? +(blockSizeInches * tileRows).toFixed(2)
                      : ""
                  }
                  placeholder="H"
                  onChange={(e) => {
                    const h = parseFloat(e.target.value);
                    if (!isNaN(h) && h > 0)
                      setBlockSizeInches(+(h / tileRows).toFixed(3));
                  }}
                  className="h-6 w-16 rounded border border-input bg-background px-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-muted-foreground">H in</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {blockSizeInches !== null
                  ? `Each block ${fmtInch(blockSizeInches)} square · ${tileCols}×${tileRows} blocks`
                  : "Set a finished block size to compute quilt dimensions"}
              </span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setPopZoom(1);
                setPopPan({ x: 0, y: 0 });
                setPreviewPane("maximized");
              }}
            >
              <Maximize2 className="mr-2 h-3.5 w-3.5" />
              Maximize preview
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Grid */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Grid</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">
              Square presets
            </DropdownMenuLabel>
            {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as GridSize[]).map(
              (n) => (
                <DropdownMenuCheckboxItem
                  key={n}
                  checked={gridW === n && gridH === n}
                  onCheckedChange={() => handleGridSizeChange(String(n))}
                >
                  {n}×{n}
                </DropdownMenuCheckboxItem>
              ),
            )}
            <DropdownMenuSeparator />
            <div
              className="px-2 py-2"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Grid lines
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {gridLineOpacity}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[gridLineOpacity]}
                onValueChange={([v]) => setGridLineOpacity(v)}
                className="w-full"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Seams */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Seams</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="text-xs">
              Place seam
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => selectTool("seam-h")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ─
              </span>
              Horizontal
              {tool === "seam-h" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("seam-v")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                │
              </span>
              Vertical
              {tool === "seam-v" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("line-nwse")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ╲
              </span>
              Diagonal NW→SE
              {tool === "line-nwse" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("line-nesw")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ╱
              </span>
              Diagonal NE→SW
              {tool === "line-nesw" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">
              Quarter seams (edge midpoints)
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => selectTool("qline-back")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ◹
              </span>
              Quarter ╲ (NE / SW)
              {tool === "qline-back" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("qline-fwd")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ◸
              </span>
              Quarter ╱ (NW / SE)
              {tool === "qline-fwd" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => selectTool("seam-snip")}>
              <Scissors className="mr-2 h-3.5 w-3.5" />
              Trim at crossing
              {tool === "seam-snip" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Auto-Seam</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => handleAutoSeam("grid")}>
                  Every row &amp; column
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAutoSeam("contiguous")}>
                  Same-colour outlines
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={seams.length === 0}
              onClick={() => setSeams([])}
              className="text-destructive focus:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              Clear all seams
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Background — only shown when a photo is loaded */}
        {bgImage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={menuBtnCls}>
                Background
                {bgAdjusting ? (
                  <span className="ml-1.5 rounded-sm bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    ADJ
                  </span>
                ) : (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuCheckboxItem
                checked={bgVisible}
                onCheckedChange={(checked) => setBgVisible(!!checked)}
              >
                Show photo
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onClick={enterBgAdjust}>
                <ZoomIn className="mr-2 h-3.5 w-3.5" />
                Adjust photo position…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div
                className="px-2 py-2"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Zoom</span>
                  <input
                    type="number"
                    step="any"
                    min={1}
                    max={1000}
                    value={parseFloat((bgScale * 100).toFixed(4))}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) setBgScale(v / 100);
                    }}
                    className="ml-auto h-6 w-20 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <Slider
                  min={25}
                  max={400}
                  step={1}
                  value={[Math.round(bgScale * 100)]}
                  onValueChange={([v]) => setBgScale(v / 100)}
                  className="w-full"
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setBgScale(1);
                  setBgOffX(0);
                  setBgOffY(0);
                }}
              >
                Reset fit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setBgImage(null);
                  setBgVisible(true);
                  setBgScale(1);
                  setBgOffX(0);
                  setBgOffY(0);
                  setBgAdjusting(false);
                }}
                className="text-destructive focus:text-destructive"
              >
                <XIcon className="mr-2 h-3.5 w-3.5" />
                Remove photo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Windows */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Windows</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-xs">
              Right panel
            </DropdownMenuLabel>
            {panels.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={p.open}
                onCheckedChange={() => togglePanel(p.id, "open")}
              >
                {p.title}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={bgFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleBgImport}
        />
        <input
          ref={scanImportRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleScanImport}
        />
      </div>

      {/* ── Quick controls sub-bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-background px-2 py-1 text-xs">
        {/* Block grid size — only square sizes that the API accepts */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Grid</span>
          <Select value={String(gridW)} onValueChange={handleGridSizeChange}>
            <SelectTrigger className="h-6 w-20 px-1.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as GridSize[]).map(
                (n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}×{n}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">cells</span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Tiled preview repeat */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Tiles</span>
          <input
            type="number"
            min={1}
            max={12}
            value={tileCols}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 12) setTileCols(n);
            }}
            className="h-6 w-12 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            title="Tile columns"
          />
          <span className="text-muted-foreground">×</span>
          <input
            type="number"
            min={1}
            max={12}
            value={tileRows}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 12) setTileRows(n);
            }}
            className="h-6 w-12 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            title="Tile rows"
          />
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Finished quilt size */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Quilt</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={
              blockSizeInches !== null
                ? +(blockSizeInches * tileCols).toFixed(2)
                : ""
            }
            placeholder="W"
            onChange={(e) => {
              const w = parseFloat(e.target.value);
              if (!isNaN(w) && w > 0)
                setBlockSizeInches(+(w / tileCols).toFixed(3));
            }}
            className="h-6 w-16 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            title="Finished quilt width (inches)"
          />
          <span className="text-muted-foreground">×</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={
              blockSizeInches !== null
                ? +(blockSizeInches * tileRows).toFixed(2)
                : ""
            }
            placeholder="H"
            onChange={(e) => {
              const h = parseFloat(e.target.value);
              if (!isNaN(h) && h > 0)
                setBlockSizeInches(+(h / tileRows).toFixed(3));
            }}
            className="h-6 w-16 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            title="Finished quilt height (inches)"
          />
          <span className="text-muted-foreground">in</span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Grid line opacity */}
        <div className="flex w-36 items-center gap-2">
          <span className="font-medium text-muted-foreground">Lines</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[gridLineOpacity]}
            onValueChange={([v]) => setGridLineOpacity(v)}
            className="flex-1"
          />
          <span className="w-8 text-right tabular-nums text-muted-foreground">
            {gridLineOpacity}%
          </span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Seams-only toggle */}
        <button
          onClick={() => setSeamOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
            seamOnly
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
          title="Toggle seams-only view"
        >
          {seamOnly ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          Seams only
        </button>

        <span className="text-muted-foreground/40">|</span>

        {/* View adjustments */}
        <div className="relative">
          <button
            onClick={() => setViewControlsOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
              viewControlsOpen || imageFilter
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
            title="View adjustments (brightness / contrast / saturation)"
          >
            <Sliders className="h-3.5 w-3.5" />
            View
            {imageFilter && (
              <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </button>
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
      </div>

      {/* ── Workspace ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left toolbar */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r bg-muted/10 py-2">
          {bgAdjusting ? (
            <>
              {/* Background adjustment sub-toolbar — replaces normal tools */}
              <div
                className="flex h-7 w-9 items-center justify-center rounded bg-primary/10"
                title="Background photo mode"
              >
                <ImageIcon className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-[8px] font-bold uppercase tracking-wider text-primary">
                photo
              </span>
              <TSep />
              <button
                title="Zoom in"
                onClick={() =>
                  setBgScale((s) => Math.min(8, +(s * 1.25).toFixed(3)))
                }
                className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <span className="text-[9px] tabular-nums text-muted-foreground">
                {Math.round(bgScale * 100)}%
              </span>
              <button
                title="Zoom out"
                onClick={() =>
                  setBgScale((s) => Math.max(0.1, +(s / 1.25).toFixed(3)))
                }
                className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <TSep />
              <div
                className="flex h-9 w-9 items-center justify-center rounded bg-primary/10"
                title="Drag to reposition photo"
              >
                <Hand className="h-4 w-4 text-primary" />
              </div>
              <TSep />
              <button
                title="Confirm placement"
                onClick={exitBgAdjust}
                className="flex h-9 w-9 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Check className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              {/* Actions */}
              <TBAction
                icon={<RotateCcw className="h-4 w-4" />}
                label="Undo (⌘Z)"
                onClick={handleUndo}
                disabled={history.length === 0}
              />
              <TBAction
                icon={<Save className="h-4 w-4" />}
                label={isSaving ? "Saving…" : "Save (⌘S)"}
                onClick={handleSave}
                disabled={isSaving}
              />
              <TBAction
                icon={<Trash2 className="h-4 w-4" />}
                label="Clear canvas"
                onClick={handleClear}
              />
              <TSep />
              {/* Drawing */}
              <TB
                id="paint"
                icon={<Paintbrush className="h-4 w-4" />}
                label="Paint"
              />
              <TB
                id="fill"
                icon={<PaintBucket className="h-4 w-4" />}
                label="Fill"
              />
              <TB
                id="erase"
                icon={<Eraser className="h-4 w-4" />}
                label="Erase"
              />
              <TSep />
              {/* Colour picker */}
              <TB
                id="eyedropper"
                icon={<Pipette className="h-4 w-4" />}
                label="Sample colour"
              />
              <TSep />
              {/* Pan / drag background — re-opens the photo positioning controls */}
              <button
                onClick={() => enterBgAdjust()}
                title="Reposition background photo"
                className={`flex h-9 w-9 items-center justify-center rounded transition-colors ${
                  tool === "pan"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Hand className="h-4 w-4" />
              </button>
              <TSep />
              {/* Seam group flyout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Seam tools"
                    className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors ${
                      isSeamActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {SEAM_ICONS[seamDisplay]}
                    <svg
                      className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                      viewBox="0 0 6 6"
                      fill="currentColor"
                    >
                      <polygon points="6,0 6,6 0,6" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  sideOffset={6}
                  className="w-44"
                >
                  <DropdownMenuLabel className="text-xs">
                    Seam tools
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => selectTool("seam-h")}>
                    <span className="mr-2 w-4 text-center font-bold">─</span>{" "}
                    Horizontal
                    {tool === "seam-h" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTool("seam-v")}>
                    <span className="mr-2 w-4 text-center font-bold">│</span>{" "}
                    Vertical
                    {tool === "seam-v" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTool("line-nwse")}>
                    <span className="mr-2 w-4 text-center font-bold">╲</span>{" "}
                    Diag NW→SE
                    {tool === "line-nwse" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTool("line-nesw")}>
                    <span className="mr-2 w-4 text-center font-bold">╱</span>{" "}
                    Diag NE→SW
                    {tool === "line-nesw" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTool("qline-back")}>
                    <span className="mr-2 w-4 text-center font-bold">◹</span>{" "}
                    Quarter ╲ (NE/SW)
                    {tool === "qline-back" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTool("qline-fwd")}>
                    <span className="mr-2 w-4 text-center font-bold">◸</span>{" "}
                    Quarter ╱ (NW/SE)
                    {tool === "qline-fwd" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => selectTool("seam-snip")}>
                    <Scissors className="mr-2 h-3.5 w-3.5" /> Trim at crossing
                    {tool === "seam-snip" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Triangle group flyout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Triangle tools"
                    className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors ${
                      isTriActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {TRI_ICONS[triDisplay]}
                    <svg
                      className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                      viewBox="0 0 6 6"
                      fill="currentColor"
                    >
                      <polygon points="6,0 6,6 0,6" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  sideOffset={6}
                  className="w-44"
                >
                  <DropdownMenuLabel className="text-xs">
                    Triangle tools
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => selectTool("tri-nwse")}>
                    <span className="mr-2 text-base leading-none">◪</span> NW→SE
                    half
                    {tool === "tri-nwse" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTool("tri-nesw")}>
                    <span className="mr-2 text-base leading-none">◩</span> NE→SW
                    half
                    {tool === "tri-nesw" && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Auto-Seam flyout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Auto-Seam"
                    className="relative flex h-9 w-9 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Wand2 className="h-4 w-4" />
                    <svg
                      className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                      viewBox="0 0 6 6"
                      fill="currentColor"
                    >
                      <polygon points="6,0 6,6 0,6" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  sideOffset={6}
                  className="w-52"
                >
                  <DropdownMenuLabel className="text-xs">
                    Auto-Seam
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleAutoSeam("grid")}>
                    <span className="mr-2 w-4 text-center text-sm leading-none">
                      #
                    </span>{" "}
                    Every row &amp; column
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleAutoSeam("contiguous")}
                  >
                    <span className="mr-2 w-4 text-center text-sm leading-none">
                      ⬛
                    </span>{" "}
                    Contiguous regions
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <TSep />
              {/* Seams-only toggle */}
              <TBAction
                icon={
                  seamOnly ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )
                }
                label={seamOnly ? "Show colours" : "Seams only (hide colours)"}
                onClick={() => setSeamOnly((v) => !v)}
                active={seamOnly}
              />
              {/* Background toggle / adjust */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Background"
                    className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors ${bgImage && bgVisible ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                  >
                    <ImageIcon className="h-4 w-4" />
                    {bgAdjusting && (
                      <span className="pointer-events-none absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                    <svg
                      className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                      viewBox="0 0 6 6"
                      fill="currentColor"
                    >
                      <polygon points="6,0 6,6 0,6" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  sideOffset={6}
                  className="w-52"
                >
                  <DropdownMenuLabel className="text-xs">
                    Background photo
                  </DropdownMenuLabel>
                  {bgImage ? (
                    <>
                      <DropdownMenuCheckboxItem
                        checked={bgVisible}
                        onCheckedChange={(checked) => setBgVisible(!!checked)}
                      >
                        Show photo
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuItem onClick={enterBgAdjust}>
                        <ZoomIn className="mr-2 h-3.5 w-3.5" />
                        Adjust photo position…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          setBgScale(1);
                          setBgOffX(0);
                          setBgOffY(0);
                        }}
                      >
                        Reset fit
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => bgFileRef.current?.click()}
                    >
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      Import background…
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <TSep />
              {/* Export flyout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Export"
                    className="relative flex h-9 w-9 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Download className="h-4 w-4" />
                    <svg
                      className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                      viewBox="0 0 6 6"
                      fill="currentColor"
                    >
                      <polygon points="6,0 6,6 0,6" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  sideOffset={6}
                  className="w-36"
                >
                  <DropdownMenuLabel className="text-xs">
                    Export as
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleExport("png")}>
                    <FileDown className="mr-2 h-3.5 w-3.5" /> PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("jpeg")}>
                    <FileDown className="mr-2 h-3.5 w-3.5" /> JPEG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("gif")}>
                    <FileDown className="mr-2 h-3.5 w-3.5" /> GIF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")}>
                    <FileDown className="mr-2 h-3.5 w-3.5" /> PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {/* Dual colour slots — L/T (slot A) and R/B (slot B) */}
          <div className="mt-auto pt-1 px-1 flex flex-col gap-1">
            {(["a", "b"] as const).map((slot) => {
              const isActive = activeSlot === slot;
              const color = slot === "a" ? selectedColor : selectedColorB;
              const setColor =
                slot === "a" ? setSelectedColor : setSelectedColorB;
              const label = slot === "a" ? "L/T" : "R/B";
              return (
                <div key={slot} className="flex items-center gap-1">
                  <button
                    title={`${label} side colour — click to make active`}
                    onClick={() => setActiveSlot(slot)}
                    className={`relative h-7 w-7 shrink-0 overflow-hidden rounded border-2 transition-all ${isActive ? "border-primary shadow-sm scale-110" : "border-muted-foreground/30"}`}
                    style={
                      !color
                        ? {
                            background:
                              "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 8px 8px",
                          }
                        : color.startsWith("fab:")
                          ? {}
                          : { backgroundColor: color }
                    }
                  >
                    {color.startsWith("fab:") &&
                      (() => {
                        const url = fabricUrlMap[parseInt(color.slice(4), 10)];
                        return url ? (
                          <img
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[7px] text-muted-foreground">
                            fab
                          </span>
                        );
                      })()}
                  </button>
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={`text-[8px] font-bold leading-none ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label}
                    </span>
                    <button
                      title="Set transparent (no colour)"
                      onClick={() => {
                        setColor("");
                        setActiveSlot(slot);
                      }}
                      className="text-[7px] leading-none text-muted-foreground hover:text-foreground"
                    >
                      ∅
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Canvas area — hint bar is fixed, grid fills the remaining space */}
        <div className="flex flex-1 flex-col overflow-hidden bg-muted/5">
          {/* Hint bar */}
          <div className="shrink-0 px-4 pt-3 pb-1">
            <div
              className={`rounded-lg border px-3 py-1.5 text-xs ${bgAdjusting ? "border-amber-200 bg-amber-50 text-amber-800" : "border-indigo-200 bg-indigo-50 text-indigo-800"}`}
            >
              {toolHint}
            </div>
          </div>
          {/* Grid measurement zone — fills rest of height, centres the ruler+grid */}
          <div
            ref={canvasAreaRef}
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
          >
            {(() => {
              const dynCellPx =
                canvasCellPx ??
                Math.min(Math.floor(400 / Math.max(gridW, gridH)), 56);
              return (
                <div className="flex flex-col" style={{ gap: 0 }}>
                  {/* Top: corner spacer + horizontal ruler */}
                  <div className="flex">
                    <div
                      style={{ width: RULER_THICK, height: RULER_THICK }}
                      className="shrink-0 rounded-tl-sm bg-muted/50 border-b border-r border-border/40"
                    />
                    <BlockRuler
                      orientation="h"
                      count={gridW}
                      cellPx={dynCellPx}
                      blockSizeInches={blockSizeInches}
                    />
                  </div>
                  {/* Bottom: vertical ruler + grid */}
                  <div className="flex">
                    <BlockRuler
                      orientation="v"
                      count={gridH}
                      cellPx={dynCellPx}
                      blockSizeInches={blockSizeInches}
                    />
                    <BlockGrid
                      cells={cells}
                      gridW={gridW}
                      gridH={gridH}
                      cellPx={dynCellPx}
                      onCellAction={handleCellAction}
                      gridLineOpacity={gridLineOpacity}
                      bgImage={bgImage}
                      bgVisible={bgVisible}
                      bgScale={bgScale}
                      bgOffX={bgOffX}
                      bgOffY={bgOffY}
                      bgAdjusting={bgAdjusting}
                      panTool={tool === "pan" || bgAdjusting}
                      onBgChange={(x, y, s) => {
                        setBgOffX(x);
                        setBgOffY(y);
                        setBgScale(s);
                      }}
                      seams={seams}
                      seamTool={
                        tool === "seam-h" ? "h" : tool === "seam-v" ? "v" : null
                      }
                      onSeamToggle={handleSeamToggle}
                      snipTool={tool === "seam-snip"}
                      onSeamSnip={handleSeamSnip}
                      onDiagSnip={handleDiagSnip}
                      diagTool={
                        tool === "line-nwse"
                          ? "nwse"
                          : tool === "line-nesw"
                            ? "nesw"
                            : tool === "qline-back"
                              ? "qback"
                              : tool === "qline-fwd"
                                ? "qfwd"
                                : null
                      }
                      seamOnly={seamOnly}
                      fabricUrlMap={fabricUrlMap}
                      imageFilter={imageFilter ?? undefined}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right panel */}
        <div
          className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l bg-background p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!dragPanelId || !dragOverId || dragPanelId === dragOverId) {
              setDragPanelId(null);
              setDragOverId(null);
              return;
            }
            setPanels((prev) => {
              const from = prev.findIndex((p) => p.id === dragPanelId);
              const to = prev.findIndex((p) => p.id === dragOverId);
              if (from < 0 || to < 0) return prev;
              const next = [...prev];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              return next;
            });
            setDragPanelId(null);
            setDragOverId(null);
          }}
        >
          {panels
            .filter((p) => p.open)
            .map((panel) => (
              <div
                key={panel.id}
                draggable
                onDragStart={() => setDragPanelId(panel.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(panel.id);
                }}
                onDragEnd={() => {
                  setDragPanelId(null);
                  setDragOverId(null);
                }}
                className={`rounded-lg border bg-background transition-colors ${
                  dragOverId === panel.id && dragPanelId !== panel.id
                    ? "border-primary"
                    : "border-border"
                }`}
              >
                {/* Panel header */}
                <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
                  <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {panel.id === "tiled-preview"
                      ? blockSizeInches !== null
                        ? `Tiled Preview — ${fmtInch(blockSizeInches * tileCols)}" × ${fmtInch(blockSizeInches * tileRows)}"`
                        : `Tiled Preview — ${tileCols}×${tileRows}`
                      : panel.title}
                  </span>
                  {panel.id === "tiled-preview" && (
                    <button
                      title="Maximise preview"
                      onClick={() => {
                        setPopZoom(1);
                        setPopPan({ x: 0, y: 0 });
                        // Pre-set size from viewport so the first render uses a real cellPx
                        // rather than falling back to the maxPx default. The ResizeObserver
                        // will fire immediately after mount and correct any small deviation.
                        setPopViewSize({
                          w: Math.round(window.innerWidth * 0.92) - 48,
                          h: Math.round(window.innerHeight * 0.92) - 100,
                        });
                        setPreviewPane("maximized");
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                    >
                      <Maximize2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                  <button
                    title={panel.minimized ? "Restore" : "Minimise"}
                    onClick={() => togglePanel(panel.id, "minimized")}
                    className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                  >
                    {panel.minimized ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Minus className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    title="Close panel"
                    onClick={() => togglePanel(panel.id, "open")}
                    className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                  >
                    <XIcon className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
                {/* Panel body */}
                {!panel.minimized && (
                  <div className="p-2">
                    {panel.id === "tiled-preview" && (
                      <TiledPreview
                        cells={cells}
                        gridW={gridW}
                        gridH={gridH}
                        tileCols={tileCols}
                        tileRows={tileRows}
                        maxPx={220}
                        seams={seams}
                        seamOnly={seamOnly}
                        bgImage={bgImage}
                        bgVisible={bgVisible}
                        bgScale={bgScale}
                        bgOffX={bgOffX}
                        bgOffY={bgOffY}
                        fabricUrlMap={fabricUrlMap}
                      />
                    )}
                    {panel.id === "tiled-preview" && (
                      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                        {blockSizeInches !== null
                          ? `Finished quilt: ${fmtInch(blockSizeInches * tileCols)} × ${fmtInch(blockSizeInches * tileRows)} (${tileCols}×${tileRows} blocks)`
                          : "Set a finished block size to see quilt dimensions"}
                      </p>
                    )}
                    {panel.id === "palette" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>Setting:</span>
                          {(["a", "b"] as const).map((slot) => {
                            const isActive = activeSlot === slot;
                            const c =
                              slot === "a" ? selectedColor : selectedColorB;
                            return (
                              <button
                                key={slot}
                                onClick={() => setActiveSlot(slot)}
                                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
                              >
                                <span
                                  className="inline-block h-3 w-3 rounded-sm border border-black/10"
                                  style={
                                    !c
                                      ? {
                                          background:
                                            "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 6px 6px",
                                        }
                                      : c.startsWith("fab:")
                                        ? {}
                                        : { backgroundColor: c }
                                  }
                                >
                                  {c.startsWith("fab:") &&
                                    (() => {
                                      const url =
                                        fabricUrlMap[parseInt(c.slice(4), 10)];
                                      return url ? (
                                        <img
                                          src={url}
                                          alt=""
                                          className="h-full w-full object-cover"
                                        />
                                      ) : null;
                                    })()}
                                </span>
                                {slot === "a" ? "L/T" : "R/B"}
                              </button>
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-8 gap-1">
                          {PALETTE.map((color) => {
                            const active =
                              activeSlot === "a"
                                ? selectedColor
                                : selectedColorB;
                            return (
                              <button
                                key={color}
                                title={color}
                                onClick={() => {
                                  if (activeSlot === "a")
                                    setSelectedColor(color);
                                  else setSelectedColorB(color);
                                  if (tool === "eyedropper") setTool("paint");
                                }}
                                className={`h-7 w-7 rounded transition-transform hover:scale-110 ${
                                  active === color
                                    ? "ring-2 ring-primary ring-offset-1"
                                    : "ring-1 ring-inset ring-black/10"
                                }`}
                                style={{ backgroundColor: color }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {panel.id === "custom-color" && (
                      <ColorPicker
                        value={
                          activeSlot === "a" ? selectedColor : selectedColorB
                        }
                        onChange={
                          activeSlot === "a"
                            ? setSelectedColor
                            : setSelectedColorB
                        }
                      />
                    )}
                    {panel.id === "fabrics" && (
                      <FabricPicker
                        fabrics={fabricsList}
                        activeValue={
                          activeSlot === "a" ? selectedColor : selectedColorB
                        }
                        onSelect={(val) => {
                          if (activeSlot === "a") setSelectedColor(val);
                          else setSelectedColorB(val);
                          if (tool === "eyedropper") setTool("paint");
                        }}
                        tally={fabricTally}
                        placeholder="Click to stamp with fabric"
                      />
                    )}
                    {panel.id === "categories" && (
                      <TagSelector
                        allCategories={allCategories ?? []}
                        selectedIds={selectedCategoryIds}
                        onToggle={(id) =>
                          setSelectedCategoryIds((prev) =>
                            prev.includes(id)
                              ? prev.filter((x) => x !== id)
                              : [...prev, id],
                          )
                        }
                        onCreated={(cat) =>
                          setSelectedCategoryIds((prev) => [...prev, cat.id])
                        }
                        disabled={isSaving}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          {panels.every((p) => !p.open) && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              All panels closed.
              <br />
              Re-open from Windows menu.
            </p>
          )}
        </div>
      </div>

      {/* ── Maximized preview overlay ─────────────────────────────────── */}
      {previewPane === "maximized" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewPane("normal")}
        >
          <div
            className="relative flex flex-col rounded-2xl bg-background shadow-2xl"
            style={{ width: "92vw", height: "92vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3">
              <p className="text-sm font-semibold">
                Tiled preview — {tileCols}×{tileRows}
                {blockSizeInches !== null && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {fmtInch(blockSizeInches * tileCols)} ×{" "}
                    {fmtInch(blockSizeInches * tileRows)} finished
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Scroll to zoom · Drag to pan
                </span>
                <button
                  onClick={() => {
                    setPopZoom(1);
                    setPopPan({ x: 0, y: 0 });
                  }}
                  className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Reset
                </button>
                <button
                  onClick={() =>
                    setPopZoom((z) => Math.min(8, +(z * 1.25).toFixed(2)))
                  }
                  className="flex h-7 w-7 items-center justify-center rounded bg-muted text-sm font-bold hover:bg-accent"
                  title="Zoom in"
                >
                  +
                </button>
                <span className="w-12 text-center text-xs tabular-nums">
                  {Math.round(popZoom * 100)}%
                </span>
                <button
                  onClick={() =>
                    setPopZoom((z) => Math.max(0.25, +(z / 1.25).toFixed(2)))
                  }
                  className="flex h-7 w-7 items-center justify-center rounded bg-muted text-sm font-bold hover:bg-accent"
                  title="Zoom out"
                >
                  −
                </button>
                <button
                  onClick={() => setPreviewPane("normal")}
                  className="ml-2 flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  title="Close"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div
              ref={popViewRef}
              className="relative flex-1 overflow-hidden"
              style={{ cursor: popDragRef.current ? "grabbing" : "grab" }}
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
                setPopZoom((z) =>
                  Math.min(8, Math.max(0.25, +(z * factor).toFixed(3))),
                );
              }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                popDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  px: popPan.x,
                  py: popPan.y,
                };
              }}
              onPointerMove={(e) => {
                if (!popDragRef.current) return;
                setPopPan({
                  x:
                    popDragRef.current.px +
                    e.clientX -
                    popDragRef.current.startX,
                  y:
                    popDragRef.current.py +
                    e.clientY -
                    popDragRef.current.startY,
                });
              }}
              onPointerUp={() => {
                popDragRef.current = null;
              }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ pointerEvents: "none" }}
              >
                <div
                  style={{
                    transform: `translate(${popPan.x}px, ${popPan.y}px) scale(${popZoom})`,
                    transformOrigin: "center center",
                    transition: popDragRef.current ? "none" : "transform 0.05s",
                  }}
                >
                  <TiledPreview
                    cells={cells}
                    gridW={gridW}
                    gridH={gridH}
                    tileCols={tileCols}
                    tileRows={tileRows}
                    cellPx={
                      popViewSize.w > 0 && popViewSize.h > 0
                        ? Math.max(
                            4,
                            Math.floor(
                              Math.min(
                                (popViewSize.w - 48) / (gridW * tileCols),
                                (popViewSize.h - 48) / (gridH * tileRows),
                              ),
                            ),
                          )
                        : undefined
                    }
                    maxPx={4000}
                    seams={seams}
                    seamOnly={seamOnly}
                    bgImage={bgImage}
                    bgVisible={bgVisible}
                    bgScale={bgScale}
                    bgOffX={bgOffX}
                    bgOffY={bgOffY}
                    fabricUrlMap={fabricUrlMap}
                    imageFilter={imageFilter ?? undefined}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Save to Library dialog ───────────────────────────────────── */}
      <Dialog open={saveToLibOpen} onOpenChange={setSaveToLibOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Save to Block Patterns</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lib-name">Template name</Label>
              <Input
                id="lib-name"
                value={libSaveName}
                onChange={(e) => setLibSaveName(e.target.value)}
                placeholder="e.g. Flying Geese"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveToLibrary();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lib-tags" className="flex items-center gap-1">
                <Tag className="h-3.5 w-3.5" />
                Tags
                <span className="text-xs font-normal text-muted-foreground">
                  (comma-separated)
                </span>
              </Label>
              <Input
                id="lib-tags"
                value={libSaveTags}
                onChange={(e) => setLibSaveTags(e.target.value)}
                placeholder="e.g. traditional, geese, triangle"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saves a reusable snapshot of the current design ({gridW}×{gridH})
              to the shared block library. It won{"'"}t affect this block.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveToLibOpen(false)}
              disabled={isSavingToLib}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveToLibrary} disabled={isSavingToLib}>
              {isSavingToLib ? "Saving…" : "Save to Library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Library browser dialog ───────────────────────────────────── */}
      <Dialog
        open={libBrowserOpen}
        onOpenChange={(open) =>
          open ? setLibBrowserOpen(true) : closeLibBrowser()
        }
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Block Patterns</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            {(!templates || templates.length === 0) && (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <Library className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No templates saved yet.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use <span className="font-medium">Save to Library</span> to
                  save the current design as a reusable template.
                </p>
              </div>
            )}
            {templates &&
              templates.length > 0 &&
              libraryTagOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {libraryTagOptions.map((tag) => {
                    const selected = libTagFilter.has(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleLibTagFilter(tag)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-card-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        {tag}
                        {selected && (
                          <XIcon className="h-2.5 w-2.5 opacity-60" />
                        )}
                      </button>
                    );
                  })}
                  {libTagFilter.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setLibTagFilter(new Set())}
                      className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            {templates &&
              templates.length > 0 &&
              filteredTemplates.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No templates match the selected tags.
                </p>
              )}
            {filteredTemplates.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-h-[380px] overflow-y-auto pr-1">
                {filteredTemplates.map((tpl: QuiltingBlockTemplate) => (
                  <div
                    key={tpl.id}
                    className="group relative flex flex-col gap-2 rounded-lg border border-border p-3"
                  >
                    {/* Preview using safe structured SVG renderer */}
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-muted/30">
                      <BlockPreviewSvg
                        cells={tpl.cells}
                        gridSize={tpl.gridW}
                        seams={tpl.seams as SeamLine[]}
                        size={80}
                      />
                    </div>
                    {/* Inline edit form — shown when this template is being renamed */}
                    {editTemplateId === tpl.id ? (
                      <div className="flex flex-col gap-1.5">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Template name"
                          className="h-7 text-xs"
                          autoFocus
                        />
                        <Input
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="Tags (comma-separated)"
                          className="h-7 text-xs"
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-6 flex-1 text-xs"
                            disabled={patchTemplate.isPending}
                            onClick={() => {
                              const newName = editName.trim();
                              if (!newName) return;
                              const newTags = editTags
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean);
                              patchTemplate.mutate(
                                {
                                  id: tpl.id,
                                  data: { name: newName, tags: newTags },
                                },
                                {
                                  onSuccess: () => {
                                    invalidateBlockTemplates();
                                    setEditTemplateId(null);
                                  },
                                  onError: () =>
                                    toast.error("Failed to save changes"),
                                },
                              );
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => setEditTemplateId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {tpl.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tpl.gridW}×{tpl.gridH}
                        </p>
                        {tpl.tags.length > 0 && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                            {tpl.tags.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                    {/* Load into canvas button */}
                    {editTemplateId !== tpl.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-auto h-7 w-full gap-1 text-xs"
                        onClick={() => handleLoadTemplate(tpl)}
                      >
                        <FolderOpen className="h-3 w-3" />
                        Load into canvas
                      </Button>
                    )}
                    {/* Action buttons (edit + delete) — shown on hover */}
                    {editTemplateId !== tpl.id && (
                      <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                        <button
                          className="rounded-full bg-muted p-1 text-foreground hover:bg-accent"
                          onClick={() => {
                            setEditTemplateId(tpl.id);
                            setEditName(tpl.name);
                            setEditTags(tpl.tags.join(", "));
                          }}
                          title="Rename / retag"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          className="rounded-full bg-destructive/90 p-1 text-white hover:bg-destructive"
                          onClick={() => {
                            if (!confirm(`Delete template "${tpl.name}"?`))
                              return;
                            deleteTemplate.mutate(
                              { id: tpl.id },
                              {
                                onSuccess: invalidateBlockTemplates,
                                onError: () =>
                                  toast.error("Failed to delete template"),
                              },
                            );
                          }}
                          title="Delete template"
                        >
                          <Trash2Icon className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeLibBrowser}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
