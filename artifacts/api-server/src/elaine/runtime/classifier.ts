import type { ElaineRequestClass } from "./contracts";

const ACTION_RE =
  /\b(add|book|cancel|change|connect|create|delete|disconnect|draft|edit|email|generate|mark|merge|move|notify|remove|rename|restore|save|send|set|share|sync|text|toggle|update|upload)\b/i;
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
  const action = ACTION_RE.test(message) && !EXPLANATION_RE.test(message);
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
