import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-client", () => ({
  callModel: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("./research", () => ({
  researchOrnament: vi.fn(),
  sourceDomainFromUrl: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import { lookupRetailValue } from "./retail-value";
import { researchOrnament, sourceDomainFromUrl } from "./research";

describe("retail value lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps extracting a cited retail value through shared ornament research", async () => {
    vi.mocked(researchOrnament).mockResolvedValue({
      answer: "The 1995 Peanuts ornament originally retailed for $12.95.",
      citations: ["https://www.hallmark.com/product/snoopy"],
      citationDomains: new Set(["hallmark.com"]),
    });
    vi.mocked(sourceDomainFromUrl).mockReturnValue("hallmark.com");
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
                        valueUsd: 12.95,
                        productUrl: "https://www.hallmark.com/product/snoopy",
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

    await expect(
      lookupRetailValue({
        name: "Snoopy's Christmas",
        seriesOrCollection: "Peanuts",
        year: 1995,
      }),
    ).resolves.toEqual({
      valueUsd: 12.95,
      productUrl: "https://www.hallmark.com/product/snoopy",
      source: "hallmark.com",
    });
    expect(researchOrnament).toHaveBeenCalledWith(
      {
        name: "Snoopy's Christmas",
        seriesOrCollection: "Peanuts",
        year: 1995,
      },
      expect.stringContaining("retail"),
    );
  });
});
