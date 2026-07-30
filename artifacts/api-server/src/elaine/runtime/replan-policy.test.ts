import { describe, expect, it } from "vitest";
import { toRuntimePlan, type ElaineRuntimeTrace } from "./contracts";
import {
  findElaineSatisfiedFallback,
  selectElaineReplanTool,
} from "./replan-policy";
import { provenanceForTool } from "./source-policy";

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

describe("findElaineSatisfiedFallback", () => {
  it("reuses a successful current web fallback for a failed specialized source", () => {
    const trace = traceWith([
      {
        id: "provider",
        label: "Check eBay",
        kind: "research",
        toolName: "ebay_search",
        dependsOn: [],
        expectedEvidence: "Current sold listings",
        required: true,
      },
      {
        id: "fallback",
        label: "Search the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "Current market evidence",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[0]!.attempts = 1;
    trace.plan.steps[1]!.status = "completed";
    trace.plan.steps[1]!.attempts = 1;
    trace.observations = [
      {
        callId: "web-call",
        stepId: "fallback",
        toolName: "web_search",
        success: true,
        evidenceSummary: "Current web results were returned",
        provenance: provenanceForTool({
          toolName: "web_search",
          coverageStatus: "matched",
        }),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    expect(findElaineSatisfiedFallback(trace)).toEqual({
      replacementToolName: "web_search",
      replacesStepIds: ["provider"],
    });
  });

  it("does not reuse a failed fallback or a same-tool retry", () => {
    const failed = traceWith([
      {
        id: "provider",
        label: "Check eBay",
        kind: "research",
        toolName: "ebay_search",
        dependsOn: [],
        expectedEvidence: "Current sold listings",
        required: true,
      },
      {
        id: "fallback",
        label: "Search the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "Current market evidence",
        required: true,
      },
    ]);
    failed.plan.steps[0]!.status = "failed";
    failed.plan.steps[1]!.status = "failed";
    failed.observations = [
      {
        callId: "web-call",
        stepId: "fallback",
        toolName: "web_search",
        success: false,
        evidenceSummary: "Web search failed",
        provenance: provenanceForTool({
          toolName: "web_search",
          coverageStatus: "unknown",
        }),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];
    expect(findElaineSatisfiedFallback(failed)).toBeNull();

    const sameTool = traceWith([
      {
        id: "first",
        label: "Search the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "Current market evidence",
        required: true,
      },
      {
        id: "retry",
        label: "Retry the web",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "Current market evidence",
        required: true,
      },
    ]);
    sameTool.plan.steps[0]!.status = "failed";
    sameTool.plan.steps[1]!.status = "completed";
    sameTool.observations = [
      {
        callId: "web-retry",
        stepId: "retry",
        toolName: "web_search",
        success: true,
        evidenceSummary: "Current web results were returned",
        provenance: provenanceForTool({
          toolName: "web_search",
          coverageStatus: "matched",
        }),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];
    expect(findElaineSatisfiedFallback(sameTool)).toBeNull();
  });

  it("does not treat another specialized provider as the configured fallback", () => {
    const trace = traceWith([
      {
        id: "failed-provider",
        label: "Check eBay",
        kind: "research",
        toolName: "ebay_search",
        dependsOn: [],
        expectedEvidence: "Current sold listings",
        required: true,
      },
      {
        id: "successful-provider",
        label: "Check exchange rates",
        kind: "lookup",
        toolName: "get_exchange_rate",
        dependsOn: [],
        expectedEvidence: "A current exchange rate",
        required: true,
      },
    ]);
    trace.plan.steps[0]!.status = "failed";
    trace.plan.steps[1]!.status = "completed";
    trace.observations = [
      {
        callId: "rate-call",
        stepId: "successful-provider",
        toolName: "get_exchange_rate",
        success: true,
        evidenceSummary: "A current exchange rate was returned",
        provenance: provenanceForTool({
          toolName: "get_exchange_rate",
          coverageStatus: "matched",
        }),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];

    expect(findElaineSatisfiedFallback(trace)).toBeNull();
  });
});
