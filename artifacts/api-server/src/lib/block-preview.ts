/**
 * Server-side block preview PNG renderer.
 *
 * Builds a self-contained SVG with embedded base64 fabric images, then
 * rasterises it to PNG using sharp. Avoids any client-side dependency or
 * browser-based rasterisation.
 *
 * parseCell and the SVG cell-rendering logic are ported from
 * artifacts/modules/src/quilting/lib/cell-parser.ts and
 * artifacts/modules/src/quilting/components/BlockPreviewSvg.tsx
 * (leaf artifacts cannot be imported from api-server).
 */
import { eq, inArray } from "drizzle-orm";
import { db, blocks, fabrics } from "@workspace/db";
import { downloadImageBuffer } from "./storage";
import { logger } from "./logger";

// ─── parseCell (ported from cell-parser.ts) ────────────────────────────────
// Must be kept in sync with the canonical version in the modules artifact.

type ParsedCell =
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
  | { kind: "other" };

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

function parseCell(cell: string): ParsedCell {
  if (
    !cell ||
    cell.startsWith("qlines:") ||
    cell.startsWith("seam-midline") ||
    cell === "ne-line" ||
    cell === "se-line" ||
    cell === "sw-line" ||
    cell === "nw-line"
  ) {
    return { kind: "other" };
  }
  if (cell === "nwse-line") return { kind: "line", type: "nwse", cs: 0, ce: 1 };
  if (cell === "nesw-line") return { kind: "line", type: "nesw", cs: 0, ce: 1 };
  if (cell === "xline")
    return { kind: "xline", nwseCs: 0, nwseCe: 1, neswCs: 0, neswCe: 1 };
  if (cell.startsWith("nwse-line:")) {
    const [cs, ce] = cell.slice(10).split(":").map(parseFloat);
    return { kind: "line", type: "nwse", cs: cs ?? 0, ce: ce ?? 1 };
  }
  if (cell.startsWith("nesw-line:")) {
    const [cs, ce] = cell.slice(10).split(":").map(parseFloat);
    return { kind: "line", type: "nesw", cs: cs ?? 0, ce: ce ?? 1 };
  }
  if (cell.startsWith("xline:")) {
    const [nwseCs, nwseCe, neswCs, neswCe] = cell
      .slice(6)
      .split(":")
      .map(parseFloat);
    return {
      kind: "xline",
      nwseCs: nwseCs ?? 0,
      nwseCe: nwseCe ?? 1,
      neswCs: neswCs ?? 0,
      neswCe: neswCe ?? 1,
    };
  }
  if (cell.startsWith("quad:")) {
    const parts = splitColorTokens(cell.slice(5));
    if (parts.length === 4)
      return {
        kind: "quad",
        top: parts[0] ?? "",
        right: parts[1] ?? "",
        bottom: parts[2] ?? "",
        left: parts[3] ?? "",
      };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("hsplit:")) {
    const parts = splitColorTokens(cell.slice(7));
    if (parts.length === 2)
      return { kind: "hsplit", top: parts[0] ?? "", bottom: parts[1] ?? "" };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("vsplit:")) {
    const parts = splitColorTokens(cell.slice(7));
    if (parts.length === 2)
      return { kind: "vsplit", left: parts[0] ?? "", right: parts[1] ?? "" };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("xsplit:")) {
    const parts = splitColorTokens(cell.slice(7));
    if (parts.length === 4)
      return {
        kind: "xsplit",
        tl: parts[0] ?? "",
        tr: parts[1] ?? "",
        bl: parts[2] ?? "",
        br: parts[3] ?? "",
      };
    return { kind: "solid", color: "" };
  }
  if (cell.startsWith("nwse:") || cell.startsWith("nesw:")) {
    const type = cell.slice(0, 4) as "nwse" | "nesw";
    const tokens = splitColorTokens(cell.slice(5));
    if (tokens.length < 2) return { kind: "solid", color: cell };
    return { kind: "triangle", type, a: tokens[0] ?? "", b: tokens[1] ?? "" };
  }
  return { kind: "solid", color: cell };
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────

function r(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function collectFabIds(cells: string[]): Set<number> {
  const ids = new Set<number>();
  const FAB_RE = /fab:(\d+)/g;
  for (const c of cells) {
    FAB_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FAB_RE.exec(c)) !== null) {
      const n = parseInt(m[1]!, 10);
      if (!isNaN(n)) ids.add(n);
    }
  }
  return ids;
}

function resolveFill(color: string, fabUriMap: Record<number, string>): string {
  if (color.startsWith("fab:")) {
    const fid = parseInt(color.slice(4), 10);
    if (!isNaN(fid) && fabUriMap[fid]) return `url(#fab-${fid})`;
    return "#D1D5DB";
  }
  return color || "#FFFFFF";
}

function renderCell(
  x: number,
  y: number,
  w: number,
  h: number,
  cell: string,
  fabUriMap: Record<number, string>,
): string {
  const p = parseCell(cell);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = Math.max(0.4, w * 0.04);
  const f = (c: string) => resolveFill(c, fabUriMap);

  switch (p.kind) {
    case "solid":
      return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${f(p.color)}"/>`;

    case "triangle":
      if (p.type === "nwse") {
        return (
          `<polygon points="${r(x)},${r(y)} ${r(x + w)},${r(y)} ${r(x + w)},${r(y + h)}" fill="${f(p.a)}"/>` +
          `<polygon points="${r(x)},${r(y)} ${r(x)},${r(y + h)} ${r(x + w)},${r(y + h)}" fill="${f(p.b)}"/>`
        );
      }
      return (
        `<polygon points="${r(x)},${r(y)} ${r(x + w)},${r(y)} ${r(x)},${r(y + h)}" fill="${f(p.a)}"/>` +
        `<polygon points="${r(x + w)},${r(y)} ${r(x)},${r(y + h)} ${r(x + w)},${r(y + h)}" fill="${f(p.b)}"/>`
      );

    case "quad":
      return (
        `<polygon points="${r(x)},${r(y)} ${r(x + w)},${r(y)} ${r(cx)},${r(cy)}" fill="${f(p.top)}"/>` +
        `<polygon points="${r(x + w)},${r(y)} ${r(x + w)},${r(y + h)} ${r(cx)},${r(cy)}" fill="${f(p.right)}"/>` +
        `<polygon points="${r(x + w)},${r(y + h)} ${r(x)},${r(y + h)} ${r(cx)},${r(cy)}" fill="${f(p.bottom)}"/>` +
        `<polygon points="${r(x)},${r(y + h)} ${r(x)},${r(y)} ${r(cx)},${r(cy)}" fill="${f(p.left)}"/>`
      );

    case "hsplit":
      return (
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h / 2)}" fill="${f(p.top)}"/>` +
        `<rect x="${r(x)}" y="${r(y + h / 2)}" width="${r(w)}" height="${r(h / 2)}" fill="${f(p.bottom)}"/>`
      );

    case "vsplit":
      return (
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w / 2)}" height="${r(h)}" fill="${f(p.left)}"/>` +
        `<rect x="${r(x + w / 2)}" y="${r(y)}" width="${r(w / 2)}" height="${r(h)}" fill="${f(p.right)}"/>`
      );

    case "xsplit":
      return (
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w / 2)}" height="${r(h / 2)}" fill="${f(p.tl)}"/>` +
        `<rect x="${r(x + w / 2)}" y="${r(y)}" width="${r(w / 2)}" height="${r(h / 2)}" fill="${f(p.tr)}"/>` +
        `<rect x="${r(x)}" y="${r(y + h / 2)}" width="${r(w / 2)}" height="${r(h / 2)}" fill="${f(p.bl)}"/>` +
        `<rect x="${r(x + w / 2)}" y="${r(y + h / 2)}" width="${r(w / 2)}" height="${r(h / 2)}" fill="${f(p.br)}"/>`
      );

    case "line": {
      const { cs, ce, type } = p;
      const [x1, y1, x2, y2] =
        type === "nwse"
          ? [x + cs * w, y + cs * h, x + ce * w, y + ce * h]
          : [x + (1 - cs) * w, y + cs * h, x + (1 - ce) * w, y + ce * h];
      return (
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="#FFFFFF"/>` +
        `<line x1="${r(x1!)}" y1="${r(y1!)}" x2="${r(x2!)}" y2="${r(y2!)}" stroke="#555" stroke-width="${r(sw)}"/>`
      );
    }

    case "xline": {
      const { nwseCs, nwseCe, neswCs, neswCe } = p;
      let out = `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="#FFFFFF"/>`;
      if (nwseCe > nwseCs)
        out += `<line x1="${r(x + nwseCs * w)}" y1="${r(y + nwseCs * h)}" x2="${r(x + nwseCe * w)}" y2="${r(y + nwseCe * h)}" stroke="#555" stroke-width="${r(sw)}"/>`;
      if (neswCe > neswCs)
        out += `<line x1="${r(x + (1 - neswCs) * w)}" y1="${r(y + neswCs * h)}" x2="${r(x + (1 - neswCe) * w)}" y2="${r(y + neswCe * h)}" stroke="#555" stroke-width="${r(sw)}"/>`;
      return out;
    }

    default:
      return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="#FFFFFF"/>`;
  }
}

type SeamLine = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number | null;
  clipEnd?: number | null;
};

function buildBlockSvg(
  cells: string[],
  gridSize: number,
  seams: SeamLine[],
  sizePx: number,
  fabUriMap: Record<number, string>,
): string {
  const gridH = Math.max(1, Math.ceil(cells.length / gridSize));
  const cellPx = sizePx / gridSize;
  const blockW = sizePx;
  const blockH = gridH * cellPx;
  const sw = Math.max(0.5, cellPx * 0.1);

  const fabIds = Array.from(collectFabIds(cells)).filter((id) => fabUriMap[id]);

  let defs = "";
  if (fabIds.length > 0) {
    const pats = fabIds
      .map(
        (id) =>
          `<pattern id="fab-${id}" patternUnits="userSpaceOnUse" x="0" y="0" ` +
          `width="${r(blockW)}" height="${r(blockH)}">` +
          `<image href="${fabUriMap[id]}" x="0" y="0" width="${r(blockW)}" height="${r(blockH)}" ` +
          `preserveAspectRatio="xMidYMid slice"/>` +
          `</pattern>`,
      )
      .join("");
    defs = `<defs>${pats}</defs>`;
  }

  let body = `<rect width="${r(blockW)}" height="${r(blockH)}" fill="#FFFFFF"/>`;

  for (let i = 0; i < cells.length; i++) {
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    body += renderCell(
      col * cellPx,
      row * cellPx,
      cellPx,
      cellPx,
      cells[i] ?? "",
      fabUriMap,
    );
  }

  for (const seam of seams) {
    const cs = seam.clipStart ?? 0;
    const ce = seam.clipEnd ?? 1;
    if (seam.axis === "h") {
      const sy = (seam.pos / 2) * cellPx;
      body +=
        `<line x1="${r((seam.cellIdx + cs) * cellPx)}" y1="${r(sy)}" ` +
        `x2="${r((seam.cellIdx + ce) * cellPx)}" y2="${r(sy)}" ` +
        `stroke="#333" stroke-width="${r(sw)}" stroke-linecap="round"/>`;
    } else {
      const sx = (seam.pos / 2) * cellPx;
      body +=
        `<line x1="${r(sx)}" y1="${r((seam.cellIdx + cs) * cellPx)}" ` +
        `x2="${r(sx)}" y2="${r((seam.cellIdx + ce) * cellPx)}" ` +
        `stroke="#333" stroke-width="${r(sw)}" stroke-linecap="round"/>`;
    }
  }

  return `<svg width="${r(blockW)}" height="${r(blockH)}" xmlns="http://www.w3.org/2000/svg">${defs}${body}</svg>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface BlockPreviewResult {
  png: Buffer;
  etag: string;
  heightPx: number;
}

/**
 * Load a block from the DB, fetch fabric photos from Supabase Storage, build
 * a self-contained SVG with embedded data URIs, and rasterise to PNG via sharp.
 *
 * Returns null if the block is not found.
 *
 * @param blockId   Quilting block ID.
 * @param sizePx    Desired PNG width in pixels (50–800). Height is derived
 *                  from the block's aspect ratio (non-square grids are supported).
 */
export async function renderBlockPreviewPng(
  blockId: number,
  sizePx: number,
): Promise<BlockPreviewResult | null> {
  const clampedSize = Math.min(800, Math.max(50, sizePx));

  // 1. Load block record
  const [row] = await db
    .select({
      cells: blocks.cells,
      gridSize: blocks.gridSize,
      seams: blocks.seams,
      createdAt: blocks.createdAt,
    })
    .from(blocks)
    .where(eq(blocks.id, blockId))
    .limit(1);
  if (!row) return null;

  const cells = (row.cells as string[]) ?? [];
  const gridSize = row.gridSize;
  const seams = (row.seams ?? []) as SeamLine[];

  // 2. Collect fabric IDs and load their storage paths
  const fabIds = Array.from(collectFabIds(cells));
  const fabUriMap: Record<number, string> = {};

  if (fabIds.length > 0) {
    const fabRows = await db
      .select({ id: fabrics.id, imagePath: fabrics.imagePath })
      .from(fabrics)
      .where(inArray(fabrics.id, fabIds));

    // 3. Download each fabric image and base64-encode as a data URI (parallel)
    await Promise.all(
      fabRows.map(async (fab) => {
        try {
          const { buffer, contentType } = await downloadImageBuffer(
            fab.imagePath,
          );
          const mime = contentType || "image/jpeg";
          fabUriMap[fab.id] =
            `data:${mime};base64,${buffer.toString("base64")}`;
        } catch (err) {
          logger.warn(
            {
              errMessage: err instanceof Error ? err.message : String(err),
              fabricId: fab.id,
            },
            "block-preview: failed to load fabric image; cell will render grey",
          );
        }
      }),
    );
  }

  // 4. Build self-contained SVG string
  const svg = buildBlockSvg(cells, gridSize, seams, clampedSize, fabUriMap);

  // 5. Rasterise with sharp
  const { default: sharp } = await import("sharp");
  const gridH = Math.max(1, Math.ceil(cells.length / gridSize));
  const cellPx = clampedSize / gridSize;
  const heightPx = Math.round(gridH * cellPx);

  const png = await sharp(Buffer.from(svg), { density: 96 })
    .resize(clampedSize, heightPx, { fit: "fill" })
    .png({ compressionLevel: 6 })
    .toBuffer();

  const etag = `"blk-${blockId}-${row.createdAt?.getTime() ?? 0}-${clampedSize}"`;
  return { png, etag, heightPx };
}
