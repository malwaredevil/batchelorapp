import { describe, expect, it } from "vitest";
import {
  matchCategoryIds,
  mergeExistingCategoryIds,
  parsePositiveIntegerArray,
  parseStringArray,
} from "./collection-parsing";

describe("collection parsing", () => {
  it("accepts JSON and multipart comma-delimited arrays", () => {
    expect(parseStringArray('["Blue","Batik"]')).toEqual(["Blue", "Batik"]);
    expect(parseStringArray("Blue, Batik")).toEqual(["Blue", "Batik"]);
    expect(parsePositiveIntegerArray("[1,2,-1,2.5]")).toEqual([1, 2]);
  });

  it("matches normalized category phrases without numeric substrings", () => {
    const categories = [
      { id: 1, name: '8"' },
      { id: 2, name: "Bowl" },
    ];
    expect(matchCategoryIds(categories, ["18″ Green Bowl"])).toEqual([2]);
    expect(matchCategoryIds(categories, ["8″ Green Bowl"])).toEqual([1, 2]);
  });

  it("unions only category ids that still exist", () => {
    expect(
      mergeExistingCategoryIds(
        [
          { id: 1, name: "One" },
          { id: 2, name: "Two" },
        ],
        [1, 99],
        [2, 1],
      ),
    ).toEqual([1, 2]);
  });
});
