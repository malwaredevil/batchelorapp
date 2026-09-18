import { parseCell } from "@/quilting/lib/cell-parser";
import { downloadBlob, downloadText } from "@workspace/web-core/download";

/** Extract unique fabric IDs referenced by `fab:{id}` colours in cell strings. */
function extractFabricIds(cells: string[]): string[] {
  const ids = new Set<string>();
  const re = /\bfab:(\d+)/g;
  for (const cell of cells) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(cell)) !== null) {
      ids.add(m[1]);
    }
  }
  return Array.from(ids);
}

type LayoutExportCell = {
  blockId: number | null;
  rotation: 0 | 90 | 180 | 270;
};

export type LayoutExportInput = {
  rows: number;
  cols: number;
  cells: LayoutExportCell[];
  sashingWidthInches?: number | null;
  sashingColor?: string | null;
  borderWidthInches?: number | null;
  borderColor?: string | null;
  cornerstoneColor?: string | null;
};

export type LayoutExportBlock = {
  id: number;
  gridSize: number;
  cells: string[];
};

export type RasterExportOptions = {
  fabricNames?: Record<number, string>;
};
export type FabricUrlMap = Record<string, string>;

export function svgCellStr(
  x: number,
  y: number,
  w: number,
  h: number,
  cell: string,
  fabricUrlMap?: FabricUrlMap,
): string {
  const p = parseCell(cell);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = Math.max(0.4, w * 0.04);
  const resolveColor = (c: string, fallback = "#FFFFFF") => {
    if (c.startsWith("fab:")) {
      const id = c.slice(4);
      return fabricUrlMap?.[id] ? `url(#fab-${id})` : "#D1D5DB";
    }
    return c || fallback;
  };
  switch (p.kind) {
    case "solid":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${resolveColor(p.color)}"/>`;
    case "triangle":
      if (p.type === "nwse") {
        return (
          `<polygon points="${x},${y} ${x + w},${y} ${x + w},${y + h}" fill="${resolveColor(p.a)}"/>` +
          `<polygon points="${x},${y} ${x},${y + h} ${x + w},${y + h}" fill="${resolveColor(p.b)}"/>`
        );
      }
      return (
        `<polygon points="${x},${y} ${x + w},${y} ${x},${y + h}" fill="${resolveColor(p.a)}"/>` +
        `<polygon points="${x + w},${y} ${x},${y + h} ${x + w},${y + h}" fill="${resolveColor(p.b)}"/>`
      );
    case "quad":
      return (
        `<polygon points="${x},${y} ${x + w},${y} ${cx},${cy}" fill="${resolveColor(p.top)}"/>` +
        `<polygon points="${x + w},${y} ${x + w},${y + h} ${cx},${cy}" fill="${resolveColor(p.right)}"/>` +
        `<polygon points="${x + w},${y + h} ${x},${y + h} ${cx},${cy}" fill="${resolveColor(p.bottom)}"/>` +
        `<polygon points="${x},${y + h} ${x},${y} ${cx},${cy}" fill="${resolveColor(p.left)}"/>`
      );
    case "hsplit":
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h / 2}" fill="${resolveColor(p.top)}"/>` +
        `<rect x="${x}" y="${y + h / 2}" width="${w}" height="${h / 2}" fill="${resolveColor(p.bottom)}"/>`
      );
    case "vsplit":
      return (
        `<rect x="${x}" y="${y}" width="${w / 2}" height="${h}" fill="${resolveColor(p.left)}"/>` +
        `<rect x="${x + w / 2}" y="${y}" width="${w / 2}" height="${h}" fill="${resolveColor(p.right)}"/>`
      );
    case "xsplit":
      return (
        `<rect x="${x}" y="${y}" width="${w / 2}" height="${h / 2}" fill="${resolveColor(p.tl)}"/>` +
        `<rect x="${x + w / 2}" y="${y}" width="${w / 2}" height="${h / 2}" fill="${resolveColor(p.tr)}"/>` +
        `<rect x="${x}" y="${y + h / 2}" width="${w / 2}" height="${h / 2}" fill="${resolveColor(p.bl)}"/>` +
        `<rect x="${x + w / 2}" y="${y + h / 2}" width="${w / 2}" height="${h / 2}" fill="${resolveColor(p.br)}"/>`
      );
    case "line": {
      const [x1, y1, x2, y2] =
        p.type === "nwse"
          ? [x + p.cs * w, y + p.cs * h, x + p.ce * w, y + p.ce * h]
          : [
              x + (1 - p.cs) * w,
              y + p.cs * h,
              x + (1 - p.ce) * w,
              y + p.ce * h,
            ];
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFFFFF"/>` +
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="${sw}"/>`
      );
    }
    case "xline": {
      const { nwseCs, nwseCe, neswCs, neswCe } = p;
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFFFFF"/>`;
      if (nwseCe > nwseCs)
        s += `<line x1="${x + nwseCs * w}" y1="${y + nwseCs * h}" x2="${x + nwseCe * w}" y2="${y + nwseCe * h}" stroke="#555" stroke-width="${sw}"/>`;
      if (neswCe > neswCs)
        s += `<line x1="${x + (1 - neswCs) * w}" y1="${y + neswCs * h}" x2="${x + (1 - neswCe) * w}" y2="${y + neswCe * h}" stroke="#555" stroke-width="${sw}"/>`;
      return s;
    }
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFFFFF"/>`;
  }
}

/**
 * Build a full SVG string for a tiled block design.
 * Pass `fabricUrlMap` (id → signed URL) to render fabric image fills; without
 * it fabric cells fall back to a grey placeholder.
 */
export function buildBlockSvgString(
  cells: string[],
  gridSize: number,
  tileCount: number,
  size: number,
  fabricUrlMap?: FabricUrlMap,
): string {
  const cellPx = size / (gridSize * tileCount);
  const shapes: string[] = [];
  for (let t = 0; t < tileCount * tileCount; t++) {
    const tr = Math.floor(t / tileCount);
    const tc = t % tileCount;
    for (let i = 0; i < Math.min(cells.length, gridSize * gridSize); i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      shapes.push(
        svgCellStr(
          (tc * gridSize + col) * cellPx,
          (tr * gridSize + row) * cellPx,
          cellPx,
          cellPx,
          cells[i] ?? "",
          fabricUrlMap,
        ),
      );
    }
  }

  let defs = "";
  if (fabricUrlMap) {
    const ids = extractFabricIds(cells).filter((id) => fabricUrlMap[id]);
    if (ids.length > 0) {
      const patterns = ids
        .map(
          (id) =>
            `<pattern id="fab-${id}" patternUnits="userSpaceOnUse" width="${cellPx}" height="${cellPx}">` +
            `<image href="${fabricUrlMap[id]}" width="${cellPx}" height="${cellPx}" preserveAspectRatio="xMidYMid slice"/>` +
            `</pattern>`,
        )
        .join("");
      defs = `<defs>${patterns}</defs>`;
    }
  }

  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#FFFFFF"/>${defs}${shapes.join("")}</svg>`;
}

/** Build the same full-colour SVG representation used by layout previews. */
export function buildLayoutSvgString(
  layout: LayoutExportInput,
  blockMap: Map<number, LayoutExportBlock>,
  size: number,
  fabricUrlMap: FabricUrlMap = {},
): string {
  const sashW = layout.sashingWidthInches ?? 0;
  const bordW = layout.borderWidthInches ?? 0;
  const sashingColor = layout.sashingColor ?? "#d4c5a9";
  const borderColor = layout.borderColor ?? "#8b6f5e";
  const cornerstoneColor = layout.cornerstoneColor ?? null;
  const unitW = layout.cols + sashW * (layout.cols - 1) + bordW * 2;
  const unitH = layout.rows + sashW * (layout.rows - 1) + bordW * 2;
  const scale = size / Math.max(unitW, unitH);
  const cellPx = scale;
  const sashPx = sashW * scale;
  const borderPx = bordW * scale;
  const width = unitW * scale;
  const height = unitH * scale;
  const referencedCells = layout.cells.flatMap((cell) =>
    cell.blockId === null ? [] : (blockMap.get(cell.blockId)?.cells ?? []),
  );
  const trimValues = [sashingColor, borderColor, cornerstoneColor ?? ""];
  const fabricIds = extractFabricIds([
    ...referencedCells,
    ...trimValues,
  ]).filter((id) => fabricUrlMap[Number(id)]);
  const resolveFill = (value: string) => {
    if (!value.startsWith("fab:")) return value;
    const id = value.slice(4);
    return fabricUrlMap[Number(id)] ? `url(#fab-${id})` : "#D1D5DB";
  };
  const patterns = fabricIds
    .map(
      (id) =>
        `<pattern id="fab-${id}" patternUnits="userSpaceOnUse" width="${cellPx}" height="${cellPx}">` +
        `<image href="${fabricUrlMap[Number(id)]}" width="${cellPx}" height="${cellPx}" preserveAspectRatio="xMidYMid slice"/>` +
        `</pattern>`,
    )
    .join("");
  const parts = [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
  ];
  if (patterns) parts.push(`<defs>${patterns}</defs>`);
  if (borderPx > 0) {
    parts.push(
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${resolveFill(borderColor)}"/>`,
    );
  }
  parts.push(
    `<rect x="${borderPx}" y="${borderPx}" width="${width - borderPx * 2}" height="${height - borderPx * 2}" fill="${sashPx > 0 ? resolveFill(sashingColor) : "#FFFFFF"}"/>`,
  );
  if (sashPx > 0 && cornerstoneColor) {
    for (let row = 0; row < layout.rows - 1; row++) {
      for (let col = 0; col < layout.cols - 1; col++) {
        const x = borderPx + (col + 1) * (cellPx + sashPx) - sashPx;
        const y = borderPx + (row + 1) * (cellPx + sashPx) - sashPx;
        parts.push(
          `<rect x="${x}" y="${y}" width="${sashPx}" height="${sashPx}" fill="${resolveFill(cornerstoneColor)}"/>`,
        );
      }
    }
  }
  layout.cells.forEach((cell, index) => {
    const row = Math.floor(index / layout.cols);
    const col = index % layout.cols;
    const x = borderPx + col * (cellPx + sashPx);
    const y = borderPx + row * (cellPx + sashPx);
    const block =
      cell.blockId === null ? undefined : blockMap.get(cell.blockId);
    if (!block) {
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellPx}" height="${cellPx}" fill="#F5F5F5" stroke="#E0E0E0" stroke-width="0.5"/>`,
      );
      return;
    }
    const blockCellPx = cellPx / block.gridSize;
    const cx = x + cellPx / 2;
    const cy = y + cellPx / 2;
    parts.push(`<g transform="rotate(${cell.rotation}, ${cx}, ${cy})">`);
    block.cells.forEach((blockCell, blockIndex) => {
      const blockRow = Math.floor(blockIndex / block.gridSize);
      const blockCol = blockIndex % block.gridSize;
      parts.push(
        svgCellStr(
          x + blockCol * blockCellPx,
          y + blockRow * blockCellPx,
          blockCellPx,
          blockCellPx,
          blockCell,
          fabricUrlMap,
        ),
      );
    });
    parts.push("</g>");
  });
  parts.push("</svg>");
  return parts.join("");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Fabric image could not be encoded"));
      }
    };
    reader.onerror = () =>
      reject(new Error("Fabric image could not be encoded"));
    reader.readAsDataURL(blob);
  });
}

async function fetchFabricImage(url: string): Promise<Blob> {
  const controller = new AbortController();
  // Fixed client-side safety bound for export liveness, not owner-facing configuration.
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Not an image");
    return blob;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build a portable layout SVG by replacing each referenced fabric image URL
 * with embedded image data. Throws rather than exporting a partially-coloured
 * file when an available fabric image cannot be fetched or encoded.
 */
export async function buildEmbeddedLayoutSvgString(
  layout: LayoutExportInput,
  blockMap: Map<number, LayoutExportBlock>,
  size: number,
  fabricUrlMap: FabricUrlMap = {},
  options?: RasterExportOptions,
): Promise<string> {
  const referencedCells = layout.cells.flatMap((cell) =>
    cell.blockId === null ? [] : (blockMap.get(cell.blockId)?.cells ?? []),
  );
  const ids = extractFabricIds([
    ...referencedCells,
    layout.sashingColor ?? "",
    layout.borderColor ?? "",
    layout.cornerstoneColor ?? "",
  ]).filter((id) => fabricUrlMap[Number(id)]);

  const embeddedEntries = await Promise.all(
    ids.map(async (id) => {
      try {
        const blob = await fetchFabricImage(fabricUrlMap[Number(id)]);
        return [Number(id), await blobToDataUrl(blob)] as const;
      } catch (error) {
        if (error instanceof RasterExportError) throw error;
        throw new RasterExportError(
          Number(id),
          options?.fabricNames?.[Number(id)],
        );
      }
    }),
  );

  return buildLayoutSvgString(
    layout,
    blockMap,
    size,
    Object.fromEntries(embeddedEntries),
  );
}

export function downloadAsSvg(svgStr: string, filename: string): void {
  downloadText(svgStr, filename, "image/svg+xml;charset=utf-8");
}

export async function downloadSvgAsJpeg(
  svgStr: string,
  filename: string,
  options?: RasterExportOptions,
): Promise<void> {
  await downloadSvgAsRaster(svgStr, filename, "image/jpeg", options, 0.95);
}

/**
 * Download an image from an authenticated URL (fabric/pattern/quilt photo).
 * Falls back to opening in a new tab if fetch/blob fails.
 */
export async function downloadCollectionImage(
  url: string,
  filename: string,
): Promise<void> {
  try {
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const ext = blob.type.includes("png")
      ? "png"
      : blob.type.includes("webp")
        ? "webp"
        : "jpg";
    const fname = /\.(jpg|jpeg|png|webp)$/i.test(filename)
      ? filename
      : `${filename}.${ext}`;
    downloadBlob(blob, fname);
  } catch {
    window.open(url, "_blank");
  }
}

export async function downloadSvgAsPng(
  svgStr: string,
  filename: string,
  options?: RasterExportOptions,
): Promise<void> {
  await downloadSvgAsRaster(svgStr, filename, "image/png", options);
}

async function downloadSvgAsRaster(
  svgStr: string,
  filename: string,
  mimeType: "image/jpeg" | "image/png",
  options?: RasterExportOptions,
  quality?: number,
): Promise<void> {
  await preflightFabricImages(svgStr, options);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("SVG render failed"));
      i.src = svgUrl;
    });
    URL.revokeObjectURL(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("toBlob failed"));
            return;
          }
          downloadBlob(blob, filename);
          resolve();
        },
        mimeType,
        quality,
      );
    });
  } catch (error) {
    if (error instanceof RasterExportError) throw error;
    throw new RasterExportError();
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

type FabricImageRef = {
  id: number;
  url: string;
};

async function preflightFabricImages(
  svgStr: string,
  options?: RasterExportOptions,
): Promise<void> {
  const refs = extractFabricImageRefs(svgStr);
  const results = await Promise.allSettled(
    refs.map((ref) => loadExportImage(ref.url)),
  );
  const failedIndex = results.findIndex(
    (result) => result.status === "rejected",
  );
  if (failedIndex !== -1) {
    const failed = refs[failedIndex];
    throw new RasterExportError(failed.id, options?.fabricNames?.[failed.id]);
  }
}

export class RasterExportError extends Error {
  readonly fabricId?: number;

  constructor(fabricId?: number, fabricName?: string) {
    const label = fabricName
      ? `“${fabricName}” (fabric #${fabricId})`
      : fabricId !== undefined
        ? `fabric #${fabricId}`
        : null;
    super(
      label
        ? `Couldn’t load the photo for ${label}. Try the download again. If it still fails, open that fabric and replace its photo.`
        : "Couldn’t create the download. Try again. If it still fails, download as SVG instead.",
    );
    this.name = "RasterExportError";
    this.fabricId = fabricId;
  }
}

function loadExportImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    // Fixed client-side safety bound for export liveness, not owner-facing configuration.
    let timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      reject(new Error("Image load timed out"));
    }, 30_000);
    image.onload = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

function extractFabricImageRefs(svgStr: string): FabricImageRef[] {
  const refs: FabricImageRef[] = [];
  const seen = new Set<number>();
  const patternRe =
    /<pattern\b[^>]*\bid=["'](?:layout-)?fab-(\d+)["'][^>]*>[\s\S]*?<image\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/pattern>/gi;
  let match: RegExpExecArray | null;
  while ((match = patternRe.exec(svgStr)) !== null) {
    const id = Number(match[1]);
    if (!seen.has(id)) {
      seen.add(id);
      refs.push({ id, url: decodeXmlEntities(match[2]) });
    }
  }
  return refs;
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt);|&#(?:x([0-9a-f]+)|(\d+));/gi,
    (entity, hex: string | undefined, decimal: string | undefined) => {
      const namedEntity = entity.toLowerCase();
      if (namedEntity === "&amp;") return "&";
      if (namedEntity === "&quot;") return '"';
      if (namedEntity === "&apos;") return "'";
      if (namedEntity === "&lt;") return "<";
      if (namedEntity === "&gt;") return ">";
      const codePoint = hex
        ? Number.parseInt(hex, 16)
        : decimal
          ? Number.parseInt(decimal, 10)
          : Number.NaN;
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}
