import { sanitizeRuntimeText } from "./contracts";

/**
 * Ranking/formatting for Elaine's outcome-memory ("past lessons") — distinct
 * from memory-policy.ts, which ranks household-fact `elaine_memory` rows.
 * Mirrors that file's shape (tokenize → score → threshold → cap → format)
 * on purpose so the two systems stay easy to reason about side by side.
 */

export interface ElaineLessonCandidate {
  id: number;
  outcome: string;
  domain: string;
  situation: string;
  takeaway: string;
  tags: unknown;
  active: boolean;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RankedElaineLesson extends ElaineLessonCandidate {
  relevanceScore: number;
  tagList: string[];
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "could",
  "from",
  "have",
  "just",
  "please",
  "that",
  "their",
  "there",
  "these",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? [],
  );
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string");
}

/**
 * Ranks candidate lessons against the current request, optionally boosted
 * when the lesson's `domain` matches the caller-supplied current-app domain
 * (e.g. "travels" while chatting inside the Travels app). Thresholded and
 * capped the same way rankElaineMemories is, so a growing lessons table
 * never dumps its whole history into the prompt.
 */
export function rankElaineLessons(input: {
  lessons: readonly ElaineLessonCandidate[];
  query: string;
  currentDomain?: string | null;
  now?: Date;
  limit?: number;
}): RankedElaineLesson[] {
  const now = input.now ?? new Date();
  const queryTokens = tokens(input.query);

  return input.lessons
    .filter((lesson) => lesson.active)
    .map((lesson): RankedElaineLesson => {
      const tagList = normalizeTags(lesson.tags);
      const lessonTokens = tokens(
        `${lesson.situation} ${lesson.takeaway} ${tagList.join(" ")}`,
      );
      const overlap = [...queryTokens].filter((token) =>
        lessonTokens.has(token),
      ).length;
      const lexical =
        queryTokens.size === 0 ? 0.25 : overlap / Math.max(queryTokens.size, 1);
      const ageDays = Math.max(
        0,
        (now.getTime() - lesson.updatedAt.getTime()) / 86_400_000,
      );
      const recency = Math.max(0, 1 - ageDays / 365);
      const domainMatch =
        input.currentDomain && lesson.domain === input.currentDomain ? 0.3 : 0;
      // Mistakes are weighted slightly higher than successes: repeating a
      // known mistake is worse than missing out on a known-good shortcut.
      const outcomeWeight = lesson.outcome === "mistake" ? 0.1 : 0.05;
      return {
        ...lesson,
        situation: sanitizeRuntimeText(lesson.situation, 300),
        takeaway: sanitizeRuntimeText(lesson.takeaway, 300),
        tagList,
        relevanceScore:
          lexical * 0.5 + recency * 0.15 + domainMatch + outcomeWeight,
      };
    })
    .filter(
      (lesson) =>
        queryTokens.size === 0 ||
        lesson.relevanceScore >= 0.3 ||
        (input.currentDomain && lesson.domain === input.currentDomain),
    )
    .sort(
      (a, b) =>
        b.relevanceScore - a.relevanceScore ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .slice(0, Math.max(1, Math.min(input.limit ?? 6, 15)));
}

export function formatLessonEvidence(
  lessons: readonly RankedElaineLesson[],
): string {
  if (lessons.length === 0) return "(no relevant past lessons)";
  return lessons
    .map((lesson) => {
      const label = lesson.outcome === "mistake" ? "MISTAKE" : "WORKED WELL";
      return `- [${label}; ${lesson.domain}] Situation: ${lesson.situation} — Takeaway: ${lesson.takeaway}`;
    })
    .join("\n");
}
