import type { ElainePlanStep, ElaineRuntimeTrace } from "./contracts";
import { SPECIALIZED_CURRENT_TOOL_NAMES } from "./model-tool-policy";
import { hasCurrentRetrievedEvidence } from "./source-policy";

export interface ElaineReplanToolSelection {
  toolName: string;
  replacesStepIds: string[];
  reason:
    | "unattempted_required_lookup"
    | "current_web_fallback"
    | "bounded_retry";
}

export interface ElaineSatisfiedFallbackAdjustment {
  replacementToolName: string;
  replacesStepIds: string[];
}

function dependenciesReady(
  step: ElainePlanStep,
  completedIds: ReadonlySet<string>,
): boolean {
  return step.dependsOn.every((dependency) => completedIds.has(dependency));
}

function isSafeRequiredRead(
  step: ElainePlanStep,
  availableToolNames: ReadonlySet<string>,
): step is ElainePlanStep & { toolName: string } {
  return (
    step.required &&
    step.riskClass === "read_only" &&
    step.confirmation === "none" &&
    ["lookup", "research"].includes(step.kind) &&
    typeof step.toolName === "string" &&
    availableToolNames.has(step.toolName)
  );
}

/**
 * Finds a successful current read that already replaced failed specialized
 * sources. The caller can adjust those failures before verification without
 * performing the successful fallback a second time.
 */
export function findElaineSatisfiedFallback(
  trace: ElaineRuntimeTrace,
): ElaineSatisfiedFallbackAdjustment | null {
  if (trace.sourceRoute?.requiresRetrievedEvidence !== true) return null;

  const successfulFallback = (trace.observations ?? []).find((observation) => {
    if (
      !observation.stepId ||
      !observation.success ||
      !observation.provenance ||
      !trace.sourceRoute?.fallbackKinds.includes(
        observation.provenance.sourceKind,
      ) ||
      !hasCurrentRetrievedEvidence([observation])
    ) {
      return false;
    }
    const step = trace.plan.steps.find(
      (candidate) => candidate.id === observation.stepId,
    );
    return (
      step?.status === "completed" &&
      step.riskClass === "read_only" &&
      step.confirmation === "none" &&
      ["lookup", "research"].includes(step.kind)
    );
  });
  if (!successfulFallback) return null;

  const replacesStepIds = trace.plan.steps
    .filter(
      (step) =>
        step.status === "failed" &&
        step.required &&
        step.riskClass === "read_only" &&
        step.confirmation === "none" &&
        ["lookup", "research"].includes(step.kind) &&
        typeof step.toolName === "string" &&
        step.toolName !== successfulFallback.toolName &&
        SPECIALIZED_CURRENT_TOOL_NAMES.has(step.toolName),
    )
    .map((step) => step.id);

  return replacesStepIds.length > 0
    ? {
        replacementToolName: successfulFallback.toolName,
        replacesStepIds,
      }
    : null;
}

/**
 * Selects at most one safe lookup for the next bounded model round. It never
 * chooses an action or confirmation step.
 */
export function selectElaineReplanTool(
  trace: ElaineRuntimeTrace,
  availableToolNames: ReadonlySet<string>,
): ElaineReplanToolSelection | null {
  const completedIds = new Set(
    trace.plan.steps
      .filter((step) => ["completed", "adjusted"].includes(step.status))
      .map((step) => step.id),
  );
  const safeReads = trace.plan.steps.filter(
    (step) =>
      isSafeRequiredRead(step, availableToolNames) &&
      dependenciesReady(step, completedIds),
  ) as Array<ElainePlanStep & { toolName: string }>;
  const failedReads = safeReads.filter((step) => step.status === "failed");
  const retryableFailedReads = failedReads.filter(
    (step) => step.attempts <= step.retryLimit,
  );
  const unattempted = safeReads.find(
    (step) =>
      ["planned", "blocked"].includes(step.status) && step.attempts === 0,
  );

  if (unattempted) {
    const replaced = failedReads.find(
      (step) => step.toolName !== unattempted.toolName,
    );
    return {
      toolName: unattempted.toolName,
      replacesStepIds: replaced ? [replaced.id] : [],
      reason: "unattempted_required_lookup",
    };
  }

  const failedSpecialized = failedReads.find((step) =>
    SPECIALIZED_CURRENT_TOOL_NAMES.has(step.toolName),
  );
  const webFallbackAllowed =
    trace.sourceRoute?.requiresRetrievedEvidence === true &&
    trace.sourceRoute.fallbackKinds.includes("web") &&
    availableToolNames.has("web_search");
  const webRetryExhausted = safeReads.some(
    (step) =>
      step.toolName === "web_search" &&
      step.status === "failed" &&
      step.attempts > step.retryLimit,
  );
  if (
    failedSpecialized &&
    failedSpecialized.toolName !== "web_search" &&
    webFallbackAllowed &&
    !webRetryExhausted
  ) {
    return {
      toolName: "web_search",
      replacesStepIds: [failedSpecialized.id],
      reason: "current_web_fallback",
    };
  }

  const retry = retryableFailedReads[0];
  if (retry) {
    return {
      toolName: retry.toolName,
      replacesStepIds: [],
      reason: "bounded_retry",
    };
  }

  const hasUnfinishedConsequentialStep = trace.plan.steps.some(
    (step) =>
      step.required &&
      step.riskClass === "consequential" &&
      !["completed", "adjusted", "waiting_confirmation"].includes(step.status),
  );
  if (
    webFallbackAllowed &&
    !hasUnfinishedConsequentialStep &&
    !webRetryExhausted
  ) {
    return {
      toolName: "web_search",
      replacesStepIds: [],
      reason: "current_web_fallback",
    };
  }

  return null;
}
