import { describe, expect, it, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Hoisted mock refs
// ---------------------------------------------------------------------------

const {
  mockSelect,
  mockLimit,
  mockInsert,
  mockInsertReturning,
  mockUpdate,
  mockUpdateReturning,
  // realRef holds the unmocked Drizzle db and schema table so SQL-predicate
  // tests can call .toSQL() without hitting the database. It must live inside
  // vi.hoisted (not a plain `let`) because vi.mock factories are hoisted to
  // the top of the file alongside vi.hoisted calls — plain `let` declarations
  // are in the temporal dead zone at that point and would throw
  // "Cannot access before initialization". A mutable property on a hoisted
  // object reference is the correct pattern.
  realRef,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockInsert: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateReturning: vi.fn(),
  realRef: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: null as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elaineLessons: null as any,
  },
}));

function makeSelectChain(): unknown {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = mockLimit;
  return chain;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  // Stash the real db and schema objects BEFORE returning the mock so
  // SQL-predicate tests can use them without executing any queries.
  realRef.db = actual.db;
  realRef.elaineLessons = actual.elaineLessons;
  return {
    ...actual,
    db: {
      select: mockSelect.mockImplementation(() => makeSelectChain()),
      insert: mockInsert.mockImplementation(() => ({
        values: vi.fn(() => ({ returning: mockInsertReturning })),
      })),
      update: mockUpdate.mockImplementation(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: mockUpdateReturning })),
        })),
      })),
    },
  };
});

import {
  ELAINE_LESSON_DOMAINS,
  buildLessonDedupWhere,
  explicitAssistantPatternKey,
  getRelevantElaineLessons,
  maybeScheduleExplicitLessonDiagnosis,
  recordElaineLesson,
} from "./elaine-lessons";
import { CODE_DIAGNOSIS_FILE_ALLOWLIST } from "./elaine-code-diagnosis";

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    outcome: "mistake",
    domain: "reminders",
    situation:
      "user asked to push a reminder back an hour and it was reset to 1 hour from now instead of added to the existing time",
    takeaway:
      "push it back an hour means add 1 hour to the existing reminder time, never reset it to 1 hour from now",
    tags: ["reminders", "reschedule"],
    active: true,
    source: "explicit_assistant",
    createdByUserId: 7,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => makeSelectChain());
  mockInsert.mockImplementation(() => ({
    values: vi.fn(() => ({ returning: mockInsertReturning })),
  }));
  mockUpdate.mockImplementation(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    })),
  }));
});

describe("Elaine lessons — before/after retrieval demonstrates a real behavior change", () => {
  it("finds nothing before a lesson is recorded, then surfaces it for a repeat of the same situation", async () => {
    // BEFORE: no lessons exist yet.
    mockLimit.mockResolvedValueOnce([]);
    const before = await getRelevantElaineLessons({
      userId: 7,
      query: "can you push my dentist reminder back an hour",
      currentDomain: "reminders",
    });
    expect(before.lessons).toHaveLength(0);
    expect(before.evidenceBlock).toBe("(no relevant past lessons)");

    // WRITE: record the lesson from the earlier bad outcome (dedup check
    // finds nothing existing, so an insert happens).
    mockLimit.mockResolvedValueOnce([]); // dedup select
    mockInsertReturning.mockResolvedValueOnce([lessonRow()]);
    const created = await recordElaineLesson({
      userId: 7,
      outcome: "mistake",
      situation: lessonRow().situation as string,
      takeaway: lessonRow().takeaway as string,
      domain: "reminders",
      tags: ["reminders", "reschedule"],
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(created.id).toBe(1);

    // AFTER: the same situation recurs — retrieval now surfaces the lesson,
    // and the evidence block carries the corrective takeaway into the prompt.
    mockLimit.mockResolvedValueOnce([lessonRow()]);
    const after = await getRelevantElaineLessons({
      userId: 7,
      query: "can you push my dentist reminder back an hour",
      currentDomain: "reminders",
    });
    expect(after.lessons.map((l) => l.id)).toEqual([1]);
    expect(after.evidenceBlock).toContain("MISTAKE");
    expect(after.evidenceBlock).toContain(
      "add 1 hour to the existing reminder time",
    );
  });

  it("touches an existing active duplicate instead of inserting a second row", async () => {
    mockLimit.mockResolvedValueOnce([{ id: 1, occurrenceCount: 1, tags: [] }]); // dedup select finds a match
    mockUpdateReturning.mockResolvedValueOnce([lessonRow({ id: 1 })]);

    const result = await recordElaineLesson({
      userId: 7,
      outcome: "mistake",
      situation: lessonRow().situation as string,
      takeaway: lessonRow().takeaway as string,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
  });

  it("increments occurrenceCount on a dedup touch, defaulting a missing prior count to 1", async () => {
    mockLimit.mockResolvedValueOnce([{ id: 1, occurrenceCount: 2, tags: [] }]);
    const mockSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    }));
    mockUpdate.mockImplementationOnce(() => ({ set: mockSet }));
    mockUpdateReturning.mockResolvedValueOnce([
      lessonRow({ id: 1, occurrenceCount: 3 }),
    ]);

    await recordElaineLesson({
      userId: 7,
      outcome: "mistake",
      situation: lessonRow().situation as string,
      takeaway: lessonRow().takeaway as string,
      source: "self_heal",
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceCount: 3 }),
    );
  });

  it("explicitAssistantPatternKey returns a sorted canonical key so tag-order never matters", () => {
    expect(explicitAssistantPatternKey(["ungrounded", "scheduling"])).toBe(
      "explicit_assistant:scheduling+ungrounded",
    );
    // Same tags in opposite order — key must be identical
    expect(explicitAssistantPatternKey(["scheduling", "ungrounded"])).toBe(
      "explicit_assistant:scheduling+ungrounded",
    );
    // Single tag
    expect(explicitAssistantPatternKey(["timing"])).toBe(
      "explicit_assistant:timing",
    );
    // Empty → null (no diagnosis attempt)
    expect(explicitAssistantPatternKey([])).toBeNull();
    // Whitespace-only tags are filtered out
    expect(explicitAssistantPatternKey(["  ", "  "])).toBeNull();
  });

  it("dedup touch merges incoming tags into the stored tag set (union)", async () => {
    // The lesson was originally recorded with ["scheduling", "ungrounded"].
    // A later tool call arrives with ["scheduling", "wrong_time"] for the
    // same situation/takeaway. The update should write the union of both sets.
    const mergedRow = lessonRow({
      id: 42,
      tags: ["scheduling", "ungrounded", "wrong_time"],
      occurrenceCount: 3,
    });

    const mockSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    }));
    mockUpdate.mockImplementationOnce(() => ({ set: mockSet }));

    mockLimit.mockResolvedValueOnce([
      { id: 42, occurrenceCount: 2, tags: ["scheduling", "ungrounded"] },
    ]);
    mockUpdateReturning.mockResolvedValueOnce([mergedRow]);

    const lesson = await recordElaineLesson({
      userId: 7,
      outcome: "mistake",
      situation: mergedRow.situation as string,
      takeaway: mergedRow.takeaway as string,
      tags: ["scheduling", "wrong_time"],
      source: "explicit_assistant",
    });

    // The .set() call must include the union of stored + incoming tags.
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([
          "scheduling",
          "ungrounded",
          "wrong_time",
        ]),
      }),
    );
    // The returned row carries the merged tags.
    expect(lesson.tags).toEqual(["scheduling", "ungrounded", "wrong_time"]);
  });

  it("dedup touch with empty incoming tags leaves the stored tags unchanged", async () => {
    // When the tool call omits tags (or passes an empty array), the stored
    // tag set should be preserved verbatim — not replaced with [].
    const storedRow = lessonRow({
      id: 5,
      tags: ["reminders", "reschedule"],
      occurrenceCount: 2,
    });

    const mockSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    }));
    mockUpdate.mockImplementationOnce(() => ({ set: mockSet }));

    mockLimit.mockResolvedValueOnce([
      { id: 5, occurrenceCount: 1, tags: ["reminders", "reschedule"] },
    ]);
    mockUpdateReturning.mockResolvedValueOnce([storedRow]);

    await recordElaineLesson({
      userId: 7,
      outcome: "mistake",
      situation: storedRow.situation as string,
      takeaway: storedRow.takeaway as string,
      // No tags supplied — should not wipe the stored set.
      source: "explicit_assistant",
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining(["reminders", "reschedule"]),
      }),
    );
    const [[setCallArg]] = mockSet.mock.calls as unknown as [
      [{ tags: string[] }],
    ];
    expect(setCallArg.tags).toHaveLength(2);
  });

  it("dedup WHERE clause is tag-independent — proven by compiling the production predicate to SQL", () => {
    // buildLessonDedupWhere is the exported function that recordElaineLesson
    // passes directly to its .where() call — not a reconstruction. The test
    // compiles that exact predicate to SQL via the real (unmocked) Drizzle
    // client and asserts tags are absent. If someone adds
    // eq(elaineLessons.tags, ...) to buildLessonDedupWhere, the compiled SQL
    // will contain "tags" and this test fails — even if mock-based tests pass,
    // because mocks return whatever they're told regardless of the predicate.
    const query = realRef.db
      .select({
        id: realRef.elaineLessons.id,
        occurrenceCount: realRef.elaineLessons.occurrenceCount,
      })
      .from(realRef.elaineLessons)
      .where(
        buildLessonDedupWhere({
          userId: 7,
          outcome: "mistake",
          situation: "some situation",
          takeaway: "some takeaway",
        }),
      )
      .limit(1);

    const { sql } = query.toSQL();

    // Tags must NOT appear in the dedup predicate. If they did, tag-order
    // variants (["scheduling","ungrounded"] vs ["ungrounded","scheduling"])
    // would produce separate rows with split occurrenceCount values that
    // individually never cross the code-diagnosis threshold.
    expect(sql).not.toMatch(/\btags\b/i);
    // The identity columns must all be present to confirm the predicate is
    // actually performing the dedup work.
    expect(sql).toMatch(/situation/);
    expect(sql).toMatch(/takeaway/);
    expect(sql).toMatch(/outcome/);
    expect(sql).toMatch(/created_by_user_id/);
  });

  it("maybeScheduleExplicitLessonDiagnosis calls the scheduler when the stored tags match an allowlisted key", () => {
    // "explicit_assistant:scheduling+ungrounded" is a real entry in
    // CODE_DIAGNOSIS_FILE_ALLOWLIST — this test proves the scheduler fires for
    // a lesson whose tags produce that key, even when the tags were originally
    // stored in a different order (union-merge normalises them via sort).
    const scheduleSpy = vi.fn();
    const lesson = lessonRow({
      id: 10,
      tags: ["ungrounded", "scheduling"], // reverse order — key must still match
      source: "explicit_assistant",
      occurrenceCount: 5,
    });

    maybeScheduleExplicitLessonDiagnosis(lesson as never, scheduleSpy);

    const expectedKey = "explicit_assistant:scheduling+ungrounded";
    expect(expectedKey in CODE_DIAGNOSIS_FILE_ALLOWLIST).toBe(true);
    expect(scheduleSpy).toHaveBeenCalledOnce();
    expect(scheduleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        patternKey: expectedKey,
        lessonId: 10,
        occurrenceCount: 5,
      }),
    );
  });

  it("maybeScheduleExplicitLessonDiagnosis does NOT call the scheduler when union-merged tags produce a key not in the allowlist", () => {
    // A lesson originally recorded with ["scheduling","ungrounded"] has been
    // dedup-touched by a later tool call that added "wrong_time", resulting in
    // the stored tag set ["scheduling","ungrounded","wrong_time"]. The canonical
    // key for this grown set is "explicit_assistant:scheduling+ungrounded+wrong_time",
    // which is NOT in CODE_DIAGNOSIS_FILE_ALLOWLIST — diagnosis for this
    // extended pattern has not been configured yet. The scheduler must NOT be
    // called, preventing a spurious background model invocation.
    const scheduleSpy = vi.fn();
    const lesson = lessonRow({
      id: 11,
      tags: ["scheduling", "ungrounded", "wrong_time"],
      source: "explicit_assistant",
      occurrenceCount: 7,
    });

    maybeScheduleExplicitLessonDiagnosis(lesson as never, scheduleSpy);

    const grownKey = "explicit_assistant:scheduling+ungrounded+wrong_time";
    expect(grownKey in CODE_DIAGNOSIS_FILE_ALLOWLIST).toBe(false);
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("normalizes an unrecognized domain to 'general' instead of rejecting the write", async () => {
    const mockValues = vi.fn(() => ({ returning: mockInsertReturning }));
    mockInsert.mockImplementationOnce(() => ({ values: mockValues }));
    mockLimit.mockResolvedValueOnce([]);
    mockInsertReturning.mockResolvedValueOnce([
      lessonRow({ domain: "general" }),
    ]);

    await recordElaineLesson({
      userId: 7,
      outcome: "success",
      situation: "something not covered by the known domain list",
      takeaway: "generalized takeaway",
      domain: "not-a-real-domain",
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "general" }),
    );
    expect(ELAINE_LESSON_DOMAINS).toContain("general");
  });
});
