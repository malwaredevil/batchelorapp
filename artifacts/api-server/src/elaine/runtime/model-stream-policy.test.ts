import { describe, expect, it } from "vitest";
import { decideElaineModelStreamRecovery } from "./model-stream-policy";

describe("decideElaineModelStreamRecovery", () => {
  it("retries synthesis with tools suppressed when evidence already exists", () => {
    expect(
      decideElaineModelStreamRecovery({
        canRetry: true,
        hasPartialContent: true,
        hasSuccessfulObservation: true,
      }),
    ).toMatchObject({
      retry: true,
      resetPartialContent: true,
      suppressTools: true,
    });
  });

  it("allows a normal retry when the failed stream produced no evidence", () => {
    expect(
      decideElaineModelStreamRecovery({
        canRetry: true,
        hasPartialContent: false,
        hasSuccessfulObservation: false,
      }),
    ).toMatchObject({
      retry: true,
      resetPartialContent: false,
      suppressTools: false,
    });
  });

  it("preserves terminal failure when no model round remains", () => {
    expect(
      decideElaineModelStreamRecovery({
        canRetry: false,
        hasPartialContent: true,
        hasSuccessfulObservation: true,
      }),
    ).toEqual({
      retry: false,
      resetPartialContent: false,
      suppressTools: false,
      instruction: null,
    });
  });
});
