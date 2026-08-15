import type {
  ElaineObservation,
  ElainePlan,
  ElaineRuntimeUsage,
  ElaineTerminalStatus,
  ElaineVerification,
} from "./contracts";

export interface ElaineTraceEvaluationInput {
  status: ElaineTerminalStatus;
  plan: ElainePlan;
  observations: ElaineObservation[];
  verification: ElaineVerification | null;
  usage: ElaineRuntimeUsage;
}

export interface ElaineTraceEvaluation {
  grade: "healthy" | "needs_review" | "failed";
  qualityScore: number;
  requiredStepCompletionRate: number;
  observationSuccessRate: number;
  toolEfficiencyRate: number;
  elapsedMs: number;
  failedOrBlockedSteps: number;
  repeatedConsequentialSteps: number;
  usedReplan: boolean;
  budgetPressure: boolean;
  /** True when this turn went through multi-path planning (planSelection present). */
  usedMultiPathPlanning: boolean;
  /**
   * True when multi-path planning was used AND the planSelection includes a
   * persisted `chosenIndex` (i.e. a trace written after the field was added).
   * Legacy traces without `chosenIndex` are counted in `usedMultiPathPlanning`
   * but NOT in this flag — they must be excluded from the rate denominator to
   * avoid biasing the measurement.
   */
  multiPathChoiceKnown: boolean;
  /**
   * True when `multiPathChoiceKnown` is true AND the model chose a candidate
   * other than the first one (chosenIndex > 0). Always false when
   * `multiPathChoiceKnown` is false.
   */
  nonDefaultPlanChosen: boolean;
}

export interface ElaineTraceEvaluationAggregate {
  evaluatedTurns: number;
  healthyTurns: number;
  needsReviewTurns: number;
  failedTurns: number;
  averageQualityScore: number;
  averageRequiredStepCompletionRate: number;
  averageObservationSuccessRate: number;
  averageToolEfficiencyRate: number;
  averageElapsedMs: number;
  turnsWithReplans: number;
  turnsUnderBudgetPressure: number;
  turnsWithRepeatedConsequentialSteps: number;
  /**
   * How many turns used multi-path planning (planSelection present). Includes
   * legacy traces that pre-date the `chosenIndex` field.
   */
  turnsWithMultiPathPlanning: number;
  /**
   * Subset of `turnsWithMultiPathPlanning` where `chosenIndex` was persisted
   * (traces written after the field was added). Only these contribute to the
   * rate — legacy traces are counted here to surface their presence without
   * biasing the measurement.
   */
  turnsWithKnownPlanChoice: number;
  /**
   * Among `turnsWithKnownPlanChoice` turns, how many resulted in the model
   * selecting a candidate other than the first one (chosenIndex > 0). A high
   * rate justifies the added token cost; a rate near zero suggests the
   * comparison step is pure overhead.
   */
  turnsWithNonDefaultPlanChosen: number;
  /**
   * turnsWithNonDefaultPlanChosen / turnsWithKnownPlanChoice, or null when
   * no turns with a known choice exist in the window (avoids a misleading
   * 0.0 that would conflate "never ran" with "always picked first").
   */
  nonDefaultPlanChosenRate: number | null;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function evaluateElaineTrace(
  trace: ElaineTraceEvaluationInput,
): ElaineTraceEvaluation {
  const steps = Array.isArray(trace.plan?.steps) ? trace.plan.steps : [];
  const observations = Array.isArray(trace.observations)
    ? trace.observations
    : [];
  const requiredSteps = steps.filter((step) => step.required);
  const completedRequiredSteps = requiredSteps.filter((step) =>
    ["completed", "adjusted", "waiting_confirmation", "waiting_input"].includes(
      step.status,
    ),
  );
  const failedOrBlockedSteps = requiredSteps.filter((step) =>
    ["failed", "blocked", "cancelled"].includes(step.status),
  ).length;
  const successfulObservations = observations.filter(
    (observation) => observation.success,
  ).length;
  const requiredStepCompletionRate = rate(
    completedRequiredSteps.length,
    requiredSteps.length,
  );
  const observationSuccessRate = rate(
    successfulObservations,
    observations.length,
  );
  const toolEfficiencyRate = Math.min(
    1,
    rate(successfulObservations, Math.max(1, trace.usage.toolCalls)),
  );
  const repeatedConsequentialSteps = steps.filter(
    (step) => step.kind === "action" && step.attempts > 1,
  ).length;
  const budgetPressure =
    trace.usage.modelRounds >= 4 ||
    trace.usage.toolCalls >= 16 ||
    trace.usage.replans >= 2 ||
    trace.usage.elapsedMs >= 120_000;
  const terminalSuccess = [
    "completed",
    "awaiting_confirmation",
    "awaiting_input",
  ].includes(trace.status);
  const verificationSuccess = [
    "satisfied",
    "awaiting_confirmation",
    "awaiting_input",
  ].includes(trace.verification?.status ?? "");

  const qualityScore = round(
    (terminalSuccess ? 0.3 : 0) +
      requiredStepCompletionRate * 0.25 +
      observationSuccessRate * 0.2 +
      (verificationSuccess ? 0.15 : 0) +
      (!budgetPressure ? 0.1 : 0),
  );
  const grade: ElaineTraceEvaluation["grade"] =
    trace.status === "failed"
      ? "failed"
      : qualityScore >= 0.8 &&
          failedOrBlockedSteps === 0 &&
          repeatedConsequentialSteps === 0
        ? "healthy"
        : "needs_review";

  const planSelection = trace.plan?.planSelection;
  const usedMultiPathPlanning = planSelection !== undefined;
  // `chosenIndex` is only present on traces written after the field was added.
  // Legacy traces have `planSelection` but no `chosenIndex` — they must be
  // excluded from the rate denominator rather than counted as index 0.
  const multiPathChoiceKnown =
    usedMultiPathPlanning && typeof planSelection.chosenIndex === "number";
  const nonDefaultPlanChosen =
    multiPathChoiceKnown && (planSelection!.chosenIndex as number) > 0;

  return {
    grade,
    qualityScore,
    requiredStepCompletionRate: round(requiredStepCompletionRate),
    observationSuccessRate: round(observationSuccessRate),
    toolEfficiencyRate: round(toolEfficiencyRate),
    elapsedMs: Math.max(0, Math.round(trace.usage.elapsedMs)),
    failedOrBlockedSteps,
    repeatedConsequentialSteps,
    usedReplan: trace.usage.replans > 0,
    budgetPressure,
    usedMultiPathPlanning,
    multiPathChoiceKnown,
    nonDefaultPlanChosen,
  };
}

export function aggregateElaineTraceEvaluations(
  evaluations: readonly ElaineTraceEvaluation[],
): ElaineTraceEvaluationAggregate {
  const total = evaluations.length;
  const average = (select: (value: ElaineTraceEvaluation) => number) =>
    round(
      total === 0
        ? 0
        : evaluations.reduce((sum, value) => sum + select(value), 0) / total,
    );
  const turnsWithMultiPathPlanning = evaluations.filter(
    ({ usedMultiPathPlanning }) => usedMultiPathPlanning,
  ).length;
  // Only traces that persisted chosenIndex count toward the rate denominator;
  // legacy traces are surfaced via turnsWithMultiPathPlanning but excluded
  // here to avoid biasing the measurement toward "always picked first".
  const turnsWithKnownPlanChoice = evaluations.filter(
    ({ multiPathChoiceKnown }) => multiPathChoiceKnown,
  ).length;
  const turnsWithNonDefaultPlanChosen = evaluations.filter(
    ({ nonDefaultPlanChosen }) => nonDefaultPlanChosen,
  ).length;
  return {
    evaluatedTurns: total,
    healthyTurns: evaluations.filter(({ grade }) => grade === "healthy").length,
    needsReviewTurns: evaluations.filter(
      ({ grade }) => grade === "needs_review",
    ).length,
    failedTurns: evaluations.filter(({ grade }) => grade === "failed").length,
    averageQualityScore: average(({ qualityScore }) => qualityScore),
    averageRequiredStepCompletionRate: average(
      ({ requiredStepCompletionRate }) => requiredStepCompletionRate,
    ),
    averageObservationSuccessRate: average(
      ({ observationSuccessRate }) => observationSuccessRate,
    ),
    averageToolEfficiencyRate: average(
      ({ toolEfficiencyRate }) => toolEfficiencyRate,
    ),
    averageElapsedMs: average(({ elapsedMs }) => elapsedMs),
    turnsWithReplans: evaluations.filter(({ usedReplan }) => usedReplan).length,
    turnsUnderBudgetPressure: evaluations.filter(
      ({ budgetPressure }) => budgetPressure,
    ).length,
    turnsWithRepeatedConsequentialSteps: evaluations.filter(
      ({ repeatedConsequentialSteps }) => repeatedConsequentialSteps > 0,
    ).length,
    turnsWithMultiPathPlanning,
    turnsWithKnownPlanChoice,
    turnsWithNonDefaultPlanChosen,
    nonDefaultPlanChosenRate:
      turnsWithKnownPlanChoice === 0
        ? null
        : round(turnsWithNonDefaultPlanChosen / turnsWithKnownPlanChoice),
  };
}
