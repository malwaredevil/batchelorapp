import { describe, expect, it } from "vitest";
import {
  getMissingOrnamentMaintenanceFields,
  getOrnamentMaintenanceRecommendation,
  hasCompleteOrnamentMaintenanceData,
} from "./maintenance";

describe("ornament maintenance status", () => {
  it("reports every exact missing identity and search field", () => {
    expect(
      getMissingOrnamentMaintenanceFields({
        embedding: null,
        seriesOrCollection: "  ",
        year: null,
      }),
    ).toEqual(["embedding", "seriesOrCollection", "year"]);
  });

  it("does not flag an otherwise complete ornament", () => {
    expect(
      getMissingOrnamentMaintenanceFields({
        embedding: [0.1, 0.2],
        seriesOrCollection: "Frosty Friends",
        year: 1998,
      }),
    ).toEqual([]);
  });

  it("gives an actionable evidence request for unresolved identity", () => {
    expect(
      getOrnamentMaintenanceRecommendation(["seriesOrCollection", "year"]),
    ).toMatch(/box front or tag/i);
  });

  it("recognizes a complete record without treating unrelated fields as missing", () => {
    expect(
      hasCompleteOrnamentMaintenanceData({
        embedding: [0.1],
        seriesOrCollection: "Frosty Friends",
        year: 1998,
      }),
    ).toBe(true);
  });
});
