import { describe, expect, it } from "vitest";
import {
  formatCommStatus,
  formatIndeterminateCommResult,
  isIndeterminateCommResult,
} from "./comm-check-status";

describe("formatCommStatus", () => {
  it("does not treat an indeterminate phone outcome as verified", () => {
    expect(formatCommStatus("indeterminate", true)).toBe(
      "Call acceptance unknown",
    );
    expect(formatCommStatus("indeterminate", true)).not.toBe("Verified");
  });

  it("preserves sent rendering for phone and reply-based channels", () => {
    expect(formatCommStatus("sent", true)).toBe("Verified");
    expect(formatCommStatus("sent")).toBe("Sent — awaiting reply");
  });

  it("recognizes the API's indeterminate result without treating it as an error", () => {
    expect(isIndeterminateCommResult("unknown: acceptance timed out")).toBe(
      true,
    );
    expect(isIndeterminateCommResult("error: call failed")).toBe(false);
    expect(formatIndeterminateCommResult("unknown: acceptance timed out")).toBe(
      "Phone call outcome unknown — acceptance timed out",
    );
  });
});
