import { describe, it, expect } from "vitest";
import {
  buildSelfHealLessonInput,
  detectClaimedCheckWithoutToolCall,
} from "./self-heal-policy";
import type { ElaineObservation } from "./contracts";

function observation(
  overrides: Partial<ElaineObservation> = {},
): ElaineObservation {
  return {
    callId: "call-1",
    stepId: null,
    toolName: "current_page_context",
    success: true,
    evidenceSummary: "",
    startedAt: "2026-08-14T00:00:00.000Z",
    completedAt: "2026-08-14T00:00:01.000Z",
    ...overrides,
  };
}

describe("detectClaimedCheckWithoutToolCall", () => {
  it("flags a claimed check when no real tool call happened this turn", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I checked and it's already scheduled for tomorrow at 6pm.",
      observations: [observation()], // only the cosmetic page-context entry
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_check_without_tool_call");
    expect(mismatch?.claimedPhrase.toLowerCase()).toContain("i checked");
  });

  it("does not flag when a real tool call grounds the claim", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I checked and it's already scheduled for tomorrow.",
      observations: [
        observation(),
        observation({
          callId: "call-2",
          toolName: "list_scheduled_contacts",
          evidenceSummary: "Found 1 scheduled contact",
        }),
      ],
    });
    expect(mismatch).toBeNull();
  });

  it("does not flag ordinary replies with no check-claim language", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "Sure, I can help with that — what would you like?",
      observations: [observation()],
    });
    expect(mismatch).toBeNull();
  });

  it("does not flag a reference to a check from an earlier turn", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I checked earlier and everything looked fine.",
      observations: [observation()],
    });
    expect(mismatch).toBeNull();
  });

  it("matches 'I confirmed' and 'I verified' phrasing too", () => {
    expect(
      detectClaimedCheckWithoutToolCall({
        finalContent: "I confirmed that the reminder went through.",
        observations: [observation()],
      }),
    ).not.toBeNull();
    expect(
      detectClaimedCheckWithoutToolCall({
        finalContent: "I verified it's all set.",
        observations: [observation()],
      }),
    ).not.toBeNull();
  });

  it("does not flag when zero observations exist at all but no claim is made", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "Happy to help — let me know the details.",
      observations: [],
    });
    expect(mismatch).toBeNull();
  });

  it("still flags a check-claim when only an unrelated read tool ran this turn", () => {
    // A real, successful tool call happened — but it has nothing to do with
    // what was claimed. Grounding must be subject-specific, not "any tool
    // call this turn counts".
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I checked your calendar and it's all clear tomorrow.",
      observations: [
        observation(),
        observation({
          callId: "call-2",
          toolName: "get_weather",
          evidenceSummary: "Sunny, 72F",
        }),
      ],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_check_without_tool_call");
  });

  it("does not flag when a topically-matching read tool grounds the claim", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I checked your calendar and it's all clear tomorrow.",
      observations: [
        observation({
          callId: "call-2",
          toolName: "list_calendar_events",
          evidenceSummary: "No events found for tomorrow",
        }),
      ],
    });
    expect(mismatch).toBeNull();
  });
});

describe("detectClaimedCheckWithoutToolCall — action-outcome claims", () => {
  it("flags 'I already saved that' with no tool call this turn", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already saved that reminder for you.",
      observations: [observation()],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_action_outcome_without_tool_call");
  });

  it("flags 'that's already scheduled' with no tool call this turn", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "That's already scheduled for tomorrow at 9am.",
      observations: [observation()],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_action_outcome_without_tool_call");
  });

  it("does not flag an action-outcome claim grounded by a real tool call", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already saved that reminder for you.",
      observations: [
        observation(),
        observation({ callId: "call-2", toolName: "create_reminder" }),
      ],
    });
    expect(mismatch).toBeNull();
  });

  it("does not flag a reference to an action outcome from an earlier turn", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already sent that message yesterday.",
      observations: [observation()],
    });
    expect(mismatch).toBeNull();
  });

  it("still flags an action-outcome claim when only an unrelated read tool ran", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already saved that reminder for you.",
      observations: [
        observation(),
        observation({
          callId: "call-2",
          toolName: "get_weather",
          evidenceSummary: "Sunny, 72F",
        }),
      ],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_action_outcome_without_tool_call");
  });

  it("still flags 'already saved' when the only action observation is a pending confirmation card, not an executed action", () => {
    // This is the original repro: create_reminder proposes a confirmation
    // card (success: true, waitingConfirmation: true) but the user hasn't
    // confirmed it yet, so nothing has actually been saved.
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already saved that reminder for you.",
      observations: [
        observation({
          callId: "call-2",
          toolName: "create_reminder",
          evidenceSummary: "Prepared reminder for confirmation",
          waitingConfirmation: true,
        }),
      ],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_action_outcome_without_tool_call");
  });

  it("does not flag 'already saved' once the same action tool call actually executed (no pending confirmation)", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already saved that reminder for you.",
      observations: [
        observation({
          callId: "call-2",
          toolName: "create_reminder",
          evidenceSummary: "Action executed successfully",
        }),
      ],
    });
    expect(mismatch).toBeNull();
  });

  it("catches an ungrounded outcome claim even when a grounded check claim appears earlier in the same reply", () => {
    // A grounded "I checked" earlier in the text must not shadow an
    // ungrounded "I already saved" claim that comes after it.
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent:
        "I checked your calendar and it's clear. I already saved that reminder for you.",
      observations: [
        observation({
          callId: "call-2",
          toolName: "list_calendar_events",
          evidenceSummary: "No events found",
        }),
      ],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_action_outcome_without_tool_call");
    expect(mismatch?.claimedPhrase.toLowerCase()).toContain("already saved");
  });

  it("still flags an action-outcome claim when a real action tool ran for a different action", () => {
    // create_trip is a real ACTION_TOOL_NAMES entry (right category), but it
    // has nothing to do with the reminder being claimed — category alone
    // must not be enough to ground the claim.
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: "I already saved that reminder for you.",
      observations: [
        observation({
          callId: "call-2",
          toolName: "create_trip",
          evidenceSummary: "Created trip to Denver",
        }),
      ],
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch?.kind).toBe("claimed_action_outcome_without_tool_call");
  });
});

describe("buildSelfHealLessonInput", () => {
  it("returns a mistake-outcome lesson with self-heal tags", () => {
    const lesson = buildSelfHealLessonInput({
      kind: "claimed_check_without_tool_call",
      claimedPhrase: "I checked",
    });
    expect(lesson.outcome).toBe("mistake");
    expect(lesson.domain).toBe("general");
    expect(lesson.tags).toContain("self-heal");
    expect(lesson.situation.length).toBeGreaterThan(0);
    expect(lesson.takeaway.length).toBeGreaterThan(0);
  });
});
