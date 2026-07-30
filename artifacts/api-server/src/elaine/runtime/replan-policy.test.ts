import { describe, expect, it } from "vitest";
import { toRuntimePlan, type ElaineRuntimeTrace } from "./contracts";
import { selectElaineReplanTool } from "./replan-policy";

const available = new Set([
  "web_search",
  "ebay_search",
  "fetch_page",
  "get_exchange_rate",
]);

function traceWith(
  steps: Parameters<typeof toRuntimePlan>[0]["steps"],
): ElaineRuntimeTrace {
  return {
    version: 1,
    traceId: "trace-replan",
    requestClass: {
      kind: "research",
      complexity: "multi_step",
      requiresFreshData: true,
      hasAttachment: false,
    },
    goal: "Find current evidence",
    plan: toRuntimePlan({
      version: 1,
      goal: "Find current evidence",
      assumptions: [],
      completionCriteria: ["Current evidence is available"],
      steps,
    }),
    sourceRoute: {
      freshness: "current",
      requiresRetrievedEvidence: true,
      preferredKinds: ["specialized_api", "web"],
      fallbackKinds: ["web", "model_synthesis"],
      rationale: "Use a live source",
    },
    observations: [],
    events: [],
    verification: null,
    status: "running",
    traceAvailable: true,
    startedAt: new Date().toISOString(),
    completedAt: null,
    usage: { modelRounds: 2, toolCalls: 2, replans: 1, elapsedMs: 100 },
  };
}

describe("selectElaineReplanTool", () => {
  it("prefers an unattempted required lookup and replaces one failed source", () => {
    const trace = traceWith([
      {
        id: "market",
        label: "Check the market provider",
        kind: "research",
        toolName: "ebay_search",
        dependsOn: [],
        expectedEvidence: "Current sold listings",
        required: true,
      },
      {
        id: "page",
        label: "Read an independent source",
        kind: "research",
        toolName: "fetch_page",
        dependsOn: [],
        expectedEvidence: "Independent current evidence",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 1;

    expect(selectElaineReplanTool(trace, available)).toEqual({
      toolName: "fetch_page",
      replacesStepIds: ["market"],
      reason: "unattempted_required_lookup",
    });
  });

  it("falls back to web after a specialized provider failure", () => {
    const trace = traceWith([
      {
        id: "rate",
        label: "Check the exchange-rate provider",
        kind: "lookup",
        toolName: "get_exchange_rate",
        dependsOn: [],
        expectedEvidence: "A current exchange rate",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 1;

    expect(selectElaineReplanTool(trace, available)).toEqual({
      toolName: "web_search",
      replacesStepIds: ["rate"],
      reason: "current_web_fallback",
    });
  });

  it("replaces an exhausted specialized provider with an unattempted fallback", () => {
    const trace = traceWith([
      {
        id: "provider",
        label: "Check the specialized provider",
        kind: "research",
        toolName: "ebay_search",
        dependsOn: [],
        expectedEvidence: "Current specialized evidence",
        required: true,
      },
      {
        id: "fallback",
        label: "Read a fallback source",
        kind: "research",
        toolName: "fetch_page",
        dependsOn: [],
        expectedEvidence: "Current fallback evidence",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 2;

    expect(selectElaineReplanTool(trace, available)).toEqual({
      toolName: "fetch_page",
      replacesStepIds: ["provider"],
      reason: "unattempted_required_lookup",
    });
  });

  it("retries a failed web lookup without replacing it", () => {
    const trace = traceWith([
      {
        id: "web",
        label: "Search the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "A current web source",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 1;

    expect(selectElaineReplanTool(trace, available)).toEqual({
      toolName: "web_search",
      replacesStepIds: [],
      reason: "bounded_retry",
    });
  });

  it("does not retry a failed web lookup after its retry budget is exhausted", () => {
    const trace = traceWith([
      {
        id: "web",
        label: "Search the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "A current web source",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 2;

    expect(selectElaineReplanTool(trace, available)).toBeNull();
  });

  it("does not force web again when a specialized source and web fallback both failed", () => {
    const trace = traceWith([
      {
        id: "provider",
        label: "Check the specialized provider",
        kind: "research",
        toolName: "ebay_search",
        dependsOn: [],
        expectedEvidence: "Current specialized evidence",
        required: true,
      },
      {
        id: "web",
        label: "Search the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "Current web evidence",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 2;
    trace.plan.steps[1]!.status = "failed";
    trace.plan.steps[1]!.attempts = 2;

    expect(selectElaineReplanTool(trace, available)).toBeNull();
  });

  it("never forces actions, confirmation steps, or response-only steps", () => {
    const trace = traceWith([
      {
        id: "action",
        label: "Update the trip",
        kind: "action",
        toolName: "update_trip",
        dependsOn: [],
        expectedEvidence: "A confirmed update",
        required: true,
      },
      {
        id: "respond",
        label: "Respond",
        kind: "respond",
        toolName: null,
        dependsOn: [],
        expectedEvidence: "A response",
        required: true,
      },
    ]);

    expect(selectElaineReplanTool(trace, available)).toBeNull();
  });

  it("does not select a lookup whose dependencies are unfinished", () => {
    const trace = traceWith([
      {
        id: "first",
        label: "Find a URL",
        kind: "lookup",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "A URL",
        required: true,
      },
      {
        id: "page",
        label: "Read the URL",
        kind: "research",
        toolName: "fetch_page",
        dependsOn: ["first"],
        expectedEvidence: "Page evidence",
        required: true,
      },
    ]);

    expect(selectElaineReplanTool(trace, available)?.toolName).toBe(
      "web_search",
    );
  });
});
