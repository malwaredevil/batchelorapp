import { describe, expect, it } from "vitest";
import {
  formatCommChannelFailure,
  formatCommStatus,
  formatCommRunNotice,
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

  it("preserves a single-channel application failure explanation", () => {
    expect(
      formatCommChannelFailure({
        result: "error: No email on owner account",
      }),
    ).toBe("error: No email on owner account");
    expect(
      formatCommChannelFailure({
        error: "Provider unavailable",
        result: "error: fallback detail",
      }),
    ).toBe("Provider unavailable");
    expect(formatCommChannelFailure({})).toBe("Failed");
  });

  it("keeps daily errors destructive when phone acceptance is indeterminate", () => {
    const notice = formatCommRunNotice({
      email: "error: SMTP unavailable",
      sms: "sent",
      slack: "sent",
      phone: "unknown: acceptance timed out",
    });
    expect(notice.kind).toBe("error");
    expect(notice.description).toContain("Email: error: SMTP unavailable");
    expect(notice.description).toContain("Phone call outcome unknown");
    expect(notice.description).not.toMatch(/^Sent —/);
  });

  it("uses a neutral notice when only phone acceptance is unknown", () => {
    const notice = formatCommRunNotice({
      email: "sent",
      sms: "sent",
      slack: "sent",
      phone: "unknown: acceptance timed out",
    });
    expect(notice.kind).toBe("neutral");
    expect(notice.title).toBe("Phone call outcome unknown");
    expect(notice.description).not.toMatch(/^Sent —/);
  });

  it("keeps all-success runs as success", () => {
    expect(
      formatCommRunNotice({
        email: "sent",
        sms: "sent",
        slack: "sent",
        phone: "sent",
      }).kind,
    ).toBe("success");
  });

  it("keeps definite phone and daily failures destructive", () => {
    const notice = formatCommRunNotice({
      email: "error: SMTP unavailable",
      sms: "sent",
      slack: "sent",
      phone: "sent",
    });
    expect(notice.kind).toBe("error");
    expect(notice.description).toContain("Email: error: SMTP unavailable");
  });
});
