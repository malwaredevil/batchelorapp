import { sanitizeRuntimeText, type ElaineRuntimeTrace } from "./contracts";

export function safeDiagnosticText(value: string, limit = 220): string {
  return sanitizeRuntimeText(value, limit)
    .replace(
      /\b(?:sk-(?:or-|proj-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}\b/g,
      "[credential]",
    )
    .replace(/\beyJ[A-Za-z0-9_.-]{80,}\b/g, "[credential]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+\d[\d ()-]{8,}\d/g, "[phone]");
}

export function summarizeElaineDiagnostics(
  trace: Pick<
    ElaineRuntimeTrace,
    "traceId" | "status" | "plan" | "observations" | "verification"
  >,
) {
  const observations = Array.isArray(trace.observations)
    ? trace.observations
    : [];
  const steps = Array.isArray(trace.plan?.steps) ? trace.plan.steps : [];
  return {
    traceId: trace.traceId,
    status: trace.status,
    steps: steps
      .filter((step) => step && typeof step.label === "string")
      .slice(0, 20)
      .map((step) => {
        const results = observations.filter((item) => item?.stepId === step.id);
        const latest = results.at(-1);
        const failed =
          latest?.success === false &&
          latest.errorCategory !== "dependency_not_ready"
            ? latest
            : undefined;
        const succeeded = latest?.success === true;
        return {
          id: safeDiagnosticText(step.id, 80),
          label: safeDiagnosticText(step.label),
          tool: step.toolName ? safeDiagnosticText(step.toolName, 80) : null,
          kind: step.kind,
          required: step.required,
          status: step.status,
          outcome: failed
            ? "tool_failed"
            : succeeded
              ? "tool_succeeded"
              : step.kind === "respond" && step.status !== "completed"
                ? "answer_not_produced"
                : step.status === "completed"
                  ? "completed"
                  : "not_attempted",
          errorCategory: failed?.errorCategory
            ? safeDiagnosticText(failed.errorCategory, 80)
            : null,
          evidence: results
            .map((item) => safeDiagnosticText(item.evidenceSummary))
            .slice(-3),
        };
      }),
    verification: trace.verification
      ? {
          status: trace.verification.status,
          summary: safeDiagnosticText(trace.verification.summary),
        }
      : null,
  };
}

export function explainIncompleteElaineTurn(
  trace: Parameters<typeof summarizeElaineDiagnostics>[0],
): string {
  const diagnostic = summarizeElaineDiagnostics(trace);
  const incomplete = diagnostic.steps.filter(
    (step) =>
      step.required &&
      ![
        "completed",
        "adjusted",
        "waiting_input",
        "waiting_confirmation",
      ].includes(step.status),
  );
  const details = incomplete
    .slice(0, 4)
    .map(
      (step) =>
        `${step.label} — ${
          step.outcome === "answer_not_produced"
            ? "the final answer was not produced"
            : step.outcome === "tool_failed"
              ? `the tool failed${step.errorCategory ? ` (${step.errorCategory})` : ""}`
              : step.outcome === "tool_succeeded"
                ? "the tool succeeded, but the step remained incomplete"
                : "not attempted"
        }`,
    );
  const completed = diagnostic.steps.filter(
    (step) => step.outcome === "tool_succeeded",
  );
  return [
    details.length
      ? `I couldn't complete: ${details.join("; ")}.`
      : "I couldn't finish verifying this request.",
    completed.length
      ? `Completed checks: ${completed
          .map((step) => step.tool ?? step.label)
          .slice(0, 5)
          .join(", ")}. Those checks were recorded as successful.`
      : "",
    "No failed or incomplete action was automatically retried.",
  ]
    .filter(Boolean)
    .join(" ");
}
