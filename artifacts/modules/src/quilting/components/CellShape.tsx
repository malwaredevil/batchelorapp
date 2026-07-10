import { parseCell, type QDir } from "@/quilting/lib/cell-parser";

// ---------------------------------------------------------------------------
// Shared single-cell SVG renderer — used by Block Designer and WQ Designer.
// ---------------------------------------------------------------------------

/**
 * Resolve a colour token for use in an SVG `fill` attribute.
 * `"fab:{id}"` tokens become `"url(#fab-{id})"` (the matching <pattern> must
 * be declared in the parent SVG's <defs>).  All other strings pass through.
 */
function resolveFill(color: string, map: Record<number, string>): string {
  if (color.startsWith("fab:")) {
    const id = parseInt(color.slice(4), 10);
    if (!isNaN(id) && map[id]) return `url(#fab-${id})`;
    return "#D1D5DB"; // fallback when image URL not yet loaded
  }
  return color;
}

/** When `seamOnly` is true, colour fills are stripped and only seam lines are shown. */
function cellForSeamOnly(cell: string): string {
  const raw = parseCell(cell);
  if (
    raw.kind === "line" ||
    raw.kind === "xline" ||
    raw.kind === "midline" ||
    raw.kind === "qlines"
  )
    return cell;
  if (raw.kind === "triangle")
    return raw.type === "nwse" ? "nwse-line" : "nesw-line";
  if (raw.kind === "quad") return "xline";
  if (raw.kind === "hsplit") return "seam-midline-h";
  if (raw.kind === "vsplit") return "seam-midline-v";
  if (raw.kind === "xsplit") return "seam-midline-hv";
  return "";
}

export function CellShape({
  x,
  y,
  W,
  H,
  cell,
  stroke = "#CBD5E1",
  strokeWidth = 0.5,
  emptyFill = "#FFFFFF",
  seamOnly = false,
  fabricUrlMap = {},
}: {
  x: number;
  y: number;
  W: number;
  H: number;
  cell: string;
  stroke?: string;
  strokeWidth?: number;
  emptyFill?: string;
  seamOnly?: boolean;
  fabricUrlMap?: Record<number, string>;
}) {
  const parsed = parseCell(seamOnly ? cellForSeamOnly(cell) : cell);

  // Shorthand: resolve a colour token, falling back to emptyFill for empty strings.
  const rf = (c: string) => resolveFill(c || emptyFill, fabricUrlMap);

  if (parsed.kind === "solid") {
    return (
      <rect
        x={x}
        y={y}
        width={W}
        height={H}
        fill={rf(parsed.color)}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (parsed.kind === "hsplit") {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W}
          height={H / 2}
          fill={rf(parsed.top)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <rect
          x={x}
          y={y + H / 2}
          width={W}
          height={H / 2}
          fill={rf(parsed.bottom)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </g>
    );
  }

  if (parsed.kind === "vsplit") {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W / 2}
          height={H}
          fill={rf(parsed.left)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <rect
          x={x + W / 2}
          y={y}
          width={W / 2}
          height={H}
          fill={rf(parsed.right)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </g>
    );
  }

  if (parsed.kind === "xsplit") {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W / 2}
          height={H / 2}
          fill={rf(parsed.tl)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <rect
          x={x + W / 2}
          y={y}
          width={W / 2}
          height={H / 2}
          fill={rf(parsed.tr)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <rect
          x={x}
          y={y + H / 2}
          width={W / 2}
          height={H / 2}
          fill={rf(parsed.bl)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <rect
          x={x + W / 2}
          y={y + H / 2}
          width={W / 2}
          height={H / 2}
          fill={rf(parsed.br)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </g>
    );
  }

  if (parsed.kind === "quad") {
    const cx = x + W / 2,
      cy = y + H / 2;
    const sw = Math.max(strokeWidth, 0.5);
    return (
      <g>
        <polygon
          points={`${x},${y} ${x + W},${y} ${cx},${cy}`}
          fill={rf(parsed.top)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <polygon
          points={`${x + W},${y} ${x + W},${y + H} ${cx},${cy}`}
          fill={rf(parsed.right)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <polygon
          points={`${x + W},${y + H} ${x},${y + H} ${cx},${cy}`}
          fill={rf(parsed.bottom)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <polygon
          points={`${x},${y + H} ${x},${y} ${cx},${cy}`}
          fill={rf(parsed.left)}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <line
          x1={x}
          y1={y}
          x2={x + W}
          y2={y + H}
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1={x + W}
          y1={y}
          x2={x}
          y2={y + H}
          stroke={stroke}
          strokeWidth={sw}
        />
      </g>
    );
  }

  if (parsed.kind === "xline") {
    const { nwseCs, nwseCe, neswCs, neswCe } = parsed;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W}
          height={H}
          fill={emptyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        {nwseCe > nwseCs && (
          <line
            x1={x + nwseCs * W}
            y1={y + nwseCs * H}
            x2={x + nwseCe * W}
            y2={y + nwseCe * H}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
        {neswCe > neswCs && (
          <line
            x1={x + (1 - neswCs) * W}
            y1={y + neswCs * H}
            x2={x + (1 - neswCe) * W}
            y2={y + neswCe * H}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
      </g>
    );
  }

  if (parsed.kind === "line") {
    const isNwse = parsed.type === "nwse";
    const { cs, ce } = parsed;
    const lx1 = isNwse ? x + cs * W : x + (1 - cs) * W;
    const ly1 = y + cs * H;
    const lx2 = isNwse ? x + ce * W : x + (1 - ce) * W;
    const ly2 = y + ce * H;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W}
          height={H}
          fill={emptyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <line
          x1={lx1}
          y1={ly1}
          x2={lx2}
          y2={ly2}
          stroke="#4f46e5"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </g>
    );
  }

  if (parsed.kind === "midline") {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W}
          height={H}
          fill={emptyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        {parsed.h && (
          <line
            x1={x}
            y1={y + H / 2}
            x2={x + W}
            y2={y + H / 2}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
        {parsed.v && (
          <line
            x1={x + W / 2}
            y1={y}
            x2={x + W / 2}
            y2={y + H}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
      </g>
    );
  }

  if (parsed.kind === "qlines") {
    const seg = (dir: QDir): [number, number, number, number] => {
      if (dir === "ne") return [x + W / 2, y, x + W, y + H / 2];
      if (dir === "se") return [x + W, y + H / 2, x + W / 2, y + H];
      if (dir === "sw") return [x + W / 2, y + H, x, y + H / 2];
      return [x, y + H / 2, x + W / 2, y]; // nw
    };
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={W}
          height={H}
          fill={emptyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        {parsed.dirs.map((d) => {
          const [x1, y1, x2, y2] = seg(d);
          return (
            <line
              key={d}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#4f46e5"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}
      </g>
    );
  }

  // Triangle (nwse / nesw)
  const { type, a, b } = parsed;
  const fa = rf(a || "#FFFFFF");
  const fb = rf(b || "#FFFFFF");

  if (type === "nwse") {
    const aPoints = `${x},${y} ${x + W},${y} ${x + W},${y + H}`;
    const bPoints = `${x},${y} ${x},${y + H} ${x + W},${y + H}`;
    return (
      <g>
        <polygon
          points={bPoints}
          fill={fb}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <polygon
          points={aPoints}
          fill={fa}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <line
          x1={x}
          y1={y}
          x2={x + W}
          y2={y + H}
          stroke={stroke}
          strokeWidth={Math.max(strokeWidth, 0.5)}
        />
      </g>
    );
  }
  // nesw
  const aPoints = `${x},${y} ${x + W},${y} ${x},${y + H}`;
  const bPoints = `${x + W},${y} ${x + W},${y + H} ${x},${y + H}`;
  return (
    <g>
      <polygon
        points={bPoints}
        fill={fb}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <polygon
        points={aPoints}
        fill={fa}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <line
        x1={x + W}
        y1={y}
        x2={x}
        y2={y + H}
        stroke={stroke}
        strokeWidth={Math.max(strokeWidth, 0.5)}
      />
    </g>
  );
}
