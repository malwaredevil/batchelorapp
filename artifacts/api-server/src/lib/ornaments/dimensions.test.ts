import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-client", () => ({
  callModel: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("./research", () => ({
  hasResearchableOrnamentIdentity: vi.fn(),
  researchOrnament: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import {
  normalizePhysicalOrnamentDimensions,
  resolveOrnamentDimensions,
} from "./dimensions";
import { hasResearchableOrnamentIdentity, researchOrnament } from "./research";

const identity = {
  name: "Snoopy's Christmas",
  seriesOrCollection: "Peanuts",
  year: 1995,
};

describe("ornament physical dimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an explicitly stated physical ornament measurement", async () => {
    await expect(
      resolveOrnamentDimensions({
        visualDimensions: '3.5" H x 2" W x 1.25" D',
        identity,
      }),
    ).resolves.toBe('3.5" H × 2" W × 1.25" D');
    expect(researchOrnament).not.toHaveBeenCalled();
  });

  it.each([
    "Approx. 4 in tall",
    "Box dimensions: 6 in × 4 in × 3 in",
    "Shipping package: 8 in × 5 in × 4 in",
    "3.5 inches estimated from the photo",
    "Small ornament",
  ])("rejects unsupported dimensions: %s", (value) => {
    expect(normalizePhysicalOrnamentDimensions(value)).toBeNull();
  });

  it("uses only a cited matching published physical measurement", async () => {
    vi.mocked(hasResearchableOrnamentIdentity).mockReturnValue(true);
    vi.mocked(researchOrnament).mockResolvedValue({
      answer:
        "Hallmark lists Snoopy's Christmas (Peanuts, 1995) at 3.5 in H × 2 in W.",
      citations: ["https://www.hallmark.com/snoopy-christmas"],
      citationDomains: new Set(["hallmark.com"]),
    });
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
                        dimensions: "3.5 in H × 2 in W",
                        citationUrl:
                          "https://www.hallmark.com/snoopy-christmas",
                        evidence:
                          "The ornament is listed as 3.5 in H × 2 in W.",
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
      resolveOrnamentDimensions({ visualDimensions: null, identity }),
    ).resolves.toBe("3.5 in H × 2 in W");
    expect(researchOrnament).toHaveBeenCalledWith(
      identity,
      expect.stringContaining("published physical dimensions"),
    );
  });

  it("does not accept a result without a supplied citation or a research result", async () => {
    vi.mocked(hasResearchableOrnamentIdentity).mockReturnValue(true);
    vi.mocked(researchOrnament).mockResolvedValue(null);

    await expect(
      resolveOrnamentDimensions({ visualDimensions: null, identity }),
    ).resolves.toBeNull();
    expect(callModel).not.toHaveBeenCalled();
  });

  it("rejects malformed extraction output and citations that do not match the result", async () => {
    vi.mocked(hasResearchableOrnamentIdentity).mockReturnValue(true);
    vi.mocked(researchOrnament).mockResolvedValue({
      answer: "A search result with unclear product identity.",
      citations: ["https://example.com/catalog"],
      citationDomains: new Set(["example.com"]),
    });
    vi.mocked(getModels).mockResolvedValue({
      fastVision: "test-model",
    } as Awaited<ReturnType<typeof getModels>>);
    vi.mocked(callModel).mockImplementation(async (_model, run) =>
      run(
        {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{ message: { content: "not valid JSON" } }],
              }),
            },
          },
        } as never,
        "test-model",
      ),
    );

    await expect(
      resolveOrnamentDimensions({ visualDimensions: null, identity }),
    ).resolves.toBeNull();

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
                        dimensions: "3 in H",
                        citationUrl: "https://unrelated.example/item",
                        evidence: "The ornament is 3 in H.",
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
      resolveOrnamentDimensions({ visualDimensions: null, identity }),
    ).resolves.toBeNull();
  });
});
