import { describe, it, expect, vi, afterEach } from "vitest";
import { createBarcodeDebouncer } from "./use-barcode-camera";

describe("createBarcodeDebouncer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first detection of a code", () => {
    const d = createBarcodeDebouncer(2000);
    expect(d.isDuplicate("12345")).toBe(false);
  });

  it("suppresses the same code scanned again immediately (rapid duplicate)", () => {
    const d = createBarcodeDebouncer(2000);
    d.isDuplicate("12345"); // first scan — recorded
    expect(d.isDuplicate("12345")).toBe(true); // immediate repeat — suppressed
  });

  it("suppresses the same code scanned within the window", () => {
    vi.useFakeTimers();
    const d = createBarcodeDebouncer(2000);
    d.isDuplicate("12345");
    vi.advanceTimersByTime(1500); // still within 2 s window
    expect(d.isDuplicate("12345")).toBe(true);
  });

  it("allows a different code even within the debounce window", () => {
    const d = createBarcodeDebouncer(2000);
    d.isDuplicate("11111");
    expect(d.isDuplicate("22222")).toBe(false);
  });

  it("allows the same code again after the window has elapsed", () => {
    vi.useFakeTimers();
    const d = createBarcodeDebouncer(2000);
    d.isDuplicate("12345");
    vi.advanceTimersByTime(2001); // just past the window
    expect(d.isDuplicate("12345")).toBe(false);
  });

  it("reset() clears state so the same code is allowed again immediately", () => {
    const d = createBarcodeDebouncer(2000);
    d.isDuplicate("12345");
    d.reset();
    expect(d.isDuplicate("12345")).toBe(false);
  });

  it("produces exactly one queue entry when the same code fires twice rapidly", () => {
    // Simulates the camera-add onDetected callback receiving the same barcode
    // twice in quick succession — the debouncer should swallow the second call.
    const d = createBarcodeDebouncer(2000);
    const received: string[] = [];

    function onDetected(code: string) {
      if (d.isDuplicate(code)) return;
      received.push(code);
    }

    onDetected("661127022308");
    onDetected("661127022308"); // rapid repeat — should be suppressed

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("661127022308");
  });
});
