import { describe, expect, it } from "vitest";
import { buildAutoRunActionFailureCorrection } from "./auto-run-failure";

describe("buildAutoRunActionFailureCorrection", () => {
  it("never includes an executor's unsafe internal error", () => {
    const correction = buildAutoRunActionFailureCorrection({
      droppedActionCount: 1,
      executorFailureCount: 1,
    });

    expect(correction).toBe(
      "I couldn't complete that action just now. Please try again in a moment.",
    );
    expect(correction).not.toContain("ECONNREFUSED");
    expect(correction).not.toContain("database");
  });

  it("uses plural wording when multiple actions fail", () => {
    expect(
      buildAutoRunActionFailureCorrection({
        droppedActionCount: 3,
        executorFailureCount: 2,
      }),
    ).toBe(
      "I couldn't complete some of those actions just now. Please try again in a moment.",
    );
  });

  it("preserves the truthful no-change wording for dropped payloads", () => {
    expect(
      buildAutoRunActionFailureCorrection({
        droppedActionCount: 1,
        executorFailureCount: 0,
      }),
    ).toContain("nothing was scheduled or changed");
  });
});
