/**
 * Shared 404 fallback page — used as the catch-all `<Route>` in every artifact.
 *
 * Uses inline styles so consuming apps don't need to scan this file for
 * Tailwind classes, consistent with the InstallBanner pattern.
 */
export function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f9fafb",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "28rem",
          margin: "0 1rem",
          borderRadius: "0.75rem",
          border: "1px solid #e5e7eb",
          backgroundColor: "white",
          padding: "2rem",
          boxShadow:
            "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
          textAlign: "center",
        }}
      >
        {/* Batchelor wordmark */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "1.75rem",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6366f1"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: "1.5rem", height: "1.5rem", flexShrink: 0 }}
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span
            style={{
              fontSize: "1.125rem",
              fontWeight: "700",
              color: "#111827",
              letterSpacing: "-0.01em",
            }}
          >
            Batchelor
          </span>
        </div>

        {/* 404 badge */}
        <div
          style={{
            display: "inline-block",
            backgroundColor: "#eff6ff",
            color: "#3b82f6",
            fontSize: "0.75rem",
            fontWeight: "600",
            letterSpacing: "0.05em",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            marginBottom: "1rem",
          }}
        >
          404
        </div>

        <h1
          style={{
            fontSize: "1.375rem",
            fontWeight: "700",
            color: "#111827",
            marginBottom: "0.625rem",
          }}
        >
          Page not found
        </h1>

        <p
          style={{
            fontSize: "0.9rem",
            color: "#6b7280",
            lineHeight: "1.5",
            marginBottom: "1.75rem",
          }}
        >
          The page you're looking for doesn't exist or may have been moved.
        </p>

        {/* Back to Home link */}
        <a
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            backgroundColor: "#6366f1",
            color: "white",
            fontSize: "0.875rem",
            fontWeight: "600",
            padding: "0.625rem 1.25rem",
            borderRadius: "0.5rem",
            textDecoration: "none",
            transition: "background-color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
              "#4f46e5";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
              "#6366f1";
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: "0.875rem", height: "0.875rem" }}
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Home
        </a>
      </div>
    </div>
  );
}
