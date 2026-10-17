import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../web-search", () => ({
  webSearch: vi.fn(),
  extractCitationDomains: vi.fn(() => new Set(["hallmark.com"])),
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import { logger } from "../logger";
import { webSearch } from "../web-search";
import { researchOrnament } from "./research";

const identity = {
  name: "Test ornament",
  seriesOrCollection: "Test series",
  year: 2000,
};

describe("optional ornament research", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests cited facts without unnecessary image searches", async () => {
    vi.mocked(webSearch).mockResolvedValue({
      answer: "Originally $12.95.",
      citations: ["https://hallmark.com/ornament"],
      images: [],
    });
    const result = await researchOrnament(identity, "Find MSRP.");
    expect(webSearch).toHaveBeenCalledWith(expect.any(String), {
      includeImages: false,
      workload: "catalog",
    });
    expect(result?.answer).toBe("Originally $12.95.");
  });

  it("handles a timeout without fabricating a replacement value or retrying", async () => {
    const error = new OpenAI.APIConnectionTimeoutError();
    vi.mocked(webSearch).mockRejectedValue(error);
    await expect(researchOrnament(identity, "Find MSRP.")).resolves.toBeNull();
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      "ornament research failed; existing values retained",
    );
  });

  it("does not treat uncited output as a replacement value", async () => {
    vi.mocked(webSearch).mockResolvedValue({
      answer: "Maybe $12.95.",
      citations: [],
      images: [],
    });
    expect(await researchOrnament(identity, "Find MSRP.")).toBeNull();
  });
});
