import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImageEditor } from "@workspace/image-capture";

type CanvasCalls = {
  rotate: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

let canvasCalls: CanvasCalls[] = [];

beforeEach(() => {
  canvasCalls = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 4, height: 2, close: vi.fn() }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperties(HTMLCanvasElement.prototype, {
    clientWidth: { configurable: true, get: () => 320 },
    clientHeight: { configurable: true, get: () => 240 },
  });

  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = createElement(tagName, options);
    if (tagName !== "canvas") return element;

    const calls: CanvasCalls = {
      rotate: vi.fn(),
      drawImage: vi.fn(),
    };
    canvasCalls.push(calls);
    const context = {
      ...calls,
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      getImageData: vi.fn((_x, _y, width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      })),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(element, "getContext", {
      value: vi.fn(() => context),
    });
    Object.defineProperty(element, "toBlob", {
      value: (callback: (blob: Blob | null) => void) =>
        callback(new Blob(["image"], { type: "image/jpeg" })),
    });
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () =>
        ({
          left: 0,
          top: 0,
          width: 320,
          height: 240,
          right: 320,
          bottom: 240,
        }) as DOMRect,
    });
    Object.defineProperty(element, "setPointerCapture", { value: vi.fn() });
    return element;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageEditor rotation preview and cropping", () => {
  it("redraws the preview and exports the same quarter-turn", async () => {
    const onSave = vi.fn();
    render(
      <ImageEditor
        file={new File(["image"], "magnet.jpg", { type: "image/jpeg" })}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasCalls[0]?.drawImage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /right/i }));
    await waitFor(() =>
      expect(canvasCalls[0]?.rotate).toHaveBeenCalledWith(Math.PI / 2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(canvasCalls[1]?.rotate).toHaveBeenCalledWith(Math.PI / 2);
  });

  it("applies a rotated visible corner drag to its matching source crop edge", async () => {
    const onSave = vi.fn();
    render(
      <ImageEditor
        file={new File(["image"], "magnet.jpg", { type: "image/jpeg" })}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasCalls[0]?.drawImage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /right/i }));
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();

    // For a clockwise turn, the visible top-left crop handle is the source
    // bottom-left handle. Dragging it down moves the source left edge right.
    fireEvent.pointerDown(canvas!, {
      pointerId: 1,
      clientX: 112,
      clientY: 24,
    });
    fireEvent.pointerMove(canvas!, {
      pointerId: 1,
      clientX: 112,
      clientY: 48,
    });
    fireEvent.pointerUp(canvas!, { pointerId: 1, clientX: 112, clientY: 48 });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(canvasCalls[1]?.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      1,
      0,
      3,
      2,
      -1.5,
      -1,
      3,
      2,
    );
  });

  it("keeps a flipped quarter-turn crop drag aligned with the saved source region", async () => {
    const onSave = vi.fn();
    render(
      <ImageEditor
        file={new File(["image"], "magnet.jpg", { type: "image/jpeg" })}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(canvasCalls[0]?.drawImage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /right/i }));
    fireEvent.click(screen.getByRole("button", { name: "Flip" }));
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();

    // After a clockwise turn plus a display-horizontal flip, visible top-left
    // maps to source top-left. Moving it right changes the source top edge.
    fireEvent.pointerDown(canvas!, {
      pointerId: 1,
      clientX: 112,
      clientY: 24,
    });
    fireEvent.pointerMove(canvas!, {
      pointerId: 1,
      clientX: 172,
      clientY: 24,
    });
    fireEvent.pointerUp(canvas!, { pointerId: 1, clientX: 172, clientY: 24 });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(canvasCalls[1]?.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      1,
      3,
      1,
      -1.5,
      -0.5,
      3,
      1,
    );
  });
});
