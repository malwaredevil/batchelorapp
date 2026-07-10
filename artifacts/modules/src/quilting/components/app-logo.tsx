export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B3A5C" />
      {/* Needle, diagonal behind spool */}
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
      {/* Thread from needle eye to spool */}
      <path
        d="M80 28 Q70 20 52 28"
        stroke="#F0E8D8"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      {/* Spool top flange */}
      <rect x="22" y="22" width="48" height="12" rx="5" fill="#3D2010" />
      {/* Spool barrel */}
      <rect x="30" y="34" width="32" height="32" fill="#C17A3E" />
      {/* Thread stripes on barrel */}
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
      {/* Spool bottom flange */}
      <rect x="22" y="66" width="48" height="12" rx="5" fill="#3D2010" />
    </svg>
  );
}
