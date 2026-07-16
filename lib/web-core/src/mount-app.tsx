import { createRoot } from "react-dom/client";
import { installScreenshotImageAutoAuth } from "@workspace/api-client-react";
import type { ComponentType } from "react";

/**
 * Standard Batchelor app bootstrap: applies the screenshot-auth auto-patch
 * and mounts the React tree into the given root element.
 *
 * Call once per artifact's `main.tsx` instead of repeating the three-line
 * bootstrap inline.
 */
export function mountApp(App: ComponentType, rootId = "root"): void {
  installScreenshotImageAutoAuth();
  createRoot(document.getElementById(rootId)!).render(<App />);
}
