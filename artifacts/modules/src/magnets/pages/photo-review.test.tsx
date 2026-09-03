import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ImageCaptureReview,
  normalizeCapturedImage,
  rotateImageCounterClockwise,
  rotateImageClockwise,
} from "@workspace/image-capture";

type CanvasCalls = {
  transform: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

let canvasCalls: CanvasCalls[] = [];
let bitmapMock: ReturnType<typeof vi.fn>;

function exifOrientationSixFile(type = "image/jpeg"): File {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x1e], 0);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // Exif\0\0
  bytes.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 12);
  bytes.set([0x00, 0x01], 20); // one IFD entry
  bytes.set(
    [0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0, 0],
    22,
  );
  return {
    name: "camera.jpg",
    type,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

beforeEach(() => {
  canvasCalls = [];
  bitmapMock = vi.fn().mockResolvedValue({
    width: 4,
    height: 2,
    close: vi.fn(),
  });
  vi.stubGlobal("createImageBitmap", bitmapMock);
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
  Object.defineProperties(URL, {
    createObjectURL: {
      configurable: true,
      value: vi.fn(() => "blob:review-preview"),
    },
    revokeObjectURL: {
      configurable: true,
      value: vi.fn(() => undefined),
    },
  });

  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = createElement(tagName, options);
    if (tagName !== "canvas") return element;

    const calls: CanvasCalls = {
      transform: vi.fn(),
      translate: vi.fn(),
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
      scale: vi.fn(),
      getImageData: vi.fn(
        (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
      ),
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

describe("camera photo review", () => {
  it("bakes EXIF orientation into upright pixels without forcing portrait", async () => {
    bitmapMock
      .mockRejectedValueOnce(new Error("orientation option unavailable"))
      .mockResolvedValueOnce({ width: 4, height: 2, close: vi.fn() });

    const normalized = await normalizeCapturedImage(exifOrientationSixFile());

    expect(normalized.type).toBe("image/jpeg");
    expect(canvasCalls[0]?.transform).toHaveBeenCalledWith(0, 1, -1, 0, 2, 0);
    expect(canvasCalls[0]?.drawImage).toHaveBeenCalledTimes(1);
  });

  it("uses the JPEG bytes for EXIF detection when the camera MIME label is empty", async () => {
    bitmapMock
      .mockRejectedValueOnce(new Error("orientation option unavailable"))
      .mockResolvedValueOnce({ width: 4, height: 2, close: vi.fn() });

    await normalizeCapturedImage(exifOrientationSixFile(""));

    expect(canvasCalls[0]?.transform).toHaveBeenCalledWith(0, 1, -1, 0, 2, 0);
  });

  it("rotates the accepted upload clockwise with swapped dimensions", async () => {
    await rotateImageClockwise(
      new File(["image"], "landscape.jpg", { type: "image/jpeg" }),
    );

    expect(canvasCalls).toHaveLength(2);
    expect(canvasCalls[1]?.translate).toHaveBeenCalledWith(2, 0);
    expect(canvasCalls[1]?.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(canvasCalls[1]?.drawImage).toHaveBeenCalledTimes(1);
  });

  it("rotates the accepted upload counterclockwise with swapped dimensions", async () => {
    await rotateImageCounterClockwise(
      new File(["image"], "landscape.jpg", { type: "image/jpeg" }),
    );

    expect(canvasCalls).toHaveLength(2);
    expect(canvasCalls[1]?.translate).toHaveBeenCalledWith(0, 4);
    expect(canvasCalls[1]?.rotate).toHaveBeenCalledWith(-Math.PI / 2);
    expect(canvasCalls[1]?.drawImage).toHaveBeenCalledTimes(1);
  });

  it("confirms exactly one reviewed photo, retries without confirming, and cleans up its preview URL", async () => {
    const onConfirm = vi.fn();
    const onRetry = vi.fn();
    const retryView = render(
      <ImageCaptureReview
        file={new File(["image"], "photo.jpg", { type: "image/jpeg" })}
        onConfirm={onConfirm}
        onRetry={onRetry}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("button-review-ok")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("button-review-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    retryView.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:review-preview");

    const confirmView = render(
      <ImageCaptureReview
        file={new File(["image"], "photo.jpg", { type: "image/jpeg" })}
        onConfirm={onConfirm}
        onRetry={onRetry}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("button-review-ok")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("button-review-rotate-left"));
    await waitFor(() => expect(canvasCalls).toHaveLength(4));
    expect(canvasCalls[3]?.rotate).toHaveBeenCalledWith(-Math.PI / 2);

    fireEvent.click(screen.getByTestId("button-review-rotate-right"));
    await waitFor(() => expect(canvasCalls).toHaveLength(6));
    expect(canvasCalls[5]?.rotate).toHaveBeenCalledWith(Math.PI / 2);

    fireEvent.click(screen.getByTestId("button-review-ok"));
    fireEvent.click(screen.getByTestId("button-review-ok"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toBeInstanceOf(File);
    confirmView.unmount();
  });

  it("returns to review after editing and confirms only the saved edited file", async () => {
    const onConfirm = vi.fn();
    const onRetry = vi.fn();
    render(
      <ImageCaptureReview
        file={new File(["image"], "photo.jpg", { type: "image/jpeg" })}
        onConfirm={onConfirm}
        onRetry={onRetry}
        enableEditing
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("button-review-edit")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("button-review-retry")).toBeInTheDocument();
    expect(screen.getByTestId("button-review-ok")).toBeInTheDocument();
    expect(screen.getByTestId("button-review-rotate-left")).toBeInTheDocument();
    expect(
      screen.getByTestId("button-review-rotate-right"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-review-edit"));
    expect(screen.getByText("Edit photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.getByTestId("button-review-edit")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-review-edit"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /right/i }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(screen.getByTestId("button-review-ok")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("button-review-ok"));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const confirmedFile = onConfirm.mock.calls[0]?.[0] as File;
    expect(confirmedFile).toBeInstanceOf(File);
    expect(confirmedFile.name).toBe("photo-edited.jpg");
    expect(confirmedFile.type).toBe("image/jpeg");
    expect(onRetry).not.toHaveBeenCalled();
  });
});
