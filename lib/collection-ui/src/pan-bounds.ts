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
