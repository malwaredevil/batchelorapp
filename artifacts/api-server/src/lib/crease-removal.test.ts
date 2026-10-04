import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callModelMock, getModelsMock } = vi.hoisted(() => ({
  callModelMock: vi.fn(),
  getModelsMock: vi.fn(),
}));

vi.mock("./ai-client", () => ({
  callModel: callModelMock,
  getModels: getModelsMock,
}));

vi.mock("./env", () => ({ env: {} }));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { detectCreasesFromBuffer } from "./crease-removal";

describe("detectCreasesFromBuffer", () => {
  beforeEach(() => {
    callModelMock.mockReset();
    getModelsMock.mockReset();
  });

  it("uses the runtime-configured fast vision model, not the startup default", async () => {
    getModelsMock.mockResolvedValue({ fastVision: "owner/rolled-back-vision" });
    callModelMock.mockResolvedValue(
      JSON.stringify({ description: "No creases", creases: [] }),
    );
    const img = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await detectCreasesFromBuffer(img);

    expect(getModelsMock).toHaveBeenCalledTimes(1);
    expect(callModelMock).toHaveBeenCalledWith(
      "owner/rolled-back-vision",
      expect.any(Function),
    );
    expect(result.description).toBe("No creases");
    expect(result.creases).toEqual([]);
  });
});
