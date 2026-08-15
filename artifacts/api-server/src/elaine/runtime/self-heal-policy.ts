import { ACTION_TOOL_NAMES } from "../planner-tool-catalog";
import type { ElaineObservation } from "./contracts";

/**
 * Self-heal detection for the "confidently asserted an outcome she never
 * verified" failure mode — e.g. claiming "I checked and it's scheduled", or
 * "I already saved that", without any real tool call this turn to back it
 * up. Distinct from the doubt detectors in classifier.ts (which react to the
 * *user* expressing doubt in their message) and from `droppedActionAttempts`
 * in index.ts (which reacts to an action tool call that was actually
 * attempted but vetoed or failed to parse/validate). This module reacts to
 * Elaine's own reply text describing a check, confirmation, or completed
 * action that has no corresponding tool observation at all — i.e. no tool
 * call was even attempted.
 *
 * Deliberately conservative, matching the style of SCHEDULING_DOUBT_RE /
 * REMINDER_DOUBT_RE: only fires on explicit past-tense self-report phrasing,
 * and only when the whole turn recorded zero real tool observations. A
 * reference to something from an earlier turn ("I checked earlier and...",
 * "I already sent that yesterday") is excluded since this turn's trace can't
 * see across turns.
 *
 * Two phrase families are covered, matching the task's two required cases:
 *   - CLAIMED_CHECK_RE: factual claims about a check/verification she
 *     performed ("I checked", "I confirmed", "I verified").
 *   - CLAIMED_ACTION_OUTCOME_RE: claims that an action already completed
 *     ("I already saved that", "I've sent the message", "that's scheduled").
 */
// Checked against a trailing window after a match (not just the next word)
// so "I already sent that message yesterday" is correctly excluded — the
// prior-turn marker can trail several words after the claim verb.
const NOT_ACTUALLY_RECENT_RE =
  /^[^.!?\n]{0,40}\b(?:earlier|before|previously|last\s+time|yesterday)\b/i;
const TRAILING_WINDOW_CHARS = 40;

const CLAIMED_CHECK_RE =
  /\bi(?:'ve| have)?\s+(?:just\s+|already\s+)?(?:checked|confirmed|verified|double[- ]checked)\b/gi;

// Requires an explicit "already" in every branch — without it, "that's
// scheduled" or "it's saved" reads as a plain present-tense description
// (e.g. of a proposal), not a claim that the action already completed.
const CLAIMED_ACTION_OUTCOME_RE =
  /\bi(?:'ve| have)?\s+already\s+(?:saved|sent|scheduled|booked|created|added|updated|deleted|cancelled|canceled)\b|\b(?:that|it|this)(?:'s|\s+is)\s+already\s+(?:been\s+)?(?:saved|sent|scheduled|booked|created|added|updated|deleted|cancelled|canceled)\b/gi;

/** True when text right after a claim match references a prior turn. */
function isReferenceToEarlierTurn(trailingText: string): boolean {
  return NOT_ACTUALLY_RECENT_RE.test(
    trailingText.slice(0, TRAILING_WINDOW_CHARS),
  );
}

// Read/verification-style tools follow this naming convention throughout the
// codebase (list_reminders, get_weather, check_integrations_health,
// find_emails_about_topic, search_household, fetch_page, ...). A claimed
// "I checked/confirmed/verified" self-report can only be grounded by one of
// these — an unrelated read tool (e.g. get_weather) still counts as "a real
// check happened", matching this detector's conservative, category-level
// (not entity-level) grounding; deeper per-entity verification is out of
// scope, see .local/tasks/task-844.md.
const READ_TOOL_NAME_RE = /^(?:list|get|check|find|search|fetch)_/;

/**
 * Returns true when `toolName` is evidence that could ground a claimed
 * check/confirmation ("I checked...") — i.e. it is a read-style tool.
 * `current_page_context` is recorded automatically on every single turn
 * regardless of what the model does (see index.ts), so it never counts as
 * evidence of an actual check happening this turn.
 */
function isCheckGroundingTool(toolName: string): boolean {
  return (
    toolName !== "current_page_context" && READ_TOOL_NAME_RE.test(toolName)
  );
}

/**
 * Returns true when an observation is evidence that could ground a claimed
 * action outcome ("I already saved that...", "it's already scheduled...").
 * Two independent ways to ground it, matching the two ways it could
 * genuinely be true:
 *   - A real, actually-executed mutating action tool (ACTION_TOOL_NAMES)
 *     performed it this turn. `waitingConfirmation: true` means the action
 *     was only *proposed* as a confirmation card, not actually performed —
 *     a card the user hasn't confirmed yet does NOT ground "I already
 *     saved/sent/scheduled that", which is exactly the false-positive this
 *     task's regression covers.
 *   - A read/check tool confirmed the current state directly (e.g. "I
 *     checked and it's already scheduled" backed by list_scheduled_contacts
 *     actually finding it). Subject-specific keyword overlap (checked by
 *     the caller, scoped to the same sentence) still applies, so this can't
 *     be satisfied by an unrelated check elsewhere in the reply.
 */
function isActionOutcomeGroundingTool(observation: ElaineObservation): boolean {
  if (ACTION_TOOL_NAMES.has(observation.toolName)) {
    return !observation.waitingConfirmation;
  }
  return isCheckGroundingTool(observation.toolName);
}

// Words that are part of the claim's own grammatical frame (pronouns,
// auxiliaries, the claim verbs themselves) rather than the entity being
// claimed about — stripped before keyword-matching a claim against a tool
// name/evidence summary so the claim verb text itself never counts as
// "overlap". Domain-ish words that also happen to be action verbs (saved,
// sent, scheduled, booked, ...) are deliberately NOT stripped: they double
// as legitimate signal (e.g. "scheduled" genuinely correlates with
// list_scheduled_contacts / cancel_scheduled_contact).
const CLAIM_FRAME_STOPWORDS = new Set([
  "i",
  "ive",
  "have",
  "just",
  "already",
  "checked",
  "confirmed",
  "verified",
  "double",
  "that",
  "this",
  "it",
  "its",
  "is",
  "was",
  "been",
  "for",
  "your",
  "you",
  "and",
  "the",
  "to",
  "all",
  "set",
  "going",
]);
const KEYWORD_CONTEXT_CHARS = 60;
// Sentence-ending punctuation bounds how far a claim's "local context" can
// reach — a reply is often several independent claims/sentences back to
// back (e.g. "I checked your calendar. I already saved that reminder."),
// and a keyword from one sentence must never leak into another sentence's
// grounding check, or a grounded claim can wrongly shadow an unrelated,
// ungrounded claim elsewhere in the same reply.
const SENTENCE_BOUNDARY_RE = /[.!?\n]/;

/**
 * Extracts a claim's local context text, bounded by both a max character
 * window and the nearest sentence boundary in either direction — so a
 * keyword from a different sentence never counts as "local" to this claim.
 */
function claimLocalContext(fullText: string, match: RegExpExecArray): string {
  const matchStart = match.index;
  const matchEnd = match.index + match[0].length;

  const beforeWindowStart = Math.max(0, matchStart - KEYWORD_CONTEXT_CHARS);
  const before = fullText.slice(beforeWindowStart, matchStart);
  const lastBoundaryInBefore = [...before].reduce(
    (lastIndex, char, i) => (SENTENCE_BOUNDARY_RE.test(char) ? i : lastIndex),
    -1,
  );
  const contextStart =
    lastBoundaryInBefore === -1
      ? beforeWindowStart
      : beforeWindowStart + lastBoundaryInBefore + 1;

  const afterWindowEnd = Math.min(
    fullText.length,
    matchEnd + KEYWORD_CONTEXT_CHARS,
  );
  const after = fullText.slice(matchEnd, afterWindowEnd);
  const boundaryInAfter = after.search(SENTENCE_BOUNDARY_RE);
  const contextEnd =
    boundaryInAfter === -1 ? afterWindowEnd : matchEnd + boundaryInAfter;

  return fullText.slice(contextStart, contextEnd);
}

/**
 * Extracts lowercase, non-stopword "entity" words from the text immediately
 * around a claim match (e.g. "calendar" from "I checked your calendar", or
 * "reminder" from "I already saved that reminder"). Used to require that a
 * grounding tool observation is actually *about* what was claimed, not just
 * any tool call of the right broad category — an irrelevant read tool (e.g.
 * get_weather) must not ground "I checked your calendar".
 */
function extractClaimKeywords(context: string): string[] {
  return context
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !CLAIM_FRAME_STOPWORDS.has(word));
}

/**
 * True when a grounding-category observation's tool name or evidence
 * summary shares an entity keyword with the claim's local context. If the
 * claim mentions no extractable entity keyword at all, no observation can
 * ground it (fails closed — a vague self-report with no concrete subject is
 * never treated as verified by an incidental tool call).
 */
function hasKeywordOverlap(
  keywords: readonly string[],
  observation: ElaineObservation,
): boolean {
  if (keywords.length === 0) return false;
  const haystack =
    `${observation.toolName.replace(/_/g, " ")} ${observation.evidenceSummary}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

export interface ElaineSelfHealMismatch {
  kind:
    | "claimed_check_without_tool_call"
    | "claimed_action_outcome_without_tool_call";
  claimedPhrase: string;
}

/**
 * Stable identity for a self-heal mismatch's failure *shape*, independent of
 * the specific phrase/turn that triggered it this time. Used as the
 * `patternKey` for elaine_lessons.occurrenceCount tracking and, once that
 * recurs enough, as the lookup key into
 * lib/elaine-code-diagnosis.ts's CODE_DIAGNOSIS_FILE_ALLOWLIST (#895) — a
 * recurring behavioral correction here likely means the detector/prompt
 * gap lives in this module, not just a one-off phrasing.
 */
export function selfHealPatternKey(
  kind: ElaineSelfHealMismatch["kind"],
): string {
  return `self_heal:${kind}`;
}

/**
 * Returns a mismatch descriptor when `finalContent` claims a check,
 * confirmation, or completed action outcome, but the turn's observation
 * trace has no real (non-cosmetic) tool call to back that claim up. Returns
 * null when the claim is grounded (or when no such claim was made at all).
 */
interface ClaimCandidate {
  match: RegExpExecArray;
  kind: ElaineSelfHealMismatch["kind"];
}

/** Collects every match of a global regex without mutating the caller's copy. */
function findAllMatches(re: RegExp, text: string): RegExpExecArray[] {
  const scoped = new RegExp(re.source, re.flags);
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = scoped.exec(text)) !== null) {
    matches.push(m);
    // Guard against zero-width matches looping forever (not expected given
    // these patterns, but cheap insurance).
    if (m[0].length === 0) scoped.lastIndex += 1;
  }
  return matches;
}

/**
 * Returns a mismatch descriptor when `finalContent` claims a check,
 * confirmation, or completed action outcome, but the turn's observation
 * trace has no real (non-cosmetic) tool call to back that claim up. Returns
 * null when the claim is grounded (or when no such claim was made at all).
 *
 * A reply can contain multiple claims (e.g. a grounded "I checked your
 * calendar" followed by an ungrounded "I already saved that reminder") —
 * every claim in the reply is checked, in the order it appears, and the
 * first ungrounded one is reported; a grounded claim earlier in the text
 * must not shadow an ungrounded claim later in the same reply.
 */
export function detectClaimedCheckWithoutToolCall(input: {
  finalContent: string;
  observations: readonly ElaineObservation[];
}): ElaineSelfHealMismatch | null {
  const candidates: ClaimCandidate[] = [
    ...findAllMatches(CLAIMED_CHECK_RE, input.finalContent).map((match) => ({
      match,
      kind: "claimed_check_without_tool_call" as const,
    })),
    ...findAllMatches(CLAIMED_ACTION_OUTCOME_RE, input.finalContent).map(
      (match) => ({
        match,
        kind: "claimed_action_outcome_without_tool_call" as const,
      }),
    ),
  ].sort((a, b) => a.match.index - b.match.index);

  for (const { match, kind } of candidates) {
    const trailingText = input.finalContent.slice(
      match.index + match[0].length,
    );
    if (isReferenceToEarlierTurn(trailingText)) continue;

    // Grounding must match both the claim's category (a check-claim needs a
    // read tool; an action-outcome claim needs a mutating, actually-executed
    // action tool — not a pending confirmation card) AND its subject (a
    // keyword shared between the claim's local context and the tool's
    // name/evidence) — an unrelated tool call of the right category (e.g.
    // get_weather grounding "I already saved that", or any read tool
    // grounding "I checked your calendar") must NOT suppress the correction.
    const localContext = claimLocalContext(input.finalContent, match);
    const claimKeywords = extractClaimKeywords(localContext);
    const isGrounded = input.observations.some((observation) => {
      if (
        !observation.success ||
        !hasKeywordOverlap(claimKeywords, observation)
      ) {
        return false;
      }
      return kind === "claimed_check_without_tool_call"
        ? isCheckGroundingTool(observation.toolName)
        : isActionOutcomeGroundingTool(observation);
    });
    if (isGrounded) continue;

    return { kind, claimedPhrase: match[0].trim() };
  }

  return null;
}

/**
 * Builds the outcome-memory ("lesson") entry for a caught self-heal
 * mismatch, so the same mistake shape becomes retrievable next time via
 * getRelevantElaineLessons. Caller is responsible for attaching `userId`
 * and `source: "self_heal"` when calling recordElaineLesson.
 */
export function buildSelfHealLessonInput(mismatch: ElaineSelfHealMismatch): {
  outcome: "mistake";
  domain: "general";
  situation: string;
  takeaway: string;
  tags: string[];
} {
  const isActionOutcome =
    mismatch.kind === "claimed_action_outcome_without_tool_call";
  return {
    outcome: "mistake",
    domain: "general",
    situation: isActionOutcome
      ? 'Started to tell the user an action was already done (e.g. "I already saved that", "that\'s scheduled") without actually calling any tool that turn to perform or confirm it.'
      : 'Started to tell the user a check or confirmation had been performed (e.g. "I checked and...", "I confirmed that...") without actually calling any tool that turn to establish it.',
    takeaway: isActionOutcome
      ? "Never say an action (save/send/schedule/create/etc.) already happened unless a real tool call this turn (or an already-visible result earlier in the conversation) actually performed or confirmed it — otherwise say plainly that it hasn't been done yet and do it or check first."
      : "Never state that you checked, confirmed, or verified something unless a real tool call this turn (or an already-visible result earlier in the conversation) actually established it — otherwise say plainly that it hasn't been verified yet and check first.",
    tags: ["self-heal", "ungrounded-claim"],
  };
}
