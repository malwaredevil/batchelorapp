import type { CSSProperties } from "react";

export interface ThumbnailFramingValue {
  mode: "crop" | "contain";
  x: number;
  y: number;
  zoom: number;
}

export interface ThumbnailConfigValue extends ThumbnailFramingValue {
  sourceVersion: string;
}

export const THUMBNAIL_MIN_ZOOM = 0.1;
export const THUMBNAIL_MAX_ZOOM = 8;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export function clampFraming(f: ThumbnailFramingValue): ThumbnailFramingValue {
  const ok = (n: number, d: number) => (Number.isFinite(n) ? n : d);
  return {
    mode: f.mode === "contain" ? "contain" : "crop",
    x: clamp(ok(f.x, 0.5), 0, 1),
    y: clamp(ok(f.y, 0.5), 0, 1),
    zoom: clamp(ok(f.zoom, 1), THUMBNAIL_MIN_ZOOM, THUMBNAIL_MAX_ZOOM),
  };
}

/** Reads the ?v= photo version from an image URL. */
export function getImageVersion(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&]v=([^&#]*)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** True when a custom config exists but was made for an older photo version. */
export function isThumbnailStale(
  imageUrl: string | null | undefined,
  thumbnail: ThumbnailConfigValue | null | undefined,
): boolean {
  if (!thumbnail) return false;
  return thumbnail.sourceVersion !== getImageVersion(imageUrl);
}

/** The config to actually render: null when unset or stale. */
export function getActiveThumbnail(
  imageUrl: string | null | undefined,
  thumbnail: ThumbnailConfigValue | null | undefined,
): ThumbnailConfigValue | null {
  if (!thumbnail || isThumbnailStale(imageUrl, thumbnail)) return null;
  return thumbnail;
}

/**
 * Size of the rendered image as a fraction of the square frame side.
 * crop: cover-fit * zoom. contain: whole-photo-fit * zoom.
 */
export function getImageFractions(
  natW: number,
  natH: number,
  f: ThumbnailFramingValue,
): { w: number; h: number } {
  const ref =
    f.mode === "contain" ? Math.max(natW, natH) : Math.min(natW, natH);
  return { w: (natW / ref) * f.zoom, h: (natH / ref) * f.zoom };
}

/** Inline percent geometry for an absolutely positioned image in the frame. */
export function getFramingStyle(
  natW: number,
  natH: number,
  framing: ThumbnailFramingValue,
): CSSProperties {
  const f = clampFraming(framing);
  const { w, h } = getImageFractions(natW, natH, f);
  const fx = f.mode === "contain" ? 0.5 : f.x;
  const fy = f.mode === "contain" ? 0.5 : f.y;
  return {
    position: "absolute",
    maxWidth: "none",
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    left: `${(0.5 - fx * w) * 100}%`,
    top: `${(0.5 - fy * h) * 100}%`,
  };
}

/** Pan: dragging by (dx,dy) frame-fractions moves the focal point inversely. */
export function panFraming(
  natW: number,
  natH: number,
  f: ThumbnailFramingValue,
  dxFrac: number,
  dyFrac: number,
): ThumbnailFramingValue {
  if (f.mode === "contain") return f;
  const { w, h } = getImageFractions(natW, natH, f);
  return clampFraming({ ...f, x: f.x - dxFrac / w, y: f.y - dyFrac / h });
}

/** Stale-prompt key: current photo version AND the config's recorded source. */
export function staleThumbnailKey(
  scope: string,
  id: number,
  imageUrl: string | null | undefined,
  thumbnail: ThumbnailConfigValue | null | undefined,
): string {
  return `${scope}:${id}:${getImageVersion(imageUrl) ?? ""}:${thumbnail?.sourceVersion ?? ""}`;
}
