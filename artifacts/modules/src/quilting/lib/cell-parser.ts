/**
 * Shared cell-format parser, extracted from designer.tsx.
 * Cell encoding (backward-compatible string format stored in JSONB):
 *   ""                              → empty (renders as white)
 *   "#RRGGBB"                       → solid colour
 *   "nwse:COLOR_A:COLOR_B"          → NW→SE diagonal (A=upper-right, B=lower-left)
 *   "nesw:COLOR_A:COLOR_B"          → NE→SW diagonal (A=upper-left,  B=lower-right)
 *   "quad:COLOR_T:COLOR_R:COLOR_B:COLOR_L" → both diagonals → 4 triangles
 *   "hsplit:COLOR_T:COLOR_B"        → horizontal midpoint split
 *   "vsplit:COLOR_L:COLOR_R"        → vertical midpoint split
 *   "xsplit:TL:TR:BL:BR"            → both midpoint splits → 4 quarter rectangles
 */

/** A quarter-corner seam line connecting two adjacent edge midpoints. */
export type QDir = "ne" | "se" | "sw" | "nw";

export type ParsedCell =
  | { kind: "solid"; color: string }
  | { kind: "triangle"; type: "nwse" | "nesw"; a: string; b: string }
  | { kind: "quad"; top: string; right: string; bottom: string; left: string }
  | { kind: "hsplit"; top: string; bottom: string }
  | { kind: "vsplit"; left: string; right: string }
  | { kind: "xsplit"; tl: string; tr: string; bl: string; br: string }
  | { kind: "line"; type: "nwse" | "nesw"; cs: number; ce: number }
  | {
      kind: "xline";
      nwseCs: number;
      nwseCe: number;
      neswCs: number;
      neswCe: number;
    }
  | { kind: "midline"; h: boolean; v: boolean }
  | { kind: "qlines"; dirs: QDir[] };

/**
 * Split a ":"-delimited colour-token list while keeping multi-segment fabric
 * references ("fab:<id>") intact. A plain colour ("#RRGGBB", named, or empty)
 * occupies one segment; a fabric reference occupies two ("fab" + the numeric
 * id) and is rejoined. This replaces the older `split(/:(?=#)/)` / `indexOf`
 * tricks, which assumed every colour was a `#hex` value and mangled `fab:N`
 * tokens (turning a half-square-triangle into invalid colours → black fill).
 */
function splitColorTokens(s: string): string[] {
  const raw = s.split(":");
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "fab" && i + 1 < raw.length) {
      out.push(`fab:${raw[i + 1]}`);
      i++;
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

export function parseCell(cell: string): ParsedCell {
  if (cell === "ne-line") return { kind: "qlines", dirs: ["ne"] };
  if (cell === "se-line") return { kind: "qlines", dirs: ["se"] };
  if (cell === "sw-line") return { kind: "qlines", dirs: ["sw"] };
  if (cell === "nw-line") return { kind: "qlines", dirs: ["nw"] };
  if (cell.startsWith("qlines:")) {
    const dirs = cell
      .slice(7)
      .split(":")
      .filter(
        (d): d is QDir => d === "ne" || d === "se" || d === "sw" || d === "nw",
      );
    return { kind: "qlines", dirs };
  }
  if (cell === "seam-midline-h") return { kind: "midline", h: true, v: false };
  if (cell === "seam-midline-v") return { kind: "midline", h: false, v: true };
  if (cell === "seam-midline-hv") return { kind: "midline", h: true, v: true };
  if (cell === "nwse-line") return { kind: "line", type: "nwse", cs: 0, ce: 1 };
  if (cell === "nesw-line") return { kind: "line", type: "nesw", cs: 0, ce: 1 };
  if (cell === "xline")
    return { kind: "xline", nwseCs: 0, nwseCe: 1, neswCs: 0, neswCe: 1 };
  if (cell.startsWith("nwse-line:")) {
    const parts = cell.slice(10).split(":");
    return {
      kind: "line",
      type: "nwse",
      cs: parseFloat(parts[0]),
      ce: parseFloat(parts[1]),
    };
  }
  if (cell.startsWith("nesw-line:")) {
    const parts = cell.slice(10).split(":");
    return {
      kind: "line",
      type: "nesw",
      cs: parseFloat(parts[0]),
      ce: parseFloat(parts[1]),
    };
  }
  if (cell.startsWith("xline:")) {
    const parts = cell.slice(6).split(":");
    return {
      kind: "xline",
      nwseCs: parseFloat(parts[0]),
      nwseCe: parseFloat(parts[1]),
      neswCs: parseFloat(parts[2]),
      neswCe: parseFloat(parts[3]),
    };
  }
  if (cell.startsWith("quad:")) {
    const parts = splitColorTokens(cell.slice(5));
    if (parts.length === 4)
      return {
        kind: "quad",
        top: parts[0],
        right: parts[1],
        bottom: parts[2],
        left: parts[3],
      };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("hsplit:")) {
    const parts = splitColorTokens(cell.slice(7));
    if (parts.length === 2)
      return { kind: "hsplit", top: parts[0], bottom: parts[1] };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("vsplit:")) {
    const parts = splitColorTokens(cell.slice(7));
    if (parts.length === 2)
      return { kind: "vsplit", left: parts[0], right: parts[1] };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("xsplit:")) {
    const parts = splitColorTokens(cell.slice(7));
    if (parts.length === 4)
      return {
        kind: "xsplit",
        tl: parts[0],
        tr: parts[1],
        bl: parts[2],
        br: parts[3],
      };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("nwse:") || cell.startsWith("nesw:")) {
    const type = cell.slice(0, 4) as "nwse" | "nesw";
    const tokens = splitColorTokens(cell.slice(5));
    if (tokens.length < 2) return { kind: "solid", color: cell };
    return { kind: "triangle", type, a: tokens[0], b: tokens[1] };
  }
  return { kind: "solid", color: cell };
}

/** True when a cell string represents a fabric fill (e.g. `"fab:42"`). */
export function isFabricCell(cell: string): boolean {
  return cell.startsWith("fab:");
}

/** Extract the numeric fabric ID from a fabric cell string, or null if not a fabric cell. */
export function fabricIdFromCell(cell: string): number | null {
  if (!cell.startsWith("fab:")) return null;
  const n = parseInt(cell.slice(4), 10);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Shared encode / toggle helpers (used by both Block Designer and WQ Designer)
// ---------------------------------------------------------------------------

/** Encode an xline cell, collapsing to a single diagonal (or empty) when one side is gone. */
export function encodeXline(
  nwseCs: number,
  nwseCe: number,
  neswCs: number,
  neswCe: number,
): string {
  const hasNwse = nwseCe - nwseCs > 0.001;
  const hasNesw = neswCe - neswCs > 0.001;
  if (!hasNwse && !hasNesw) return "";
  if (!hasNwse)
    return neswCs === 0 && neswCe === 1
      ? "nesw-line"
      : `nesw-line:${neswCs}:${neswCe}`;
  if (!hasNesw)
    return nwseCs === 0 && nwseCe === 1
      ? "nwse-line"
      : `nwse-line:${nwseCs}:${nwseCe}`;
  if (nwseCs === 0 && nwseCe === 1 && neswCs === 0 && neswCe === 1)
    return "xline";
  return `xline:${nwseCs}:${nwseCe}:${neswCs}:${neswCe}`;
}

/** Apply a diagonal clip result back to a cell string. keepCs/keepCe = the portion to KEEP. */
export function applyDiagClip(
  parsed: ParsedCell,
  diagType: "nwse" | "nesw",
  keepCs: number,
  keepCe: number,
): string {
  const hasContent = keepCe - keepCs > 0.001;
  if (parsed.kind === "line") {
    if (!hasContent) return "";
    const prefix = diagType === "nwse" ? "nwse-line" : "nesw-line";
    return keepCs === 0 && keepCe === 1
      ? prefix
      : `${prefix}:${keepCs}:${keepCe}`;
  }
  if (parsed.kind === "xline") {
    const nwseCs =
      diagType === "nwse" ? (hasContent ? keepCs : 0) : parsed.nwseCs;
    const nwseCe =
      diagType === "nwse" ? (hasContent ? keepCe : 0) : parsed.nwseCe;
    const neswCs =
      diagType === "nesw" ? (hasContent ? keepCs : 0) : parsed.neswCs;
    const neswCe =
      diagType === "nesw" ? (hasContent ? keepCe : 0) : parsed.neswCe;
    return encodeXline(nwseCs, nwseCe, neswCs, neswCe);
  }
  return "";
}

/**
 * Toggle a full corner-to-corner diagonal (cs=0, ce=1) in a cell.
 * One click places it; another click removes it. If the other diagonal
 * already exists, both are kept (xline encoding).
 */
export function toggleFullDiag(
  cells: string[],
  idx: number,
  type: "nwse" | "nesw",
): string[] {
  const nx = [...cells];
  const p = parseCell(cells[idx] ?? "");
  let nwseCs = 1,
    nwseCe = 0,
    neswCs = 1,
    neswCe = 0;
  if (p.kind === "xline") {
    nwseCs = p.nwseCs;
    nwseCe = p.nwseCe;
    neswCs = p.neswCs;
    neswCe = p.neswCe;
  } else if (p.kind === "line") {
    if (p.type === "nwse") {
      nwseCs = p.cs;
      nwseCe = p.ce;
    } else {
      neswCs = p.cs;
      neswCe = p.ce;
    }
  }
  const present =
    type === "nwse" ? nwseCe > nwseCs + 0.001 : neswCe > neswCs + 0.001;
  const newCs = present ? 1 : 0;
  const newCe = present ? 0 : 1;
  nx[idx] = encodeXline(
    type === "nwse" ? newCs : nwseCs,
    type === "nwse" ? newCe : nwseCe,
    type === "nesw" ? newCs : neswCs,
    type === "nesw" ? newCe : neswCe,
  );
  return nx;
}

// ---------------------------------------------------------------------------
// Quarter-corner seam lines (NE / SE / SW / NW edge-midpoint lines)
// Stored in the cell string so multiple may coexist in one cell.
// ---------------------------------------------------------------------------

const QORDER: QDir[] = ["ne", "se", "sw", "nw"];

/** Encode a set of quarter-corner lines into a cell string ("" when none). */
export function encodeQlines(dirs: QDir[]): string {
  const present = QORDER.filter((d) => dirs.includes(d));
  return present.length === 0 ? "" : `qlines:${present.join(":")}`;
}

/** Toggle one quarter-corner line in a cell; any/all four may coexist. */
export function toggleQuarterLine(
  cells: string[],
  idx: number,
  dir: QDir,
): string[] {
  const nx = [...cells];
  const p = parseCell(cells[idx] ?? "");
  const cur = p.kind === "qlines" ? p.dirs : [];
  const next = cur.includes(dir) ? cur.filter((d) => d !== dir) : [...cur, dir];
  nx[idx] = encodeQlines(next);
  return nx;
}

/** Remove one quarter-corner line from a cell (used by Trim at crossing). */
export function removeQuarterLine(
  cells: string[],
  idx: number,
  dir: QDir,
): string[] {
  const p = parseCell(cells[idx] ?? "");
  if (p.kind !== "qlines") return cells;
  const nx = [...cells];
  nx[idx] = encodeQlines(p.dirs.filter((d) => d !== dir));
  return nx;
}

/**
 * Decide which quarter-corner line a click targets, given a tool that covers a
 * parallel pair and the click's fractional position within the cell (0..1).
 *   "back" (╲) pair → NE (top-right) or SW (bottom-left)
 *   "fwd"  (╱) pair → NW (top-left)  or SE (bottom-right)
 */
export function quarterDirForClick(
  pair: "back" | "fwd",
  fx: number,
  fy: number,
): QDir {
  if (pair === "back") return fx >= fy ? "ne" : "sw";
  return fx + fy <= 1 ? "nw" : "se";
}

/**
 * Flood-fill starting from `startIdx`, replacing all connected solid cells of the
 * same colour with `fillColor`. Non-solid cells (seams, triangles, etc.) act as barriers.
 */
export function floodFillSolid(
  cells: string[],
  gridW: number,
  gridH: number,
  startIdx: number,
  fillColor: string,
): string[] {
  const startParsed = parseCell(cells[startIdx] ?? "");
  if (startParsed.kind !== "solid") return cells;
  const targetColor = startParsed.color;
  if (targetColor === fillColor) return cells;
  const next = [...cells];
  const stack = [startIdx];
  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (idx < 0 || idx >= next.length) continue;
    const p = parseCell(next[idx] ?? "");
    if (p.kind !== "solid" || p.color !== targetColor) continue;
    next[idx] = fillColor;
    const row = Math.floor(idx / gridW);
    const col = idx % gridW;
    if (col > 0) stack.push(idx - 1);
    if (col < gridW - 1) stack.push(idx + 1);
    if (row > 0) stack.push(idx - gridW);
    if (row < gridH - 1) stack.push(idx + gridW);
  }
  return next;
}

// ---------------------------------------------------------------------------

/** Format an inch measurement as a human-readable fraction string (e.g. 2.5 → 2½"). */
export function fmtInch(val: number): string {
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
// Cut-pattern analysis
// ---------------------------------------------------------------------------

export interface CutPiece {
  shape: "square" | "rectangle" | "hst" | "qst";
  label: string;
  colors: string[];
  finishedW: number | null;
  finishedH: number | null;
  cutW: number | null;
  cutH: number | null;
  note: string | null;
  count: number;
}

/**
 * Analyse a cell array and produce a grouped fabric piece inventory.
 * Each unique (shape × color) combination is one entry.
 *
 * @param cells      Raw cell strings from the block record.
 * @param gridW      Block grid width.
 * @param gridH      Block grid height.
 * @param blockSizeInches  Finished block size in inches, or null if not set.
 * @param seamAllowanceInches  Seam allowance per side (default 0.25").
 */
/** Standard oversize for a half-square triangle source square at a ¼" seam (⅞"). */
const HST_OVERSIZE = 0.875;
/** Standard oversize for a quarter-square triangle source square at a ¼" seam (1¼"). */
const QST_OVERSIZE = 1.25;

export function analyzeCutPattern(
  cells: string[],
  gridW: number,
  gridH: number,
  blockSizeInches: number | null,
  seamAllowanceInches: number,
): CutPiece[] {
  const sa = seamAllowanceInches;
  const cellFW = blockSizeInches !== null ? blockSizeInches / gridW : null;
  const cellFH = blockSizeInches !== null ? blockSizeInches / gridH : null;

  const acc = new Map<string, CutPiece>();

  function add(key: string, piece: Omit<CutPiece, "count">) {
    const ex = acc.get(key);
    if (ex) {
      ex.count++;
    } else {
      acc.set(key, { ...piece, count: 1 });
    }
  }

  for (const cell of cells) {
    if (!cell) continue;
    const p = parseCell(cell);

    switch (p.kind) {
      case "solid": {
        if (!p.color) break;
        const cw = cellFW !== null ? cellFW + 2 * sa : null;
        const ch = cellFH !== null ? cellFH + 2 * sa : null;
        add(`sq:${p.color}`, {
          shape: "square",
          label: "Square",
          colors: [p.color],
          finishedW: cellFW,
          finishedH: cellFH,
          cutW: cw,
          cutH: ch,
          note: null,
        });
        break;
      }
      case "triangle": {
        const side =
          cellFW !== null && cellFH !== null
            ? Math.max(cellFW, cellFH)
            : (cellFW ?? cellFH);
        if (p.a === p.b) {
          const cw = side !== null ? side + 2 * sa : null;
          add(`sq:${p.a}`, {
            shape: "square",
            label: "Square",
            colors: [p.a],
            finishedW: side,
            finishedH: side,
            cutW: cw,
            cutH: cw,
            note: null,
          });
          break;
        }
        const cutSide =
          side !== null ? side + HST_OVERSIZE * (sa / 0.25) : null;
        add(`hst:${p.a}`, {
          shape: "hst",
          label: "Half-square triangle",
          colors: [p.a],
          finishedW: side,
          finishedH: side,
          cutW: cutSide,
          cutH: cutSide,
          note: "Cut square on the diagonal",
        });
        add(`hst:${p.b}`, {
          shape: "hst",
          label: "Half-square triangle",
          colors: [p.b],
          finishedW: side,
          finishedH: side,
          cutW: cutSide,
          cutH: cutSide,
          note: "Cut square on the diagonal",
        });
        break;
      }
      case "quad": {
        const side =
          cellFW !== null && cellFH !== null
            ? Math.max(cellFW, cellFH)
            : (cellFW ?? cellFH);
        const cutSide =
          side !== null ? side + QST_OVERSIZE * (sa / 0.25) : null;
        for (const color of [p.top, p.right, p.bottom, p.left]) {
          if (!color) continue;
          add(`qst:${color}`, {
            shape: "qst",
            label: "Quarter-square triangle",
            colors: [color],
            finishedW: side,
            finishedH: side,
            cutW: cutSide,
            cutH: cutSide,
            note: null,
          });
        }
        break;
      }
      case "hsplit": {
        const fh2 = cellFH !== null ? cellFH / 2 : null;
        const cw = cellFW !== null ? cellFW + 2 * sa : null;
        const ch = fh2 !== null ? fh2 + 2 * sa : null;
        add(`hrect-top:${p.top}`, {
          shape: "rectangle",
          label: "Rectangle (top half)",
          colors: [p.top],
          finishedW: cellFW,
          finishedH: fh2,
          cutW: cw,
          cutH: ch,
          note: "Top half of cell",
        });
        add(`hrect-bot:${p.bottom}`, {
          shape: "rectangle",
          label: "Rectangle (bottom half)",
          colors: [p.bottom],
          finishedW: cellFW,
          finishedH: fh2,
          cutW: cw,
          cutH: ch,
          note: "Bottom half of cell",
        });
        break;
      }
      case "vsplit": {
        const fw2 = cellFW !== null ? cellFW / 2 : null;
        const cw = fw2 !== null ? fw2 + 2 * sa : null;
        const ch = cellFH !== null ? cellFH + 2 * sa : null;
        add(`vrect-left:${p.left}`, {
          shape: "rectangle",
          label: "Rectangle (left half)",
          colors: [p.left],
          finishedW: fw2,
          finishedH: cellFH,
          cutW: cw,
          cutH: ch,
          note: "Left half of cell",
        });
        add(`vrect-right:${p.right}`, {
          shape: "rectangle",
          label: "Rectangle (right half)",
          colors: [p.right],
          finishedW: fw2,
          finishedH: cellFH,
          cutW: cw,
          cutH: ch,
          note: "Right half of cell",
        });
        break;
      }
      case "xsplit": {
        const fw2 = cellFW !== null ? cellFW / 2 : null;
        const fh2 = cellFH !== null ? cellFH / 2 : null;
        const cw = fw2 !== null ? fw2 + 2 * sa : null;
        const ch = fh2 !== null ? fh2 + 2 * sa : null;
        for (const [pos, color] of [
          ["tl", p.tl],
          ["tr", p.tr],
          ["bl", p.bl],
          ["br", p.br],
        ] as [string, string][]) {
          if (!color) continue;
          add(`qsq-${pos}:${color}`, {
            shape: "square",
            label: "Small square (quarter cell)",
            colors: [color],
            finishedW: fw2,
            finishedH: fh2,
            cutW: cw,
            cutH: ch,
            note: `${pos.toUpperCase()} quarter`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  const pieces = Array.from(acc.values());

  for (const piece of pieces) {
    if (piece.shape !== "hst") continue;
    const triangles = piece.count;
    const squares = Math.ceil(triangles / 2);
    piece.count = squares;
    const spare = squares * 2 - triangles;
    piece.label = "Half-square triangle (HST)";
    piece.note =
      `Cut ${squares} square${squares === 1 ? "" : "s"}, then slice diagonally → ${triangles} triangle${triangles === 1 ? "" : "s"}` +
      (spare > 0 ? ` (${spare} spare)` : "");
  }

  for (const piece of pieces) {
    if (piece.shape !== "qst") continue;
    const triangles = piece.count;
    const squares = Math.ceil(triangles / 4);
    piece.count = squares;
    const spare = squares * 4 - triangles;
    piece.label = "Quarter-square triangle (QST)";
    piece.note =
      `Cut ${squares} square${squares === 1 ? "" : "s"}, then cut twice diagonally (X) → ${triangles} triangle${triangles === 1 ? "" : "s"}` +
      (spare > 0 ? ` (${spare} spare)` : "");
  }

  return pieces.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Fabric requirements (yardage) — group cut pieces by colour into fabrics
// ---------------------------------------------------------------------------

export interface FabricRequirement {
  /** Fabric label assigned by order of usage: "A", "B", "C", … */
  letter: string;
  color: string;
  pieces: CutPiece[];
  /** Total number of physical pieces to cut from this fabric. */
  pieceCount: number;
  /** Estimated yardage (yards) including a waste factor, or null if dimensions unknown. */
  yards: number | null;
}

/** Usable width of fabric after selvages are trimmed (typical 42–44" bolt). */
const WOF_USABLE_IN = 40;
/** Extra fabric bought to cover trimming, squaring and cutting waste. */
const WASTE_FACTOR = 1.15;

/**
 * Group the analysed cut pieces by colour into "fabrics" and estimate yardage.
 * Fabrics are lettered A, B, C… in descending order of fabric needed, matching
 * the convention used in published quilt patterns.
 */
export function buildFabricRequirements(
  pieces: CutPiece[],
  hasDimensions: boolean,
): FabricRequirement[] {
  const byColor = new Map<string, CutPiece[]>();
  for (const p of pieces) {
    const color = p.colors[0];
    if (!color) continue;
    const arr = byColor.get(color);
    if (arr) arr.push(p);
    else byColor.set(color, [p]);
  }

  const groups = Array.from(byColor.entries()).map(([color, ps]) => {
    const pieceCount = ps.reduce((s, p) => s + p.count, 0);
    let yards: number | null = null;
    if (hasDimensions) {
      let areaSqIn = 0;
      for (const p of ps) {
        if (p.cutW !== null && p.cutH !== null)
          areaSqIn += p.cutW * p.cutH * p.count;
      }
      areaSqIn *= WASTE_FACTOR;
      const raw = areaSqIn / (WOF_USABLE_IN * 36);
      yards = Math.max(0.25, Math.ceil(raw * 8) / 8);
    }
    return { color, pieces: ps, pieceCount, yards };
  });

  groups.sort(
    (a, b) => (b.yards ?? 0) - (a.yards ?? 0) || b.pieceCount - a.pieceCount,
  );

  return groups.map((g, i) => ({ letter: String.fromCharCode(65 + i), ...g }));
}

/** Derive a friendly skill level from the shapes present in the block. */
export function skillLevel(pieces: CutPiece[]): string {
  const shapes = new Set(pieces.map((p) => p.shape));
  if (shapes.has("qst")) return "Advanced";
  if (shapes.has("hst")) return "Intermediate";
  return "Confident beginner";
}

/** Format a yardage value as a readable fraction of a yard (e.g. 1.375 → "1⅜ yd"). */
export function fmtYards(yards: number): string {
  const whole = Math.floor(yards);
  const frac = Math.round((yards - whole) * 8);
  const fracMap: Record<number, string> = {
    1: "⅛",
    2: "¼",
    3: "⅜",
    4: "½",
    5: "⅝",
    6: "¾",
    7: "⅞",
  };
  if (frac === 0) return `${whole} yd`;
  const fracStr = fracMap[frac] ?? `${frac}/8`;
  return whole > 0 ? `${whole}${fracStr} yd` : `${fracStr} yd`;
}
