import { describe, expect, it } from "vitest";
import { getPhotoRecognitionRefetchInterval } from "@workspace/collection-ui";

describe("automatic photo-recognition detail polling", () => {
  it("refreshes while a recognition run is pending or briefly acknowledged", () => {
    expect(getPhotoRecognitionRefetchInterval("pending")).toBe(1_000);
    expect(getPhotoRecognitionRefetchInterval("complete")).toBe(1_000);
    expect(getPhotoRecognitionRefetchInterval(null)).toBe(false);
  });
});
