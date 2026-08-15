import type { ElaineRequestClass } from "./contracts";

const ACTION_RE =
  /\b(add|book|cancel|change|connect|create|delete|disconnect|draft|edit|email|generate|mark|merge|move|notify|remove|rename|restore|save|send|set|share|sync|text|toggle|update|upload)\b/i;
const EXPLICIT_MEMORY_ACTION_RE =
  /^(?:(?:can|could|will|would)\s+you\s+)?(?:please\s+)?(?:(?:correct|forget)\b|remember\b(?!\s+(?:how|what|when|where|whether|who|why)\b))/i;
const EXPLANATION_RE =
  /^(?:why|what|who|when|where|how)\b|\bhow\s+to\b|\b(?:explain|describe)\b/i;
const RESEARCH_RE =
  /\b(current|currently|forecast|latest|look\s*up|near\s+me|news|price|search|today|tomorrow|weather|who\s+is|web)\b/i;
const HOUSEHOLD_READ_RE =
  /\b(my|our)\s+(calendar|collection|document|email|fabric|inbox|itinerary|ornament|packing|pattern|pottery|quilt|reminder|reservation|settings?|trip|wishlist)\b|\b(find|show|check)\s+(my|our)\b/i;
const MULTI_STEP_RE =
  /\b(and then|after that|also|compare|first|next|plan|then)\b|[,;].*[,;]|\?.*\?/i;

export function classifyElaineRequest(input: {
  message: string;
  hasAttachment?: boolean;
}): ElaineRequestClass {
  const message = input.message.trim();
  const hasAttachment = input.hasAttachment ?? false;
  // Action verbs also occur in ordinary questions ("Why do leaves change
  // color?", "How do I delete a trip?"). Explanatory wording stays on the
  // answer path unless the user actually asks Elaine to perform the change.
  const action =
    (ACTION_RE.test(message) || EXPLICIT_MEMORY_ACTION_RE.test(message)) &&
    !EXPLANATION_RE.test(message);
  const research = RESEARCH_RE.test(message);
  const householdRead = HOUSEHOLD_READ_RE.test(message);

  let kind: ElaineRequestClass["kind"] = "answer";
  if (action && (research || householdRead || hasAttachment)) kind = "mixed";
  else if (action) kind = "action";
  else if (research) kind = "research";
  else if (householdRead || hasAttachment) kind = "read";

  const connectorCount = (message.match(/\b(and|then|also)\b/gi) ?? []).length;
  const complexity =
    MULTI_STEP_RE.test(message) ||
    connectorCount >= 2 ||
    (kind === "mixed" && message.length > 40)
      ? "multi_step"
      : "simple";

  return {
    kind,
    complexity,
    requiresFreshData: research,
    hasAttachment,
  };
}

export function requestNeedsStructuredPlan(
  requestClass: ElaineRequestClass,
): boolean {
  return (
    requestClass.kind !== "answer" || requestClass.complexity === "multi_step"
  );
}

// ---------------------------------------------------------------------------
// Scheduling-doubt detector
//
// Matches user messages that express doubt about whether a previously
// proposed action is actually scheduled/pending — e.g. "I don't see a card",
// "did that actually get scheduled?", "I confirmed it but nothing happened".
//
// When detected the server forces a list_scheduled_contacts tool call on the
// very first model round so Elaine answers from real DB results, not from
// memory or prompt compliance alone. This is mechanical enforcement layered
// on top of the existing prompt instruction in confirmationModeSection.
//
// Design notes:
//  - Kept deliberately conservative to avoid false positives on ordinary
//    questions ("is it pending review?" about a pottery piece, etc.).
//  - Focuses on three signal families:
//      1. Visibility: "don't/can't see", "nothing showed up"
//      2. Schedule confirmation: "did that get scheduled", "was it scheduled"
//      3. Post-confirm surprise: "confirmed/pressed confirm but nothing"
//  - The HOUSEHOLD_READ_RE in classifyElaineRequest already routes broad
//    "show my reminders" requests to the read path; this targets the narrower
//    doubt sub-case so the two don't compete.
// ---------------------------------------------------------------------------

export const SCHEDULING_DOUBT_RE =
  /\b(?:don'?t|didn'?t|doesn'?t|can'?t|couldn'?t)\s+see\b|did\s+(?:that|it)\s+(?:actually\s+)?(?:get\s+)?schedul|was\s+(?:that|it)\s+(?:actually\s+)?schedul|nothing\s+(?:happened|came\s+through|showed?\s+up|appear)|didn'?t\s+(?:go\s+through|work|happen)\b|(?:confirm(?:ed|ing)|pressed?\s+confirm)\s+(?:it\s+)?but\b|is\s+(?:it|that|anything)\s+(?:still\s+)?pending\b|what(?:'?s|\s+is)\s+(?:still\s+)?(?:pending|scheduled)\b|what\s+(?:have\s+you|did\s+you)\s+(?:have\s+)?scheduled\b/i;

/**
 * Returns true when the user's message expresses doubt about whether a
 * previously proposed contact/communication action was actually scheduled.
 * Used by the request handler to mechanically force a list_scheduled_contacts
 * tool call before the model is allowed to answer, rather than relying purely
 * on prompt compliance.
 */
export function isSchedulingDoubtMessage(message: string): boolean {
  return SCHEDULING_DOUBT_RE.test(message.trim());
}

// ---------------------------------------------------------------------------
// Reminder-doubt detector
//
// Matches user messages that express doubt about whether a plain reminder
// (created via create_reminder / the bell icon) was actually saved — e.g.
// "I set a reminder but I don't see it", "did that reminder actually save?".
//
// Distinct from SCHEDULING_DOUBT_RE (which targets communication/contact
// actions). Requires the word "reminder" to appear so it doesn't fire on
// ordinary "I don't see it" messages about unrelated UI elements.
//
// When detected the server forces a list_reminders tool call on the first
// model round so Elaine answers from real DB results. When BOTH detectors
// fire (ambiguous phrasing), both tools are forced in sequence.
// ---------------------------------------------------------------------------

export const REMINDER_DOUBT_RE =
  /\breminder\b.*\b(?:don'?t|didn'?t|doesn'?t|can'?t|couldn'?t)\s+see\b|\b(?:don'?t|didn'?t|doesn'?t|can'?t|couldn'?t)\s+see\b.*\breminder\b|\breminder\b.*\b(?:didn'?t|did\s+not)\s+(?:save|go\s+through|work|show\s+up|appear)\b|did\s+(?:that|it|the|my)\s+reminder\s+(?:actually\s+)?(?:save|go\s+through|work)\b|was\s+(?:that|it|the|my)\s+reminder\s+(?:actually\s+)?saved?\b/i;

/**
 * Returns true when the user's message expresses doubt about whether a plain
 * reminder was actually saved/scheduled. Used by the request handler to
 * mechanically force a list_reminders tool call so Elaine answers from real
 * DB state rather than prompt compliance alone.
 */
export function isReminderDoubtMessage(message: string): boolean {
  return REMINDER_DOUBT_RE.test(message.trim());
}

// ---------------------------------------------------------------------------
// Pattern keys and lesson builders for code-diagnosis integration (#915)
//
// Analogous to selfHealPatternKey / buildSelfHealLessonInput in
// self-heal-policy.ts. When the same doubt signal recurs enough times, the
// root cause is more likely a gap in the detector regex (SCHEDULING_DOUBT_RE
// / REMINDER_DOUBT_RE) or in the tool-forcing/reply logic than a one-off
// prompt issue — and a code-level look is warranted.
// ---------------------------------------------------------------------------

export type ClassifierDoubtKind = "scheduling" | "reminder";

/**
 * Stable identity for a classifier-doubt event's failure shape, used as the
 * `patternKey` for elaine_lessons.occurrenceCount tracking and as the lookup
 * key into CODE_DIAGNOSIS_FILE_ALLOWLIST — a recurring doubt signal here
 * likely means the detector regex or the grounding response after it fires
 * has a systematic gap, not just a one-off phrasing.
 */
export function classifierDoubtPatternKey(kind: ClassifierDoubtKind): string {
  return `classifier_doubt:${kind}`;
}

/**
 * Builds the outcome-memory ("lesson") entry for a caught classifier-doubt
 * event so the same signal shape becomes retrievable next time via
 * getRelevantElaineLessons. Caller is responsible for attaching `userId` and
 * `source: "self_heal"` when calling recordElaineLesson — "self_heal" is
 * reused here because classifier-doubt is a server-detected correction
 * (not a user-initiated explicit lesson), and that source value is what gates
 * recurrence tracking and code-diagnosis consideration.
 */
export function buildClassifierDoubtLessonInput(kind: ClassifierDoubtKind): {
  outcome: "mistake";
  domain: "general";
  situation: string;
  takeaway: string;
  tags: string[];
} {
  const isScheduling = kind === "scheduling";
  return {
    outcome: "mistake",
    domain: "general",
    situation: isScheduling
      ? 'The user\'s message expressed doubt about whether a contact or communication action was actually scheduled — e.g. "I confirmed it but nothing happened", "did that get scheduled?". This signals that a previous reply may not have given clear, grounded confirmation of scheduling status.'
      : 'The user\'s message expressed doubt about whether a plain reminder was actually saved — e.g. "I set a reminder but I don\'t see it", "did that reminder actually save?". This signals that a previous reply may not have given clear, grounded confirmation of reminder creation.',
    takeaway: isScheduling
      ? "After any scheduling action, explicitly confirm the outcome from real DB state (list_scheduled_contacts) rather than relying on the model's own recollection — recurring user doubt here indicates the previous turn's confirmation was insufficient or ungrounded."
      : "After any reminder creation, explicitly confirm the outcome from real DB state (list_reminders) rather than relying on the model's own recollection — recurring user doubt here indicates the previous turn's confirmation was insufficient or ungrounded.",
    tags: ["classifier-doubt", isScheduling ? "scheduling" : "reminder"],
  };
}
