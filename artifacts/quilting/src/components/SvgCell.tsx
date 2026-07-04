import { parseCell } from "@/lib/cell-parser";

export function SvgCell({
  x,
  y,
  w,
  h,
  cell,
  fabricUrlMap = {},
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: string;
  fabricUrlMap?: Record<number, string>;
}) {
  const p = parseCell(cell);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = Math.max(0.4, w * 0.04);
  const rf = (c: string) => {
    if (c.startsWith("fab:")) {
      const n = parseInt(c.slice(4), 10);
      if (!isNaN(n) && fabricUrlMap[n]) return `url(#fab-${n})`;
      return "#D1D5DB";
    }
    return c || "#FFFFFF";
  };

  switch (p.kind) {
    case "solid":
      return <rect x={x} y={y} width={w} height={h} fill={rf(p.color)} />;

    case "triangle":
      if (p.type === "nwse")
        return (
          <g>
            <polygon
              points={`${x},${y} ${x + w},${y} ${x + w},${y + h}`}
              fill={rf(p.a)}
            />
            <polygon
              points={`${x},${y} ${x},${y + h} ${x + w},${y + h}`}
              fill={rf(p.b)}
            />
          </g>
        );
      return (
        <g>
          <polygon
            points={`${x},${y} ${x + w},${y} ${x},${y + h}`}
            fill={rf(p.a)}
          />
          <polygon
            points={`${x + w},${y} ${x},${y + h} ${x + w},${y + h}`}
            fill={rf(p.b)}
          />
        </g>
      );

    case "quad":
      return (
        <g>
          <polygon
            points={`${x},${y} ${x + w},${y} ${cx},${cy}`}
            fill={rf(p.top)}
          />
          <polygon
            points={`${x + w},${y} ${x + w},${y + h} ${cx},${cy}`}
            fill={rf(p.right)}
          />
          <polygon
            points={`${x + w},${y + h} ${x},${y + h} ${cx},${cy}`}
            fill={rf(p.bottom)}
          />
          <polygon
            points={`${x},${y + h} ${x},${y} ${cx},${cy}`}
            fill={rf(p.left)}
          />
        </g>
      );

    case "hsplit":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h / 2} fill={rf(p.top)} />
          <rect
            x={x}
            y={y + h / 2}
            width={w}
            height={h / 2}
            fill={rf(p.bottom)}
          />
        </g>
      );

    case "vsplit":
      return (
        <g>
          <rect x={x} y={y} width={w / 2} height={h} fill={rf(p.left)} />
          <rect
            x={x + w / 2}
            y={y}
            width={w / 2}
            height={h}
            fill={rf(p.right)}
          />
        </g>
      );

    case "xsplit":
      return (
        <g>
          <rect x={x} y={y} width={w / 2} height={h / 2} fill={rf(p.tl)} />
          <rect
            x={x + w / 2}
            y={y}
            width={w / 2}
            height={h / 2}
            fill={rf(p.tr)}
          />
          <rect
            x={x}
            y={y + h / 2}
            width={w / 2}
            height={h / 2}
            fill={rf(p.bl)}
          />
          <rect
            x={x + w / 2}
            y={y + h / 2}
            width={w / 2}
            height={h / 2}
            fill={rf(p.br)}
          />
        </g>
      );

    case "line": {
      const { cs, ce, type } = p;
      const [x1, y1, x2, y2] =
        type === "nwse"
          ? [x + cs * w, y + cs * h, x + ce * w, y + ce * h]
          : [x + (1 - cs) * w, y + cs * h, x + (1 - ce) * w, y + ce * h];
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#555"
            strokeWidth={sw}
          />
        </g>
      );
    }

    case "xline": {
      const { nwseCs, nwseCe, neswCs, neswCe } = p;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />
          {nwseCe > nwseCs && (
            <line
              x1={x + nwseCs * w}
              y1={y + nwseCs * h}
              x2={x + nwseCe * w}
              y2={y + nwseCe * h}
              stroke="#555"
              strokeWidth={sw}
            />
          )}
          {neswCe > neswCs && (
            <line
              x1={x + (1 - neswCs) * w}
              y1={y + neswCs * h}
              x2={x + (1 - neswCe) * w}
              y2={y + neswCe * h}
              stroke="#555"
              strokeWidth={sw}
            />
          )}
        </g>
      );
    }

    default:
      return <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />;
  }
}
