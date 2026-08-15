import { and, desc, eq } from "drizzle-orm";
import { db, elaineLessons, type ElaineLessonRow } from "@workspace/db";
import {
  formatLessonEvidence,
  rankElaineLessons,
} from "../elaine/runtime/lesson-policy";
import { CODE_DIAGNOSIS_FILE_ALLOWLIST } from "./elaine-code-diagnosis";

/**
 * Elaine's outcome-memory ("past lessons") — distinct from elaine-memory.ts,
 * which stores household facts. See lib/db/src/schema/elaine.ts for the full
 * rationale on why these are separate systems.
 */

export type ElaineLessonOutcome = "mistake" | "success";

/**
 * Conventional-but-not-exhaustive domain buckets for tagging a lesson's
 * situation. Kept intentionally small so retrieval stays "tagged/categorized,
 * not a free-text dump" — validated at the write layer (invalid/omitted
 * values fall back to "general" rather than rejecting the write, since a
 * slightly-wrong bucket is far less harmful than losing the lesson).
 */
export const ELAINE_LESSON_DOMAINS = [
  "travels",
  "pottery",
  "quilting",
  "ornaments",
  "office",
  "reminders",
  "memory",
  "navigation",
  "communication",
  "general",
] as const;
export type ElaineLessonDomain = (typeof ELAINE_LESSON_DOMAINS)[number];

function normalizeDomain(value: string | undefined | null): ElaineLessonDomain {
  return (ELAINE_LESSON_DOMAINS as readonly string[]).includes(value ?? "")
    ? (value as ElaineLessonDomain)
    : "general";
}

export async function getRelevantElaineLessons(input: {
  userId: number;
  query: string;
  currentDomain?: string | null;
  limit?: number;
}): Promise<{
  lessons: ReturnType<typeof rankElaineLessons>;
  evidenceBlock: string;
}> {
  const rows = await db
    .select()
    .from(elaineLessons)
    .where(
      and(
        eq(elaineLessons.active, true),
        eq(elaineLessons.createdByUserId, input.userId),
      ),
    )
    .orderBy(desc(elaineLessons.updatedAt))
    .limit(200);
  const lessons = rankElaineLessons({
    lessons: rows,
    query: input.query,
    currentDomain: input.currentDomain,
    limit: input.limit,
  });
  return { lessons, evidenceBlock: formatLessonEvidence(lessons) };
}

/**
 * Derives a stable, canonical pattern key for an `explicit_assistant` lesson
 * from its tags. Returns null when there are no tags (no stable key can be
 * formed). The key is sorted so tag-order differences in tool calls never
 * produce distinct keys for the same semantic pattern.
 *
 * Example: tags ["scheduling", "ungrounded"] → "explicit_assistant:scheduling+ungrounded"
 *
 * Consumed by elaine-code-diagnosis.ts's CODE_DIAGNOSIS_FILE_ALLOWLIST — add
 * a matching entry there for any tag combination that has a clear,
 * bounded set of source files to inspect.
 */
export function explicitAssistantPatternKey(tags: unknown): string | null {
  // tags comes from a jsonb column (typed as {} by Drizzle) or from a tool-call
  // input — normalize defensively to string[] before processing.
  const asArray = Array.isArray(tags)
    ? (tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const normalized = asArray
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .sort();
  if (normalized.length === 0) return null;
  return `explicit_assistant:${normalized.join("+")}`;
}

/**
 * Post-persist hook for explicit_assistant lessons: derives a canonical
 * pattern key from the lesson's persisted tags and, if the pattern is
 * allowlisted and the occurrence count has crossed the configured threshold,
 * schedules a background code-diagnosis run via the provided callback.
 *
 * Extracted from elaine/index.ts so the wiring can be unit-tested in
 * isolation — the record_lesson handler passes diagnoseRecurringFailureInBackground
 * as the scheduler; tests pass a spy instead.
 *
 * The scheduler is only invoked when the derived pattern key has an entry in
 * CODE_DIAGNOSIS_FILE_ALLOWLIST — an un-allowlisted key would cause the
 * downstream maybeDiagnoseRecurringFailure to no-op (readAllowlistedSourceFiles
 * returns []), so skipping the scheduler call here avoids a spurious background
 * model invocation for patterns we haven't explicitly configured yet. This also
 * makes the guard testable in isolation without hitting the DB.
 *
 * Note on tag growth: a lesson's stored tags can grow via union-merging on
 * dedup touches (["scheduling","ungrounded"] → ["scheduling","ungrounded","wrong_time"]).
 * The canonical key produced by explicitAssistantPatternKey reflects the full,
 * sorted tag set — so a grown key may no longer match any allowlist entry even
 * though the original shorter key did. This guard makes that silent gap
 * detectable: add the extended key to CODE_DIAGNOSIS_FILE_ALLOWLIST when a
 * grown tag combination is common enough to warrant its own diagnosis target.
 */
export function maybeScheduleExplicitLessonDiagnosis(
  lesson: ElaineLessonRow,
  scheduleDiagnosis: (input: {
    patternKey: string;
    lessonId: number;
    occurrenceCount: number;
    situation: string;
    takeaway: string;
  }) => void,
): void {
  const patternKey = explicitAssistantPatternKey(lesson.tags);
  if (!patternKey) return;
  // Only schedule when the allowlist has a file set for this pattern — an
  // un-allowlisted key means diagnosis is a no-op downstream anyway.
  if (!(patternKey in CODE_DIAGNOSIS_FILE_ALLOWLIST)) return;
  scheduleDiagnosis({
    patternKey,
    lessonId: lesson.id,
    occurrenceCount: lesson.occurrenceCount ?? 1,
    situation: lesson.situation,
    takeaway: lesson.takeaway,
  });
}

/**
 * Builds the WHERE predicate used by the recordElaineLesson dedup query.
 * Exported so tests can compile the *exact same* predicate to SQL and assert
 * that tags are absent — proving the dedup is tag-order-independent without
 * reconstructing the query manually (a manual copy could diverge silently).
 *
 * Tags are intentionally excluded from the predicate. A lesson's identity is
 * its (outcome, situation, takeaway) — the observable facts about what went
 * wrong and what the correction is. Tags are categorization metadata: a later
 * tool call may supply them in a different order, omit one, or use a slightly
 * different word for the same concept. If we matched on tags, those variants
 * would produce separate rows whose occurrenceCount would individually never
 * cross the code-diagnosis threshold, even though the *same* mistake is
 * recurring. By excluding tags from the dedup, all tag-order variants for the
 * same situation/takeaway increment the same row. On each dedup touch the
 * incoming tags are union-merged into the stored set (see recordElaineLesson),
 * and explicitAssistantPatternKey sorts the final set into a canonical key —
 * so the diagnosis key only grows monotonically as new categorizations arrive.
 */
export function buildLessonDedupWhere(input: {
  userId: number;
  outcome: ElaineLessonOutcome;
  situation: string;
  takeaway: string;
}) {
  return and(
    eq(elaineLessons.active, true),
    eq(elaineLessons.createdByUserId, input.userId),
    eq(elaineLessons.outcome, input.outcome),
    eq(elaineLessons.situation, input.situation),
    eq(elaineLessons.takeaway, input.takeaway),
  );
}

export async function recordElaineLesson(input: {
  userId: number;
  outcome: ElaineLessonOutcome;
  situation: string;
  takeaway: string;
  domain?: string;
  tags?: string[];
  source?: "explicit_user" | "explicit_assistant" | "self_heal";
}): Promise<ElaineLessonRow> {
  const domain = normalizeDomain(input.domain);
  const tags = (input.tags ?? []).filter((tag) => tag.trim().length > 0);

  // Light dedup: if the exact same active lesson already exists, just touch
  // its updatedAt (so recency-ranking reflects it was reconfirmed) instead of
  // growing the table with an identical duplicate row every time the same
  // mistake recurs. Also bump occurrenceCount — this is the signal the
  // code-diagnosis flow (#895) uses to decide when a recurring *behavioral*
  // correction is frequent enough that the real cause is likely a gap in
  // the code, not something a better prompt can fix. See
  // lib/elaine-code-diagnosis.ts. The predicate is built by
  // buildLessonDedupWhere (exported above) — tags are intentionally absent;
  // see that function's doc comment for the full rationale.
  const [existing] = await db
    .select({
      id: elaineLessons.id,
      occurrenceCount: elaineLessons.occurrenceCount,
      tags: elaineLessons.tags,
    })
    .from(elaineLessons)
    .where(buildLessonDedupWhere(input))
    .limit(1);
  if (existing) {
    // Merge the incoming tags into the stored tag set (union, not replace).
    //
    // Rationale: tags are categorization metadata — if Elaine consistently
    // uses a more specific or corrected tag set in later tool calls for the
    // same mistake, those improvements should enrich the stored row rather
    // than being silently discarded. A union (not a replace) is chosen over
    // replace because: (a) the original tags were intentional and may still
    // be correct; (b) the canonical key (explicitAssistantPatternKey) sorts
    // tags before hashing, so adding new tags extends the key predictably
    // rather than changing it unpredictably; (c) code-diagnosis allowlist
    // entries for existing keys remain valid — the new extended key is simply
    // a superset that can be added separately if it reaches the threshold.
    // If the incoming tags are empty the stored set is left unchanged.
    const existingTags = Array.isArray(existing.tags)
      ? (existing.tags as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : [];
    const mergedTags = Array.from(new Set([...existingTags, ...tags]));

    const [touched] = await db
      .update(elaineLessons)
      .set({
        updatedAt: new Date(),
        occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
        tags: mergedTags,
      })
      .where(eq(elaineLessons.id, existing.id))
      .returning();
    return touched;
  }

  const [created] = await db
    .insert(elaineLessons)
    .values({
      outcome: input.outcome,
      domain,
      situation: input.situation,
      takeaway: input.takeaway,
      tags,
      source: input.source ?? "explicit_assistant",
      createdByUserId: input.userId,
    })
    .returning();
  return created;
}
