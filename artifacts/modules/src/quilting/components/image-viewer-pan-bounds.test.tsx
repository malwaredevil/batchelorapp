/**
 * Integration-level tests for the shared image-viewer pan/zoom bounding:
 * exercises the actual PreviewZoomModal input handlers (touch pinch/pan,
 * mouse drag, wheel zoom, toolbar zoom buttons) and asserts the rendered
 * transform never lets the content leave the viewport.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  fireEvent,
  screen,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import { ImageLightbox, PreviewZoomModal } from "@workspace/collection-ui";
import { computePanLimit, clampPanOffset } from "@workspace/collection-ui";

const VIEWPORT_W = 1000;
const VIEWPORT_H = 800;
const CONTENT_W = 800;
const CONTENT_H = 600;

function limitX(scale: number) {
  return computePanLimit(VIEWPORT_W, CONTENT_W, scale);
}
function limitY(scale: number) {
  return computePanLimit(VIEWPORT_H, CONTENT_H, scale);
}

function setup() {
  render(
    <PreviewZoomModal open onClose={() => {}} title="test">
      <div data-testid="content-inner" />
    </PreviewZoomModal>,
  );
  const canvas = document.querySelector(
    'div[style*="cursor"]',
  ) as HTMLDivElement;
  expect(canvas).toBeTruthy();
  return canvas;
}

function getTransform() {
  const el = document.querySelector(
    'div[style*="translate(calc"]',
  ) as HTMLDivElement;
  const m = el.style.transform.match(
    /translate\(calc\(-50% \+ (-?[\d.]+)px\), calc\(-50% \+ (-?[\d.]+)px\)\) scale\(([\d.]+)\)/,
  );
  expect(m).toBeTruthy();
  return { x: Number(m![1]), y: Number(m![2]), scale: Number(m![3]) };
}

type FakeTouch = { clientX: number; clientY: number };

function dispatchTouch(el: HTMLElement, type: string, touches: FakeTouch[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", { value: touches });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function dispatchWheel(el: HTMLElement, deltaY: number) {
  const ev = new WheelEvent("wheel", {
    deltaY,
    bubbles: true,
    cancelable: true,
    clientX: VIEWPORT_W / 2,
    clientY: VIEWPORT_H / 2,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe("PreviewZoomModal pan/zoom bounding (integration)", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      left: 0,
      top: 0,
      right: VIEWPORT_W,
      bottom: VIEWPORT_H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return CONTENT_W;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return CONTENT_H;
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clamps a single-finger touch pan so content can't leave the viewport", () => {
    const canvas = setup();
    dispatchTouch(canvas, "touchstart", [{ clientX: 500, clientY: 400 }]);
    dispatchTouch(canvas, "touchmove", [{ clientX: 9500, clientY: 9400 }]);
    const t = getTransform();
    expect(t.x).toBe(limitX(1));
    expect(t.y).toBe(limitY(1));
    dispatchTouch(canvas, "touchend", []);
  });

  it("two-finger pinch zooms in and subsequent pan is bounded at the new scale", () => {
    const canvas = setup();
    // Pinch: fingers spread from 100px apart to 300px apart → 3x zoom.
    dispatchTouch(canvas, "touchstart", [
      { clientX: 450, clientY: 400 },
      { clientX: 550, clientY: 400 },
    ]);
    dispatchTouch(canvas, "touchmove", [
      { clientX: 350, clientY: 400 },
      { clientX: 650, clientY: 400 },
    ]);
    let t = getTransform();
    expect(t.scale).toBeCloseTo(3, 5);
    dispatchTouch(canvas, "touchend", []);

    // Pan at 3x: a huge drag clamps to the 3x limit (larger than the 1x one).
    dispatchTouch(canvas, "touchstart", [{ clientX: 500, clientY: 400 }]);
    dispatchTouch(canvas, "touchmove", [{ clientX: 99999, clientY: 400 }]);
    t = getTransform();
    expect(t.x).toBeCloseTo(limitX(3), 3);
    expect(limitX(3)).toBeGreaterThan(limitX(1));
    dispatchTouch(canvas, "touchend", []);
  });

  it("mouse drag pan is clamped to the same bounds", () => {
    const canvas = setup();
    fireEvent.mouseDown(canvas, { button: 0, clientX: 500, clientY: 400 });
    fireEvent.mouseMove(canvas, { clientX: 500 + 99999, clientY: 400 - 99999 });
    fireEvent.mouseUp(canvas);
    const t = getTransform();
    expect(t.x).toBe(limitX(1));
    expect(t.y).toBe(-limitY(1));
  });

  it("wheel zoom-out after panning reclamps the offset to the new bound", () => {
    const canvas = setup();
    // Zoom in via wheel (several steps), then pan to the current limit.
    for (let i = 0; i < 8; i++) dispatchWheel(canvas, -100);
    const zoomedIn = getTransform().scale;
    expect(zoomedIn).toBeGreaterThan(2);
    dispatchTouch(canvas, "touchstart", [{ clientX: 500, clientY: 400 }]);
    dispatchTouch(canvas, "touchmove", [{ clientX: 999999, clientY: 400 }]);
    dispatchTouch(canvas, "touchend", []);
    expect(getTransform().x).toBeCloseTo(limitX(zoomedIn), 2);

    // Zoom all the way back out via wheel: pan must be reclamped each step.
    for (let i = 0; i < 20; i++) {
      dispatchWheel(canvas, 100);
      const t = getTransform();
      expect(Math.abs(t.x)).toBeLessThanOrEqual(limitX(t.scale) + 0.01);
    }
  });

  it("toolbar zoom-out button reclamps a large pan offset", () => {
    const canvas = setup();
    // Zoom in with the toolbar button, pan to the limit, then zoom out.
    const zoomIn = screen.getByTitle("Zoom in");
    const zoomOut = screen.getByTitle("Zoom out");
    for (let i = 0; i < 6; i++) fireEvent.click(zoomIn);
    const zoomed = getTransform().scale;
    dispatchTouch(canvas, "touchstart", [{ clientX: 500, clientY: 400 }]);
    dispatchTouch(canvas, "touchmove", [{ clientX: 999999, clientY: 400 }]);
    dispatchTouch(canvas, "touchend", []);
    expect(getTransform().x).toBeCloseTo(limitX(zoomed), 2);

    for (let i = 0; i < 12; i++) {
      fireEvent.click(zoomOut);
      const t = getTransform();
      expect(Math.abs(t.x)).toBeLessThanOrEqual(limitX(t.scale) + 0.01);
    }
    // Fully zoomed out, the offset must be back within the small-scale bound.
    const final = getTransform();
    expect(Math.abs(final.x)).toBeLessThanOrEqual(limitX(final.scale) + 0.01);
  });
});

describe("shared image viewer presentation and controls", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the image lightbox opaque while retaining title, navigation, and keyboard dismissal", () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(
      <ImageLightbox
        open
        src="/first.jpg"
        alt="First result"
        title="AI Lab result"
        images={["/first.jpg", "/second.jpg"]}
        currentIndex={0}
        labels={["Original", "Result"]}
        onNavigate={onNavigate}
        onClose={onClose}
      />,
    );

    const viewer = screen.getByRole("dialog", { name: "AI Lab result" });
    expect(viewer).toHaveClass("bg-[#08090b]");
    expect(screen.getByText("AI Lab result")).toBeVisible();
    expect(screen.getByText("1 / 2")).toBeVisible();
    expect(screen.getByText("Original")).toBeVisible();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses an opaque, wrapping toolbar for arbitrary preview content", () => {
    render(
      <PreviewZoomModal open onClose={() => {}} title="Block preview">
        <div>Preview content</div>
      </PreviewZoomModal>,
    );

    const viewer = screen.getByRole("dialog", { name: "Block preview" });
    expect(viewer).toHaveClass("bg-[#08090b]");
    expect(screen.getByTestId("preview-zoom-toolbar")).toHaveClass(
      "flex-wrap",
      "bg-[#111214]",
    );
    expect(screen.getByTitle("Zoom in")).toBeVisible();
    expect(screen.getByLabelText("Close preview")).toBeVisible();
  });

  it("keeps ImageLightbox keyboard focus inside the viewer and restores it on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <ImageLightbox open src="/result.jpg" onClose={() => {}} />,
    );

    const close = screen.getByLabelText("Close image viewer");
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByTitle("Zoom in")).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("keeps PreviewZoomModal keyboard focus inside the viewer and restores it on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <PreviewZoomModal open onClose={() => {}} title="Block preview">
        <div>Preview content</div>
      </PreviewZoomModal>,
    );

    const close = screen.getByLabelText("Close preview");
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "View" })).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("pan-bounds helpers", () => {
  it("keeps at least the minimum visible sliver of content in view", () => {
    // limit = (content*scale + viewport)/2 - minVisible
    expect(computePanLimit(1000, 800, 1)).toBe(852);
    expect(computePanLimit(1000, 800, 4)).toBe(2052);
    // Never negative even for tiny content at tiny scale.
    expect(computePanLimit(100, 10, 0.1)).toBe(2.5);
    expect(computePanLimit(50, 10, 0.1)).toBeGreaterThanOrEqual(0);
  });

  it("clampPanOffset is symmetric and bounded", () => {
    expect(clampPanOffset(9999, 500)).toBe(500);
    expect(clampPanOffset(-9999, 500)).toBe(-500);
    expect(clampPanOffset(123, 500)).toBe(123);
  });
});
