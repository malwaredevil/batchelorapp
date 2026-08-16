/**
 * Shared factory for `vi.mock("./runtime", ...)` in Elaine test files.
 *
 * Usage (no overrides — most tests):
 *
 *   import { buildRuntimeMock } from "./test-helpers/runtime-mock";
 *   vi.mock("./runtime", () => buildRuntimeMock());
 *
 * Usage (with test-specific overrides):
 *
 *   vi.mock("./runtime", () =>
 *     buildRuntimeMock({
 *       isReminderDoubtMessage: mockIsReminderDoubtMessage,
 *       MODEL_VISIBLE_HARD_TOOL_NAMES: new Set(["list_reminders"]),
 *     }),
 *   );
 *
 * Usage (when importOriginal is needed — e.g. to use the real implementation):
 *
 *   vi.mock("./runtime", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("./runtime")>();
 *     return buildRuntimeMock({
 *       generateElainePlan: actual.generateElainePlan,
 *     });
 *   });
 *
 * When a new export is added to the runtime module:
 *   1. Add the export key to RUNTIME_REQUIRED_EXPORTS in
 *      scripts/src/check-domain-composition.ts.
 *   2. Add the matching key+default-value to RUNTIME_MOCK_DEFAULTS below.
 *   That's the only two-file edit required — no per-test-file changes needed.
 */

import { vi } from "vitest";

/** All properties the factory can produce (and that callers can override). */
export interface RuntimeMockShape {
  assertElaineToolFamilyCoverage: unknown;
  aggregateElaineTraceEvaluations: unknown;
  buildClassifierDoubtLessonInput: unknown;
  buildElaineSourceRoute: unknown;
  buildSelfHealLessonInput: unknown;
  classifierDoubtPatternKey: unknown;
  classifyElaineRequest: unknown;
  completedActionAcknowledgement: unknown;
  createElaineTurnTrace: unknown;
  createFallbackPlan: unknown;
  decideElaineModelStreamRecovery: unknown;
  detectClaimedCheckWithoutToolCall: unknown;
  ELAINE_READ_CONCURRENCY: number;
  ElaineTurnRuntime: unknown;
  evaluateElaineTrace: unknown;
  evaluateForecastDateCoverage: unknown;
  findElaineSatisfiedFallback: unknown;
  finishElaineTurnTrace: unknown;
  generateElainePlan: unknown;
  isReminderDoubtMessage: unknown;
  isReusableElaineResponseState: unknown;
  isSchedulingDoubtMessage: unknown;
  loadElaineTurnTracesForMessages: unknown;
  mapWithConcurrency: unknown;
  MODEL_VISIBLE_HARD_TOOL_NAMES: Set<string>;
  MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS:
    | Map<string, string>
    | Record<string, string>;
  persistElaineTraceBestEffort: unknown;
  preparedActionAcknowledgement: unknown;
  provenanceForTool: unknown;
  requestNeedsStructuredPlan: unknown;
  sanitizeRuntimeText: unknown;
  selectElaineOpenAIRole: unknown;
  selectElaineReplanTool: unknown;
  selfHealPatternKey: unknown;
  stripElaineCitationMetadata: unknown;
}

/**
 * Canonical default values for every required runtime export.
 *
 * Exported as a plain named const so the check-domain-composition guardrail
 * can validate key presence against THIS object specifically, rather than the
 * full file source (which also includes the TypeScript interface above and
 * would produce false-positive matches).
 *
 * Key presence in this object is verified by RUNTIME_REQUIRED_EXPORTS in
 * scripts/src/check-domain-composition.ts — the guardrail catches drift.
 */
export const RUNTIME_MOCK_DEFAULTS: RuntimeMockShape = {
  assertElaineToolFamilyCoverage: vi.fn(),
  aggregateElaineTraceEvaluations: vi.fn().mockReturnValue([]),
  buildClassifierDoubtLessonInput: vi.fn().mockReturnValue({
    outcome: "mistake",
    domain: "general",
    situation: "mock situation",
    takeaway: "mock takeaway",
    tags: ["classifier-doubt"],
  }),
  buildElaineSourceRoute: vi.fn().mockReturnValue({
    preferredKinds: [],
    fallbackKinds: [],
    sourceKind: "direct",
    sourceName: "current page context",
    confidence: "high",
  }),
  buildSelfHealLessonInput: vi.fn(),
  classifierDoubtPatternKey: vi.fn().mockReturnValue("classifier_doubt:mock"),
  classifyElaineRequest: vi.fn().mockReturnValue({
    type: "conversational",
    scope: "none",
    intent: "chat",
  }),
  completedActionAcknowledgement: vi.fn().mockReturnValue(""),
  createElaineTurnTrace: vi.fn().mockResolvedValue({ id: 1 }),
  createFallbackPlan: vi.fn().mockReturnValue({
    goal: "Answer the user",
    steps: [],
    assumptions: [],
    completionCriteria: ["User receives a helpful reply"],
  }),
  decideElaineModelStreamRecovery: vi.fn().mockReturnValue({
    retry: false,
    suppressTools: false,
    resetPartialContent: false,
  }),
  detectClaimedCheckWithoutToolCall: vi.fn().mockReturnValue(null),
  ELAINE_READ_CONCURRENCY: 3,
  ElaineTurnRuntime: class {
    registerToolCalls = vi.fn();
    recordModelRound = vi.fn().mockReturnValue(true);
    snapshot = vi.fn();
    verify = vi.fn();
    complete = vi.fn();
    setTraceAvailable = vi.fn();
    markFailedReadStepsAdjusted = vi.fn();
    recordObservation = vi.fn();
    getBudgetStatus = vi.fn().mockReturnValue({
      exhausted: false,
      hitLimits: [],
      usage: { modelRounds: 0, toolCalls: 0, replans: 0, elapsedMs: 0 },
      budget: {
        maxModelRounds: 4,
        maxToolCalls: 16,
        maxReplans: 2,
        maxElapsedMs: 120_000,
      },
    });
  },
  evaluateElaineTrace: vi.fn().mockResolvedValue({}),
  evaluateForecastDateCoverage: vi.fn().mockResolvedValue({}),
  findElaineSatisfiedFallback: vi.fn().mockReturnValue(null),
  finishElaineTurnTrace: vi.fn().mockResolvedValue(undefined),
  generateElainePlan: vi.fn().mockResolvedValue({
    plan: {
      goal: "Answer the user",
      steps: [],
      assumptions: [],
      completionCriteria: ["User receives a helpful reply"],
    },
    source: "generated",
  }),
  isReminderDoubtMessage: vi.fn().mockReturnValue(false),
  isReusableElaineResponseState: vi.fn().mockReturnValue(false),
  isSchedulingDoubtMessage: vi.fn().mockReturnValue(false),
  loadElaineTurnTracesForMessages: vi.fn().mockResolvedValue(new Map()),
  mapWithConcurrency: vi
    .fn()
    .mockImplementation(
      async <T>(
        items: T[],
        _concurrency: number,
        fn: (item: T) => Promise<unknown>,
      ) => Promise.all(items.map(fn)),
    ),
  MODEL_VISIBLE_HARD_TOOL_NAMES: new Set<string>(),
  MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: new Map<string, string>(),
  persistElaineTraceBestEffort: vi.fn().mockResolvedValue(false),
  preparedActionAcknowledgement: vi.fn().mockReturnValue(""),
  provenanceForTool: vi.fn().mockReturnValue(null),
  requestNeedsStructuredPlan: vi.fn().mockReturnValue(false),
  sanitizeRuntimeText: vi.fn().mockImplementation((t: string) => t),
  selectElaineOpenAIRole: vi.fn().mockReturnValue("assistant"),
  selectElaineReplanTool: vi.fn().mockReturnValue(null),
  selfHealPatternKey: vi
    .fn()
    .mockImplementation((kind: string) => `self_heal:${kind}`),
  stripElaineCitationMetadata: vi.fn().mockImplementation((t: string) => t),
};

/**
 * Returns the canonical runtime mock object, with optional per-test overrides
 * spread on top.
 *
 * Key presence in RUNTIME_MOCK_DEFAULTS is verified by the guardrail in
 * scripts/src/check-domain-composition.ts.
 */
export function buildRuntimeMock(
  overrides?: Partial<RuntimeMockShape> & Record<string, unknown>,
): RuntimeMockShape & Record<string, unknown> {
  return { ...RUNTIME_MOCK_DEFAULTS, ...overrides };
}
