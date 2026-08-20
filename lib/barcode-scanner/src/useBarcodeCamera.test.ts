import { describe, expect, it } from "vitest";
import { createBarcodeConfirmation } from "./useBarcodeCamera";

describe("createBarcodeConfirmation", () => {
  it("does not accept a barcode until it has been read three times consecutively", () => {
    const confirmation = createBarcodeConfirmation(3);

    expect(confirmation.register("7611862311666")).toEqual({
      accepted: false,
      progress: 1,
    });
    expect(confirmation.register("7611862311666")).toEqual({
      accepted: false,
      progress: 2,
    });
    expect(confirmation.register("7611862311666")).toEqual({
      accepted: true,
      progress: 3,
    });
  });

  it("throws away a partial confirmation when the camera reads a different code", () => {
    const confirmation = createBarcodeConfirmation(3);
    confirmation.register("7611862311666");
    confirmation.register("7611862311666");

    expect(confirmation.register("08009936")).toEqual({
      accepted: false,
      progress: 1,
    });
  });

  it("can be reset for a new scan session", () => {
    const confirmation = createBarcodeConfirmation(3);
    confirmation.register("7611862311666");
    confirmation.reset();

    expect(confirmation.register("7611862311666")).toEqual({
      accepted: false,
      progress: 1,
    });
  });

  it("normalizes surrounding whitespace before confirming a code", () => {
    const confirmation = createBarcodeConfirmation(2);

    confirmation.register(" 7611862311666 ");
    expect(confirmation.register("7611862311666")).toEqual({
      accepted: true,
      progress: 2,
    });
  });
});
