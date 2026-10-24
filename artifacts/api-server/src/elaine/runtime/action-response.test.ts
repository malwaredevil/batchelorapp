import { describe, expect, it } from "vitest";
import {
  completedActionAcknowledgement,
  executedCommunicationAcknowledgement,
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

describe("executedCommunicationAcknowledgement", () => {
  it("explains a known call preflight failure without claiming success or leaking raw errors", () => {
    const acknowledgement = executedCommunicationAcknowledgement(
      [
        {
          type: "call_me",
          status: 422,
          result: {
            code: "voicemail_script_unsupported",
            attempted: false,
            error: "SECRET",
          },
        },
      ],
      "Europe/Berlin",
    );
    expect(acknowledgement).toContain("No call was placed or scheduled");
    expect(acknowledgement).toContain("voicemail");
    expect(acknowledgement).not.toContain("SECRET");
  });
  const action = (type = "call_me", result: Record<string, unknown> = {}) => ({
    type,
    status: 200,
    result: {
      type,
      result: {
        scheduled: true,
        scheduledActionId: 38,
        scheduledFor: "2026-10-23T13:30:00.000Z",
        ...result,
      },
    },
  });

  it("confirms a saved call with its date, local time and timezone", () => {
    const text = executedCommunicationAcknowledgement(
      [action()],
      "Europe/Berlin",
    );
    expect(text).toContain("Confirmed: your call is scheduled");
    expect(text).toContain("October 23, 2026");
    expect(text).toContain("3:30 PM");
    expect(text).toContain("Europe/Berlin");
    expect(text).not.toContain("I'll");
  });
  it("confirms saved messages with the requested timezone override", () => {
    const text = executedCommunicationAcknowledgement(
      [
        action("message_contact", {
          scheduledActionId: undefined,
          scheduledActionIds: [38, 39],
          timezone: "Asia/Tokyo",
        }),
      ],
      "Europe/Berlin",
    );
    expect(text).toContain("message is scheduled");
    expect(text).toContain("10:30 PM");
    expect(text).toContain("Asia/Tokyo");
  });
  it.each([
    { scheduledActionId: undefined },
    { scheduledActionId: 0 },
    { scheduledActionIds: [] },
    { scheduledFor: "not-a-date" },
  ])("does not invent saved scheduling evidence: %j", (result) => {
    expect(
      executedCommunicationAcknowledgement(
        [action("call_me", result)],
        "Europe/Berlin",
      ),
    ).toContain("couldn't confirm the saved schedule details");
  });
  it("does not call a failed execution successful", () => {
    expect(
      executedCommunicationAcknowledgement(
        [{ ...action(), status: 503 }],
        "Europe/Berlin",
      ),
    ).toBeNull();
  });
  it("distinguishes an accepted immediate message from delivery", () => {
    const text = executedCommunicationAcknowledgement(
      [
        action("message_contact", {
          scheduled: false,
          receiptStatus: "accepted",
        }),
      ],
      "Europe/Berlin",
    );
    expect(text).toContain("provider accepted");
    expect(text).toContain("Delivery is not yet confirmed");
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
