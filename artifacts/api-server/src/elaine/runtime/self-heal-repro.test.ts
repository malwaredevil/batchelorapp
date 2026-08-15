import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isReminderDoubtMessage, isSchedulingDoubtMessage } from "./classifier";
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

/**
 * Regression coverage for Task 844's original repro: ask Elaine to schedule
 * something, then ask whether it actually happened — her answer must be
 * grounded in a real tool call every time, never asserted from memory.
 *
 * Two layers work together end to end (confirmed live against the running
 * app during this task, not just here):
 *   1. isSchedulingDoubtMessage / isReminderDoubtMessage (classifier.ts,
 *      pre-existing) force a real list_scheduled_contacts / list_reminders
 *      call whenever the *user's own message* expresses doubt.
 *   2. detectClaimedCheckWithoutToolCall (self-heal-policy.ts, added by this
 *      task) is the backstop for the case that mechanism doesn't cover:
 *      Elaine narrating a check/confirmation on her own, unprompted by user
 *      doubt, with zero real tool calls anywhere in the turn to back it up.
 */
describe("Task 844 repro: schedule → doubt → grounded answer", () => {
  it("classifies the exact repro follow-up ('did that happen?' family) as a doubt message that forces a real check", () => {
    expect(isSchedulingDoubtMessage("did that actually get scheduled?")).toBe(
      true,
    );
    expect(
      isReminderDoubtMessage(
        "Wait, did that reminder actually save? I don't see it anywhere.",
      ),
    ).toBe(true);
  });

  it("does NOT flag Elaine's reply when a real check tool call grounds the claim (the doubt-message path worked)", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent:
        'No — the "Water the plants" reminder was not saved. I checked your actual reminder list, and it isn\'t there.',
      observations: [
        observation(),
        observation({
          callId: "call-2",
          toolName: "list_reminders",
          evidenceSummary: "0 reminders found",
        }),
      ],
    });
    expect(mismatch).toBeNull();
  });

  it("flags the exact failure mode: Elaine claims she checked, but no tool ran this turn at all", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent:
        "I checked and your reminder is already scheduled for tomorrow.",
      observations: [observation()], // only the cosmetic page-context entry
    });
    expect(mismatch).not.toBeNull();

    const lesson = buildSelfHealLessonInput(mismatch!);
    expect(lesson.outcome).toBe("mistake");
    expect(lesson.tags).toContain("self-heal");
  });
});

describe("system prompt: never describe an unverified check or outcome", () => {
  // Guard test mirroring the existing "reminder-doubt backstop" pattern in
  // classifier.test.ts — ensures the general self-heal instruction added for
  // Task 844 can't be silently deleted by a future prompt edit.
  it("index.ts instructs Elaine never to claim a check/outcome she didn't perform, for any of her own prior actions", () => {
    const src = readFileSync(join(__dirname, "../index.ts"), "utf8");
    expect(src).toContain("never narrate a check you didn't perform");
    expect(src).toContain(
      "it covers every claim you make about your own prior actions or checks",
    );
  });

  it("index.ts wires the self-heal detector and writes a durable lesson on a caught mismatch", () => {
    const src = readFileSync(join(__dirname, "../index.ts"), "utf8");
    expect(src).toContain("detectClaimedCheckWithoutToolCall(");
    expect(src).toContain("buildSelfHealLessonInput(selfHealMismatch)");
    expect(src).toContain('source: "self_heal"');
  });
});
