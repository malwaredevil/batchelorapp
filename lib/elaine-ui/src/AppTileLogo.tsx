import type { ReactNode } from "react";

export type AppTileId =
  | "pottery"
  | "quilting"
  | "travels"
  | "ornaments"
  | "office";

/**
 * Per-app glyph + tile background for the shared square app logo. Every app
 * logo is the same rounded-square SVG tile varying only by background color
 * and the glyph drawn on top — so they render from one parameterized
 * component instead of near-identical copies per app.
 */
const APP_TILE_CONFIG: Record<AppTileId, { fill: string; glyph: ReactNode }> = {
  pottery: {
    fill: "#1B3A5C",
    glyph: (
      <>
        <ellipse
          cx="50"
          cy="41"
          rx="30"
          ry="8"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          fill="none"
        />
        <path
          d="M20 41 Q20 72 50 74 Q80 72 80 41"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />
        <line
          x1="38"
          y1="74"
          x2="62"
          y2="74"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
  quilting: {
    fill: "#1B3A5C",
    glyph: (
      <>
        <g transform="rotate(30, 74, 50)">
          <rect x="71.5" y="16" width="5" height="68" rx="2.5" fill="#D8D8D8" />
          <ellipse
            cx="74"
            cy="22"
            rx="2"
            ry="3.5"
            fill="none"
            stroke="#1B3A5C"
            strokeWidth="1.5"
          />
          <polygon points="74,84 70,76 78,76" fill="#A8A8A8" />
        </g>
        <path
          d="M80 28 Q70 20 52 28"
          stroke="#F0E8D8"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="22" y="22" width="48" height="12" rx="5" fill="#3D2010" />
        <rect x="30" y="34" width="32" height="32" fill="#C17A3E" />
        <line
          x1="30"
          y1="41"
          x2="62"
          y2="41"
          stroke="#F0E8D8"
          strokeWidth="2.2"
          opacity="0.75"
        />
        <line
          x1="30"
          y1="49"
          x2="62"
          y2="49"
          stroke="#F0E8D8"
          strokeWidth="2.2"
          opacity="0.75"
        />
        <line
          x1="30"
          y1="57"
          x2="62"
          y2="57"
          stroke="#F0E8D8"
          strokeWidth="2.2"
          opacity="0.75"
        />
        <rect x="22" y="66" width="48" height="12" rx="5" fill="#3D2010" />
      </>
    ),
  },
  travels: {
    fill: "#1B4E6B",
    glyph: (
      <>
        <polygon
          points="18,50 82,22 56,78"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          fill="none"
          strokeLinejoin="round"
        />
        <line
          x1="18"
          y1="50"
          x2="56"
          y2="78"
          stroke="#F0E8D8"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.8"
        />
      </>
    ),
  },
  ornaments: {
    fill: "#1B3A5C",
    glyph: (
      <>
        <rect x="44" y="16" width="12" height="10" rx="3" fill="#F0E8D8" />
        <circle
          cx="50"
          cy="58"
          r="26"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          fill="none"
        />
        <path
          d="M32 46 L68 46"
          stroke="#F0E8D8"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </>
    ),
  },
  office: {
    fill: "#1B3A5C",
    glyph: (
      <>
        <rect
          x="24"
          y="30"
          width="52"
          height="42"
          rx="4"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          fill="none"
        />
        <path
          d="M24 40 L76 40"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M40 30 L40 24 Q40 20 44 20 L56 20 Q60 20 60 24 L60 30"
          stroke="#F0E8D8"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
};

export function AppTileLogo({
  app,
  className,
}: {
  app: AppTileId;
  className?: string;
}) {
  const { fill, glyph } = APP_TILE_CONFIG[app];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill={fill} />
      {glyph}
    </svg>
  );
}
