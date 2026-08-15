/**
 * Integration test for the full self-heal code-suggestion pipeline.
 *
 * The existing elaine-code-diagnosis.test.ts (unit) exercises
 * maybeDiagnoseRecurringFailure in isolation with everything mocked. This
 * test drives the actual call chain that lives in elaine/index.ts:
 *
 *   detectClaimedCheckWithoutToolCall   (self-heal-policy.ts)
 *     → buildSelfHealLessonInput        (self-heal-policy.ts)
 *     → recordElaineLesson              (elaine-lessons.ts)
 *     → diagnoseRecurringFailureInBackground (elaine-code-diagnosis.ts)
 *         → maybeDiagnoseRecurringFailure
 *             → INSERT elaine_code_suggestions
 *
 * …three times with the same mismatch signature, then asserts:
 *   1. A suggestion row is persisted on the third occurrence (when
 *      occurrenceCount reaches codeDiagnosisRecurrenceThreshold).
 *   2. The suggestion is returned by listElaineCodeSuggestions (the
 *      function backing GET /admin/elaine-code-suggestions).
 *   3. The fire-and-forget wrapper never lets a diagnosis failure propagate —
 *      it logs a warning so the user's chat turn is never affected.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mock refs ───────────────────────────────────────────────────────

const {
  mockSelectLimit,
  mockValuesReturning,
  mockOnConflictDoNothing,
  mockSuggestionReturning,
  mockUpdateReturning,
  mockCallModel,
  mockGetThresholds,
} = vi.hoisted(() => ({
  mockSelectLimit: vi.fn(),
  mockValuesReturning: vi.fn(),
  mockOnConflictDoNothing: vi.fn(),
  mockSuggestionReturning: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockCallModel: vi.fn(),
  mockGetThresholds: vi.fn(),
}));

/**
 * Builds a fluent select chain whose terminal .limit() resolves via
 * mockSelectLimit. A fresh chain is returned on every db.select() call so
 * sequential SELECT calls in one test don't share internal state.
 */
function makeSelectChain(): unknown {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = mockSelectLimit;
  return chain;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      // SELECT used by: recordElaineLesson (dedup) + hasPendingSuggestion
      select: vi.fn().mockImplementation(() => makeSelectChain()),
      // INSERT used by:
      //   - recordElaineLesson (new lesson): .values().returning()
      //   - maybeDiagnoseRecurringFailure (suggestion): .values().onConflictDoNothing().returning()
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: mockValuesReturning,
          onConflictDoNothing: mockOnConflictDoNothing.mockImplementation(
            () => ({ returning: mockSuggestionReturning }),
          ),
        })),
      })),
      // UPDATE used by: recordElaineLesson (bump occurrenceCount on dedup)
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: mockUpdateReturning })),
        })),
      })),
    },
  };
});

vi.mock("../lib/ai-client", () => ({
  callModel: mockCallModel,
  getModels: vi.fn(async () => ({ advisor: "mock-advisor-model" })),
  getThresholds: mockGetThresholds,
}));

vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ── Module imports (must follow all vi.mock() declarations) ─────────────────

import { db } from "@workspace/db";
import {
  detectClaimedCheckWithoutToolCall,
  buildSelfHealLessonInput,
  selfHealPatternKey,
} from "./runtime/self-heal-policy";
import { recordElaineLesson } from "../lib/elaine-lessons";
import {
  diagnoseRecurringFailureInBackground,
  listElaineCodeSuggestions,
} from "../lib/elaine-code-diagnosis";
import { logger } from "../lib/logger";

// ── Shared fixtures ─────────────────────────────────────────────────────────

/** A reply that triggers the "claimed check" mismatch detector. */
const MISMATCH_REPLY =
  "I checked your reminders and everything looks set up correctly.";

/**
 * The cosmetic observation (current_page_context) always recorded by Elaine's
 * runtime but never counted as grounding for a claimed check.
 */
const PAGE_CONTEXT_ONLY_OBSERVATIONS = [
  {
    callId: "call-0",
    stepId: null,
    toolName: "current_page_context",
    success: true as const,
    evidenceSummary: "",
    startedAt: "2026-08-14T10:00:00.000Z",
    completedAt: "2026-08-14T10:00:00.001Z",
  },
];

const TEST_USER_ID = 99;

const BASE_LESSON_ROW = {
  id: 1,
  active: true,
  occurrenceCount: 1,
  outcome: "mistake" as const,
  domain: "general",
  situation:
    'Started to tell the user a check or confirmation had been performed (e.g. "I checked and...", "I confirmed that...") without actually calling any tool that turn to establish it.',
  takeaway:
    "Never state that you checked, confirmed, or verified something unless a real tool call this turn (or an already-visible result earlier in the conversation) actually established it — otherwise say plainly that it hasn't been verified yet and check first.",
  tags: ["self-heal", "ungrounded-claim"],
  source: "self_heal" as const,
  createdByUserId: TEST_USER_ID,
  createdAt: new Date("2026-08-14T10:00:00.000Z"),
  updatedAt: new Date("2026-08-14T10:00:00.000Z"),
};

const BASE_SUGGESTION_ROW = {
  id: 10,
  patternKey: "self_heal:claimed_check_without_tool_call",
  lessonId: 1,
  occurrenceCount: 3,
  observedPattern: "Elaine claimed a check without a real tool call.",
  filesReviewed: [
    {
      path: "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
    },
  ],
  hypothesis:
    "The CLAIMED_CHECK_RE regex may not cover all phrasing variants that Elaine uses.",
  status: "pending" as const,
  createdAt: new Date("2026-08-14T10:00:03.000Z"),
  decidedAt: null,
  decidedByUserId: null,
};

/** Hypothesis JSON the mocked model returns when diagnosis fires. */
const MODEL_HYPOTHESIS_JSON = JSON.stringify({
  hasHypothesis: true,
  filesReferenced: [
    "artifacts/api-server/src/elaine/runtime/self-heal-policy.ts",
  ],
  hypothesis:
    "The CLAIMED_CHECK_RE regex may not cover all phrasing variants that Elaine uses.",
});

/**
 * Flushes the microtask and macrotask queues so fire-and-forget promises
 * settle before assertions run.  A single setTimeout(0) drains all pending
 * microtasks before the macrotask fires, which is enough for any number of
 * chained .then()/.catch() continuations.
 */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  // vi.resetAllMocks() clears call counts, implementations, AND queued
  // one-time return values — preventing cross-test mock-queue contamination.
  vi.resetAllMocks();

  // Re-apply persistent implementations that vi.resetAllMocks() cleared.
  vi.mocked(db.select).mockImplementation(() => makeSelectChain() as never);
  vi.mocked(db.insert).mockImplementation(
    () =>
      ({
        values: vi.fn(() => ({
          returning: mockValuesReturning,
          onConflictDoNothing: mockOnConflictDoNothing.mockImplementation(
            () => ({ returning: mockSuggestionReturning }),
          ),
        })),
      }) as never,
  );
  vi.mocked(db.update).mockImplementation(
    () =>
      ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: mockUpdateReturning })),
        })),
      }) as never,
  );
  mockGetThresholds.mockResolvedValue({ codeDiagnosisRecurrenceThreshold: 3 });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Runs one self-heal turn (detect → build lesson → record → background
 * diagnose), exactly mirroring the sequence in elaine/index.ts ~line 5444.
 */
async function runSelfHealTurn() {
  const mismatch = detectClaimedCheckWithoutToolCall({
    finalContent: MISMATCH_REPLY,
    observations: PAGE_CONTEXT_ONLY_OBSERVATIONS,
  });
  if (!mismatch) throw new Error("Expected a mismatch but got null");

  const lessonInput = buildSelfHealLessonInput(mismatch);
  const lesson = await recordElaineLesson({
    userId: TEST_USER_ID,
    source: "self_heal",
    ...lessonInput,
  });

  diagnoseRecurringFailureInBackground({
    patternKey: selfHealPatternKey(mismatch.kind),
    lessonId: lesson.id,
    occurrenceCount: lesson.occurrenceCount,
    situation: lessonInput.situation,
    takeaway: lessonInput.takeaway,
  });

  // Wait for the fire-and-forget promise chain to settle.
  await flushAsync();
  return lesson;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("self-heal pipeline: detectClaimedCheckWithoutToolCall triggers on the correct reply", () => {
  it("flags a reply that claims a check with no grounding tool calls", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: MISMATCH_REPLY,
      observations: PAGE_CONTEXT_ONLY_OBSERVATIONS,
    });
    expect(mismatch).not.toBeNull();
    expect(mismatch!.kind).toBe("claimed_check_without_tool_call");
  });

  it("does NOT flag a reply when a real read tool grounds the claim", () => {
    const mismatch = detectClaimedCheckWithoutToolCall({
      finalContent: MISMATCH_REPLY,
      observations: [
        ...PAGE_CONTEXT_ONLY_OBSERVATIONS,
        {
          callId: "call-1",
          stepId: null,
          toolName: "list_reminders",
          success: true as const,
          evidenceSummary: "0 reminders found",
          startedAt: "2026-08-14T10:00:00.000Z",
          completedAt: "2026-08-14T10:00:00.500Z",
        },
      ],
    });
    expect(mismatch).toBeNull();
  });
});

describe("self-heal pipeline: three mismatch-triggering turns produce a persisted suggestion", () => {
  it("after three identical mismatch shapes, a suggestion row is inserted and visible via listElaineCodeSuggestions", async () => {
    // ── Turn 1: first occurrence — no existing lesson, INSERT, below threshold ──
    // recordElaineLesson: dedup SELECT → no match → INSERT lesson (occurrenceCount=1)
    mockSelectLimit.mockResolvedValueOnce([]); // no existing lesson
    mockValuesReturning.mockResolvedValueOnce([
      { ...BASE_LESSON_ROW, occurrenceCount: 1 },
    ]);
    // diagnoseRecurringFailureInBackground: occurrenceCount 1 < threshold 3 → no-op

    const lesson1 = await runSelfHealTurn();
    expect(lesson1.occurrenceCount).toBe(1);
    // Background diagnosis must have exited before touching the model or DB
    // (threshold not yet reached)
    expect(mockCallModel).not.toHaveBeenCalled();
    expect(mockSuggestionReturning).not.toHaveBeenCalled();

    // ── Turn 2: second occurrence — UPDATE occurrenceCount to 2 ─────────────
    // recordElaineLesson: dedup SELECT → found → UPDATE (occurrenceCount=2)
    mockSelectLimit.mockResolvedValueOnce([{ id: 1, occurrenceCount: 1 }]);
    mockUpdateReturning.mockResolvedValueOnce([
      { ...BASE_LESSON_ROW, occurrenceCount: 2 },
    ]);
    // diagnoseRecurringFailureInBackground: occurrenceCount 2 < threshold 3 → no-op

    const lesson2 = await runSelfHealTurn();
    expect(lesson2.occurrenceCount).toBe(2);
    expect(mockCallModel).not.toHaveBeenCalled();
    expect(mockSuggestionReturning).not.toHaveBeenCalled();

    // ── Turn 3: third occurrence — UPDATE occurrenceCount to 3, threshold reached ─
    // recordElaineLesson: dedup SELECT → found → UPDATE (occurrenceCount=3)
    mockSelectLimit.mockResolvedValueOnce([{ id: 1, occurrenceCount: 2 }]);
    mockUpdateReturning.mockResolvedValueOnce([
      { ...BASE_LESSON_ROW, occurrenceCount: 3 },
    ]);
    // diagnoseRecurringFailureInBackground: occurrenceCount 3 = threshold 3 → fires
    //   hasPendingSuggestion SELECT → no pending suggestion
    mockSelectLimit.mockResolvedValueOnce([]);
    //   callModel → concrete hypothesis
    mockCallModel.mockResolvedValueOnce(MODEL_HYPOTHESIS_JSON);
    //   INSERT suggestion
    mockSuggestionReturning.mockResolvedValueOnce([BASE_SUGGESTION_ROW]);

    const lesson3 = await runSelfHealTurn();
    expect(lesson3.occurrenceCount).toBe(3);

    // The suggestion insert must have been triggered exactly once
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(mockSuggestionReturning).toHaveBeenCalledTimes(1);

    // ── Visibility via listElaineCodeSuggestions (backs GET /admin/…) ────────
    // listElaineCodeSuggestions uses db.select().from().where().orderBy() —
    // no .limit().  Build a thenable chain whose .orderBy() resolves to the
    // suggestion list so the function's `await query.where().orderBy()` works.
    const thenableChain: Record<string, unknown> = {};
    thenableChain.from = vi.fn(() => thenableChain);
    thenableChain.where = vi.fn(() => thenableChain);
    thenableChain.orderBy = vi
      .fn()
      .mockResolvedValueOnce([BASE_SUGGESTION_ROW]);
    thenableChain.limit = mockSelectLimit;
    vi.mocked(db.select).mockImplementationOnce(() => thenableChain as never);

    const suggestions = await listElaineCodeSuggestions("pending");
    expect(suggestions).toEqual([BASE_SUGGESTION_ROW]);
    expect(suggestions[0].patternKey).toBe(
      "self_heal:claimed_check_without_tool_call",
    );
    expect(suggestions[0].status).toBe("pending");
  });

  it("the first two turns do NOT trigger a diagnosis model call (below threshold)", async () => {
    // Turn 1
    mockSelectLimit.mockResolvedValueOnce([]);
    mockValuesReturning.mockResolvedValueOnce([
      { ...BASE_LESSON_ROW, occurrenceCount: 1 },
    ]);
    await runSelfHealTurn();

    // Turn 2
    mockSelectLimit.mockResolvedValueOnce([{ id: 1, occurrenceCount: 1 }]);
    mockUpdateReturning.mockResolvedValueOnce([
      { ...BASE_LESSON_ROW, occurrenceCount: 2 },
    ]);
    await runSelfHealTurn();

    // callModel must never have been invoked — threshold not yet reached
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("does not insert a second pending suggestion when one already exists (dedup guard)", async () => {
    // Simulate a state where occurrenceCount just reached 3 and a pending
    // suggestion already exists from a prior run in the same session.
    mockSelectLimit.mockResolvedValueOnce([{ id: 1, occurrenceCount: 2 }]); // lesson lookup
    mockUpdateReturning.mockResolvedValueOnce([
      { ...BASE_LESSON_ROW, occurrenceCount: 3 },
    ]);
    // hasPendingSuggestion → finds an existing pending suggestion → bail
    mockSelectLimit.mockResolvedValueOnce([{ id: 10 }]);

    await runSelfHealTurn();

    // Model must NOT have been called (dedup bailed before the model call)
    expect(mockCallModel).not.toHaveBeenCalled();
    expect(mockSuggestionReturning).not.toHaveBeenCalled();
  });
});

describe("self-heal pipeline: fire-and-forget error handling", () => {
  /**
   * Helper that calls diagnoseRecurringFailureInBackground directly (as
   * elaine/index.ts does) then flushes async so the background promise
   * settles before assertions run.
   */
  async function runBackgroundDiagnosis(occurrenceCount: number) {
    diagnoseRecurringFailureInBackground({
      patternKey: "self_heal:claimed_check_without_tool_call",
      lessonId: 1,
      occurrenceCount,
      situation: BASE_LESSON_ROW.situation,
      takeaway: BASE_LESSON_ROW.takeaway,
    });
    await flushAsync();
  }

  it("swallows a DB failure in hasPendingSuggestion and logs a warning — never throws", async () => {
    // occurrenceCount 3 ≥ threshold 3, so the diagnosis path fires.
    // hasPendingSuggestion SELECT rejects (simulating a DB connection error).
    mockSelectLimit.mockRejectedValueOnce(new Error("DB connection lost"));

    // Must not propagate — the fire-and-forget wrapper absorbs the error.
    await expect(runBackgroundDiagnosis(3)).resolves.toBeUndefined();

    // logger.warn must have been called with the error details.
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "DB connection lost" }),
        patternKey: "self_heal:claimed_check_without_tool_call",
      }),
      "elaine-code-diagnosis: background diagnosis failed",
    );

    // No suggestion row must have been inserted.
    expect(mockSuggestionReturning).not.toHaveBeenCalled();
  });

  it("swallows a model failure and logs a warning — never throws", async () => {
    // hasPendingSuggestion SELECT → no pending suggestion
    mockSelectLimit.mockResolvedValueOnce([]);
    // callModel rejects (simulating an OpenRouter timeout)
    mockCallModel.mockRejectedValueOnce(new Error("OpenRouter timeout"));

    await expect(runBackgroundDiagnosis(3)).resolves.toBeUndefined();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "OpenRouter timeout" }),
        patternKey: "self_heal:claimed_check_without_tool_call",
      }),
      "elaine-code-diagnosis: background diagnosis failed",
    );
    expect(mockSuggestionReturning).not.toHaveBeenCalled();
  });

  it("no-ops silently (no warning) when occurrenceCount is below the threshold", async () => {
    // occurrenceCount 2 < threshold 3 → returns null before any DB call
    await expect(runBackgroundDiagnosis(2)).resolves.toBeUndefined();

    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    expect(mockSelectLimit).not.toHaveBeenCalled();
    expect(mockCallModel).not.toHaveBeenCalled();
  });
});
