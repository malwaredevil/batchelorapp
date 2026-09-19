import { describe, expect, it } from "vitest";
import { formatCommStatus } from "./comm-check-status";

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
});
