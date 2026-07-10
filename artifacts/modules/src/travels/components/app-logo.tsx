export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B4E6B" />
      {/* Paper plane */}
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
    </svg>
  );
}
