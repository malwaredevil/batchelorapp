export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B3A5C" />
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
    </svg>
  );
}
