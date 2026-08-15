import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClassifierDoubtLessonInput,
  classifierDoubtPatternKey,
  classifyElaineRequest,
  isReminderDoubtMessage,
  isSchedulingDoubtMessage,
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

  it.each([
    "Please remember that I prefer invented jasmine tea.",
    "Correct memory 901 to an invented preference.",
    "Forget the invented test memory.",
  ])("classifies an explicit memory command as an action: %s", (message) => {
    expect(classifyElaineRequest({ message })).toMatchObject({
      kind: "action",
      requiresFreshData: false,
    });
  });

  it.each([
    "What do you remember about my invented preference?",
    "How do I correct a memory?",
    "Remember when we discussed an invented trip?",
  ])(
    "keeps an explanatory memory question on the answer path: %s",
    (message) => {
      expect(classifyElaineRequest({ message })).toMatchObject({
        kind: "answer",
        requiresFreshData: false,
      });
    },
  );
});

describe("isSchedulingDoubtMessage", () => {
  it.each([
    // Visibility family
    "I don't see a card",
    "I don't see anything to confirm",
    "I can't see the confirmation",
    "I didn't see it come up",
    "nothing showed up",
    "nothing happened",
    "nothing came through",
    "nothing appeared",
    // Schedule confirmation family
    "did that actually get scheduled?",
    "did that get scheduled?",
    "did it actually get scheduled",
    "was that scheduled?",
    "was it actually scheduled?",
    // Post-confirm surprise family
    "I confirmed it but nothing happened",
    "I confirmed it but I still don't see anything",
    "confirmed it but nothing came through",
    "I pressed confirm but nothing showed up",
    // Pending state family
    "is it still pending?",
    "is that still pending?",
    "is anything pending?",
    "what's pending?",
    "what is pending?",
    "what's still pending?",
    "what have you scheduled?",
    "what did you have scheduled?",
    // Failure family
    "it didn't go through",
    "it didn't work",
    "it didn't happen",
  ])("detects a scheduling-doubt message: %s", (message) => {
    expect(isSchedulingDoubtMessage(message)).toBe(true);
  });

  it.each([
    // Ordinary collection/read questions that should NOT trigger the detector
    "Show my reminders",
    "What reminders do I have?",
    "Check my upcoming trips",
    "Is my booking pending review?",
    "What trips are pending?",
    // General questions
    "How do I schedule a message?",
    "Can you schedule a message to Mom?",
    "Send a message to Dad",
    "What's the weather like?",
  ])("does not flag an ordinary message as a doubt: %s", (message) => {
    expect(isSchedulingDoubtMessage(message)).toBe(false);
  });
});

describe("isReminderDoubtMessage", () => {
  it.each([
    // reminder + don't/can't/didn't see (either order)
    "I set a reminder but I don't see it",
    "I don't see my reminder",
    "I can't see the reminder I set",
    "I didn't see the reminder",
    // reminder + didn't save / go through / work / show up
    "did that reminder actually save?",
    "did my reminder save?",
    "I set a reminder and it didn't save",
    "the reminder didn't save",
    "the reminder didn't go through",
    "that reminder didn't work",
    "the reminder didn't show up",
    // was the reminder saved
    "was the reminder saved?",
    "was that reminder actually saved?",
    "was my reminder saved",
  ])("detects a reminder-doubt message: %s", (message) => {
    expect(isReminderDoubtMessage(message)).toBe(true);
  });

  it.each([
    // Plain read requests — not expressing doubt
    "Show my reminders",
    "What reminders do I have?",
    "List my upcoming reminders",
    // Scheduling-doubt messages that don't mention reminders
    "did that actually get scheduled?",
    "nothing happened",
    "I confirmed it but nothing came through",
    // Unrelated
    "What's the weather like?",
    "Is my booking pending review?",
  ])("does not flag an ordinary message as reminder-doubt: %s", (message) => {
    expect(isReminderDoubtMessage(message)).toBe(false);
  });
});

describe("classifierDoubtPatternKey", () => {
  it("returns the expected key for scheduling", () => {
    expect(classifierDoubtPatternKey("scheduling")).toBe(
      "classifier_doubt:scheduling",
    );
  });

  it("returns the expected key for reminder", () => {
    expect(classifierDoubtPatternKey("reminder")).toBe(
      "classifier_doubt:reminder",
    );
  });
});

describe("buildClassifierDoubtLessonInput", () => {
  it("returns a mistake-outcome lesson for scheduling kind", () => {
    const lesson = buildClassifierDoubtLessonInput("scheduling");
    expect(lesson.outcome).toBe("mistake");
    expect(lesson.domain).toBe("general");
    expect(lesson.situation.length).toBeGreaterThan(0);
    expect(lesson.takeaway.length).toBeGreaterThan(0);
    expect(lesson.tags).toContain("classifier-doubt");
    expect(lesson.tags).toContain("scheduling");
    expect(lesson.tags).not.toContain("reminder");
  });

  it("returns a mistake-outcome lesson for reminder kind", () => {
    const lesson = buildClassifierDoubtLessonInput("reminder");
    expect(lesson.outcome).toBe("mistake");
    expect(lesson.domain).toBe("general");
    expect(lesson.situation.length).toBeGreaterThan(0);
    expect(lesson.takeaway.length).toBeGreaterThan(0);
    expect(lesson.tags).toContain("classifier-doubt");
    expect(lesson.tags).toContain("reminder");
    expect(lesson.tags).not.toContain("scheduling");
  });

  it("scheduling situation mentions contact/communication scheduling doubt", () => {
    const lesson = buildClassifierDoubtLessonInput("scheduling");
    // Must reference the scheduling-doubt domain (contact/communication action)
    expect(lesson.situation.toLowerCase()).toMatch(/schedul/);
  });

  it("reminder situation mentions reminder-save doubt", () => {
    const lesson = buildClassifierDoubtLessonInput("reminder");
    // Must reference the reminder-doubt domain
    expect(lesson.situation.toLowerCase()).toMatch(/reminder/);
  });

  it("scheduling takeaway references list_scheduled_contacts grounding", () => {
    const lesson = buildClassifierDoubtLessonInput("scheduling");
    expect(lesson.takeaway).toContain("list_scheduled_contacts");
  });

  it("reminder takeaway references list_reminders grounding", () => {
    const lesson = buildClassifierDoubtLessonInput("reminder");
    expect(lesson.takeaway).toContain("list_reminders");
  });
});

describe("dual-match: message triggers both doubt detectors simultaneously", () => {
  // The handler comment explicitly states: "When the phrasing is ambiguous
  // (both detectors fire), both tools are forced in sequence."  These tests
  // verify that the pure detector functions can co-fire so that the handler's
  // dual-push logic is actually exercisable.  A future change that made one
  // regex subsume the other (preventing co-firing) would be caught here.

  const DUAL_MATCH_CASES: string[] = [
    // Mentions "reminder" + scheduling doubt ("didn't get scheduled") +
    // visibility doubt ("I don't see it") — all three signal families at once.
    "I set a reminder to call Mom but it didn't get scheduled — I don't see it",
    // Reminder + visible-doubt phrasing in either detector
    "I created a reminder but I don't see anything scheduled",
    // "reminder didn't go through" fires REMINDER_DOUBT_RE;
    // "nothing came through" fires SCHEDULING_DOUBT_RE
    "the reminder didn't go through and nothing came through on the scheduled side either",
  ];

  it.each(DUAL_MATCH_CASES)(
    "isSchedulingDoubtMessage fires for dual-match message: %s",
    (message) => {
      expect(isSchedulingDoubtMessage(message)).toBe(true);
    },
  );

  it.each(DUAL_MATCH_CASES)(
    "isReminderDoubtMessage fires for dual-match message: %s",
    (message) => {
      expect(isReminderDoubtMessage(message)).toBe(true);
    },
  );

  it("both detectors fire for the canonical ambiguous message", () => {
    const message =
      "I set a reminder to call Mom but it didn't get scheduled — I don't see it";
    expect(isSchedulingDoubtMessage(message)).toBe(true);
    expect(isReminderDoubtMessage(message)).toBe(true);
  });
});

describe("system prompt reminder-doubt backstop", () => {
  // Guard: the confirmationModeSection in index.ts must explicitly instruct
  // Elaine to call list_reminders when the user doubts a saved reminder —
  // symmetric with the existing scheduling-doubt instruction for
  // list_scheduled_contacts. This test ensures that instruction is never
  // silently deleted by a future edit.
  it("index.ts confirmationModeSection references list_reminders for reminder-doubt", () => {
    const src = readFileSync(join(__dirname, "../index.ts"), "utf8");
    // The instruction must tell Elaine to call list_reminders first
    expect(src).toContain("list_reminders");
    // Specifically in the context of the user not finding a reminder
    expect(src).toContain("doubts whether it was actually saved");
    // And must direct her to answer from real results, not memory
    expect(src).toContain("answer from its real results");
  });
});
