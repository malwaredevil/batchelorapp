/**
 * End-to-end integration test for the explicit_assistant lesson →
 * code-diagnosis path wired in #920.
 *
 * Flow under test:
 *   recordElaineLesson (source: explicit_assistant, with tags)
 *     → maybeScheduleExplicitLessonDiagnosis(lesson, diagnoseRecurringFailureInBackground)
 *         — uses lesson.tags / lesson.id / lesson.occurrenceCount from the DB row
 *     → maybeDiagnoseRecurringFailure
 *     → elaineCodeSuggestions row created when threshold is crossed
 *
 * The test calls the real production functions (recordElaineLesson,
 * maybeScheduleExplicitLessonDiagnosis, maybeDiagnoseRecurringFailure) with
 * mocked DB and AI client, so a regression in any step — including the data
 * handoff of lesson.id / occurrenceCount / tags — will fail a test here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted shared state and mocks
// ---------------------------------------------------------------------------

const {
  selectQueue,
  dbMock,
  mockCallModel,
  setInsertResult,
  setUpdateResult,
  pushSelect,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertResult: { value: unknown[] } = { value: [] };
  const updateResult: { value: unknown[] } = { value: [] };

  function makeSelectBuilder(): {
    from: () => ReturnType<typeof makeSelectBuilder>;
    where: () => ReturnType<typeof makeSelectBuilder>;
    limit: () => Promise<unknown[]>;
    then: (
      onFulfilled: (v: unknown[]) => unknown,
      onRejected: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } {
    const builder = {
      from: () => builder,
      where: () => builder,
      limit: () => Promise.resolve(selectQueue.shift() ?? []),
      then(
        onFulfilled: (v: unknown[]) => unknown,
        onRejected: (e: unknown) => unknown,
      ) {
        return Promise.resolve(selectQueue.shift() ?? []).then(
          onFulfilled,
          onRejected,
        );
      },
    };
    return builder;
  }

  function makeUpdateBuilder() {
    const builder = {
      set: () => builder,
      where: () => builder,
      returning: () => Promise.resolve(updateResult.value),
    };
    return builder;
  }

  function makeInsertBuilder() {
    const builder = {
      values: () => builder,
      onConflictDoNothing: () => builder,
      returning: () => Promise.resolve(insertResult.value),
    };
    return builder;
  }

  const dbMock = {
    select: vi.fn(() => makeSelectBuilder()),
    update: vi.fn(() => makeUpdateBuilder()),
    insert: vi.fn(() => makeInsertBuilder()),
  };

  const mockCallModel = vi.fn(
    async (
      _model: unknown,
      fn: (client: unknown, model: string) => Promise<string>,
    ) =>
      fn(
        {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        hasHypothesis: true,
                        filesReferenced: [
                          "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
                        ],
                        hypothesis:
                          "The grounding check in self-heal-policy.ts does not cover the scheduling confirmation path.",
                      }),
                    },
                  },
                ],
              }),
            },
          },
        },
        "test-model",
      ),
  );

  return {
    selectQueue,
    insertResult,
    updateResult,
    dbMock,
    mockCallModel,
    setInsertResult: (rows: unknown[]) => {
      insertResult.value = rows;
    },
    setUpdateResult: (rows: unknown[]) => {
      updateResult.value = rows;
    },
    pushSelect: (rows: unknown[]) => {
      selectQueue.push(rows);
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("./ai-client", () => ({
  getModels: vi.fn(async () => ({ advisor: "test-advisor-model" })),
  getThresholds: vi.fn(async () => ({
    codeDiagnosisRecurrenceThreshold: 3,
  })),
  callModel: mockCallModel,
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// node:fs mock — lets readAllowlistedSourceFiles exercise its full safety
// checks with synthetic content, without needing real files on disk.
const FAKE_SOURCE_CONTENT =
  "// synthetic source file for test\nexport function check() { return true; }";

vi.mock("node:fs", () => ({
  statSync: vi.fn(() => ({ size: FAKE_SOURCE_CONTENT.length })),
  readFileSync: vi.fn(() => FAKE_SOURCE_CONTENT),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  explicitAssistantPatternKey,
  maybeScheduleExplicitLessonDiagnosis,
  recordElaineLesson,
} from "./elaine-lessons";
import {
  maybeDiagnoseRecurringFailure,
  diagnoseRecurringFailureInBackground,
  CODE_DIAGNOSIS_FILE_ALLOWLIST,
} from "./elaine-code-diagnosis";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_LESSON_INPUT = {
  userId: 1,
  outcome: "mistake" as const,
  situation:
    "Elaine reported a scheduled reminder as confirmed without a tool call",
  takeaway: "Always verify the scheduling tool result before confirming",
};

function makeLesson(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    active: true,
    outcome: "mistake",
    domain: "reminders",
    situation: BASE_LESSON_INPUT.situation,
    takeaway: BASE_LESSON_INPUT.takeaway,
    tags: ["scheduling", "ungrounded"],
    source: "explicit_assistant",
    occurrenceCount: 1,
    createdByUserId: 1,
    createdAt: new Date("2026-08-14T00:00:00Z"),
    updatedAt: new Date("2026-08-14T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue.splice(0);
  setInsertResult([]);
  setUpdateResult([]);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// explicitAssistantPatternKey — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("explicitAssistantPatternKey", () => {
  it("returns null when tags array is empty", () => {
    expect(explicitAssistantPatternKey([])).toBeNull();
  });

  it("returns null when tags is not an array (null, undefined, plain object)", () => {
    expect(explicitAssistantPatternKey(null)).toBeNull();
    expect(explicitAssistantPatternKey(undefined)).toBeNull();
    expect(explicitAssistantPatternKey({ key: "value" })).toBeNull();
  });

  it("returns null when the array contains only empty/whitespace strings", () => {
    expect(explicitAssistantPatternKey(["", "  ", "\t"])).toBeNull();
  });

  it("returns a stable canonical key regardless of tag order", () => {
    const key1 = explicitAssistantPatternKey(["ungrounded", "scheduling"]);
    const key2 = explicitAssistantPatternKey(["scheduling", "ungrounded"]);
    expect(key1).toBe(key2);
    expect(key1).toBe("explicit_assistant:scheduling+ungrounded");
  });

  it("normalises tag casing", () => {
    expect(explicitAssistantPatternKey(["Scheduling", "UNGROUNDED"])).toBe(
      "explicit_assistant:scheduling+ungrounded",
    );
  });

  it("produces keys that match every known explicit_assistant allowlist entry", () => {
    const allowlisted = Object.keys(CODE_DIAGNOSIS_FILE_ALLOWLIST).filter((k) =>
      k.startsWith("explicit_assistant:"),
    );
    expect(allowlisted.length).toBeGreaterThan(0);
    for (const key of allowlisted) {
      const tags = key.replace("explicit_assistant:", "").split("+");
      expect(explicitAssistantPatternKey(tags)).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// recordElaineLesson — DB-layer behavior (new lesson vs. dedup increment)
// ---------------------------------------------------------------------------

describe("recordElaineLesson", () => {
  it("creates a new lesson and returns the row with the provided tags and occurrenceCount=1", async () => {
    pushSelect([]); // no existing lesson
    setInsertResult([makeLesson({ occurrenceCount: 1 })]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["scheduling", "ungrounded"],
      source: "explicit_assistant",
    });

    expect(lesson.id).toBe(7);
    expect(lesson.tags).toEqual(["scheduling", "ungrounded"]);
    expect(lesson.occurrenceCount).toBe(1);
    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("increments occurrenceCount via dedup update when an identical lesson already exists", async () => {
    // Dedup check finds existing lesson with occurrenceCount=2
    pushSelect([{ id: 7, occurrenceCount: 2 }]);
    // Update returns the touched row with occurrenceCount=3 (crossing threshold)
    setUpdateResult([makeLesson({ occurrenceCount: 3 })]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["scheduling", "ungrounded"],
      source: "explicit_assistant",
    });

    // The dedup path must use the DB-incremented count, not a hand-crafted value
    expect(lesson.id).toBe(7);
    expect(lesson.occurrenceCount).toBe(3);
    expect(dbMock.update).toHaveBeenCalledOnce();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// recordElaineLesson → maybeScheduleExplicitLessonDiagnosis integration
//
// This is the critical data-handoff path: the production code in index.ts does:
//   const lesson = await recordElaineLesson({...})
//   maybeScheduleExplicitLessonDiagnosis(lesson, diagnoseRecurringFailureInBackground)
//
// These tests exercise that exact sequence, asserting that the scheduler
// receives the persisted lesson's tags / id / occurrenceCount — not values
// the test constructed itself.
// ---------------------------------------------------------------------------

describe("recordElaineLesson → maybeScheduleExplicitLessonDiagnosis", () => {
  it("calls the scheduler with the persisted lesson id, occurrenceCount, and tags (new lesson path)", async () => {
    pushSelect([]); // no existing
    setInsertResult([
      makeLesson({
        id: 7,
        tags: ["scheduling", "ungrounded"],
        occurrenceCount: 1,
      }),
    ]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["scheduling", "ungrounded"],
      source: "explicit_assistant",
    });

    const diagnoseSpy = vi.fn();
    maybeScheduleExplicitLessonDiagnosis(lesson, diagnoseSpy);

    expect(diagnoseSpy).toHaveBeenCalledOnce();
    expect(diagnoseSpy).toHaveBeenCalledWith({
      patternKey: "explicit_assistant:scheduling+ungrounded",
      lessonId: lesson.id, // 7 — from the DB row, not hand-crafted
      occurrenceCount: lesson.occurrenceCount, // 1 — from the DB row
      situation: lesson.situation,
      takeaway: lesson.takeaway,
    });
  });

  it("calls the scheduler with the incremented occurrenceCount from the dedup update row", async () => {
    // Simulate the third recurrence (occurrenceCount goes 2 → 3, crossing threshold=3)
    pushSelect([{ id: 7, occurrenceCount: 2 }]);
    setUpdateResult([
      makeLesson({
        id: 7,
        tags: ["scheduling", "ungrounded"],
        occurrenceCount: 3,
      }),
    ]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["scheduling", "ungrounded"],
      source: "explicit_assistant",
    });

    const diagnoseSpy = vi.fn();
    maybeScheduleExplicitLessonDiagnosis(lesson, diagnoseSpy);

    // The persisted count=3 must be forwarded — not (2+1) computed in the test
    expect(diagnoseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        patternKey: "explicit_assistant:scheduling+ungrounded",
        lessonId: 7,
        occurrenceCount: 3,
      }),
    );
  });

  it("does not call the scheduler when the persisted lesson has no tags", async () => {
    pushSelect([]); // no existing
    setInsertResult([makeLesson({ id: 8, tags: [], occurrenceCount: 1 })]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: [],
      source: "explicit_assistant",
    });

    const diagnoseSpy = vi.fn();
    maybeScheduleExplicitLessonDiagnosis(lesson, diagnoseSpy);

    // explicitAssistantPatternKey returns null → scheduler must not fire
    expect(diagnoseSpy).not.toHaveBeenCalled();
  });

  it("end-to-end: threshold crossing via recordElaineLesson creates a suggestion row", async () => {
    // Third recurrence → occurrenceCount=3 (at threshold=3)
    pushSelect([{ id: 7, occurrenceCount: 2 }]); // dedup check for recordElaineLesson
    setUpdateResult([
      makeLesson({
        id: 7,
        tags: ["scheduling", "ungrounded"],
        occurrenceCount: 3,
      }),
    ]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["scheduling", "ungrounded"],
      source: "explicit_assistant",
    });

    // Push hasPendingSuggestion select: no existing pending row
    pushSelect([]);
    // Suggestion insert result
    const expectedRow = {
      id: 99,
      patternKey: "explicit_assistant:scheduling+ungrounded",
      status: "pending",
    };
    setInsertResult([expectedRow]);

    // Wire through the production callback, just as index.ts does
    const diagnosisResult = await new Promise<unknown>((resolve) => {
      maybeScheduleExplicitLessonDiagnosis(lesson, (input) => {
        maybeDiagnoseRecurringFailure(input).then(resolve, resolve);
      });
    });

    expect(mockCallModel).toHaveBeenCalled();
    expect(dbMock.insert).toHaveBeenCalled();
    expect(diagnosisResult).toEqual(expectedRow);
  });

  it("end-to-end: does NOT fire diagnosis for a tag combo with no allowlist entry", async () => {
    pushSelect([]); // no existing
    setInsertResult([
      makeLesson({
        id: 9,
        tags: ["no", "allowlist", "entry"],
        occurrenceCount: 5,
      }),
    ]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["no", "allowlist", "entry"],
      source: "explicit_assistant",
    });

    // The pattern key has no CODE_DIAGNOSIS_FILE_ALLOWLIST entry, so
    // maybeScheduleExplicitLessonDiagnosis's own guard skips the scheduler
    // callback entirely — maybeDiagnoseRecurringFailure is never reached, and
    // no spurious background model invocation happens for an unconfigured
    // pattern.
    const scheduleSpy = vi.fn();
    maybeScheduleExplicitLessonDiagnosis(lesson, scheduleSpy);

    expect(scheduleSpy).not.toHaveBeenCalled();
    // Only the lesson insert happened (from recordElaineLesson), not a suggestion insert.
    // The lesson insert uses elaineLessons; no second insert for elaineCodeSuggestions.
    expect(dbMock.insert).toHaveBeenCalledOnce();
  });

  it("the second allowlisted pattern (reminders+timing) follows the same chain above threshold", async () => {
    pushSelect([{ id: 11, occurrenceCount: 3 }]); // dedup: occurrenceCount goes 3→4
    setUpdateResult([
      makeLesson({ id: 11, tags: ["reminders", "timing"], occurrenceCount: 4 }),
    ]);

    const lesson = await recordElaineLesson({
      ...BASE_LESSON_INPUT,
      tags: ["reminders", "timing"],
      source: "explicit_assistant",
    });

    pushSelect([]); // hasPendingSuggestion: none
    const expectedRow = {
      id: 100,
      patternKey: "explicit_assistant:reminders+timing",
      status: "pending",
    };
    setInsertResult([expectedRow]);

    const diagnosisResult = await new Promise<unknown>((resolve) => {
      maybeScheduleExplicitLessonDiagnosis(lesson, (input) => {
        maybeDiagnoseRecurringFailure(input).then(resolve, resolve);
      });
    });

    expect(diagnosisResult).toEqual(expectedRow);
  });
});

// ---------------------------------------------------------------------------
// maybeDiagnoseRecurringFailure — gate / dedup / allowlist checks
// ---------------------------------------------------------------------------

describe("maybeDiagnoseRecurringFailure — gate checks", () => {
  const ALLOWLISTED_KEY = "explicit_assistant:scheduling+ungrounded";

  function diagnosisInput(
    patternKey: string,
    occurrenceCount: number,
  ): Parameters<typeof maybeDiagnoseRecurringFailure>[0] {
    return {
      patternKey,
      lessonId: 1,
      occurrenceCount,
      situation: BASE_LESSON_INPUT.situation,
      takeaway: BASE_LESSON_INPUT.takeaway,
    };
  }

  it("returns null and touches no DB when occurrenceCount is below threshold", async () => {
    const result = await maybeDiagnoseRecurringFailure(
      diagnosisInput(ALLOWLISTED_KEY, 2),
    );
    expect(result).toBeNull();
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("returns null and skips the model call when a pending suggestion already exists", async () => {
    pushSelect([{ id: 42 }]);
    const result = await maybeDiagnoseRecurringFailure(
      diagnosisInput(ALLOWLISTED_KEY, 5),
    );
    expect(result).toBeNull();
    expect(mockCallModel).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("returns null when the model declines to form a hypothesis (hasHypothesis: false)", async () => {
    pushSelect([]);
    mockCallModel.mockImplementationOnce(
      async (
        _model: unknown,
        fn: (client: unknown, model: string) => Promise<string>,
      ) =>
        fn(
          {
            chat: {
              completions: {
                create: async () => ({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          hasHypothesis: false,
                          filesReferenced: [],
                          hypothesis: "",
                        }),
                      },
                    },
                  ],
                }),
              },
            },
          },
          "test-model",
        ),
    );
    const result = await maybeDiagnoseRecurringFailure(
      diagnosisInput(ALLOWLISTED_KEY, 5),
    );
    expect(result).toBeNull();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// diagnoseRecurringFailureInBackground — fire-and-forget wrapper
// ---------------------------------------------------------------------------

describe("diagnoseRecurringFailureInBackground", () => {
  it("does not throw synchronously for a below-threshold no-op call", async () => {
    expect(() =>
      diagnoseRecurringFailureInBackground({
        patternKey: "explicit_assistant:scheduling+ungrounded",
        lessonId: 1,
        occurrenceCount: 1,
        situation: BASE_LESSON_INPUT.situation,
        takeaway: BASE_LESSON_INPUT.takeaway,
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does not propagate synchronously when maybeDiagnoseRecurringFailure rejects", async () => {
    // Above threshold and allowlisted so the wrapper actually calls the model.
    // Push empty select so hasPendingSuggestion check passes.
    pushSelect([]);
    const boom = new Error("diagnosis exploded");
    mockCallModel.mockRejectedValueOnce(boom);

    // Must not throw synchronously — the .catch() wrapper must absorb the error.
    expect(() =>
      diagnoseRecurringFailureInBackground({
        patternKey: "explicit_assistant:scheduling+ungrounded",
        lessonId: 1,
        occurrenceCount: 5,
        situation: BASE_LESSON_INPUT.situation,
        takeaway: BASE_LESSON_INPUT.takeaway,
      }),
    ).not.toThrow();

    // Drain microtask queue so the .catch() handler has run.
    await new Promise((r) => setTimeout(r, 0));

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: boom,
        patternKey: "explicit_assistant:scheduling+ungrounded",
      }),
      expect.any(String),
    );
  });

  it("calls logger.warn with the error and patternKey when diagnosis rejects, and the turn still completes", async () => {
    // Simulate a different allowlisted pattern to confirm patternKey is forwarded faithfully.
    pushSelect([]);
    const networkError = new Error("upstream timeout");
    mockCallModel.mockRejectedValueOnce(networkError);

    let turnCompleted = false;
    // Mimic fire-and-forget usage: call the wrapper, then do turn-completion work.
    diagnoseRecurringFailureInBackground({
      patternKey: "explicit_assistant:reminders+timing",
      lessonId: 2,
      occurrenceCount: 4,
      situation: BASE_LESSON_INPUT.situation,
      takeaway: BASE_LESSON_INPUT.takeaway,
    });
    // This line must be reached regardless of the background rejection.
    turnCompleted = true;

    await new Promise((r) => setTimeout(r, 0));

    expect(turnCompleted).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: networkError,
        patternKey: "explicit_assistant:reminders+timing",
      }),
      expect.any(String),
    );
  });
});
