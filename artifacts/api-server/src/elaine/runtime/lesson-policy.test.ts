import { describe, expect, it } from "vitest";
import {
  formatLessonEvidence,
  rankElaineLessons,
  type ElaineLessonCandidate,
} from "./lesson-policy";

const now = new Date("2026-07-30T12:00:00.000Z");

function lesson(
  overrides: Partial<ElaineLessonCandidate> = {},
): ElaineLessonCandidate {
  return {
    id: 1,
    outcome: "mistake",
    domain: "reminders",
    situation:
      "user asked to push a reminder back an hour and it was reset to 1 hour from now instead of added to the existing time",
    takeaway:
      "'push it back an hour' means add 1 hour to the existing reminder time, not reset it to 1 hour from now",
    tags: ["reminders", "reschedule"],
    active: true,
    source: "explicit_assistant",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-29T12:00:00.000Z"),
    ...overrides,
  };
}

describe("Elaine lesson policy", () => {
  it("excludes inactive lessons", () => {
    const result = rankElaineLessons({
      query: "push the reminder back an hour",
      now,
      lessons: [lesson(), lesson({ id: 2, active: false })],
    });
    expect(result.map((l) => l.id)).toEqual([1]);
  });

  it("ranks a lexically relevant lesson above an unrelated one", () => {
    const result = rankElaineLessons({
      query: "can you push my reminder back an hour",
      now,
      lessons: [
        lesson(),
        lesson({
          id: 2,
          domain: "travels",
          situation: "user asked about flight prices to Rome",
          takeaway: "always call search_flights with real dates, never guess",
          tags: ["flights"],
        }),
      ],
    });
    expect(result[0]?.id).toBe(1);
  });

  it("includes a lesson via domain match even with a weak lexical overlap", () => {
    const result = rankElaineLessons({
      query: "can you take care of that thing we talked about",
      currentDomain: "reminders",
      now,
      lessons: [lesson()],
    });
    expect(result.map((l) => l.id)).toEqual([1]);
  });

  it("excludes an irrelevant lesson with no domain match", () => {
    const result = rankElaineLessons({
      query: "current weather forecast for rome",
      currentDomain: "travels",
      now,
      lessons: [lesson()],
    });
    expect(result).toHaveLength(0);
  });

  it("caps results at the requested limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => lesson({ id: i + 1 }));
    const result = rankElaineLessons({
      query: "push the reminder back an hour",
      now,
      lessons: many,
      limit: 3,
    });
    expect(result).toHaveLength(3);
  });

  it("excludes a navigation lesson for a pottery pricing query while retaining a relevant pottery lesson", () => {
    // Query uses explicit pottery/eBay tokens so the pottery lesson ranks well.
    // The navigation lesson must share no tokens with this query to stay below
    // the 0.3 relevance threshold and be excluded.
    const potteryQuery = "Blue Willow platter pottery ebay pricing";

    const navigationLesson = lesson({
      id: 10,
      domain: "navigation",
      // Situation and takeaway deliberately avoid any token that appears in
      // potteryQuery ("blue", "willow", "platter", "pottery", "ebay", "pricing")
      // and avoid "the" (3-char non-stop-word that would create spurious overlap).
      situation:
        "navigating cross-SPA bundles using client router caused blank display",
      takeaway:
        "always invoke window.location.href for cross-SPA routing; skip browser router",
      tags: ["navigation", "spa", "router"],
      outcome: "mistake" as const,
    });
    const potteryLesson = lesson({
      id: 11,
      domain: "pottery",
      situation:
        "user asked about pottery market value and Elaine answered from general knowledge without checking eBay sold listings",
      takeaway:
        "always verify pottery market values via a real eBay sold-listing lookup before answering",
      tags: ["pottery", "ebay", "price", "market"],
      outcome: "mistake" as const,
    });

    const result = rankElaineLessons({
      query: potteryQuery,
      currentDomain: "pottery",
      now,
      lessons: [navigationLesson, potteryLesson],
    });

    const ids = result.map((l) => l.id);
    // The pottery lesson is lexically relevant and domain-matched — must be included.
    expect(ids).toContain(11);
    // The navigation lesson has no lexical or domain overlap with pottery pricing — must be excluded.
    expect(ids).not.toContain(10);
  });

  it("formats evidence with an outcome label and falls back when empty", () => {
    expect(formatLessonEvidence([])).toBe("(no relevant past lessons)");
    const [ranked] = rankElaineLessons({
      query: "push the reminder back an hour",
      now,
      lessons: [lesson()],
    });
    const formatted = formatLessonEvidence([ranked]);
    expect(formatted).toContain("MISTAKE");
    expect(formatted).toContain("push it back an hour");
  });
});
