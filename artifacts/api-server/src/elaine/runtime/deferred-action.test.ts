import { describe, expect, it, vi } from "vitest";
import { toRuntimePlan } from "./contracts";
import { summarizeElaineDiagnostics } from "./diagnostic-summary";
import { selectReadyDeferredElaineAction } from "./replan-policy";
import { ElaineTurnRuntime } from "./turn-runtime";

function makeRuntime() {
  return new ElaineTurnRuntime({
    traceId: "deferred-call",
    requestClass: {
      kind: "action",
      complexity: "multi_step",
      requiresFreshData: false,
      hasAttachment: false,
    },
    plan: toRuntimePlan({
      version: 1,
      goal: "Schedule the requested callback",
      assumptions: [],
      completionCriteria: ["A saved scheduled-call record is returned"],
      steps: [
        {
          id: "time",
          label: "Read timezone",
          kind: "lookup",
          toolName: "read_app_operation",
          dependsOn: [],
          expectedEvidence: "Verified timezone",
          required: true,
        },
        {
          id: "call",
          label: "Schedule callback",
          kind: "action",
          toolName: "call_me",
          dependsOn: ["time"],
          expectedEvidence: "Saved call",
          required: true,
        },
        {
          id: "verify",
          label: "Check saved call",
          kind: "lookup",
          toolName: "list_scheduled_contacts",
          dependsOn: ["call"],
          expectedEvidence: "Scheduled call found",
          required: true,
        },
      ],
    }),
  });
}
const action = {
  id: "early-call",
  name: "call_me",
  consequential: true,
  confirmationRequired: false,
  dedupeKey: "same-requested-call",
};
const deferredTools = new Set(["call_me"]);

function deferCall(runtime: ElaineTurnRuntime) {
  const [lookup, call] = runtime.registerToolCalls([
    { id: "time-read", name: "read_app_operation" },
    action,
  ]);
  expect(lookup?.allowed).toBe(true);
  expect(call).toMatchObject({
    allowed: false,
    deferred: true,
    stepId: "call",
  });
  runtime.recordObservation({
    callId: action.id,
    toolName: action.name,
    success: false,
    errorCategory: "dependency_not_ready",
    summary: "Not attempted: waiting for time",
  });
}
function finishTime(runtime: ElaineTurnRuntime, success = true) {
  runtime.recordObservation({
    callId: "time-read",
    toolName: "read_app_operation",
    success,
    summary: success ? "Timezone read" : "Timezone unavailable",
  });
}

describe("deferred scheduling without replaying consequential actions", () => {
  it("continues the original action after the prerequisite, then verifies its saved record", async () => {
    const runtime = makeRuntime();
    const executor = vi.fn().mockResolvedValue({ id: 123, status: "pending" });
    deferCall(runtime);
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), deferredTools),
    ).toBeNull();
    finishTime(runtime);
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), deferredTools),
    ).toBe("call_me");
    expect(runtime.snapshot().plan.steps[1]).toMatchObject({
      status: "blocked",
      attempts: 0,
    });
    expect(
      summarizeElaineDiagnostics(runtime.snapshot()).steps[1]?.outcome,
    ).toBe("not_attempted");
    const [ready] = runtime.registerToolCalls([
      { ...action, id: "ready-call" },
    ]);
    expect(ready).toMatchObject({ allowed: true, stepId: "call" });
    if (ready?.allowed) await executor();
    runtime.recordObservation({
      callId: "ready-call",
      toolName: "call_me",
      success: true,
      summary: "Saved call #123",
    });
    const [verify] = runtime.registerToolCalls([
      { id: "verify-call", name: "list_scheduled_contacts" },
    ]);
    expect(verify?.allowed).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), deferredTools),
    ).toBeNull();
    expect(
      summarizeElaineDiagnostics(runtime.snapshot()).steps[1]?.outcome,
    ).toBe("tool_succeeded");
    expect(
      runtime.registerToolCalls([{ ...action, id: "duplicate" }])[0]?.allowed,
    ).toBe(false);
  });

  it("does not continue when a prerequisite failed", () => {
    const runtime = makeRuntime();
    deferCall(runtime);
    finishTime(runtime, false);
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), deferredTools),
    ).toBeNull();
    expect(
      runtime.registerToolCalls([{ ...action, id: "still-blocked" }])[0],
    ).toMatchObject({ allowed: false, deferred: true });
  });

  it("never selects an unrelated planned action without an actual dependency veto", () => {
    const runtime = makeRuntime();
    deferCall(runtime);
    finishTime(runtime);
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), new Set()),
    ).toBeNull();
  });

  it("keeps the confirmation flow intact after a deferral", () => {
    const runtime = makeRuntime();
    deferCall(runtime);
    finishTime(runtime);
    expect(
      runtime.registerToolCalls([
        { ...action, id: "confirmation-call", confirmationRequired: true },
      ])[0]?.allowed,
    ).toBe(true);
    expect(runtime.snapshot().plan.steps[1]?.status).toBe(
      "waiting_confirmation",
    );
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), deferredTools),
    ).toBeNull();
  });

  it("does not replay a failed executor even when it returned no saved record", () => {
    const runtime = makeRuntime();
    deferCall(runtime);
    finishTime(runtime);
    runtime.registerToolCalls([{ ...action, id: "uncertain-call" }]);
    runtime.recordObservation({
      callId: "uncertain-call",
      toolName: "call_me",
      success: false,
      errorCategory: "provider_error",
      summary: "No reliable delivery outcome",
    });
    expect(
      selectReadyDeferredElaineAction(runtime.snapshot(), deferredTools),
    ).toBeNull();
    expect(
      runtime.registerToolCalls([{ ...action, id: "do-not-retry" }])[0]
        ?.allowed,
    ).toBe(false);
  });

  it("honors tool-call budgets even when the dependency becomes ready", () => {
    const runtime = makeRuntime();
    deferCall(runtime);
    finishTime(runtime);
    for (let i = 0; i < 100; i++)
      runtime.registerToolCalls([
        { id: `extra-${i}`, name: "read_app_operation" },
      ]);
    expect(
      runtime.registerToolCalls([{ ...action, id: "over-budget" }])[0]?.allowed,
    ).toBe(false);
  });
});
