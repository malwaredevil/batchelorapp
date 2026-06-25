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

  // 0.5 px bleed: expand every filled shape by half a pixel on each side so
  // adjacent cells overlap rather than leaving a sub-pixel gap that the browser
  // anti-aliases against the white background (which shows as a visible seam).
  const B = 0.5;

  switch (p.kind) {
    case "solid":
      return (
        <rect
          x={x - B}
          y={y - B}
          width={w + B * 2}
          height={h + B * 2}
          fill={rf(p.color)}
        />
      );

    case "triangle":
      if (p.type === "nwse")
        return (
          <g>
            {/* b fills the whole cell as background with bleed */}
            <rect x={x - B} y={y - B} width={w + B * 2} height={h + B * 2} fill={rf(p.b)} />
            {/* a = top-right triangle, expanded to corners so it covers the bleed zone */}
            <polygon
              points={`${x - B},${y - B} ${x + w + B},${y - B} ${x + w + B},${y + h + B}`}
              fill={rf(p.a)}
            />
          </g>
        );
      return (
        <g>
          {/* b fills the whole cell as background with bleed */}
          <rect x={x - B} y={y - B} width={w + B * 2} height={h + B * 2} fill={rf(p.b)} />
          {/* a = top-left triangle */}
          <polygon
            points={`${x - B},${y - B} ${x + w + B},${y - B} ${x - B},${y + h + B}`}
            fill={rf(p.a)}
          />
        </g>
      );

    case "quad":
      return (
        <g>
          <polygon
            points={`${x - B},${y - B} ${x + w + B},${y - B} ${cx},${cy}`}
            fill={rf(p.top)}
          />
          <polygon
            points={`${x + w + B},${y - B} ${x + w + B},${y + h + B} ${cx},${cy}`}
            fill={rf(p.right)}
          />
          <polygon
            points={`${x + w + B},${y + h + B} ${x - B},${y + h + B} ${cx},${cy}`}
            fill={rf(p.bottom)}
          />
          <polygon
            points={`${x - B},${y + h + B} ${x - B},${y - B} ${cx},${cy}`}
            fill={rf(p.left)}
          />
        </g>
      );

    case "hsplit":
      return (
        <g>
          <rect x={x - B} y={y - B} width={w + B * 2} height={h / 2 + B} fill={rf(p.top)} />
          <rect x={x - B} y={y + h / 2 - B} width={w + B * 2} height={h / 2 + B} fill={rf(p.bottom)} />
        </g>
      );

    case "vsplit":
      return (
        <g>
          <rect x={x - B} y={y - B} width={w / 2 + B} height={h + B * 2} fill={rf(p.left)} />
          <rect x={x + w / 2 - B} y={y - B} width={w / 2 + B} height={h + B * 2} fill={rf(p.right)} />
        </g>
      );

    case "xsplit":
      return (
        <g>
          <rect x={x - B} y={y - B} width={w / 2 + B} height={h / 2 + B} fill={rf(p.tl)} />
          <rect x={x + w / 2 - B} y={y - B} width={w / 2 + B} height={h / 2 + B} fill={rf(p.tr)} />
          <rect x={x - B} y={y + h / 2 - B} width={w / 2 + B} height={h / 2 + B} fill={rf(p.bl)} />
          <rect x={x + w / 2 - B} y={y + h / 2 - B} width={w / 2 + B} height={h / 2 + B} fill={rf(p.br)} />
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
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#555" strokeWidth={sw} />
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
              x1={x + nwseCs * w} y1={y + nwseCs * h}
              x2={x + nwseCe * w} y2={y + nwseCe * h}
              stroke="#555" strokeWidth={sw}
            />
          )}
          {neswCe > neswCs && (
            <line
              x1={x + (1 - neswCs) * w} y1={y + neswCs * h}
              x2={x + (1 - neswCe) * w} y2={y + neswCe * h}
              stroke="#555" strokeWidth={sw}
            />
          )}
        </g>
      );
    }

    default:
      return <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" />;
  }
}
