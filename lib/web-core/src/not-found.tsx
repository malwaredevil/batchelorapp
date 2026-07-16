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
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "28rem",
          margin: "0 1rem",
          borderRadius: "0.5rem",
          border: "1px solid #e5e7eb",
          backgroundColor: "white",
          padding: "1.5rem",
          boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        }}
      >
        <div
          style={{
            display: "flex",
            marginBottom: "1rem",
            gap: "0.5rem",
            alignItems: "flex-start",
          }}
        >
          <svg
            style={{
              width: "2rem",
              height: "2rem",
              color: "#ef4444",
              flexShrink: 0,
            }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h1
            style={{ fontSize: "1.5rem", fontWeight: "700", color: "#111827" }}
          >
            404 Page Not Found
          </h1>
        </div>
        <p
          style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#4b5563" }}
        >
          Did you forget to add the page to the router?
        </p>
      </div>
    </div>
  );
}
