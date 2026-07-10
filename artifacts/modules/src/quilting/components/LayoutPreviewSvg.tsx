import { SvgCell } from "./SvgCell";

type LayoutCell = { blockId: number | null; rotation: 0 | 90 | 180 | 270 };

type LayoutSummaryMin = {
  rows: number;
  cols: number;
  cells: LayoutCell[];
  sashingWidthInches?: number | null;
  sashingColor?: string | null;
  borderWidthInches?: number | null;
  borderColor?: string | null;
  cornerstoneColor?: string | null;
};

type BlockSummaryMin = {
  id: number;
  gridSize: number;
  cells: string[];
};

export function LayoutPreviewSvg({
  layout,
  blocks,
  size = 160,
  fabricUrlMap = {},
}: {
  layout: LayoutSummaryMin;
  blocks: BlockSummaryMin[];
  size?: number;
  fabricUrlMap?: Record<number, string>;
}) {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const sashW = layout.sashingWidthInches ?? 0;
  const bordW = layout.borderWidthInches ?? 0;
  const sashingColor = layout.sashingColor ?? "#d4c5a9";
  const borderColor = layout.borderColor ?? "#8b6f5e";
  const cornerstoneColor = layout.cornerstoneColor ?? null;

  const fabIds = (() => {
    const ids = new Set<number>();
    const FAB_RE = /fab:(\d+)/g;
    for (const lc of layout.cells) {
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
    return Array.from(ids);
  })();

  const unitW = layout.cols + sashW * (layout.cols - 1) + bordW * 2;
  const unitH = layout.rows + sashW * (layout.rows - 1) + bordW * 2;
  const scale = size / Math.max(unitW, unitH);
  const cellPx = scale;
  const sashPx = sashW * scale;
  const borderPx = bordW * scale;
  const W = unitW * scale;
  const H = unitH * scale;

  return (
    <svg
      width={W}
      height={H}
      xmlns="http://www.w3.org/2000/svg"
      className="bg-white"
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
      {borderPx > 0 && (
        <rect x={0} y={0} width={W} height={H} fill={borderColor} />
      )}
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
      {layout.cells.map((cell, i) => {
        const row = Math.floor(i / layout.cols);
        const col = i % layout.cols;
        const x = borderPx + col * (cellPx + sashPx);
        const y = borderPx + row * (cellPx + sashPx);
        const block = cell.blockId !== null ? blockMap.get(cell.blockId) : null;
        if (!block)
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={cellPx}
              height={cellPx}
              fill="#F5F5F5"
              stroke="#E0E0E0"
              strokeWidth="0.5"
            />
          );
        const bCellPx = cellPx / block.gridSize;
        const cx = x + cellPx / 2;
        const cy = y + cellPx / 2;
        return (
          <g key={i} transform={`rotate(${cell.rotation}, ${cx}, ${cy})`}>
            {block.cells.map((blockCell, j) => {
              const br = Math.floor(j / block.gridSize);
              const bc = j % block.gridSize;
              return (
                <SvgCell
                  key={j}
                  x={x + bc * bCellPx}
                  y={y + br * bCellPx}
                  w={bCellPx}
                  h={bCellPx}
                  cell={blockCell}
                  fabricUrlMap={fabricUrlMap}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
