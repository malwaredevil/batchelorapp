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
  };
}
