import { describe, expect, it } from "vitest";
import {
  classifyElaineRequest,
  requestNeedsStructuredPlan,
} from "./classifier";

describe("classifyElaineRequest", () => {
  it("keeps a stable explanatory question on the fast answer path", () => {
    const result = classifyElaineRequest({
      message: "Why do quilt seams need an allowance?",
    });
    expect(result).toEqual({
      kind: "answer",
      complexity: "simple",
      requiresFreshData: false,
      hasAttachment: false,
    });
    expect(requestNeedsStructuredPlan(result)).toBe(false);
  });

  it("classifies current weather as research that needs a plan", () => {
    const result = classifyElaineRequest({
      message: "What is the weather for our Sicily trip?",
    });
    expect(result.kind).toBe("research");
    expect(result.requiresFreshData).toBe(true);
    expect(requestNeedsStructuredPlan(result)).toBe(true);
  });

  it("classifies a household mutation with a lookup as mixed", () => {
    const result = classifyElaineRequest({
      message: "Find my blue bowl and update its condition to chipped",
    });
    expect(result.kind).toBe("mixed");
    expect(requestNeedsStructuredPlan(result)).toBe(true);
  });

  it("plans attachment-only turns", () => {
    const result = classifyElaineRequest({
      message: "",
      hasAttachment: true,
    });
    expect(result.kind).toBe("read");
    expect(result.hasAttachment).toBe(true);
  });
});
