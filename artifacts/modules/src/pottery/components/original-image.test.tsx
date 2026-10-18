import { describe, expect, it } from "vitest";
import {
  getOriginalImageFile,
  inheritOriginalImage,
} from "@workspace/image-capture";

describe("pre-edit photo provenance", () => {
  it("keeps the first photo through normalization, rotation and repeated edits", () => {
    const raw = new File(["camera pixels"], "camera.jpg", {
      type: "image/jpeg",
    });
    const normalized = inheritOriginalImage(
      new File(["upright"], "upright.jpg"),
      raw,
    );
    const rotated = inheritOriginalImage(
      new File(["rotated"], "rotated.jpg"),
      normalized,
    );
    const crop = inheritOriginalImage(new File(["crop"], "crop.jpg"), rotated);
    const secondCrop = inheritOriginalImage(
      new File(["second crop"], "crop2.jpg"),
      crop,
    );
    expect(getOriginalImageFile(secondCrop)).toBe(raw);
    expect(getOriginalImageFile(crop)).toBe(raw);
    expect(getOriginalImageFile(raw)).toBe(raw);
  });

  it("does not confuse separate camera photos or unchanged files", () => {
    const first = new File(["one"], "camera.jpg");
    const second = new File(["two"], "camera.jpg");
    inheritOriginalImage(first, first);
    const edited = inheritOriginalImage(
      new File(["crop"], "edited.jpg"),
      first,
    );
    expect(getOriginalImageFile(second)).toBe(second);
    expect(getOriginalImageFile(edited)).toBe(first);
  });
});
