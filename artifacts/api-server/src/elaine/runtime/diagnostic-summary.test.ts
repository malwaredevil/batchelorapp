import { describe, expect, it } from "vitest";
import {
  explainIncompleteElaineTurn,
  safeDiagnosticText,
  summarizeElaineDiagnostics,
} from "./diagnostic-summary";
import type { ElaineRuntimeTrace } from "./contracts";

const trace = {
  traceId: "trace",
  status: "blocked",
  plan: {
    steps: [
      {
        id: "sentry",
        label: "Check Sentry",
        kind: "lookup",
        required: true,
        status: "completed",
        toolName: "list_sentry_issues",
      },
      {
        id: "reply",
        label: "Answer the question",
        kind: "respond",
        required: true,
        status: "planned",
        toolName: null,
      },
    ],
  },
  observations: [
    {
      stepId: "sentry",
      toolName: "list_sentry_issues",
      success: true,
      evidenceSummary: "Sentry check completed",
    },
  ],
  verification: {
    status: "blocked",
    summary: "Could not satisfy 1 required plan step",
  },
} as unknown as ElaineRuntimeTrace;

describe("Elaine execution diagnostics", () => {
  it("identifies a missing answer without blaming the successful Sentry check", () => {
    const result = explainIncompleteElaineTurn(trace);
    expect(result).toContain("Answer the question");
    expect(result).toContain("final answer was not produced");
    expect(result).toContain("list_sentry_issues");
    expect(result).toContain("recorded as successful");
    expect(result).not.toContain("Sentry failed");
  });
  it("distinguishes tools that were never attempted", () => {
    const result = summarizeElaineDiagnostics({
      ...trace,
      observations: [],
      plan: {
        ...trace.plan,
        steps: [{ ...trace.plan.steps[0]!, status: "planned" }],
      },
    });
    expect(result.steps[0]?.outcome).toBe("not_attempted");
  });
  it("reports a recorded error category, not a guessed diagnosis", () => {
    const result = summarizeElaineDiagnostics({
      ...trace,
      observations: [
        {
          ...trace.observations![0]!,
          success: false,
          errorCategory: "timeout",
        },
      ],
    });
    expect(result.steps[0]?.outcome).toBe("tool_failed");
    expect(result.steps[0]?.errorCategory).toBe("timeout");
  });
  it("redacts credentials and personal identifiers", () => {
    expect(safeDiagnosticText("person@example.com +15555550199")).toBe(
      "[email] [phone]",
    );
    expect(safeDiagnosticText("sk-proj-" + "a".repeat(30))).toBe(
      "[credential]",
    );
  });
});
