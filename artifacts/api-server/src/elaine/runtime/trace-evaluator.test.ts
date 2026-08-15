import { describe, expect, it } from "vitest";
import {
  aggregateElaineTraceEvaluations,
  evaluateElaineTrace,
  type ElaineTraceEvaluationInput,
} from "./trace-evaluator";

function inventedTrace(
  overrides: Partial<ElaineTraceEvaluationInput> = {},
): ElaineTraceEvaluationInput {
  return {
    status: "completed",
    plan: {
      version: 1,
      goal: "Check an invented household item",
      assumptions: [],
      completionCriteria: ["Return a grounded result"],
      steps: [
        {
          id: "lookup",
          label: "Look up the invented item",
          kind: "lookup",
          toolName: "read_app_operation",
          dependsOn: [],
          expectedEvidence: "An invented API result",
          required: true,
          riskClass: "read_only",
          confirmation: "none",
          retryLimit: 1,
          status: "completed",
          attempts: 1,
        },
      ],
    },
    observations: [
      {
        callId: "invented-call",
        stepId: "lookup",
        toolName: "read_app_operation",
        success: true,
        evidenceSummary: "Invented result returned",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.100Z",
      },
    ],
    verification: {
      status: "satisfied",
      satisfiedCriteria: ["Return a grounded result"],
      unsatisfiedCriteria: [],
      summary: "Plan criteria satisfied",
    },
    usage: {
      modelRounds: 2,
      toolCalls: 1,
      replans: 0,
      elapsedMs: 1_000,
    },
    ...overrides,
  };
}

describe("Elaine trace-driven evaluation", () => {
  it("grades a completed, verified, efficient trace as healthy", () => {
    expect(evaluateElaineTrace(inventedTrace())).toMatchObject({
      grade: "healthy",
      qualityScore: 1,
      requiredStepCompletionRate: 1,
      observationSuccessRate: 1,
      toolEfficiencyRate: 1,
      elapsedMs: 1_000,
      budgetPressure: false,
    });
  });

  it("flags failed evidence and exhausted budgets for review", () => {
    const trace = inventedTrace({
      status: "blocked",
      observations: [
        {
          ...inventedTrace().observations[0]!,
          success: false,
          errorCategory: "provider_unavailable",
        },
      ],
      verification: {
        status: "blocked",
        satisfiedCriteria: [],
        unsatisfiedCriteria: ["Return a grounded result"],
        summary: "Evidence unavailable",
      },
      usage: {
        modelRounds: 4,
        toolCalls: 16,
        replans: 2,
        elapsedMs: 120_000,
      },
    });
    trace.plan.steps[0]!.status = "failed";

    expect(evaluateElaineTrace(trace)).toMatchObject({
      grade: "needs_review",
      failedOrBlockedSteps: 1,
      usedReplan: true,
      budgetPressure: true,
    });
  });

  it("returns privacy-safe aggregate rates without trace content", () => {
    const aggregate = aggregateElaineTraceEvaluations([
      evaluateElaineTrace(inventedTrace()),
      evaluateElaineTrace(inventedTrace({ status: "failed" })),
    ]);

    expect(aggregate).toMatchObject({
      evaluatedTurns: 2,
      healthyTurns: 1,
      failedTurns: 1,
      averageElapsedMs: 1_000,
    });
    expect(JSON.stringify(aggregate)).not.toMatch(
      /invented household item|prompt|message|payload/i,
    );
  });

  it("reports no multi-path fields when no planSelection", () => {
    const result = evaluateElaineTrace(inventedTrace());
    expect(result.usedMultiPathPlanning).toBe(false);
    expect(result.multiPathChoiceKnown).toBe(false);
    expect(result.nonDefaultPlanChosen).toBe(false);
  });

  it("reports nonDefaultPlanChosen=false when the first candidate was chosen (chosenIndex=0)", () => {
    const trace = inventedTrace();
    trace.plan.planSelection = {
      chosenApproach: "Look up first",
      alternativeApproaches: ["Answer directly"],
      reason: "More reliable",
      chosenIndex: 0,
    };
    const result = evaluateElaineTrace(trace);
    expect(result.usedMultiPathPlanning).toBe(true);
    expect(result.multiPathChoiceKnown).toBe(true);
    expect(result.nonDefaultPlanChosen).toBe(false);
  });

  it("reports nonDefaultPlanChosen=true when a later candidate was chosen (chosenIndex>0)", () => {
    const trace = inventedTrace();
    trace.plan.planSelection = {
      chosenApproach: "Research first",
      alternativeApproaches: ["Answer directly"],
      reason: "Prevents an unsupported claim",
      chosenIndex: 1,
    };
    const result = evaluateElaineTrace(trace);
    expect(result.usedMultiPathPlanning).toBe(true);
    expect(result.multiPathChoiceKnown).toBe(true);
    expect(result.nonDefaultPlanChosen).toBe(true);
  });

  it("treats a legacy planSelection without chosenIndex as unknown — not index 0", () => {
    const trace = inventedTrace();
    // Simulate a trace written before chosenIndex was added
    trace.plan.planSelection = {
      chosenApproach: "Look up first",
      alternativeApproaches: ["Answer directly"],
      reason: "Older trace",
      // chosenIndex intentionally absent
    };
    const result = evaluateElaineTrace(trace);
    expect(result.usedMultiPathPlanning).toBe(true);
    // Known=false: must be excluded from the rate denominator
    expect(result.multiPathChoiceKnown).toBe(false);
    expect(result.nonDefaultPlanChosen).toBe(false);
  });

  it("returns nonDefaultPlanChosenRate=null when no turn used multi-path planning", () => {
    const aggregate = aggregateElaineTraceEvaluations([
      evaluateElaineTrace(inventedTrace()),
      evaluateElaineTrace(inventedTrace({ status: "failed" })),
    ]);
    expect(aggregate.turnsWithMultiPathPlanning).toBe(0);
    expect(aggregate.turnsWithKnownPlanChoice).toBe(0);
    expect(aggregate.turnsWithNonDefaultPlanChosen).toBe(0);
    expect(aggregate.nonDefaultPlanChosenRate).toBeNull();
  });

  it("returns nonDefaultPlanChosenRate=null when only legacy multi-path traces exist", () => {
    const legacyTrace = inventedTrace();
    legacyTrace.plan.planSelection = {
      chosenApproach: "Look up first",
      alternativeApproaches: ["Answer directly"],
      reason: "Older trace",
      // no chosenIndex
    };
    const aggregate = aggregateElaineTraceEvaluations([
      evaluateElaineTrace(legacyTrace),
    ]);
    // Legacy traces count toward turnsWithMultiPathPlanning but NOT turnsWithKnownPlanChoice
    expect(aggregate.turnsWithMultiPathPlanning).toBe(1);
    expect(aggregate.turnsWithKnownPlanChoice).toBe(0);
    expect(aggregate.nonDefaultPlanChosenRate).toBeNull();
  });

  it("computes nonDefaultPlanChosenRate using only known-choice turns as denominator", () => {
    const defaultChoice = inventedTrace();
    defaultChoice.plan.planSelection = {
      chosenApproach: "First",
      alternativeApproaches: ["Second"],
      reason: "Fine",
      chosenIndex: 0,
    };
    const nonDefaultChoice = inventedTrace();
    nonDefaultChoice.plan.planSelection = {
      chosenApproach: "Second",
      alternativeApproaches: ["First"],
      reason: "Better",
      chosenIndex: 1,
    };
    const legacyMultiPath = inventedTrace();
    legacyMultiPath.plan.planSelection = {
      chosenApproach: "Legacy approach",
      alternativeApproaches: ["Other"],
      reason: "Old trace, no chosenIndex",
    };
    const noComparison = inventedTrace();

    const aggregate = aggregateElaineTraceEvaluations([
      evaluateElaineTrace(defaultChoice),
      evaluateElaineTrace(nonDefaultChoice),
      evaluateElaineTrace(legacyMultiPath),
      evaluateElaineTrace(noComparison),
    ]);

    // 3 multi-path turns total (2 new + 1 legacy), but only 2 have a known choice
    expect(aggregate.turnsWithMultiPathPlanning).toBe(3);
    expect(aggregate.turnsWithKnownPlanChoice).toBe(2);
    expect(aggregate.turnsWithNonDefaultPlanChosen).toBe(1);
    // Rate = 1/2 = 0.5 — legacy trace does NOT pull this toward 0
    expect(aggregate.nonDefaultPlanChosenRate).toBe(0.5);
  });
});
