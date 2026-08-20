import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute("disabled"));
}

/**
 * Gives full-screen viewers the expected modal keyboard lifecycle: focus enters
 * the viewer, Tab stays inside it, and closing returns focus to the opener.
 */
export function useModalFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusInitialControl = () => {
      const container = containerRef.current;
      if (!container) return;
      const initialFocus =
        initialFocusRef.current ??
        getFocusableElements(container)[0] ??
        container;
      initialFocus.focus();
    };
    const animationFrame = requestAnimationFrame(focusInitialControl);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeElement = document.activeElement;

      if (
        event.shiftKey &&
        (activeElement === first || !container.contains(activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === last || !container.contains(activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, containerRef, initialFocusRef]);
}

/**
 * Shared pan-bounding math for the image viewers (PreviewZoomModal,
 * ImageLightbox). The content is center-anchored: it is translated by the pan
 * offset from the viewport center and scaled about its own center.
 *
 * The maximum pan offset keeps at least `minVisiblePx` of the rendered
 * (scaled) content inside the viewport on the given axis, so the image can
 * never be dragged entirely off-screen — while still letting a zoomed-in
 * image reach its far edges.
 */
export function computePanLimit(
  viewportExtent: number,
  contentExtent: number,
  scale: number,
  minVisiblePx = 48,
): number {
  const renderedExtent = contentExtent * scale;
  return Math.max(0, (renderedExtent + viewportExtent) / 2 - minVisiblePx);
}

/** Clamp a pan offset to ±limit. */
export function clampPanOffset(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/** Convenience: clamp an offset against the computed limit for one axis. */
export function clampPanToBounds(
  value: number,
  viewportExtent: number,
  contentExtent: number,
  scale: number,
  minVisiblePx = 48,
): number {
  return clampPanOffset(
    value,
    computePanLimit(viewportExtent, contentExtent, scale, minVisiblePx),
  );
}
