import { describe, expect, it } from "vitest";
import { toRuntimePlan } from "./contracts";
import { ElaineTurnRuntime } from "./turn-runtime";

function makeRuntime(
  actionTool = "call_me",
  lookupTool = "list_scheduled_contacts",
  extraDependency = false,
) {
  return new ElaineTurnRuntime({
    traceId: "scheduling-verification",
    requestClass: {
      kind: "action",
      complexity: "multi_step",
      requiresFreshData: false,
      hasAttachment: false,
    },
    plan: toRuntimePlan({
      version: 1,
      goal: "Check whether the requested callback was saved",
      assumptions: [],
      completionCriteria: ["Report the verified callback outcome"],
      steps: [
        {
          id: "schedule",
          label: "Schedule callback",
          kind: "action",
          toolName: actionTool,
          dependsOn: [],
          expectedEvidence: "Saved callback",
          required: true,
        },
        {
          id: "scope",
          label: "Resolve lookup scope",
          kind: "lookup",
          toolName: "read_app_operation",
          dependsOn: [],
          expectedEvidence: "Grounded lookup scope",
          required: false,
        },
        {
          id: "verify",
          label: "Check saved callback",
          kind: "lookup",
          toolName: lookupTool,
          dependsOn: extraDependency ? ["schedule", "scope"] : ["schedule"],
          expectedEvidence: "Saved scheduled-call records",
          required: true,
        },
      ],
    }),
  });
}

function attempt(
  runtime: ElaineTurnRuntime,
  toolName = "call_me",
  errorCategory = "http_502",
) {
  runtime.registerToolCalls([
    {
      id: "attempt",
      name: toolName,
      consequential: true,
      confirmationRequired: false,
      dedupeKey: "original-callback",
    },
  ]);
  runtime.recordObservation({
    callId: "attempt",
    toolName,
    success: false,
    errorCategory,
    summary: "Executor returned an error; saved outcome is unconfirmed",
  });
}

const lookup = { id: "inspect", name: "list_scheduled_contacts" };

describe("read-only verification after an uncertain scheduling result", () => {
  it.each(["call_me", "call_contact"])(
    "allows inspection after %s fails without completing or replaying it",
    (toolName) => {
      const runtime = makeRuntime(toolName);
      attempt(runtime, toolName);
      expect(runtime.registerToolCalls([lookup])[0]?.allowed).toBe(true);
      runtime.recordObservation({
        callId: lookup.id,
        toolName: lookup.name,
        success: true,
        summary: "Scheduled-call records checked",
      });
      expect(runtime.snapshot().plan.steps[0]?.status).toBe("failed");
      expect(runtime.snapshot().plan.steps[2]?.status).toBe("completed");
      expect(
        runtime.registerToolCalls([
          {
            id: "repeat",
            name: toolName,
            consequential: true,
            dedupeKey: "original-callback",
          },
        ])[0],
      ).toMatchObject({ allowed: false });
    },
  );

  it("does not bypass an action that was never attempted", () => {
    const runtime = makeRuntime();
    expect(runtime.registerToolCalls([lookup])[0]).toMatchObject({
      allowed: false,
      deferred: true,
    });
  });

  it("does not bypass a pending confirmation", () => {
    const runtime = makeRuntime();
    runtime.registerToolCalls([
      { id: "proposal", name: "call_me", consequential: true },
    ]);
    runtime.recordObservation({
      callId: "proposal",
      toolName: "call_me",
      success: true,
      waitingConfirmation: true,
      summary: "Waiting for approval",
    });
    expect(runtime.registerToolCalls([lookup])[0]?.allowed).toBe(false);
  });

  it.each(["tool_error", "dependency_not_ready", "runtime_blocked"])(
    "does not treat %s as an executed scheduling attempt",
    (category) => {
      const runtime = makeRuntime();
      attempt(runtime, "call_me", category);
      expect(runtime.registerToolCalls([lookup])[0]?.allowed).toBe(false);
    },
  );

  it("does not bypass another unresolved lookup dependency", () => {
    const runtime = makeRuntime("call_me", lookup.name, true);
    attempt(runtime);
    expect(runtime.registerToolCalls([lookup])[0]).toMatchObject({
      allowed: false,
      reason: "Waiting for prerequisite step: scope",
    });
  });

  it("does not allow an unrelated read tool to bypass dependencies", () => {
    const runtime = makeRuntime("call_me", "search_household_data");
    attempt(runtime);
    expect(
      runtime.registerToolCalls([
        { id: "unrelated", name: "search_household_data" },
      ])[0]?.allowed,
    ).toBe(false);
  });

  it("does not bypass a different failed action", () => {
    const runtime = makeRuntime("create_trip");
    attempt(runtime, "create_trip");
    expect(runtime.registerToolCalls([lookup])[0]?.allowed).toBe(false);
  });

  it("does not relax dependencies for a consequential invocation", () => {
    const runtime = makeRuntime();
    attempt(runtime);
    expect(
      runtime.registerToolCalls([{ ...lookup, consequential: true }])[0]
        ?.allowed,
    ).toBe(false);
  });

  it("still enforces the tool-call budget", () => {
    const runtime = makeRuntime();
    attempt(runtime);
    for (let i = 0; i < 100; i++) {
      runtime.registerToolCalls([
        { id: `extra-${i}`, name: "read_app_operation" },
      ]);
    }
    expect(runtime.registerToolCalls([lookup])[0]).toMatchObject({
      allowed: false,
      reason: "The turn's tool-call budget was exhausted.",
    });
  });
});
