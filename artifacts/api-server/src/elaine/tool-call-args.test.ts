import { describe, expect, it } from "vitest";
import {
  extractFirstBalancedJsonValue,
  parseToolCallArgs,
} from "./tool-call-args";

describe("extractFirstBalancedJsonValue", () => {
  it("returns the whole buffer when it is a single balanced object", () => {
    expect(extractFirstBalancedJsonValue('{"a":1}')).toBe('{"a":1}');
  });

  it("returns the first object from duplicated concatenated args", () => {
    expect(extractFirstBalancedJsonValue('{"a":1}{"a":1}')).toBe('{"a":1}');
  });

  it("ignores braces inside string literals", () => {
    const buf = '{"greeting":"hi } there \\" {","n":2}extra';
    expect(extractFirstBalancedJsonValue(buf)).toBe(
      '{"greeting":"hi } there \\" {","n":2}',
    );
  });

  it("handles nested objects and arrays", () => {
    const buf = '{"scheduleAt":{"kind":"relative","units":[{"m":5}]}}junk';
    expect(extractFirstBalancedJsonValue(buf)).toBe(
      '{"scheduleAt":{"kind":"relative","units":[{"m":5}]}}',
    );
  });

  it("returns null for an incomplete buffer", () => {
    expect(extractFirstBalancedJsonValue('{"a":1')).toBeNull();
  });

  it("returns null when no JSON value starts", () => {
    expect(extractFirstBalancedJsonValue("not json")).toBeNull();
  });
});

describe("parseToolCallArgs", () => {
  it("parses valid JSON without salvage", () => {
    expect(parseToolCallArgs('{"a":1}')).toEqual({
      ok: true,
      value: { a: 1 },
      salvaged: false,
    });
  });

  it("salvages duplicated concatenated objects", () => {
    expect(parseToolCallArgs('{"a":1}{"a":1}')).toEqual({
      ok: true,
      value: { a: 1 },
      salvaged: true,
    });
  });

  it("salvages trailing junk after a valid object", () => {
    expect(parseToolCallArgs('{"a":1}\nDone.')).toEqual({
      ok: true,
      value: { a: 1 },
      salvaged: true,
    });
  });

  it("fails with the original parse error for unrecoverable buffers", () => {
    const result = parseToolCallArgs('{"a":');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it("fails for an empty buffer", () => {
    expect(parseToolCallArgs("").ok).toBe(false);
  });
});
