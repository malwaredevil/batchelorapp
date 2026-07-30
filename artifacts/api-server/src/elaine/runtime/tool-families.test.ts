import { describe, expect, it } from "vitest";
import {
  assertElaineToolFamilyCoverage,
  ELAINE_TOOL_FAMILY_SENTINELS,
} from "./tool-families";

describe("Elaine tool-family compatibility guard", () => {
  it("covers travel, collection, Office, memory, widget, and navigation tools", () => {
    const names = Object.values(ELAINE_TOOL_FAMILY_SENTINELS).flat();
    expect(() => assertElaineToolFamilyCoverage(names)).not.toThrow();
    expect(Object.keys(ELAINE_TOOL_FAMILY_SENTINELS)).toEqual([
      "travels",
      "pottery",
      "quilting",
      "ornaments",
      "office",
      "notifications",
      "memory",
      "widgets",
      "navigation",
    ]);
  });

  it("fails loudly when a representative existing family capability is lost", () => {
    expect(() => assertElaineToolFamilyCoverage([])).toThrow(
      "travels:search_household_data",
    );
  });
});
