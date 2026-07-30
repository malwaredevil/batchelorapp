import { describe, expect, it } from "vitest";
import { toRuntimePlan } from "./contracts";
import { provenanceForTool } from "./source-policy";
import { ElaineTurnRuntime } from "./turn-runtime";

const requestClass = {
  kind: "research" as const,
  complexity: "multi_step" as const,
  requiresFreshData: true,
  hasAttachment: false,
};

function tripWeatherPlan() {
  return toRuntimePlan({
    version: 1,
    goal: "Answer the trip weather question",
    assumptions: [],
    completionCriteria: ["Trip dates and applicable weather are explicit"],
    steps: [
      {
        id: "trip",
        label: "Find the trip",
        kind: "lookup",
        toolName: "search_household_data",
        dependsOn: [],
        expectedEvidence: "Destination and dates",
        required: true,
      },
      {
        id: "weather",
        label: "Check weather coverage",
        kind: "research",
        toolName: "get_weather_forecast",
        dependsOn: ["trip"],
        expectedEvidence: "Weather coverage matches the requested dates",
        required: true,
      },
      {
        id: "answer",
        label: "Explain the result",
        kind: "respond",
        toolName: null,
        dependsOn: ["weather"],
        expectedEvidence: "A clear answer",
        required: true,
      },
    ],
  });
}

describe("ElaineTurnRuntime", () => {
  it("blocks a dependent tool until its prerequisite completes", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-1",
      requestClass,
      plan: tripWeatherPlan(),
    });
    runtime.recordModelRound();
    const scheduled = runtime.registerToolCalls([
      { id: "weather-call", name: "get_weather_forecast" },
      { id: "trip-call", name: "search_household_data" },
    ]);
    expect(scheduled[0]).toMatchObject({
      allowed: false,
      stepId: "weather",
    });
    expect(scheduled[1]).toMatchObject({ allowed: true, stepId: "trip" });
  });

  it("allows the dependent tool after a successful observation", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-2",
      requestClass,
      plan: tripWeatherPlan(),
    });
    runtime.recordModelRound();
    runtime.registerToolCalls([
      { id: "trip-call", name: "search_household_data" },
    ]);
    runtime.recordObservation({
      callId: "trip-call",
      toolName: "search_household_data",
      success: true,
      summary: "Found Sicily, 2026-08-05 through 2026-08-08",
    });
    const [weather] = runtime.registerToolCalls([
      { id: "weather-call", name: "get_weather_forecast" },
    ]);
    expect(weather).toMatchObject({ allowed: true, stepId: "weather" });
  });

  it("requests a bounded re-plan when evidence is incomplete", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-3",
      requestClass,
      plan: tripWeatherPlan(),
      budget: { maxReplans: 1 },
    });
    runtime.recordModelRound();
    runtime.registerToolCalls([
      { id: "trip-call", name: "search_household_data" },
    ]);
    runtime.recordObservation({
      callId: "trip-call",
      toolName: "search_household_data",
      success: false,
      summary: "No matching trip was found",
      errorCategory: "not_found",
    });
    const first = runtime.verify({
      finalContent: "I could not find it.",
      hasPendingConfirmation: false,
    });
    expect(first.shouldReplan).toBe(true);
    runtime.recordModelRound();
    const second = runtime.verify({
      finalContent: "Which trip did you mean?",
      hasPendingConfirmation: false,
    });
    expect(second.shouldReplan).toBe(false);
    expect(second.verification.status).toBe("blocked");
  });

  it("preserves completed work across a bounded re-plan", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-preserve",
      requestClass,
      plan: tripWeatherPlan(),
      budget: { maxReplans: 1 },
    });
    runtime.recordModelRound();
    runtime.registerToolCalls([
      { id: "trip-call", name: "search_household_data" },
    ]);
    runtime.recordObservation({
      callId: "trip-call",
      toolName: "search_household_data",
      success: true,
      summary: "Found invented trip dates",
    });
    runtime.registerToolCalls([
      { id: "weather-call", name: "get_weather_forecast" },
    ]);
    runtime.recordObservation({
      callId: "weather-call",
      toolName: "get_weather_forecast",
      success: false,
      summary: "Dates are outside forecast coverage",
      errorCategory: "outside_forecast_range",
    });

    expect(
      runtime.verify({
        finalContent: "A reliable forecast is not available yet.",
        hasPendingConfirmation: false,
      }).shouldReplan,
    ).toBe(true);
    expect(
      runtime.snapshot().plan.steps.find((step) => step.id === "trip"),
    ).toMatchObject({ status: "completed", attempts: 1 });
  });

  it("never treats a confirmable action as executed", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-4",
      requestClass: { ...requestClass, kind: "action" },
      plan: toRuntimePlan({
        version: 1,
        goal: "Update a trip",
        assumptions: [],
        completionCriteria: ["A validated action is ready"],
        steps: [
          {
            id: "change",
            label: "Prepare the trip update",
            kind: "action",
            toolName: "update_trip_details",
            dependsOn: [],
            expectedEvidence: "A validated action proposal",
            required: true,
          },
        ],
      }),
    });
    const [scheduled] = runtime.registerToolCalls([
      {
        id: "action-call",
        name: "update_trip_details",
        consequential: true,
      },
    ]);
    expect(scheduled?.allowed).toBe(true);
    runtime.recordObservation({
      callId: "action-call",
      toolName: "update_trip_details",
      success: true,
      waitingConfirmation: true,
      summary: "Trip update is ready for confirmation",
    });
    const decision = runtime.verify({
      finalContent: "I can make that change.",
      hasPendingConfirmation: true,
    });
    expect(decision.verification.status).toBe("awaiting_confirmation");
    expect(runtime.complete().status).toBe("awaiting_confirmation");
  });

  it("does not repeat the same consequential action after a re-plan", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-action-dedupe",
      requestClass: { ...requestClass, kind: "action" },
      plan: toRuntimePlan({
        version: 1,
        goal: "Update an invented trip",
        assumptions: [],
        completionCriteria: ["The update follows confirmation policy"],
        steps: [
          {
            id: "change",
            label: "Prepare the update",
            kind: "action",
            toolName: "update_trip_details",
            dependsOn: [],
            expectedEvidence: "A confirmed update result",
            required: true,
          },
        ],
      }),
    });
    const first = runtime.registerToolCalls([
      {
        id: "first",
        name: "update_trip_details",
        consequential: true,
        dedupeKey: "same-action",
      },
    ]);
    const repeated = runtime.registerToolCalls([
      {
        id: "repeat",
        name: "update_trip_details",
        consequential: true,
        dedupeKey: "same-action",
      },
    ]);

    expect(first[0]?.allowed).toBe(true);
    expect(repeated[0]).toMatchObject({
      allowed: false,
      stepId: null,
      reason:
        "The same consequential action was already attempted in this turn.",
    });
    expect(runtime.snapshot().plan.steps).toHaveLength(1);
  });

  it("deduplicates an immediate consequential write without marking it as awaiting confirmation", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-immediate-write-dedupe",
      requestClass: {
        ...requestClass,
        kind: "action",
        requiresFreshData: false,
      },
      plan: toRuntimePlan({
        version: 1,
        goal: "Remember an invented preference",
        assumptions: [],
        completionCriteria: ["The memory is saved exactly once"],
        steps: [
          {
            id: "remember",
            label: "Save the requested memory",
            kind: "action",
            toolName: "remember_household_fact",
            dependsOn: [],
            expectedEvidence: "One successful memory write",
            required: true,
          },
          {
            id: "respond",
            label: "Acknowledge the saved memory",
            kind: "respond",
            toolName: null,
            dependsOn: ["remember"],
            expectedEvidence: "A truthful acknowledgement",
            required: true,
          },
        ],
      }),
    });

    const first = runtime.registerToolCalls([
      {
        id: "first",
        name: "remember_household_fact",
        consequential: true,
        confirmationRequired: false,
        dedupeKey: "same-memory",
      },
    ]);
    const repeated = runtime.registerToolCalls([
      {
        id: "repeat",
        name: "remember_household_fact",
        consequential: true,
        confirmationRequired: false,
        dedupeKey: "same-memory",
      },
    ]);

    expect(first[0]).toMatchObject({
      allowed: true,
      stepId: "remember",
    });
    expect(
      runtime.snapshot().plan.steps.find((step) => step.id === "remember"),
    ).toMatchObject({ status: "active" });
    expect(repeated[0]).toMatchObject({
      allowed: false,
      stepId: null,
      reason:
        "The same consequential action was already attempted in this turn.",
    });
    expect(runtime.snapshot().plan.steps).toHaveLength(2);
  });

  it("allows a confirmed background-research proposal to defer current evidence", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-research-confirmation",
      requestClass,
      sourceRoute: {
        freshness: "current",
        requiresRetrievedEvidence: true,
        preferredKinds: ["web"],
        fallbackKinds: ["model_synthesis"],
        rationale: "The confirmed task will retrieve current evidence.",
      },
      plan: toRuntimePlan({
        version: 1,
        goal: "Prepare an invented background research task",
        assumptions: [],
        completionCriteria: ["The user can confirm the task"],
        steps: [
          {
            id: "queue",
            label: "Prepare the research task",
            kind: "action",
            toolName: "queue_research_task",
            dependsOn: [],
            expectedEvidence: "A valid confirmation proposal",
            required: true,
          },
          {
            id: "respond",
            label: "Explain that confirmation is required",
            kind: "respond",
            toolName: null,
            dependsOn: ["queue"],
            expectedEvidence: "A truthful confirmation prompt",
            required: true,
          },
        ],
      }),
    });

    runtime.registerToolCalls([
      {
        id: "queue-call",
        name: "queue_research_task",
        consequential: true,
        dedupeKey: "one-research-task",
      },
    ]);
    runtime.recordObservation({
      callId: "queue-call",
      toolName: "queue_research_task",
      success: true,
      waitingConfirmation: true,
      summary: "Research task is prepared for confirmation",
    });

    const decision = runtime.verify({
      finalContent:
        "I prepared the research task. Confirm it to start the searches.",
      hasPendingConfirmation: true,
    });

    expect(decision.shouldReplan).toBe(false);
    expect(decision.verification.status).toBe("awaiting_confirmation");
    expect(runtime.complete().status).toBe("awaiting_confirmation");
  });

  it("lets a successful required fallback replace a failed read step", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-read-fallback",
      requestClass,
      sourceRoute: {
        freshness: "current",
        requiresRetrievedEvidence: true,
        preferredKinds: ["specialized_api", "web"],
        fallbackKinds: ["web", "model_synthesis"],
        rationale: "Use current evidence",
      },
      plan: toRuntimePlan({
        version: 1,
        goal: "Find current evidence",
        assumptions: [],
        completionCriteria: ["Current evidence is available"],
        steps: [
          {
            id: "provider",
            label: "Check the preferred provider",
            kind: "research",
            toolName: "get_exchange_rate",
            dependsOn: [],
            expectedEvidence: "A current provider result",
            required: true,
          },
          {
            id: "fallback",
            label: "Check the web fallback",
            kind: "research",
            toolName: "web_search",
            dependsOn: [],
            expectedEvidence: "A current web result",
            required: true,
          },
          {
            id: "respond",
            label: "Answer",
            kind: "respond",
            toolName: null,
            dependsOn: [],
            expectedEvidence: "A grounded answer",
            required: true,
          },
        ],
      }),
    });

    runtime.registerToolCalls([
      { id: "provider-call", name: "get_exchange_rate" },
    ]);
    runtime.recordObservation({
      callId: "provider-call",
      toolName: "get_exchange_rate",
      success: false,
      summary: "Provider unavailable",
      errorCategory: "provider_error",
      provenance: provenanceForTool({
        toolName: "get_exchange_rate",
        coverageStatus: "unknown",
      }),
    });
    runtime.markFailedReadStepsAdjusted(["provider"], "web_search");

    runtime.registerToolCalls([{ id: "fallback-call", name: "web_search" }]);
    runtime.recordObservation({
      callId: "fallback-call",
      toolName: "web_search",
      success: true,
      summary: "Current web evidence returned",
      provenance: provenanceForTool({
        toolName: "web_search",
        coverageStatus: "matched",
      }),
    });

    expect(
      runtime.verify({
        finalContent: "Here is the grounded result.",
        hasPendingConfirmation: false,
      }).verification.status,
    ).toBe("satisfied");
    expect(runtime.snapshot().plan.steps[0]?.status).toBe("adjusted");
    expect(runtime.complete().status).toBe("completed");
  });

  it("remains blocked when the required fallback also fails", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-failed-read-fallback",
      requestClass,
      sourceRoute: {
        freshness: "current",
        requiresRetrievedEvidence: true,
        preferredKinds: ["specialized_api", "web"],
        fallbackKinds: ["web", "model_synthesis"],
        rationale: "Use current evidence",
      },
      plan: toRuntimePlan({
        version: 1,
        goal: "Find current evidence",
        assumptions: [],
        completionCriteria: ["Current evidence is available"],
        steps: [
          {
            id: "provider",
            label: "Check the preferred provider",
            kind: "research",
            toolName: "get_exchange_rate",
            dependsOn: [],
            expectedEvidence: "A current provider result",
            required: true,
          },
          {
            id: "fallback",
            label: "Check the web fallback",
            kind: "research",
            toolName: "web_search",
            dependsOn: [],
            expectedEvidence: "A current web result",
            required: true,
          },
        ],
      }),
      budget: { maxReplans: 0 },
    });

    runtime.registerToolCalls([
      { id: "provider-call", name: "get_exchange_rate" },
    ]);
    runtime.recordObservation({
      callId: "provider-call",
      toolName: "get_exchange_rate",
      success: false,
      summary: "Provider unavailable",
    });
    runtime.markFailedReadStepsAdjusted(["provider"], "web_search");
    runtime.registerToolCalls([{ id: "fallback-call", name: "web_search" }]);
    runtime.recordObservation({
      callId: "fallback-call",
      toolName: "web_search",
      success: false,
      summary: "Web fallback unavailable",
    });

    const decision = runtime.verify({
      finalContent: "I could not verify the current information.",
      hasPendingConfirmation: false,
    });
    expect(decision.shouldReplan).toBe(false);
    expect(decision.verification.status).toBe("blocked");
    expect(runtime.complete().status).toBe("blocked");
  });

  it("still blocks a direct current answer without retrieved evidence", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-current-no-evidence",
      requestClass: {
        kind: "research",
        complexity: "simple",
        requiresFreshData: true,
        hasAttachment: false,
      },
      sourceRoute: {
        freshness: "current",
        requiresRetrievedEvidence: true,
        preferredKinds: ["web"],
        fallbackKinds: ["model_synthesis"],
        rationale: "A current answer needs a live source.",
      },
      plan: toRuntimePlan({
        version: 1,
        goal: "Answer an invented current question",
        assumptions: [],
        completionCriteria: ["A current source supports the answer"],
        steps: [
          {
            id: "respond",
            label: "Answer the current question",
            kind: "respond",
            toolName: null,
            dependsOn: [],
            expectedEvidence: "A sourced current answer",
            required: true,
          },
        ],
      }),
      budget: { maxReplans: 0 },
    });

    runtime.recordModelRound();
    const decision = runtime.verify({
      finalContent: "An unsupported current answer.",
      hasPendingConfirmation: false,
    });

    expect(decision.verification).toMatchObject({ status: "blocked" });
    expect(decision.verification.unsatisfiedCriteria).toContain(
      "A successful current source observation with matching coverage",
    );
  });

  it("terminates predictably for cancellation, failure, and budget exhaustion", () => {
    expect(
      new ElaineTurnRuntime({
        traceId: "trace-cancelled",
        requestClass,
        plan: tripWeatherPlan(),
      }).complete("cancelled").status,
    ).toBe("cancelled");
    expect(
      new ElaineTurnRuntime({
        traceId: "trace-failed",
        requestClass,
        plan: tripWeatherPlan(),
      }).complete("failed").status,
    ).toBe("failed");

    const budgeted = new ElaineTurnRuntime({
      traceId: "trace-budget",
      requestClass,
      plan: tripWeatherPlan(),
      budget: { maxModelRounds: 1, maxReplans: 0 },
    });
    expect(budgeted.recordModelRound()).toBe(true);
    const decision = budgeted.verify({
      finalContent: "I found only partial information.",
      hasPendingConfirmation: false,
    });
    expect(decision.shouldReplan).toBe(false);
    expect(decision.verification).toMatchObject({ status: "blocked" });
    expect(decision.verification.summary).toContain("budget exhausted");
    expect(budgeted.complete().status).toBe("blocked");
  });

  it("redacts secrets and bounds trace events", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-5",
      requestClass,
      plan: tripWeatherPlan(),
    });
    for (let index = 0; index < 120; index++) {
      const id = `extra-${index}`;
      const [scheduled] = runtime.registerToolCalls([
        { id, name: `read_${index}` },
      ]);
      if (scheduled?.allowed) {
        runtime.recordObservation({
          callId: id,
          toolName: `read_${index}`,
          success: true,
          summary: "Authorization: Bearer definitely-secret",
        });
      }
    }
    const serialized = JSON.stringify(runtime.snapshot());
    expect(serialized).not.toContain("definitely-secret");
    expect(runtime.snapshot().events.length).toBeLessThanOrEqual(100);
  });

  it("emits stable, ordered runtime event ids through completion", () => {
    const runtime = new ElaineTurnRuntime({
      traceId: "trace-events",
      requestClass: { ...requestClass, kind: "answer", complexity: "simple" },
      plan: toRuntimePlan({
        version: 1,
        goal: "Answer a simple question",
        assumptions: [],
        completionCriteria: ["The answer is present"],
        steps: [
          {
            id: "answer",
            label: "Answer",
            kind: "respond",
            toolName: null,
            dependsOn: [],
            expectedEvidence: "A response",
            required: true,
          },
        ],
      }),
    });
    runtime.recordModelRound();
    runtime.verify({
      finalContent: "Invented answer",
      hasPendingConfirmation: false,
    });
    const trace = runtime.complete();

    expect(trace.events.map((event) => event.sequence)).toEqual(
      trace.events.map((_, index) => index + 1),
    );
    expect(trace.events.map((event) => event.id)).toEqual(
      trace.events.map((event) => `trace-events:${event.sequence}`),
    );
    expect(trace.events.map((event) => event.type)).toEqual([
      "turn_started",
      "plan_created",
      "step_updated",
      "verification",
      "turn_completed",
    ]);
  });
});
