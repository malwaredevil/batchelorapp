import { describe, it, expect } from "vitest";
import { parseAiAppraisalRange, computeConsensusValue } from "./index";

describe("parseAiAppraisalRange", () => {
  it("parses a standard hyphen range", () => {
    expect(
      parseAiAppraisalRange("This ornament appraises for $10-$18 in EUC."),
    ).toEqual({ low: 10, high: 18 });
  });

  it("parses en-dash and em-dash ranges with spacing", () => {
    expect(parseAiAppraisalRange("Est. value $10 – $18")).toEqual({
      low: 10,
      high: 18,
    });
    expect(parseAiAppraisalRange("Est. value $10 — $18")).toEqual({
      low: 10,
      high: 18,
    });
  });

  it("parses decimal values", () => {
    expect(parseAiAppraisalRange("$10.50-$18.25")).toEqual({
      low: 10.5,
      high: 18.25,
    });
  });

  it("returns nulls when there is no parseable range", () => {
    expect(parseAiAppraisalRange("Hard to say what this is worth.")).toEqual({
      low: null,
      high: null,
    });
    expect(parseAiAppraisalRange(null)).toEqual({ low: null, high: null });
    expect(parseAiAppraisalRange(undefined)).toEqual({
      low: null,
      high: null,
    });
  });
});

describe("computeConsensusValue", () => {
  it("returns null with fewer than two sources", () => {
    expect(
      computeConsensusValue({
        bookValue: 20,
        ebayPriceMinUsd: null,
        ebayPriceMaxUsd: null,
        aiAppraisal: null,
      }),
    ).toBeNull();
  });

  it("averages book value + eBay mid when both present", () => {
    // ebayMid = (10+20)/2 = 15, book = 20 -> avg = 17.5
    expect(
      computeConsensusValue({
        bookValue: 20,
        ebayPriceMinUsd: 10,
        ebayPriceMaxUsd: 20,
        aiAppraisal: null,
      }),
    ).toBe(17.5);
  });

  it("averages all three sources when all present", () => {
    // ebayMid = (10+20)/2 = 15, aiMid = (10+18)/2 = 14, book = 20
    // avg = (15+14+20)/3 = 16.333...
    const result = computeConsensusValue({
      bookValue: 20,
      ebayPriceMinUsd: 10,
      ebayPriceMaxUsd: 20,
      aiAppraisal: "$10-$18",
    });
    expect(result).toBeCloseTo(16.333, 2);
  });
});
