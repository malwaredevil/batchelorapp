import { createRoot } from "react-dom/client";
import { installScreenshotImageAutoAuth } from "@workspace/api-client-react";
import type { ComponentType } from "react";

// Reload at most once per 10s so a genuinely broken/offline load can't loop.
const STALE_CHUNK_RELOAD_KEY = "batchelor:stale-chunk-reload-at";
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000;

/**
 * After a new deploy, a tab left open (or one loaded from a stale cache)
 * still references JS chunk URLs from the previous build, which 404 the
 * next time the app lazy-loads a route. Vite fires `vite:preloadError` on
 * `window` for exactly this case (see
 * https://vitejs.dev/guide/build.html#load-error-handling) instead of just
 * letting the error boundary show a dead end. Reload once to pick up the
 * new build.
 */
function installStaleChunkReload(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", () => {
    const lastAttempt = Number(
      sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) || 0,
    );
    if (Date.now() - lastAttempt < STALE_CHUNK_RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  });
}

/**
 * Standard Batchelor app bootstrap: applies the screenshot-auth auto-patch
 * and mounts the React tree into the given root element.
 *
 * Call once per artifact's `main.tsx` instead of repeating the three-line
 * bootstrap inline.
 */
export function mountApp(App: ComponentType, rootId = "root"): void {
  installScreenshotImageAutoAuth();
  installStaleChunkReload();
  createRoot(document.getElementById(rootId)!).render(<App />);
}
