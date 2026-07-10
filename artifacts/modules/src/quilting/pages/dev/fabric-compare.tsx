import { useRef, useState, type WheelEvent, type MouseEvent } from "react";

/**
 * Dev-only comparison page: source fabric photo vs. before-fix production
 * tiling (photo tiled directly into an SVG pattern) vs. after-fix tiling
 * (flat-field corrected + color-enhanced tile from
 * `generateFlatFabricTile()` in artifacts/api-server/src/lib/image.ts).
 *
 * The before-fix panel reproduces the "puffy square" grid artifact (lighter
 * center / darker edges per tile, like an embossed top-left light source),
 * caused by the source photo's natural lighting vignette repeating at tile
 * frequency. The after-fix panel is the actual production output once
 * FabricPicker's buildFabricUrlMap prefers `tileImageUrl`.
 *
 * Not linked from any nav menu.
 */

const SOURCE_IMAGE_URL = `${import.meta.env.BASE_URL}dev-fabric-compare/source.jpg`;

function useZoomPan() {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );

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
    setOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  };

  const onMouseUp = () => {
    dragRef.current = null;
  };

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return { scale, offset, onWheel, onMouseDown, onMouseMove, onMouseUp, reset, setScale };
}

function ZoomPanel({ title, children }: { title: string; children: (scale: number) => React.ReactNode }) {
  const { scale, offset, onWheel, onMouseDown, onMouseMove, onMouseUp, reset, setScale } =
    useZoomPan();

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
          <button type="button" className="rounded border px-2 py-1 hover:bg-muted" onClick={reset}>
            Reset
          </button>
          <span>{Math.round(scale * 100)}%</span>
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
  );
}

type TileMethod =
  | "original"
  | "v2"
  | "posterized"
  | "vectorized"
  | "vectorized-smooth"
  | "vectorized-crisp"
  | "vectorized-3pass"
  | "vectorized-ultra-smooth"
  | "vectorized-max-detail";

const fabricTileUrl = (fabricId: number, method: TileMethod) =>
  `/api/quilting/dev/fabric-tile-experiment/${fabricId}/${method}`;

/** Four real fabrics picked to fill the four distinct colour roles in the
 * "Aunt Sukey's Choice" block template (see
 * `scripts/src/seed-quilting-block-templates.ts`, LIGHT/DARK/GOLD/RED),
 * chosen so each role's tuning behavior can be judged on genuinely
 * different colors/print styles at once. */
const FABRIC_LIGHT = { id: 57, label: "White Hearts (LIGHT role)" };
const FABRIC_DARK = { id: 58, label: "Black Floral (DARK role)" };
const FABRIC_GOLD = { id: 24, label: "Yellow with Gold Floral (GOLD role)" };
const FABRIC_RED = { id: 33, label: "Red with Red Blossoms (RED role)" };

/** Direction A tuning variants to compare, each exploring a different lever
 * on the same pipeline — see the matching `DIRECTION_A_*_TUNING` presets and
 * doc comments in `artifacts/api-server/src/lib/image.ts` for the rationale
 * behind each one. */
const DIRECTION_A_VARIANTS: { method: TileMethod; title: string; description: string }[] = [
  {
    method: "vectorized",
    title: "Baseline",
    description:
      "Two-pass flat-field correction, 6-color posterize, standard VTracer settings — the current shipped-in-preview Direction A pipeline.",
  },
  {
    method: "vectorized-smooth",
    title: "Variant: Smoother",
    description:
      "Fewer posterize colors (5) + heavier texture-suppression blur + looser VTracer corner threshold, so grain flattens into fewer, cleaner regions — less surface area for the residual gradient to show as a visible edge, at the cost of some print fidelity.",
  },
  {
    method: "vectorized-crisp",
    title: "Variant: Crisp",
    description:
      "Lighter texture-suppression blur + more posterize colors (8) + higher VTracer color precision + tighter speckle filter, keeping more original print/weave detail — more color bands may break the faint gradient into thinner, less noticeable slices.",
  },
  {
    method: "vectorized-3pass",
    title: "Variant: 3-pass flat-field",
    description:
      "Identical posterize/VTracer settings to baseline, but adds a third, even-wider-sigma flat-field pass — the most direct attack on the residual dark-edge/light-center gradient itself, independent of posterize/vectorize tuning.",
  },
  {
    method: "vectorized-ultra-smooth",
    title: "Variant: Ultra-smooth",
    description:
      "Stacks the 3-pass flat field with the smoother posterize/VTracer settings (4 colors, heavy blur, loose corner threshold) — both anti-artifact levers combined at once, to see the upper bound of how much smoother this pipeline can get.",
  },
  {
    method: "vectorized-max-detail",
    title: "Variant: Max detail",
    description:
      "The opposite extreme — minimal texture suppression, 12-color posterize, high VTracer color precision, and the tightest speckle/corner/layer settings, preserving as much of the original print as possible.",
  },
];

/**
 * Renders the "Aunt Sukey's Choice" 3×3 block (see
 * `scripts/src/seed-quilting-block-templates.ts`, lines ~1030-1040) using the
 * exact same cell geometry (solid rect / nwse-nesw diagonal-split polygon)
 * the block designer uses — see CellShape.tsx. Cell roles: LIGHT/DARK
 * half-square-triangle corners, GOLD solid cross/frame, RED solid center.
 * All 9 cells use the same processing method (tuning variant) so this
 * isolates the effect of the method itself across 4 fabrics at once.
 */
function AuntSukeysChoiceBlock({
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

  // solid | nwse(a,b) | nesw(a,b), matching the seed script's cell order.
  type Cell =
    | { kind: "solid"; fill: string }
    | { kind: "nwse"; a: string; b: string }
    | { kind: "nesw"; a: string; b: string };
  const L = "light";
  const D = "dark";
  const G = "gold";
  const R = "red";
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
          <pattern key={role} id={patId(role)} patternUnits="userSpaceOnUse" width={tilePx} height={tilePx}>
            <image href={url} x={0} y={0} width={tilePx} height={tilePx} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        ))}
      </defs>
      {cells.map((cell, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = col * cellPx;
        const y = row * cellPx;
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
        // nwse: "a" fills the top-right triangle, "b" fills the bottom-left
        // nesw: "a" fills the top-left triangle, "b" fills the bottom-right
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
            <polygon points={bPoints} fill={fillFor(cell.b)} stroke="#00000022" strokeWidth={0.5} />
            <polygon points={aPoints} fill={fillFor(cell.a)} stroke="#00000022" strokeWidth={0.5} />
            <line x1={diagX1} y1={y} x2={diagX2} y2={y + cellPx} stroke="#00000033" strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}

export default function FabricCompareDevPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">Fabric SVG rendering — dev comparison</h1>
        <p className="text-sm text-muted-foreground">
          Internal, dev-only page. Not linked from any menu. Scroll to zoom, drag to pan on each
          panel independently.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ZoomPanel title="Source fabric photo">
          {() => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={SOURCE_IMAGE_URL} alt="Source fabric" className="max-w-none" width={400} />
          )}
        </ZoomPanel>
      </div>

      <div className="pt-4">
        <h2 className="text-lg font-bold">
          Direction A: VTracer vectorization (posterized raster traced to real SVG paths)
        </h2>
        <p className="text-sm text-muted-foreground">
          Chosen as the best-so-far direction. Each block below is a full "Aunt Sukey's Choice"
          3×3 block (see <code>scripts/src/seed-quilting-block-templates.ts</code>), rendered with
          the exact solid-rect / diagonal-split polygon geometry the block designer uses for
          <code> solid</code>/<code>nwse</code>/<code>nesw</code> cells (see{" "}
          <code>CellShape.tsx</code>) — 4 real fabrics fill the block's 4 color roles: fabric #
          {FABRIC_LIGHT.id} "{FABRIC_LIGHT.label}", fabric #{FABRIC_DARK.id} "{FABRIC_DARK.label}",
          fabric #{FABRIC_GOLD.id} "{FABRIC_GOLD.label}", and fabric #{FABRIC_RED.id} "
          {FABRIC_RED.label}", so the pipeline can be judged across a more complex, multi-fabric
          pattern instead of a single two-fabric triangle. The core pipeline is a flat-field
          correction (<code>generateFlatFabricTileV3</code>) → texture-suppressing blur →
          no-dither posterize → VTracer trace (<code>@neplex/vectorizer</code>) into real vector
          fill paths. Below the baseline are 5 tuned variants exploring different levers on that
          same pipeline to chase down the known residual artifact (a very faint darker band near
          tile edges, faint lighter patch near center) and to push further toward a visibly
          distinct, production-ready option.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DIRECTION_A_VARIANTS.map((variant) => (
          <ZoomPanel key={variant.method} title={variant.title}>
            {() => (
              <AuntSukeysChoiceBlock
                idPrefix={`ask-${variant.method}`}
                tileUrlLight={fabricTileUrl(FABRIC_LIGHT.id, variant.method)}
                tileUrlDark={fabricTileUrl(FABRIC_DARK.id, variant.method)}
                tileUrlGold={fabricTileUrl(FABRIC_GOLD.id, variant.method)}
                tileUrlRed={fabricTileUrl(FABRIC_RED.id, variant.method)}
              />
            )}
          </ZoomPanel>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {DIRECTION_A_VARIANTS.map((variant) => (
          <p key={variant.method} className="text-xs text-muted-foreground">
            <span className="font-semibold">{variant.title}:</span> {variant.description}
          </p>
        ))}
      </div>
    </div>
  );
}
