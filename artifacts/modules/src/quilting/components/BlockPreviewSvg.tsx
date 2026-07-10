import { SvgCell } from "./SvgCell";

export type BlockSeamLine = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number;
  clipEnd?: number;
};

export function BlockPreviewSvg({
  cells,
  gridSize,
  gridHeight,
  seams = [],
  size = 120,
  tileCount = 2,
  fabricUrlMap = {},
}: {
  cells: string[];
  gridSize: number;
  /** Optional explicit row count for non-square grids (e.g. block templates). Defaults to a square derived from cells.length. */
  gridHeight?: number;
  seams?: BlockSeamLine[];
  size?: number;
  tileCount?: number;
  fabricUrlMap?: Record<number, string>;
}) {
  const gridH = gridHeight ?? Math.max(1, Math.ceil(cells.length / gridSize));
  const cellPx = size / (gridSize * tileCount);
  const svgH = gridH * tileCount * cellPx;
  const tiles = Array.from({ length: tileCount * tileCount }, (_, t) => t);
  const sw = Math.max(0.5, cellPx * 0.1);

  const fabIds = (() => {
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
          {fabIds.map((id) => (
            <pattern
              key={id}
              id={`fab-${id}`}
              patternUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={cellPx / 4}
              height={cellPx / 4}
            >
              <image
                href={fabricUrlMap[id]}
                x="0"
                y="0"
                width={cellPx / 4}
                height={cellPx / 4}
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
        const offX = tc * gridSize * cellPx;
        const offY = tr * gridH * cellPx;
        return (
          <g key={tile}>
            {cells.map((cell, i) => {
              const row = Math.floor(i / gridSize);
              const col = i % gridSize;
              return (
                <SvgCell
                  key={i}
                  x={offX + col * cellPx}
                  y={offY + row * cellPx}
                  w={cellPx}
                  h={cellPx}
                  cell={cell}
                  fabricUrlMap={fabricUrlMap}
                />
              );
            })}
            {seams.map((seam, si) => {
              const cs = seam.clipStart ?? 0;
              const ce = seam.clipEnd ?? 1;
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
