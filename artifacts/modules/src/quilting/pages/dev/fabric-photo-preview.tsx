/**
 * DEV-ONLY — /quilting/dev/fabric-photo-preview
 *
 * "Most realistic preview before the first cut" demo.
 *
 * LEFT column: current production approach — vectorized tile-image.png tiled
 *   4× per cell (each cell repeats the SVG tile 16 times).
 *
 * RIGHT column: photo-clip approach — actual fabric PHOTO clipped to each
 *   cell shape via SVG <clipPath>. One photo per triangle/square — no tiling,
 *   no vectorization artifacts. Closest to what the cut piece will actually look like.
 *
 * No production code, infrastructure, or database changes of any kind.
 * The only new thing is fetching /api/quilting/fabrics/:id/image as blob URLs
 * (same pattern as tile pre-fetching) and a custom <PhotoBlockSvg> component.
 */

import { useMemo, useEffect, useState } from "react";
import { getScreenshotToken } from "@workspace/api-client-react";
import { parseCell } from "@/quilting/lib/cell-parser";
import {
  CURRENT_REPEATS,
  DevNav,
  ZoomPanel,
  TilesStatus,
  BlockPanel,
  FabricPhotoStrip,
  useDevData,
} from "./_shared";
import { LayoutPreviewSvg } from "@/quilting/components/LayoutPreviewSvg";
import type {
  QuiltingBlock,
  QuiltingQuiltLayout,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// usePhotoBlobMap — fetches actual fabric photos (not vectorized tiles) as blobs
// ---------------------------------------------------------------------------

function usePhotoBlobMap(fabricIds: number[]): {
  photoBlobMap: Record<number, string>;
  photoLoading: boolean;
} {
  const [photoBlobMap, setPhotoBlobMap] = useState<Record<number, string>>({});
  const [photoLoading, setPhotoLoading] = useState(false);
  const idsKey = useMemo(
    () =>
      fabricIds
        .slice()
        .sort((a, b) => a - b)
        .join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fabricIds.join(",")],
  );

  useEffect(() => {
    if (fabricIds.length === 0) return;
    let cancelled = false;
    setPhotoLoading(true);
    const token = getScreenshotToken();
    const headers: HeadersInit = token ? { "x-screenshot-token": token } : {};
    void Promise.all(
      fabricIds.map((id) =>
        fetch(`/api/quilting/fabrics/${id}/image`, {
          // raw-fetch-ok
          credentials: "include",
          headers,
        })
          .then((r) => (r.ok ? r.blob() : null))
          .then((blob): [number, string | null] =>
            blob ? [id, URL.createObjectURL(blob)] : [id, null],
          )
          .catch((): [number, null] => [id, null]),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const map: Record<number, string> = {};
      for (const [id, url] of pairs) if (url !== null) map[id] = url;
      setPhotoBlobMap(map);
      setPhotoLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return { photoBlobMap, photoLoading };
}

// ---------------------------------------------------------------------------
// PhotoBlockSvg — renders a block by clipping real fabric photos to cell shapes
// ---------------------------------------------------------------------------

type ClipEntry =
  | { id: string; kind: "poly"; points: string }
  | { id: string; kind: "rect"; x: number; y: number; w: number; h: number };

type ImgEntry = {
  clipId: string;
  fabToken: string;
  /** top-left of the CELL the image fills before clipping */
  x: number;
  y: number;
  w: number;
  h: number;
};

function buildBlockEntries(
  cells: string[],
  gridSize: number,
  cellPx: number,
  idPrefix: string,
): { clips: ClipEntry[]; imgs: ImgEntry[] } {
  const clips: ClipEntry[] = [];
  const imgs: ImgEntry[] = [];

  cells.forEach((cell, i) => {
    const p = parseCell(cell);
    const row = Math.floor(i / gridSize);
    const col = i % gridSize;
    const ox = col * cellPx;
    const oy = row * cellPx;
    const w = cellPx;
    const h = cellPx;
    const pfx = `${idPrefix}-c${i}`;

    const addRect = (
      idx: number,
      rx: number,
      ry: number,
      rw: number,
      rh: number,
      fab: string,
    ) => {
      const id = `${pfx}-${idx}`;
      clips.push({ id, kind: "rect", x: rx, y: ry, w: rw, h: rh });
      imgs.push({ clipId: id, fabToken: fab, x: ox, y: oy, w, h });
    };

    const addPoly = (idx: number, pts: string, fab: string) => {
      const id = `${pfx}-${idx}`;
      clips.push({ id, kind: "poly", points: pts });
      imgs.push({ clipId: id, fabToken: fab, x: ox, y: oy, w, h });
    };

    switch (p.kind) {
      case "solid":
        addRect(0, ox, oy, w, h, p.color);
        break;
      case "triangle":
        if (p.type === "nwse") {
          addPoly(0, `${ox},${oy} ${ox + w},${oy} ${ox + w},${oy + h}`, p.a);
          addPoly(1, `${ox},${oy} ${ox},${oy + h} ${ox + w},${oy + h}`, p.b);
        } else {
          addPoly(0, `${ox},${oy} ${ox + w},${oy} ${ox},${oy + h}`, p.a);
          addPoly(
            1,
            `${ox + w},${oy} ${ox + w},${oy + h} ${ox},${oy + h}`,
            p.b,
          );
        }
        break;
      case "quad": {
        const mx = ox + w / 2,
          my = oy + h / 2;
        addPoly(0, `${ox},${oy} ${ox + w},${oy} ${mx},${my}`, p.top);
        addPoly(1, `${ox + w},${oy} ${ox + w},${oy + h} ${mx},${my}`, p.right);
        addPoly(2, `${ox + w},${oy + h} ${ox},${oy + h} ${mx},${my}`, p.bottom);
        addPoly(3, `${ox},${oy + h} ${ox},${oy} ${mx},${my}`, p.left);
        break;
      }
      case "hsplit":
        addRect(0, ox, oy, w, h / 2, p.top);
        addRect(1, ox, oy + h / 2, w, h / 2, p.bottom);
        break;
      case "vsplit":
        addRect(0, ox, oy, w / 2, h, p.left);
        addRect(1, ox + w / 2, oy, w / 2, h, p.right);
        break;
      case "xsplit":
        addRect(0, ox, oy, w / 2, h / 2, p.tl);
        addRect(1, ox + w / 2, oy, w / 2, h / 2, p.tr);
        addRect(2, ox, oy + h / 2, w / 2, h / 2, p.bl);
        addRect(3, ox + w / 2, oy + h / 2, w / 2, h / 2, p.br);
        break;
      default:
        addRect(0, ox, oy, w, h, "");
    }
  });

  return { clips, imgs };
}

function renderClipDefs(clips: ClipEntry[]) {
  return clips.map((c) =>
    c.kind === "poly" ? (
      <clipPath key={c.id} id={c.id}>
        <polygon points={c.points} />
      </clipPath>
    ) : (
      <clipPath key={c.id} id={c.id}>
        <rect x={c.x} y={c.y} width={c.w} height={c.h} />
      </clipPath>
    ),
  );
}

function renderImgElements(
  imgs: ImgEntry[],
  photoBlobMap: Record<number, string>,
) {
  return imgs.map((img) => {
    // Resolve the fabric token to a URL or fallback color
    let url: string | null = null;
    let fallbackColor = "#D1D5DB";
    if (img.fabToken.startsWith("fab:")) {
      const id = parseInt(img.fabToken.slice(4), 10);
      url = !isNaN(id) ? (photoBlobMap[id] ?? null) : null;
    } else if (img.fabToken) {
      fallbackColor = img.fabToken; // solid color cell
    }

    return url ? (
      <image
        key={img.clipId}
        href={url}
        x={img.x}
        y={img.y}
        width={img.w}
        height={img.h}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${img.clipId})`}
      />
    ) : (
      <rect
        key={img.clipId}
        x={img.x}
        y={img.y}
        width={img.w}
        height={img.h}
        fill={fallbackColor}
        clipPath={`url(#${img.clipId})`}
      />
    );
  });
}

export function PhotoBlockSvg({
  cells,
  gridSize,
  size = 450,
  photoBlobMap,
  idPrefix = "pb",
}: {
  cells: string[];
  gridSize: number;
  size?: number;
  photoBlobMap: Record<number, string>;
  idPrefix?: string;
}) {
  const gridH = Math.max(1, Math.ceil(cells.length / gridSize));
  const cellPx = size / gridSize;
  const svgH = gridH * cellPx;
  const { clips, imgs } = buildBlockEntries(cells, gridSize, cellPx, idPrefix);

  return (
    <svg width={size} height={svgH} xmlns="http://www.w3.org/2000/svg">
      <defs>{renderClipDefs(clips)}</defs>
      <rect width={size} height={svgH} fill="#fff" />
      {renderImgElements(imgs, photoBlobMap)}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// PhotoLayoutSvg — full layout rendered with photo-clip per block cell
// ---------------------------------------------------------------------------

function PhotoLayoutSvg({
  layout,
  blocks,
  size = 500,
  photoBlobMap,
}: {
  layout: QuiltingQuiltLayout;
  blocks: QuiltingBlock[];
  size?: number;
  photoBlobMap: Record<number, string>;
}) {
  const blockMap = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  );

  const sashW = layout.sashingWidthInches ?? 0;
  const bordW = layout.borderWidthInches ?? 0;
  const sashingColor = layout.sashingColor ?? "#d4c5a9";
  const borderColor = layout.borderColor ?? "#8b6f5e";
  const cornerstoneColor = layout.cornerstoneColor ?? null;

  const unitW = layout.cols + sashW * (layout.cols - 1) + bordW * 2;
  const unitH = layout.rows + sashW * (layout.rows - 1) + bordW * 2;
  const sc = size / Math.max(unitW, unitH);
  const cellPx = sc;
  const sashPx = sashW * sc;
  const borderPx = bordW * sc;
  const W = unitW * sc;
  const H = unitH * sc;

  // Build all clips + images for all blocks flat in one SVG (unique IDs via lc index)
  const allClips: ClipEntry[] = [];
  const allImgs: ImgEntry[] = [];

  layout.cells.forEach((lc, i) => {
    const block = lc.blockId !== null ? blockMap.get(lc.blockId) : null;
    if (!block) return;
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    const bx = borderPx + col * (cellPx + sashPx);
    const by = borderPx + row * (cellPx + sashPx);
    const bCellPx = cellPx / block.gridSize;

    // For rotated blocks we render clips at non-rotated positions then apply
    // the rotation transform via a <g> — but clipPath coords are in user space
    // BEFORE the transform, so we need to account for rotation.
    // Simplification for demo: only render non-rotated blocks with photo clips;
    // rotated blocks get solid gray (rotation + clipPath interaction is complex).
    if (lc.rotation !== 0) {
      allClips.push({
        id: `plc-${i}-rot`,
        kind: "rect",
        x: bx,
        y: by,
        w: cellPx,
        h: cellPx,
      });
      allImgs.push({
        clipId: `plc-${i}-rot`,
        fabToken: "fab:0",
        x: bx,
        y: by,
        w: cellPx,
        h: cellPx,
      });
      return;
    }

    // Render each sub-cell of the block at its position in the layout SVG
    block.cells.forEach((bcell, j) => {
      const br = Math.floor(j / block.gridSize);
      const bc = j % block.gridSize;
      const subX = bx + bc * bCellPx;
      const subY = by + br * bCellPx;

      const { clips, imgs } = buildBlockEntries(
        [bcell],
        1,
        bCellPx,
        `plc-${i}-bc${j}`,
      );

      // buildBlockEntries positions at (0, 0) relative; shift to (subX, subY)
      for (const c of clips) {
        if (c.kind === "rect") {
          allClips.push({
            ...c,
            x: c.x + subX,
            y: c.y + subY,
          });
        } else {
          // Shift polygon points
          const shifted = c.points
            .split(" ")
            .map((pt) => {
              const [px, py] = pt.split(",").map(Number);
              return `${px + subX},${py + subY}`;
            })
            .join(" ");
          allClips.push({ ...c, points: shifted });
        }
      }
      // Place each sub-cell's image at the full BLOCK bounds (bx, by, cellPx,
      // cellPx) — not the tiny sub-cell bounds.  With xMidYMid slice the photo
      // fills the block area, and the clipPath cuts the triangle from within
      // that area.  This keeps each fabric at the same visual scale as the
      // block view, so the layout matches the block panels proportionally.
      for (const img of imgs) {
        allImgs.push({
          ...img,
          x: bx,
          y: by,
          w: cellPx,
          h: cellPx,
        });
      }
    });
  });

  return (
    <svg
      width={W}
      height={H}
      xmlns="http://www.w3.org/2000/svg"
      className="bg-white"
    >
      <defs>{renderClipDefs(allClips)}</defs>

      {/* Border */}
      {borderPx > 0 && (
        <rect x={0} y={0} width={W} height={H} fill={borderColor} />
      )}

      {/* Sashing or white background */}
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

      {/* Cornerstones */}
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

      {/* Empty layout cells */}
      {layout.cells.map((lc, i) => {
        if (lc.blockId !== null) return null;
        const row = Math.floor(i / layout.cols);
        const col = i % layout.cols;
        const bx = borderPx + col * (cellPx + sashPx);
        const by = borderPx + row * (cellPx + sashPx);
        return (
          <rect
            key={`empty-${i}`}
            x={bx}
            y={by}
            width={cellPx}
            height={cellPx}
            fill="#F5F5F5"
            stroke="#E0E0E0"
            strokeWidth="0.5"
          />
        );
      })}

      {/* Photo-clipped block cells */}
      {renderImgElements(allImgs, photoBlobMap)}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// PhotoBlockPanel — ZoomPanel wrapper for PhotoBlockSvg
// ---------------------------------------------------------------------------

function PhotoBlockPanel({
  block,
  photoBlobMap,
  label,
  sizePx = 450,
}: {
  block: QuiltingBlock | null;
  photoBlobMap: Record<number, string>;
  label: string;
  sizePx?: number;
}) {
  if (!block) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-8 text-sm text-muted-foreground">
        No fabric blocks found in database
      </div>
    );
  }
  const { cells, gridSize } = block;

  return (
    <ZoomPanel
      title={label}
      modalContent={
        <PhotoBlockSvg
          cells={cells}
          gridSize={gridSize}
          size={sizePx * 2}
          photoBlobMap={photoBlobMap}
          idPrefix="modal"
        />
      }
    >
      {() => (
        <PhotoBlockSvg
          cells={cells}
          gridSize={gridSize}
          size={sizePx}
          photoBlobMap={photoBlobMap}
        />
      )}
    </ZoomPanel>
  );
}

// ---------------------------------------------------------------------------
// PhotoLayoutPanel — ZoomPanel wrapper for PhotoLayoutSvg
// ---------------------------------------------------------------------------

function PhotoLayoutPanel({
  layout,
  blocks,
  photoBlobMap,
  label,
  sizePx = 500,
}: {
  layout: QuiltingQuiltLayout | null;
  blocks: QuiltingBlock[];
  photoBlobMap: Record<number, string>;
  label: string;
  sizePx?: number;
}) {
  if (!layout) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-8 text-sm text-muted-foreground">
        No saved layout found in database
      </div>
    );
  }
  return (
    <ZoomPanel
      title={label}
      modalContent={
        <PhotoLayoutSvg
          layout={layout}
          blocks={blocks}
          size={sizePx * 1.8}
          photoBlobMap={photoBlobMap}
        />
      }
    >
      {() => (
        <PhotoLayoutSvg
          layout={layout}
          blocks={blocks}
          size={sizePx}
          photoBlobMap={photoBlobMap}
        />
      )}
    </ZoomPanel>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FabricPhotoPreviewDevPage() {
  const {
    demoBlock,
    demoLayout,
    layoutBlocks,
    blobFabricUrlMap,
    tilesLoading,
    allUsedFabricIds,
    demoFabricIds,
    fabricsList,
  } = useDevData();

  const { photoBlobMap, photoLoading } = usePhotoBlobMap(allUsedFabricIds);
  const photoCount = Object.keys(photoBlobMap).length;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold">
            Most realistic preview before the first cut
          </h1>
          <p className="text-sm text-muted-foreground">
            DEV-ONLY. <strong>Right column</strong>: actual fabric photos
            clipped to each triangle / square shape via SVG{" "}
            <code>&lt;clipPath&gt;</code> — one uninterrupted photo per cut
            piece, no tiling, no vectorization. <strong>Left column</strong>:
            current production (vectorized tile, {CURRENT_REPEATS}×).
          </p>
        </div>
        <DevNav current="photo" />
      </div>

      <FabricPhotoStrip fabricIds={demoFabricIds} fabricsList={fabricsList} />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          Vectorized tiles:{" "}
          <TilesStatus
            loading={tilesLoading}
            count={Object.keys(blobFabricUrlMap).length}
          />
        </span>
        <span>
          Fabric photos:{" "}
          {photoLoading ? (
            <span className="text-muted-foreground">⏳ loading…</span>
          ) : photoCount > 0 ? (
            <span className="text-green-600">✓ {photoCount} photos loaded</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        {demoBlock && (
          <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            Block: &quot;{demoBlock.name}&quot; ({demoBlock.gridSize}×
            {demoBlock.gridSize})
          </span>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Block comparison                                                  */}
      {/* ---------------------------------------------------------------- */}
      <h2 className="border-t pt-4 text-base font-semibold">
        Block — vectorized tile vs photo-clip
      </h2>
      <p className="text-sm text-muted-foreground -mt-2">
        Each triangle in the right panel is one real fabric photo clipped to
        that shape. The photo scale matches the cell —{" "}
        <code>preserveAspectRatio=&quot;xMidYMid slice&quot;</code> — the photo
        fills each cell and the clipPath cuts the shape, so each triangle or
        rectangle shows the proportional piece of the swatch (quarter triangle =
        quarter of photo, half = half, etc.).
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">
            Production — vectorized tile {CURRENT_REPEATS}×
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={CURRENT_REPEATS}
            label={
              demoBlock
                ? `Block: "${demoBlock.name}" — vectorized ${CURRENT_REPEATS}×`
                : "Block"
            }
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-green-700">
            Photo-clip — one real photo per shape ✦ most realistic
          </p>
          <PhotoBlockPanel
            block={demoBlock}
            photoBlobMap={photoBlobMap}
            label={
              demoBlock
                ? `Block: "${demoBlock.name}" — photo per shape`
                : "Block"
            }
          />
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Layout comparison                                                 */}
      {/* ---------------------------------------------------------------- */}
      <h2 className="border-t pt-6 text-base font-semibold">
        Layout — vectorized tile vs photo-clip
      </h2>
      <p className="text-sm text-muted-foreground -mt-2">
        Right panel applies the same photo-clip approach to every block in the
        layout. Each sub-cell triangle / square shows its fabric photo cropped
        to that exact shape. Rotated blocks (if any) fall back to gray — SVG
        clipPath + rotation interaction requires a coordinate transform that
        would complicate this demo.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">
            Production — vectorized tile {CURRENT_REPEATS}×
          </p>
          <ZoomPanel
            title={
              demoLayout
                ? `Layout: "${demoLayout.name}" — vectorized ${CURRENT_REPEATS}×`
                : "Layout"
            }
            modalContent={
              demoLayout ? (
                <LayoutPreviewSvg
                  layout={demoLayout}
                  blocks={layoutBlocks}
                  size={900}
                  fabricUrlMap={blobFabricUrlMap}
                  fabricTileRepeats={CURRENT_REPEATS}
                />
              ) : undefined
            }
          >
            {() =>
              demoLayout ? (
                <LayoutPreviewSvg
                  layout={demoLayout}
                  blocks={layoutBlocks}
                  size={500}
                  fabricUrlMap={blobFabricUrlMap}
                  fabricTileRepeats={CURRENT_REPEATS}
                />
              ) : (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  No layout found
                </div>
              )
            }
          </ZoomPanel>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-green-700">
            Photo-clip — one real photo per shape ✦ most realistic
          </p>
          <PhotoLayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            photoBlobMap={photoBlobMap}
            label={
              demoLayout
                ? `Layout: "${demoLayout.name}" — photo per shape`
                : "Layout"
            }
          />
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Tradeoff notes                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="border-t pt-6 space-y-2 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">
          Tradeoff: photo-clip vs vectorized tile
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>Photo-clip advantages:</strong> shows real texture / grain /
            print variation; no posterization artifacts; the quilter sees
            exactly what their cut piece will look like; colour accuracy is
            perfect; works for any cell shape without re-generating tiles.
          </li>
          <li>
            <strong>Photo-clip disadvantages:</strong> large photos are heavy
            (each download is the full swatch image, not a small tile); seam
            allowance is not accounted for (the photo shows the full cut piece,
            not the finished sewn size); when you have 50+ blocks in a layout
            each with 2 fabrics that's 100+ full-image downloads.
          </li>
          <li>
            <strong>Vectorized tile advantages:</strong> tiny file size (SVG
            paths, compressed); no download per-cell; renders instantly once
            cached; works well for solid-colour and simple-print fabrics.
          </li>
          <li>
            <strong>Best-of-both path:</strong> pre-clip the photo to each shape
            at storage time (on upload or tile-generate) and cache the clipped
            PNGs. This avoids per-load heavy downloads while keeping real-photo
            realism. Requires 3–4 clipped variants per fabric (square, NWSE
            triangle, NESW triangle, quarter-square if needed).
          </li>
        </ul>
      </div>
    </div>
  );
}
