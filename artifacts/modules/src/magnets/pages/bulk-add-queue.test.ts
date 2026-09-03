import { describe, expect, it } from "vitest";
import { claimCaptureSchedule, releaseCaptureSchedule } from "./bulk-add-queue";

describe("Magnet bulk-add capture scheduling", () => {
  it("ignores a repeated Retry before React can rerender the error row", () => {
    const scheduled = new Set<string>();

    expect(claimCaptureSchedule(scheduled, "capture-1")).toBe(true);
    expect(claimCaptureSchedule(scheduled, "capture-1")).toBe(false);
    expect(scheduled).toEqual(new Set(["capture-1"]));

    releaseCaptureSchedule(scheduled, "capture-1");
    expect(claimCaptureSchedule(scheduled, "capture-1")).toBe(true);
  });
});
