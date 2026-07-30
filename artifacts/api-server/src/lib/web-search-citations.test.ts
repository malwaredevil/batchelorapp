import { describe, expect, it } from "vitest";
import { extractWebSearchCitations } from "./web-search-citations";

describe("extractWebSearchCitations", () => {
  it("extracts standardized OpenRouter URL citation annotations", () => {
    expect(
      extractWebSearchCitations({
        choices: [
          {
            message: {
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    url: "https://example.test/current",
                    title: "Invented current source",
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual(["https://example.test/current"]);
  });

  it("retains legacy citations and deduplicates mixed response shapes in stable order", () => {
    expect(
      extractWebSearchCitations({
        choices: [
          {
            message: {
              annotations: [
                {
                  type: "url_citation",
                  url_citation: { url: "https://example.test/first" },
                },
                {
                  type: "url_citation",
                  url_citation: { url: "https://example.test/shared" },
                },
              ],
            },
          },
        ],
        citations: [
          "https://example.test/shared",
          "https://example.test/legacy",
        ],
      }),
    ).toEqual([
      "https://example.test/first",
      "https://example.test/shared",
      "https://example.test/legacy",
    ]);
  });

  it("ignores malformed annotations and non-HTTP URLs", () => {
    expect(
      extractWebSearchCitations({
        choices: [
          null,
          {
            message: {
              annotations: [
                null,
                {
                  type: "other",
                  url_citation: { url: "https://ignored.test" },
                },
                {
                  type: "url_citation",
                  url_citation: { url: "javascript:alert(1)" },
                },
                {
                  type: "url_citation",
                  url_citation: { url: "not a URL" },
                },
              ],
            },
          },
        ],
        citations: [
          42,
          null,
          "ftp://example.test/file",
          "https://user:password@example.test/private",
        ],
      }),
    ).toEqual([]);
  });

  it("bounds the returned citation list", () => {
    const citations = Array.from(
      { length: 30 },
      (_, index) => `https://example.test/source-${index}`,
    );

    expect(extractWebSearchCitations({ citations })).toHaveLength(20);
  });
});
