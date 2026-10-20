import { describe, expect, it } from "vitest";
import {
  clampFraming,
  getActiveThumbnail,
  getFramingStyle,
  getImageVersion,
  isThumbnailStale,
  panFraming,
  staleThumbnailKey,
} from "../../../../lib/collection-ui/src/thumbnail-geometry";

const cfg = (v: string) => ({
  mode: "crop" as const,
  x: 0.5,
  y: 0.5,
  zoom: 1,
  sourceVersion: v,
});

describe("thumbnail geometry", () => {
  it("clamps framing", () => {
    expect(clampFraming({ mode: "crop", x: -1, y: 3, zoom: 100 })).toEqual({
      mode: "crop",
      x: 0,
      y: 1,
      zoom: 8,
    });
    expect(clampFraming({ mode: "crop", x: NaN, y: 0.2, zoom: 0 }).zoom).toBe(
      0.1,
    );
  });
  it("parses version and detects stale configs", () => {
    expect(getImageVersion("/a.jpg?v=abc")).toBe("abc");
    expect(isThumbnailStale("/a.jpg?v=abc", cfg("abc"))).toBe(false);
    expect(isThumbnailStale("/a.jpg?v=abc", cfg("stale:0123"))).toBe(true);
    expect(getActiveThumbnail("/a.jpg?v=abc", cfg("stale:0123"))).toBeNull();
    expect(getActiveThumbnail("/a.jpg?v=abc", null)).toBeNull();
  });
  it("prompt key differs by config source even for the same photo version", () => {
    const a = staleThumbnailKey("g", 1, "/a?v=A", cfg("stale:1"));
    const b = staleThumbnailKey("g", 1, "/a?v=A", cfg("stale:2"));
    expect(a).not.toBe(b);
  });
  it("centres a crop and sizes a landscape photo", () => {
    const s = getFramingStyle(200, 100, {
      mode: "crop",
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
    expect(s.width).toBe("200%");
    expect(s.height).toBe("100%");
    expect(s.left).toBe("-50%");
    expect(s.top).toBe("0%");
  });
  it("contain fits whole photo", () => {
    const s = getFramingStyle(200, 100, {
      mode: "contain",
      x: 0,
      y: 0,
      zoom: 1,
    });
    expect(s.width).toBe("100%");
    expect(s.height).toBe("50%");
    expect(s.top).toBe("25%");
  });
  it("pans inversely, clamps, and ignores contain", () => {
    const f = { mode: "crop" as const, x: 0.5, y: 0.5, zoom: 1 };
    expect(panFraming(100, 100, f, 0.1, 0).x).toBeCloseTo(0.4);
    expect(panFraming(100, 100, f, 5, 0).x).toBe(0);
    const c = { ...f, mode: "contain" as const };
    expect(panFraming(100, 100, c, 0.1, 0.1)).toBe(c);
  });
});
