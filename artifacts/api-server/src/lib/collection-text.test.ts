import { describe, expect, it } from "vitest";
import { normalizeCollectionTag } from "@workspace/web-core/collection-text";

describe("shared collection tag normalization", () => {
  it.each([
    ["", ""],
    ["   ", ""],
    ["  cotton  ", "Cotton"],
    ["  2″ × 3′  ", "2\" × 3'"],
    ["“blue”–green…", '"blue"-green...'],
    ["écru", "Écru"],
    ["MIXED case", "MIXED case"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeCollectionTag(raw)).toBe(expected);
    expect(normalizeCollectionTag(normalizeCollectionTag(raw))).toBe(expected);
  });

  it("preserves every formerly supported double/single quote spelling", () => {
    for (const quote of "\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u301D\u301E\u02BA\uFF02") {
      expect(normalizeCollectionTag(`a${quote}b`)).toBe('A"b');
    }
    for (const quote of "\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u02B9\u02BC\uFF07") {
      expect(normalizeCollectionTag(`a${quote}b`)).toBe("A'b");
    }
  });
});
