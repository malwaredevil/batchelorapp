import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./ai-client", () => ({
  getModels: vi.fn(async () => ({ research: "test-search-model" })),
  callModel: vi.fn(async (_model, run) =>
    run({ chat: { completions: { create } } }, "test-search-model"),
  ),
}));
vi.mock("./app-config", () => ({
  getConfig: vi.fn(async (_module, _key, fallback) => fallback),
}));

import { webSearch } from "./web-search";

describe("web search request policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({
      choices: [{ message: { content: "Cited answer." } }],
    });
  });

  it("keeps image searches enabled for existing chat callers", async () => {
    await webSearch("Find a photo.");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ return_images: true }),
      { timeout: 15_000 },
    );
  });

  it("disables image enrichment when a fact lookup opts out", async () => {
    await webSearch("Find MSRP.", { includeImages: false });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ return_images: false }),
      { timeout: 15_000 },
    );
  });

  it("propagates timeouts to required callers without retries", async () => {
    const error = new OpenAI.APIConnectionTimeoutError();
    create.mockRejectedValue(error);
    await expect(webSearch("Find MSRP.")).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
