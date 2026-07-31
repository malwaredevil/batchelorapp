import { describe, expect, it } from "vitest";
import {
  isReusableElaineResponseState,
  selectElaineOpenAIRole,
  stripElaineCitationMetadata,
} from "./responses-state";

describe("Elaine Responses state", () => {
  it("keeps every Elaine turn on Sol so retained state is continuous", () => {
    expect(
      selectElaineOpenAIRole({
        kind: "action",
        complexity: "simple",
        requiresFreshData: false,
        hasAttachment: false,
      }),
    ).toBe("reasoning");
    expect(
      selectElaineOpenAIRole({
        kind: "answer",
        complexity: "simple",
        requiresFreshData: false,
        hasAttachment: false,
      }),
    ).toBe("reasoning");
  });

  it("reuses only fresh state created by the expected model", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    expect(
      isReusableElaineResponseState({
        state: {
          responseId: "resp_123",
          model: "gpt-5.6-sol",
          updatedAt: "2026-07-29T12:00:00Z",
        },
        expectedModel: "gpt-5.6-sol",
        maxAgeDays: 29,
        now,
      }),
    ).toBe(true);
    expect(
      isReusableElaineResponseState({
        state: {
          responseId: "resp_123",
          model: "gpt-5.6-terra",
          updatedAt: "2026-07-29T12:00:00Z",
        },
        expectedModel: "gpt-5.6-sol",
        maxAgeDays: 29,
        now,
      }),
    ).toBe(false);
    expect(
      isReusableElaineResponseState({
        state: {
          responseId: "resp_123",
          model: "gpt-5.6-sol",
          updatedAt: "2026-06-01T12:00:00Z",
        },
        expectedModel: "gpt-5.6-sol",
        maxAgeDays: 29,
        now,
      }),
    ).toBe(false);
  });

  it("removes persisted citation transport metadata", () => {
    expect(
      stripElaineCitationMetadata(
        'The answer.\x1f["https://example.com/source"]',
      ),
    ).toBe("The answer.");
  });
});
