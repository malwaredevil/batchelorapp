import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../env", () => ({
  env: { apifyApiToken: "test-apify-token" },
}));

vi.mock("../apify-client", () => ({
  runApifyActor: vi.fn(),
}));

import { runApifyActor } from "../apify-client";
import { searchHallmark } from "./hallmark-search";

function liveHallmarkResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    found: true,
    hallmarkSku: "5QXI1006",
    name: "2025 Ford F-150 2026 Metal Ornament",
    brand: "Hallmark",
    seriesName: null,
    sequenceNumber: null,
    year: 2026,
    artist: "Timothy Bishop",
    originalRetailPrice: null,
    hallmarkProductUrl:
      "https://www.hallmark.com/ornaments/keepsake-ornaments/2025-ford-f-150-2026-metal-ornament-5QXI1006.html",
    images: [],
    description:
      "Let this bold red 2025 Ford F-150 Hallmark Keepsake Christmas ornament zoom onto your tree.",
    confidence: 0.95,
    source: "hallmark.com",
    scrapedAt: "2026-08-22T15:16:14.112Z",
    ...overrides,
  };
}

describe("searchHallmark", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns current Hallmark.com product details through the live actor path", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([liveHallmarkResult()]);

    const result = await searchHallmark({
      name: "2025 Ford F-150 2026 Metal Ornament",
      year: 2026,
    });

    expect(runApifyActor).toHaveBeenCalledWith(
      "NE2FKT2a7bh9AnKvE",
      {
        hallmarkSku: undefined,
        name: "2025 Ford F-150 2026 Metal Ornament",
        year: 2026,
      },
      "test-apify-token",
      expect.objectContaining({ maxItems: 1 }),
    );
    expect(result).toMatchObject({
      hallmarkSku: "5QXI1006",
      name: "2025 Ford F-150 2026 Metal Ornament",
      year: 2026,
      artist: "Timothy Bishop",
      source: "hallmark.com",
    });
  });

  it("returns a safe miss when the live actor has no product result", async () => {
    vi.mocked(runApifyActor).mockResolvedValue([]);

    await expect(
      searchHallmark({ hallmarkSku: "5QXI1006" }),
    ).resolves.toBeNull();
  });
});
