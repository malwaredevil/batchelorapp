import { parseCell } from "@/lib/cell-parser";

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

export function svgCellStr(
  x: number,
  y: number,
  w: number,
  h: number,
  cell: string,
  fabricUrlMap?: Record<string, string>,
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
  fabricUrlMap?: Record<string, string>,
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

  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#FFFFFF"/>${defs}${shapes.join("")}</svg>`;
}

export function downloadAsSvg(svgStr: string, filename: string): void {
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadSvgAsJpeg(
  svgStr: string,
  filename: string,
): Promise<void> {
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
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          resolve();
        },
        "image/jpeg",
        0.95,
      );
    });
  } catch {
    URL.revokeObjectURL(svgUrl);
    throw new Error("Export failed");
  }
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
    const resp = await fetch(url, { credentials: "include" });
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch {
    window.open(url, "_blank");
  }
}

export async function downloadSvgAsPng(
  svgStr: string,
  filename: string,
): Promise<void> {
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
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("toBlob failed"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      }, "image/png");
    });
  } catch {
    URL.revokeObjectURL(svgUrl);
    throw new Error("Export failed");
  }
}
