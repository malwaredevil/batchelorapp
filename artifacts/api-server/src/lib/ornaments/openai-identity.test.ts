import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app-config", () => ({
  getConfig: vi.fn(async (_module, _key, fallback) => fallback),
}));

vi.mock("../ai-client", () => ({
  callModel: vi.fn(),
  getModels: vi.fn(),
}));

import { callModel, getModels } from "../ai-client";
import { embedText, enrichOrnamentIdentity } from "./openai";

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

  it("includes ornament embeddings in catalog capacity without vision parameters", async () => {
    vi.mocked(getModels).mockResolvedValue({
      embedding: "test-embedding-model",
    } as Awaited<ReturnType<typeof getModels>>);
    const create = vi.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }],
    });
    vi.mocked(callModel).mockImplementation(async (_model, run) =>
      run({ embeddings: { create } } as never, "test-embedding-model"),
    );
    expect(await embedText("ornament description")).toEqual([0.1, 0.2]);
    expect(callModel).toHaveBeenCalledWith(
      "test-embedding-model",
      expect.any(Function),
      "catalog",
    );
    expect(create).toHaveBeenCalledWith({
      model: "test-embedding-model",
      input: "ornament description",
    });
  });

  it("uses the shared catalog workload and bounded reasoning policy", async () => {
    mockVisionIdentityResponse({ seriesOrCollection: null, year: null });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
    });
    vi.mocked(callModel).mockImplementation(async (_model, run) =>
      run({ chat: { completions: { create } } } as never, "test-model"),
    );
    await enrichOrnamentIdentity(["data:image/jpeg;base64,test"], {
      name: "Snow Day",
      barcodeValue: null,
      seriesOrCollection: null,
      year: null,
    });
    expect(callModel).toHaveBeenCalledWith(
      "test-model",
      expect.any(Function),
      "catalog",
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        reasoning: { effort: "low", exclude: true },
        provider: { sort: "latency" },
      }),
    );
  });

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
