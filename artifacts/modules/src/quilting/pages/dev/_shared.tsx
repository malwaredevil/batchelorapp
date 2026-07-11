/**
 * Shared utilities for quilting dev pages under /quilting/dev/.
 * DEV-ONLY — never imported from production code.
 */

import {
  useRef,
  useState,
  useMemo,
  useEffect,
  useId,
  type WheelEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ZoomIn } from "lucide-react";
import {
  useListBlocks,
  useListLayouts,
  useListFabrics,
  getScreenshotToken,
} from "@workspace/api-client-react";
import type {
  QuiltingBlock,
  QuiltingQuiltLayout,
} from "@workspace/api-client-react";
import { BlockPreviewSvg } from "@/quilting/components/BlockPreviewSvg";
import { LayoutPreviewSvg } from "@/quilting/components/LayoutPreviewSvg";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { buildFabricUrlMap } from "@/quilting/components/FabricPicker";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CURRENT_REPEATS = 4;
export const SWATCH_WIDTH_IN = 3;

// ---------------------------------------------------------------------------
// DevNav — cross-page navigation
// ---------------------------------------------------------------------------

export function DevNav({
  current,
}: {
  current: "compare" | "density" | "size" | "pipeline" | "photo";
}) {
  const pages = [
    {
      id: "compare" as const,
      href: "/modules/quilting/dev/fabric-compare",
      label: "Overview",
    },
    {
      id: "density" as const,
      href: "/modules/quilting/dev/fabric-density",
      label: "Density comparison",
    },
    {
      id: "size" as const,
      href: "/modules/quilting/dev/fabric-size",
      label: "3\u2033 vs 5\u2033 size",
    },
    {
      id: "pipeline" as const,
      href: "/modules/quilting/dev/fabric-pipeline",
      label: "Pipeline A variants",
    },
    {
      id: "photo" as const,
      href: "/modules/quilting/dev/fabric-photo-preview",
      label: "Photo-clip \u2728 most realistic",
    },
  ];
  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      {pages.map((p) => (
        <a
          key={p.id}
          href={p.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`rounded border px-3 py-1 ${
            current === p.id
              ? "border-primary bg-primary text-primary-foreground"
              : "hover:bg-muted"
          }`}
        >
          {p.label}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// useZoomPan
// ---------------------------------------------------------------------------

export function useZoomPan() {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setScale((s) => Math.min(8, Math.max(0.5, s + s * delta)));
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    });
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return {
    scale,
    offset,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    reset,
    setScale,
  };
}

// ---------------------------------------------------------------------------
// ZoomPanel — scroll-to-zoom / drag-to-pan viewport + optional fullscreen modal
// ---------------------------------------------------------------------------

export function ZoomPanel({
  title,
  children,
  modalContent,
}: {
  title: string;
  children: (scale: number) => ReactNode;
  modalContent?: ReactNode;
}) {
  const {
    scale,
    offset,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    reset,
    setScale,
  } = useZoomPan();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <button
              type="button"
              className="rounded border px-2 py-1 hover:bg-muted"
              onClick={() => setScale((s) => Math.min(8, s + 0.5))}
            >
              +
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 hover:bg-muted"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.5))}
            >
              −
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 hover:bg-muted"
              onClick={reset}
            >
              Reset
            </button>
            <span className="w-10 text-center tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            {modalContent !== undefined && (
              <button
                type="button"
                title="Expand in fullscreen"
                className="ml-1 rounded border p-1 hover:bg-muted"
                onClick={() => setModalOpen(true)}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div
          className="relative h-[480px] w-full cursor-grab overflow-hidden rounded border bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#f8fafc_0%_50%)] bg-[length:16px_16px] active:cursor-grabbing"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <div
            className="absolute left-1/2 top-1/2 origin-center"
            style={{
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          >
            {children(scale)}
          </div>
        </div>
      </div>
      {modalContent !== undefined && (
        <PreviewZoomModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={title}
        >
          {modalContent}
        </PreviewZoomModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// useFabricTileBlobs
// ---------------------------------------------------------------------------

export function useFabricTileBlobs(fabricIds: number[]): {
  blobMap: Record<number, string>;
  loading: boolean;
} {
  const [blobMap, setBlobMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const idsKey = fabricIds
    .slice()
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (fabricIds.length === 0) return;
    let cancelled = false;
    setLoading(true);

    const token = getScreenshotToken();
    const headers: HeadersInit = token ? { "x-screenshot-token": token } : {};

    void Promise.all(
      fabricIds.map((id) =>
        fetch(`/api/quilting/fabrics/${id}/tile-image.png`, {
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
      setBlobMap(map);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return { blobMap, loading };
}

// ---------------------------------------------------------------------------
// Helpers for live comparison panels
// ---------------------------------------------------------------------------

export function toBlockCells(b: QuiltingBlock) {
  return {
    cells: b.cells,
    gridSize: b.gridSize,
    gridHeight: undefined as number | undefined,
  };
}

export function BlockPanel({
  block,
  fabricUrlMap,
  fabricTileRepeats,
  label,
  sizePx = 450,
}: {
  block: QuiltingBlock | null;
  fabricUrlMap: Record<number, string>;
  fabricTileRepeats: number;
  label: string;
  sizePx?: number;
}) {
  // Unique prefix per instance so SVG pattern IDs don't collide across panels
  const rawId = useId();
  const prefix = rawId.replace(/[^a-zA-Z0-9-_]/g, "") + "-";

  if (!block) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-8 text-sm text-muted-foreground">
        No fabric blocks found in database
      </div>
    );
  }
  const { cells, gridSize, gridHeight } = toBlockCells(block);
  return (
    <ZoomPanel
      title={label}
      modalContent={
        <BlockPreviewSvg
          cells={cells}
          gridSize={gridSize}
          gridHeight={gridHeight}
          size={Math.round(sizePx * 2)}
          tileCount={1}
          fabricUrlMap={fabricUrlMap}
          fabricTileRepeats={fabricTileRepeats}
          patternPrefix={prefix + "modal-"}
        />
      }
    >
      {() => (
        <BlockPreviewSvg
          cells={cells}
          gridSize={gridSize}
          gridHeight={gridHeight}
          size={sizePx}
          tileCount={1}
          fabricUrlMap={fabricUrlMap}
          fabricTileRepeats={fabricTileRepeats}
          patternPrefix={prefix}
        />
      )}
    </ZoomPanel>
  );
}

export function LayoutPanel({
  layout,
  blocks,
  fabricUrlMap,
  fabricTileRepeats,
  label,
  sizePx = 500,
}: {
  layout: QuiltingQuiltLayout | null;
  blocks: QuiltingBlock[];
  fabricUrlMap: Record<number, string>;
  fabricTileRepeats: number;
  label: string;
  sizePx?: number;
}) {
  // Unique prefix per instance so SVG pattern IDs don't collide across panels
  const rawId = useId();
  const prefix = rawId.replace(/[^a-zA-Z0-9-_]/g, "") + "-";

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
        <LayoutPreviewSvg
          layout={layout}
          blocks={blocks}
          size={Math.round(sizePx * 1.8)}
          fabricUrlMap={fabricUrlMap}
          fabricTileRepeats={fabricTileRepeats}
          patternPrefix={prefix + "modal-"}
        />
      }
    >
      {() => (
        <LayoutPreviewSvg
          layout={layout}
          blocks={blocks}
          size={sizePx}
          fabricUrlMap={fabricUrlMap}
          fabricTileRepeats={fabricTileRepeats}
          patternPrefix={prefix}
        />
      )}
    </ZoomPanel>
  );
}

// ---------------------------------------------------------------------------
// useDevData — shared data-loading hook for all dev pages
// ---------------------------------------------------------------------------

export function useDevData() {
  const { data: allBlocks = [] } = useListBlocks();
  const { data: allLayouts = [] } = useListLayouts();
  const { data: fabricsData } = useListFabrics({ pageSize: 200 });
  const fabricsList = fabricsData?.items;

  const fabricUrlMap = useMemo(
    () => buildFabricUrlMap(fabricsList ?? []),
    [fabricsList],
  );

  const demoBlock: QuiltingBlock | null = useMemo(
    () =>
      allBlocks.find((b) => b.cells.some((c) => c.includes("fab:"))) ?? null,
    [allBlocks],
  );

  const demoFabricIds = useMemo<number[]>(() => {
    if (!demoBlock) return [];
    const ids = new Set<number>();
    for (const cell of demoBlock.cells) {
      const parts = cell.split(":");
      for (let i = 0; i < parts.length - 1; i++) {
        if (parts[i] === "fab") ids.add(Number(parts[i + 1]));
      }
    }
    return [...ids];
  }, [demoBlock]);

  const demoLayout: QuiltingQuiltLayout | null = allLayouts[0] ?? null;

  const layoutBlockIds = useMemo(() => {
    if (!demoLayout) return new Set<number>();
    return new Set(
      demoLayout.cells
        .filter((c) => c.blockId !== null)
        .map((c) => c.blockId as number),
    );
  }, [demoLayout]);

  const layoutBlocks = useMemo(
    () => allBlocks.filter((b) => layoutBlockIds.has(b.id)),
    [allBlocks, layoutBlockIds],
  );

  const allUsedFabricIds = useMemo<number[]>(() => {
    const ids = new Set<number>();
    const extract = (cells: string[]) => {
      for (const cell of cells) {
        const parts = cell.split(":");
        for (let i = 0; i < parts.length - 1; i++) {
          if (parts[i] === "fab") {
            const n = Number(parts[i + 1]);
            if (!isNaN(n) && n > 0) ids.add(n);
          }
        }
      }
    };
    if (demoBlock) extract(demoBlock.cells);
    for (const b of layoutBlocks) extract(b.cells);
    return [...ids];
  }, [demoBlock, layoutBlocks]);

  const { blobMap: blobFabricUrlMap, loading: tilesLoading } =
    useFabricTileBlobs(allUsedFabricIds);

  return {
    allBlocks,
    fabricUrlMap,
    fabricsList,
    demoBlock,
    demoFabricIds,
    demoLayout,
    layoutBlocks,
    blobFabricUrlMap,
    tilesLoading,
    allUsedFabricIds,
  };
}

// ---------------------------------------------------------------------------
// TilesStatus — loading/loaded badge for section headers
// ---------------------------------------------------------------------------

export function TilesStatus({
  loading,
  count,
}: {
  loading: boolean;
  count: number;
}) {
  if (loading) {
    return (
      <span className="text-sm font-normal text-muted-foreground">
        ⏳ loading fabric tiles…
      </span>
    );
  }
  if (count > 0) {
    return (
      <span className="text-sm font-normal text-green-600">
        ✓ {count} fabric tiles loaded
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// useFabricPhotos + FabricPhotoStrip — show original swatch photos
// ---------------------------------------------------------------------------

/**
 * Fetches the real fabric swatch photos for the given fabric IDs as blob URLs.
 * Uses the same credentials/screenshot-token pattern as useFabricTileBlobs.
 */
export function useFabricPhotos(fabricIds: number[]): {
  photoMap: Record<number, string>;
  loading: boolean;
} {
  const [photoMap, setPhotoMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const key = fabricIds.join(",");

  useEffect(() => {
    if (!fabricIds.length) return;
    let alive = true;
    setLoading(true);
    const token = getScreenshotToken();

    Promise.all(
      fabricIds.map(async (id) => {
        try {
          const resp = await fetch(`/api/quilting/fabrics/${id}/image`, {
            // raw-fetch-ok
            credentials: "include",
            headers: token ? { "x-screenshot-token": token } : {},
          });
          if (!resp.ok) return [id, null] as const;
          const blob = await resp.blob();
          return [id, URL.createObjectURL(blob)] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      const map: Record<number, string> = {};
      for (const [id, url] of entries) {
        if (url) map[id] = url;
      }
      setPhotoMap(map);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { photoMap, loading };
}

type FabricStub = { id: number; name: string };

/**
 * A small horizontal strip showing the real swatch photos of the fabrics used
 * in the demo block, so you can see the raw material on every dev page.
 */
export function FabricPhotoStrip({
  fabricIds,
  fabricsList,
}: {
  fabricIds: number[];
  fabricsList?: FabricStub[] | null;
}) {
  const { photoMap, loading } = useFabricPhotos(fabricIds);
  const nameMap = useMemo(
    () => new Map((fabricsList ?? []).map((f) => [f.id, f.name])),
    [fabricsList],
  );

  if (!fabricIds.length) return null;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <p className="w-full text-xs font-semibold text-muted-foreground">
        Original swatch photos used in demo block:
      </p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading photos…</p>
      ) : (
        fabricIds.map((id) => (
          <div key={id} className="flex flex-col items-center gap-1">
            {photoMap[id] ? (
              <img
                src={photoMap[id]}
                alt={nameMap.get(id) ?? `Fabric ${id}`}
                className="h-24 w-24 rounded border object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">
                No photo
              </div>
            )}
            <span className="w-24 truncate text-center text-xs text-muted-foreground">
              {nameMap.get(id) ?? `#${id}`}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Direction A helpers (used by fabric-pipeline.tsx)
// ---------------------------------------------------------------------------

export type TileMethod =
  | "original"
  | "v2"
  | "posterized"
  | "vectorized"
  | "vectorized-smooth"
  | "vectorized-crisp"
  | "vectorized-3pass"
  | "vectorized-ultra-smooth"
  | "vectorized-max-detail";

export const fabricTileUrl = (fabricId: number, method: TileMethod) =>
  `/api/quilting/dev/fabric-tile-experiment/${fabricId}/${method}`;

/** All pipeline stages from raw photo through to the shipped production tile. */
export const ALL_PIPELINE_VARIANTS: {
  method: TileMethod;
  title: string;
  stage: string;
  description: string;
  isProduction?: boolean;
}[] = [
  {
    method: "original",
    stage: "Stage 0",
    title: "Original photo",
    description:
      "Raw fabric swatch photo, no processing — the starting point for the entire pipeline.",
  },
  {
    method: "v2",
    stage: "Stage 1",
    title: "Flat-field correction",
    description:
      "Percentile-anchored flat-field division removes lighting gradients and vignette from the raw photo.",
  },
  {
    method: "posterized",
    stage: "Stage 2",
    title: "Posterized (ready to vectorize)",
    description:
      "Flat-field + texture-suppression blur + no-dither palette reduction. This raster is fed into VTracer.",
  },
  {
    method: "vectorized",
    stage: "Stage 3 — Direction A",
    title: "Baseline vectorized",
    description:
      "Two-pass flat-field, 6-color posterize, standard VTracer settings — the first Direction A result.",
  },
  {
    method: "vectorized-smooth",
    stage: "Stage 4 — Direction A",
    title: "Smooth",
    description:
      "5 posterize colors + heavier blur + looser VTracer corner threshold — grain flattens into fewer, cleaner regions.",
  },
  {
    method: "vectorized-crisp",
    stage: "Stage 5 — Direction A",
    title: "Crisp",
    description:
      "Lighter blur + 8 posterize colors + higher VTracer precision + tighter speckle filter — more original print detail.",
  },
  {
    method: "vectorized-3pass",
    stage: "Stage 6 — Direction A",
    title: "3-pass flat-field",
    description:
      "Adds a third, wider-sigma flat-field pass — direct attack on the residual dark-edge/light-center gradient.",
  },
  {
    method: "vectorized-ultra-smooth",
    stage: "Stage 7 — Direction A",
    title: "Ultra-smooth",
    description:
      "3-pass flat field + 4-color posterize + heavy blur + loose VTracer corners — both anti-artifact levers combined.",
  },
  {
    method: "vectorized-max-detail",
    stage: "Stage 8 — Direction A",
    title: "Max detail ← production",
    description:
      "Minimal texture suppression, 12-color posterize, high VTracer precision, tightest speckle/corner/layer settings. This is the shipped default.",
    isProduction: true,
  },
];

/** Kept for the dedicated Direction-A tuning panel — subset of ALL_PIPELINE_VARIANTS. */
export const DIRECTION_A_VARIANTS = ALL_PIPELINE_VARIANTS.filter((v) =>
  v.method.startsWith("vectorized"),
);

export function AuntSukeysChoiceBlock({
  idPrefix,
  tileUrlLight,
  tileUrlDark,
  tileUrlGold,
  tileUrlRed,
}: {
  idPrefix: string;
  tileUrlLight: string;
  tileUrlDark: string;
  tileUrlGold: string;
  tileUrlRed: string;
}) {
  const blockPx = 450;
  const cellPx = blockPx / 3;
  const tilePx = cellPx / 3;
  const patId = (role: string) => `${idPrefix}-${role}`;

  type Cell =
    | { kind: "solid"; fill: string }
    | { kind: "nwse"; a: string; b: string }
    | { kind: "nesw"; a: string; b: string };
  const L = "light",
    D = "dark",
    G = "gold",
    R = "red";
  const cells: Cell[] = [
    { kind: "nwse", a: L, b: D },
    { kind: "solid", fill: G },
    { kind: "nesw", a: L, b: D },
    { kind: "solid", fill: G },
    { kind: "solid", fill: R },
    { kind: "solid", fill: G },
    { kind: "nesw", a: D, b: L },
    { kind: "solid", fill: G },
    { kind: "nwse", a: D, b: L },
  ];
  const fillFor = (role: string) => `url(#${patId(role)})`;

  return (
    <svg width={blockPx} height={blockPx} viewBox={`0 0 ${blockPx} ${blockPx}`}>
      <defs>
        {(
          [
            [L, tileUrlLight],
            [D, tileUrlDark],
            [G, tileUrlGold],
            [R, tileUrlRed],
          ] as const
        ).map(([role, url]) => (
          <pattern
            key={role}
            id={patId(role)}
            patternUnits="userSpaceOnUse"
            width={tilePx}
            height={tilePx}
          >
            <image
              href={url}
              x={0}
              y={0}
              width={tilePx}
              height={tilePx}
              preserveAspectRatio="xMidYMid slice"
            />
          </pattern>
        ))}
      </defs>
      {cells.map((cell, i) => {
        const col = i % 3,
          row = Math.floor(i / 3);
        const x = col * cellPx,
          y = row * cellPx;
        if (cell.kind === "solid") {
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={cellPx}
              height={cellPx}
              fill={fillFor(cell.fill)}
              stroke="#00000022"
              strokeWidth={0.5}
            />
          );
        }
        const aPoints =
          cell.kind === "nwse"
            ? `${x},${y} ${x + cellPx},${y} ${x + cellPx},${y + cellPx}`
            : `${x},${y} ${x + cellPx},${y} ${x},${y + cellPx}`;
        const bPoints =
          cell.kind === "nwse"
            ? `${x},${y} ${x},${y + cellPx} ${x + cellPx},${y + cellPx}`
            : `${x + cellPx},${y} ${x + cellPx},${y + cellPx} ${x},${y + cellPx}`;
        const diagX1 = cell.kind === "nwse" ? x : x + cellPx;
        const diagX2 = cell.kind === "nwse" ? x + cellPx : x;
        return (
          <g key={i}>
            <polygon
              points={bPoints}
              fill={fillFor(cell.b)}
              stroke="#00000022"
              strokeWidth={0.5}
            />
            <polygon
              points={aPoints}
              fill={fillFor(cell.a)}
              stroke="#00000022"
              strokeWidth={0.5}
            />
            <line
              x1={diagX1}
              y1={y}
              x2={diagX2}
              y2={y + cellPx}
              stroke="#00000033"
              strokeWidth={1}
            />
          </g>
        );
      })}
    </svg>
  );
}
