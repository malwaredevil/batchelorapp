import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@workspace/web-core/download";
import {
  buildEmbeddedLayoutSvgString,
  buildLayoutSvgString,
  downloadSvgAsPng,
  RasterExportError,
} from "./svg-export";
import { buildFabricNameMap } from "./fabric-names";

vi.mock("@workspace/web-core/download", () => ({
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(downloadBlob).mockClear();
});

describe("buildFabricNameMap", () => {
  it("maps fabric IDs to names", () => {
    expect(
      buildFabricNameMap([
        { id: 11, name: "Blue gingham" },
        { id: 22, name: "Red floral" },
      ]),
    ).toEqual({ 11: "Blue gingham", 22: "Red floral" });
  });

  it("returns an empty map when no fabrics are available", () => {
    expect(buildFabricNameMap([])).toEqual({});
  });
});

describe("buildLayoutSvgString", () => {
  it("preserves fabric-backed cells and trim alongside layout geometry", () => {
    const svg = buildLayoutSvgString(
      {
        rows: 2,
        cols: 2,
        cells: [
          { blockId: 7, rotation: 90 },
          { blockId: null, rotation: 0 },
          { blockId: 7, rotation: 0 },
          { blockId: 7, rotation: 270 },
        ],
        sashingWidthInches: 0.25,
        sashingColor: "fab:22",
        borderWidthInches: 0.5,
        borderColor: "#123456",
        cornerstoneColor: "fab:33",
      },
      new Map([
        [
          7,
          {
            id: 7,
            gridSize: 2,
            cells: ["fab:11", "#abcdef", "tri:nwse:fab:11:#fedcba", ""],
          },
        ],
      ]),
      800,
      {
        11: "/fabrics/11.jpg",
        22: "/fabrics/22.jpg",
        33: "/fabrics/33.jpg",
      },
    );

    for (const [id, url] of [
      [11, "/fabrics/11.jpg"],
      [22, "/fabrics/22.jpg"],
      [33, "/fabrics/33.jpg"],
    ] as const) {
      expect(svg).toContain(`<pattern id="fab-${id}"`);
      expect(svg).toContain(`href="${url}"`);
      expect(svg).toContain(`fill="url(#fab-${id})"`);
    }
    expect(svg).not.toContain('fill="#D1D5DB"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#abcdef"');
    expect(svg).toContain("rotate(90,");
    expect(svg).toContain('fill="#F5F5F5" stroke="#E0E0E0"');
  });

  it("uses a clear grey fallback when a referenced fabric has no image", () => {
    const svg = buildLayoutSvgString(
      {
        rows: 1,
        cols: 1,
        cells: [{ blockId: 1, rotation: 0 }],
      },
      new Map([[1, { id: 1, gridSize: 1, cells: ["fab:99"] }]]),
      100,
    );

    expect(svg).not.toContain('<pattern id="fab-99"');
    expect(svg).toContain('fill="#D1D5DB"');
  });
});

describe("buildEmbeddedLayoutSvgString", () => {
  const layout = {
    rows: 1,
    cols: 1,
    cells: [{ blockId: 1, rotation: 0 as const }],
  };
  const blocks = new Map([[1, { id: 1, gridSize: 1, cells: ["fab:11"] }]]);

  it("embeds referenced fabric images as self-contained data URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: () =>
          Promise.resolve(new Blob(["fabric"], { type: "image/png" })),
      }),
    );

    const svg = await buildEmbeddedLayoutSvgString(layout, blocks, 100, {
      11: "/fabrics/11.jpg",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/fabrics/11.jpg",
      expect.objectContaining({
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).not.toContain("/fabrics/11.jpg");
    expect(svg).toContain('fill="url(#fab-11)"');
  });

  it("identifies a fabric image that cannot be embedded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    await expect(
      buildEmbeddedLayoutSvgString(
        layout,
        blocks,
        100,
        { 11: "/fabrics/11.jpg" },
        { fabricNames: { 11: "Blue gingham" } },
      ),
    ).rejects.toMatchObject({
      fabricId: 11,
      message: expect.stringContaining("Blue gingham"),
    });
  });

  it("identifies a fabric when its image request is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed")));

    await expect(
      buildEmbeddedLayoutSvgString(
        layout,
        blocks,
        100,
        { 11: "/fabrics/11.jpg" },
        { fabricNames: { 11: "Blue gingham" } },
      ),
    ).rejects.toMatchObject({
      fabricId: 11,
      message: expect.stringContaining("Blue gingham"),
    });
  });

  it("aborts a stalled fabric request and identifies the timed-out fabric", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
        });
      }),
    );

    const exportPromise = buildEmbeddedLayoutSvgString(
      layout,
      blocks,
      100,
      { 11: "/fabrics/11.jpg" },
      { fabricNames: { 11: "Blue gingham" } },
    );
    const rejection = expect(exportPromise).rejects.toMatchObject({
      fabricId: 11,
      message: expect.stringContaining("Blue gingham"),
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("RasterExportError", () => {
  it("identifies the failed fabric and gives a recovery action", () => {
    const error = new RasterExportError(11, "Blue gingham");

    expect(error.fabricId).toBe(11);
    expect(error.message).toContain("Blue gingham");
    expect(error.message).toContain("fabric #11");
    expect(error.message).toContain("Try the download again");
    expect(error.message).toContain("replace its photo");
  });

  it("offers SVG as a safe fallback when the fabric is unknown", () => {
    expect(new RasterExportError().message).toContain("download as SVG");
  });

  it("identifies a failed fabric image before starting a download", async () => {
    const loadedUrls: string[] = [];
    class ExportImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(url: string) {
        loadedUrls.push(url);
        queueMicrotask(() => {
          if (url.includes("broken")) this.onerror?.();
          else this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", ExportImage);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<pattern id="fab-11"><image href="/working.jpg?token=one&amp;sig=two"/></pattern>' +
      '<pattern id="fab-22"><image href="/broken.jpg"/></pattern>' +
      "</defs></svg>";

    await expect(
      downloadSvgAsPng(svg, "layout.png", {
        fabricNames: { 11: "Blue gingham", 22: "Red floral" },
      }),
    ).rejects.toMatchObject({
      fabricId: 22,
      message: expect.stringContaining("Red floral"),
    });
    expect(loadedUrls).toContain("/working.jpg?token=one&sig=two");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("times out a stalled fabric image before starting a download", async () => {
    vi.useFakeTimers();
    class StalledExportImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {}
    }
    vi.stubGlobal("Image", StalledExportImage);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<pattern id="fab-11"><image href="/stalled.jpg"/></pattern>' +
      "</defs></svg>";

    const rejection = expect(
      downloadSvgAsPng(svg, "layout.png", {
        fabricNames: { 11: "Blue gingham" },
      }),
    ).rejects.toMatchObject({
      fabricId: 11,
      message: expect.stringContaining("Blue gingham"),
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(downloadBlob).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
