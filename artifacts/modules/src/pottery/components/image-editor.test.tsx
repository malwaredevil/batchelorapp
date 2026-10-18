import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageEditor } from "./image-editor";

const bitmap = { width: 100, height: 80, close: vi.fn() };
const context = {
  filter: "none",
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  drawImage: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  getImageData: vi.fn(
    (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(128),
    }),
  ),
  putImageData: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) =>
      callback(new Blob(["exported photo"], { type: "image/jpeg" })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openEditor() {
  const onSave = vi.fn();
  render(
    <ImageEditor
      file={
        new File(["original photo"], "original.jpg", { type: "image/jpeg" })
      }
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );
  await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
  return onSave;
}

function sharpenSlider(value: number) {
  const label = screen.getByText(`Sharpen ${value}`, { exact: true });
  return within(label.parentElement!).getByRole("slider");
}

describe("neutral photo editing defaults", () => {
  it("saves a crop at source resolution without silently applying sharpening", async () => {
    const onSave = await openEditor();
    expect(sharpenSlider(0)).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(context.getImageData).not.toHaveBeenCalled();
    expect(context.putImageData).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenLastCalledWith(
      bitmap,
      10,
      8,
      80,
      64,
      -40,
      -32,
      80,
      64,
    );
    const output = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock
      .contexts[0] as HTMLCanvasElement;
    expect([output.width, output.height]).toEqual([80, 64]);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      name: "original-edited.jpg",
      type: "image/jpeg",
    });
  });

  it("resets an intentionally sharpened photo back to neutral", async () => {
    const onSave = await openEditor();
    fireEvent.keyDown(sharpenSlider(0), { key: "End" });
    expect(sharpenSlider(100)).toHaveAttribute("aria-valuenow", "100");
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(sharpenSlider(0)).toHaveAttribute("aria-valuenow", "0");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(context.getImageData).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("still applies sharpening when the user explicitly chooses it", async () => {
    const onSave = await openEditor();
    fireEvent.keyDown(sharpenSlider(0), { key: "End" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 100, 80);
    expect(context.putImageData).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
