import { describe, expect, it } from "vitest";
import {
  completedActionAcknowledgement,
  preparedActionAcknowledgement,
} from "./action-response";

describe("preparedActionAcknowledgement", () => {
  it("returns no text when no confirmation action is ready", () => {
    expect(preparedActionAcknowledgement([])).toBeNull();
  });

  it("describes background research as prepared rather than already running", () => {
    const acknowledgement = preparedActionAcknowledgement([
      { type: "queue_research_task" },
    ]);

    expect(acknowledgement).toContain("prepared");
    expect(acknowledgement).toContain("confirm");
    expect(acknowledgement).not.toMatch(/\b(?:running|completed)\b/i);
  });

  it("provides a generic confirmation acknowledgement for other actions", () => {
    expect(
      preparedActionAcknowledgement([{ type: "update_trip_details" }]),
    ).toBe(
      "I prepared the requested action. Review and confirm it to continue.",
    );
  });
});

describe("completedActionAcknowledgement", () => {
  it("acknowledges an immediate memory write without asking for confirmation", () => {
    expect(
      completedActionAcknowledgement([{ type: "remember_household_fact" }]),
    ).toBe("I saved the requested memory.");
  });

  it("does not invent a completion when no action succeeded", () => {
    expect(completedActionAcknowledgement([])).toBeNull();
  });
});
