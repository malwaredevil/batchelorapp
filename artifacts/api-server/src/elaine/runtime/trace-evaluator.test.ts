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
});
