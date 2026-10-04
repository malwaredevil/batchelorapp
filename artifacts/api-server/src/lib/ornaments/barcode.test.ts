import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ env: {} }));
vi.mock("../ebay/oauth", () => ({ getEbayAppToken: vi.fn() }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../ai-client", () => ({
  getModels: vi.fn(),
  callModel: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import { lookupBarcode } from "./barcode";

describe("barcode recognition model selection", () => {
  it.each(["google/gemini-3.8-flash", "custom/recognizer"])(
    "uses the configured fastVision model %s for the bounded AI fallback",
    async (model) => {
      vi.mocked(getModels).mockResolvedValue({
        fastVision: model,
      } as Awaited<ReturnType<typeof getModels>>);
      vi.mocked(callModel).mockResolvedValue('{"found":false}');
      const result = await lookupBarcode("661127022308");
      expect(result.found).toBe(false);
      expect(callModel).toHaveBeenLastCalledWith(model, expect.any(Function));
    },
  );
});
