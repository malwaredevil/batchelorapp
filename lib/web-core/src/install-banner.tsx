import { useInstallPrompt } from "./use-install-prompt";

/**
 * Self-contained "Add to home screen" install banner.
 * Renders nothing when the browser hasn't surfaced an install prompt or when
 * the user has already dismissed it this session.
 *
 * Uses inline styles so Tailwind class scanning in consuming apps is not required.
 */
export function InstallBanner() {
  const { isPromptAvailable, prompt, dismiss } = useInstallPrompt();

  if (!isPromptAvailable) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 16px",
        backgroundColor: "#1a395b",
        color: "#fff",
        fontSize: "13px",
        gap: "12px",
        flexShrink: 0,
      }}
      role="banner"
      aria-label="Install app banner"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Download icon (inline SVG — no lucide dependency needed) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Install Batchelor for quick access from your home screen</span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={prompt}
          style={{
            backgroundColor: "rgba(255,255,255,0.2)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "6px",
            padding: "4px 12px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          Add to home screen
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            padding: "4px",
            lineHeight: 1,
            fontSize: "16px",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
