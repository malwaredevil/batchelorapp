import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  env: { firecrawlApiKey: "test-firecrawl-key" },
}));

import {
  fetchHallmarkEventsSource,
  HALLMARK_EVENTS_URL,
  parseHallmarkEventsForTest,
} from "./hallmark-events-source";

const structuredPage = {
  markdown: "Hallmark Keepsake events 2026",
  json: {
    pageYear: 2026,
    events: [
      {
        sourceKey: "hallmark-keepsake-events",
        title: "Ornament Premiere",
        startDate: "07/11",
        endDate: "07/19",
        details: "Shop the new Keepsake ornaments.",
      },
      {
        sourceKey: "hallmark-keepsake-events",
        title: "Ornament Debut",
        startDate: "10/10",
        endDate: "10/18",
      },
      {
        sourceKey: "artist-signing",
        title: "Artist Signing",
        startDate: "July 12",
        endDate: "July 12",
      },
    ],
  },
};

function firecrawlResponse(
  data: unknown,
  status = 200,
  success = true,
): Response {
  return new Response(JSON.stringify({ success, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Hallmark event source", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes supported event windows and rejects artist signings", () => {
    const result = parseHallmarkEventsForTest(structuredPage);

    expect(result.complete).toBe(true);
    expect(result.year).toBe(2026);
    expect(result.candidates).toMatchObject([
      {
        sourceKey: "ornament-premiere:2026",
        title: "Hallmark Keepsake Ornament Premiere",
        startDate: "2026-07-11",
        endDate: "2026-07-19",
      },
      {
        sourceKey: "ornament-debut:2026",
        title: "Hallmark Keepsake Ornament Debut",
        startDate: "2026-10-10",
        endDate: "2026-10-18",
      },
    ]);
    expect(result.rejected).toEqual([
      {
        sourceKey: "artist-signing",
        title: "Artist Signing",
        reason: "Unsupported event category",
      },
    ]);
  });

  it("does not mark malformed or yearless date data as safe to reconcile", () => {
    const result = parseHallmarkEventsForTest({
      json: {
        pageYear: 2026,
        events: [
          {
            sourceKey: "ornament-premiere",
            title: "Premiere",
            startDate: "July 40",
            endDate: "July 41",
          },
        ],
      },
    });

    expect(result.complete).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({
      reason: "Invalid or incomplete date range",
    });
  });

  it("rejects a partial source even when one event is valid", () => {
    const result = parseHallmarkEventsForTest({
      json: {
        pageYear: 2026,
        events: [
          {
            sourceKey: "hallmark-keepsake-events",
            title: "Ornament Premiere",
            startDate: "2026-07-11",
            endDate: "2026-07-19",
          },
        ],
      },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.complete).toBe(false);
  });

  it("uses the canonical page through Firecrawl", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(firecrawlResponse(structuredPage));

    const result = await fetchHallmarkEventsSource(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.firecrawl.dev/v2/scrape",
    );
    expect(
      JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      url: HALLMARK_EVENTS_URL,
      formats: [
        "markdown",
        {
          type: "json",
          checkPromptInjection: true,
        },
      ],
    });
    expect(result.sourceUrl).toBe(HALLMARK_EVENTS_URL);
    expect(result.candidates).toHaveLength(2);
  });

  it("falls back to an official Hallmark search result when the canonical page fails", async () => {
    const replacementUrl = "https://www.hallmark.com/keepsake-events/";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(firecrawlResponse({}, 404, false))
      .mockResolvedValueOnce(
        firecrawlResponse({
          web: [
            {
              url: replacementUrl,
              ...structuredPage,
            },
          ],
        }),
      );

    const result = await fetchHallmarkEventsSource(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.firecrawl.dev/v2/search",
    );
    expect(result.sourceUrl).toBe(replacementUrl);
  });
});
