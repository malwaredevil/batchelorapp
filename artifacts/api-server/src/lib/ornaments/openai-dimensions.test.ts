import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-client", () => ({
  callModel: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("./dimensions", () => ({
  resolveOrnamentDimensions: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import { resolveOrnamentDimensions } from "./dimensions";
import { analyzeOrnamentImage } from "./openai";

function mockVisionAnalysis() {
  vi.mocked(getModels).mockResolvedValue({
    fastVision: "test-model",
  } as Awaited<ReturnType<typeof getModels>>);
  vi.mocked(callModel).mockImplementation(async (_model, run) =>
    run(
      {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      name: "Snoopy's Christmas",
                      seriesOrCollection: "Peanuts",
                      year: 1995,
                      dimensions: null,
                      dominantColors: ["white"],
                      motifs: ["Snoopy"],
                      aiDescription: "A festive Snoopy ornament.",
                      boxDescription: null,
                      boxDescriptionGenerated: false,
                      upc: null,
                    }),
                  },
                },
              ],
            }),
          },
        },
      } as never,
      "test-model",
    ),
  );
}

describe("ornament analysis dimensions options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisionAnalysis();
  });

  it("does not research when creation supplied dimensions or reanalysis locked them", async () => {
    await expect(
      analyzeOrnamentImage(["data:image/jpeg;base64,test"], {
        resolveDimensions: false,
      }),
    ).resolves.toMatchObject({ dimensions: null });
    expect(resolveOrnamentDimensions).not.toHaveBeenCalled();
  });

  it("resolves dimensions through the shared resolver when enabled", async () => {
    vi.mocked(resolveOrnamentDimensions).mockResolvedValue("3.5 in H × 2 in W");

    await expect(
      analyzeOrnamentImage(["data:image/jpeg;base64,test"], {
        resolveDimensions: true,
      }),
    ).resolves.toMatchObject({ dimensions: "3.5 in H × 2 in W" });
    expect(resolveOrnamentDimensions).toHaveBeenCalledWith({
      visualDimensions: null,
      identity: {
        name: "Snoopy's Christmas",
        seriesOrCollection: "Peanuts",
        year: 1995,
      },
    });
  });
});
