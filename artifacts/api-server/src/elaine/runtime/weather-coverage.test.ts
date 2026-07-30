import { describe, expect, it } from "vitest";
import { evaluateForecastDateCoverage } from "./weather-coverage";

const forecastDates = [
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
];

describe("evaluateForecastDateCoverage", () => {
  it("rejects the Sicily regression when requested dates are outside coverage", () => {
    const result = evaluateForecastDateCoverage({
      forecastDates,
      requestedStartDate: "2026-08-05",
      requestedEndDate: "2026-08-08",
    });
    expect(result.status).toBe("outside");
    expect(result.matchingDates).toEqual([]);
    expect(result.summary).toContain("outside the available forecast");
  });

  it("identifies partial coverage without mislabelling it as complete", () => {
    const result = evaluateForecastDateCoverage({
      forecastDates,
      requestedStartDate: "2026-08-01",
      requestedEndDate: "2026-08-05",
    });
    expect(result.status).toBe("partial");
    expect(result.matchingDates).toEqual(["2026-08-01", "2026-08-02"]);
  });

  it("accepts a fully covered request", () => {
    const result = evaluateForecastDateCoverage({
      forecastDates,
      requestedStartDate: "2026-07-30",
      requestedEndDate: "2026-08-01",
    });
    expect(result.status).toBe("covered");
  });
});
