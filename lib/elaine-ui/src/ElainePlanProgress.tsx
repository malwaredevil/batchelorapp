import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  RotateCw,
} from "lucide-react";
import type {
  ElainePlanStepStatus,
  ElaineRuntimeTrace,
} from "@workspace/api-client-react";

function StepIcon({ status }: { status: ElainePlanStepStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (status === "active") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  if (status === "waiting_confirmation") {
    return <Clock3 className="h-3.5 w-3.5 text-amber-500" />;
  }
  if (status === "adjusted") {
    return <RotateCw className="h-3.5 w-3.5 text-sky-500" />;
  }
  if (["blocked", "failed", "cancelled"].includes(status)) {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />;
}

function statusLabel(trace: ElaineRuntimeTrace): string {
  if (trace.status === "running") {
    const active = trace.plan.steps.find((step) => step.status === "active");
    return active?.label ?? "Working through the plan";
  }
  if (trace.status === "awaiting_confirmation") return "Ready for confirmation";
  if (trace.status === "completed") return "Plan completed";
  if (trace.status === "blocked") return "Completed with a limitation";
  if (trace.status === "cancelled") return "Plan cancelled";
  return "Plan stopped";
}

/**
 * User-safe progress only: goal, step labels, statuses, and concise evidence
 * summaries. The server never sends hidden chain-of-thought in this payload.
 */
export function ElainePlanProgress({
  trace,
  live = false,
}: {
  trace: ElaineRuntimeTrace;
  live?: boolean;
}) {
  const [open, setOpen] = useState(live);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border border-border/60 bg-background/65 px-3 py-2 text-xs"
    >
      <summary className="cursor-pointer select-none font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {statusLabel(trace)}
      </summary>
      <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
        <p className="text-muted-foreground">{trace.goal}</p>
        {trace.sourceRoute && (
          <p className="text-muted-foreground">
            Source plan:{" "}
            {trace.sourceRoute.preferredKinds
              .map((source) => source.replace(/_/g, " "))
              .join(" → ")}
            {trace.sourceRoute.requiresRetrievedEvidence
              ? " · live evidence required"
              : ""}
          </p>
        )}
        <ol className="space-y-1.5" aria-label="Elaine plan progress">
          {trace.plan.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0">
                <span className="text-foreground">{step.label}</span>
                {step.summary && (
                  <span className="block text-muted-foreground">
                    {step.summary}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        {trace.verification?.summary && (
          <p className="text-muted-foreground">{trace.verification.summary}</p>
        )}
        {(trace.observations?.length ?? 0) > 0 && (
          <p className="text-muted-foreground">
            {trace.observations?.filter((item) => item.success).length ?? 0} of{" "}
            {trace.observations?.length ?? 0} evidence sources succeeded
          </p>
        )}
        {!trace.traceAvailable && (
          <p className="text-amber-600 dark:text-amber-400">
            Diagnostic history was unavailable for this turn; chat continued
            normally.
          </p>
        )}
      </div>
    </details>
  );
}
