import { describe, expect, it } from "vitest";
import {
  sourceHandleForPreviewHandle,
  sourcePanDeltaForPreviewDrag,
} from "@workspace/image-capture";

describe("ImageEditor crop interactions after transforms", () => {
  it("maps visible crop corners back to their source edges after quarter turns", () => {
    expect(sourceHandleForPreviewHandle("tl", 1, false)).toBe("bl");
    expect(sourceHandleForPreviewHandle("br", 1, false)).toBe("tr");
    expect(sourceHandleForPreviewHandle("tl", 3, false)).toBe("tr");
    expect(sourceHandleForPreviewHandle("br", 3, false)).toBe("bl");
  });

  it("accounts for horizontal mirroring when resolving a visible crop corner", () => {
    expect(sourceHandleForPreviewHandle("tl", 1, true)).toBe("tl");
    expect(sourceHandleForPreviewHandle("br", 3, true)).toBe("tl");
  });

  it("inverse-rotates pan drags into source-image movement", () => {
    expect(sourcePanDeltaForPreviewDrag(10, 0, 100, 100, 1, 1, false)).toEqual({
      x: 0,
      y: -0.1,
    });
    expect(sourcePanDeltaForPreviewDrag(10, 0, 100, 100, 1, 3, false)).toEqual({
      x: 0,
      y: 0.1,
    });
  });

  it("inverse-rotates and unmirrors pan drags together", () => {
    expect(sourcePanDeltaForPreviewDrag(0, 10, 100, 100, 1, 1, true)).toEqual({
      x: 0.1,
      y: 0,
    });
  });
});
