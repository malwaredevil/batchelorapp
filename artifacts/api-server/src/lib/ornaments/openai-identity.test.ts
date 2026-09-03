import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai-client", () => ({
  callModel: vi.fn(),
  getModels: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import { enrichOrnamentIdentity } from "./openai";

function mockVisionIdentityResponse(response: unknown) {
  vi.mocked(getModels).mockResolvedValue({
    fastVision: "test-model",
  } as Awaited<ReturnType<typeof getModels>>);
  vi.mocked(callModel).mockImplementation(async (_model, run) =>
    run(
      {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: JSON.stringify(response) } }],
            }),
          },
        },
      } as never,
      "test-model",
    ),
  );
}

describe("targeted ornament identity enrichment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only a supported series and year from the focused pass", async () => {
    mockVisionIdentityResponse({
      seriesOrCollection: "Frosty Friends",
      year: "1998",
    });

    await expect(
      enrichOrnamentIdentity(["data:image/jpeg;base64,test"], {
        name: "Snow Day",
        barcodeValue: "661127022308",
        seriesOrCollection: null,
        year: null,
      }),
    ).resolves.toEqual({
      seriesOrCollection: "Frosty Friends",
      year: 1998,
    });
  });

  it("leaves identity unknown when the available evidence is insufficient", async () => {
    mockVisionIdentityResponse({
      seriesOrCollection: null,
      year: "not readable",
    });

    await expect(
      enrichOrnamentIdentity(["data:image/jpeg;base64,test"], {
        name: "Snow Day",
        barcodeValue: null,
        seriesOrCollection: null,
        year: null,
      }),
    ).resolves.toEqual({ seriesOrCollection: null, year: null });
  });

  it("rejects an impossible year from the visual response", async () => {
    mockVisionIdentityResponse({
      seriesOrCollection: "Frosty Friends",
      year: 1700,
    });

    await expect(
      enrichOrnamentIdentity(["data:image/jpeg;base64,test"], {
        name: "Snow Day",
        barcodeValue: null,
        seriesOrCollection: null,
        year: null,
      }),
    ).resolves.toEqual({ seriesOrCollection: "Frosty Friends", year: null });
  });
});
