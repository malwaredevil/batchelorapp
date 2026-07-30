import {
  sanitizeRuntimeText,
  type ElainePlan,
  type ElainePlanStep,
  type ElaineRuntimeBudget,
  type ElaineRuntimeEvent,
  type ElaineRuntimeTrace,
  type ElaineTerminalStatus,
  type ElaineVerification,
  type ElaineRequestClass,
  type ElaineObservationProvenance,
  type ElaineSourceRoute,
} from "./contracts";
import { hasCurrentRetrievedEvidence } from "./source-policy";

export interface RuntimeToolCall {
  id: string;
  name: string;
  consequential?: boolean;
  /**
   * Consequential calls normally wait for the configured confirmation flow.
   * Set false only for an explicit-user write that executes immediately but
   * still needs consequential-call deduplication.
   */
  confirmationRequired?: boolean;
  /**
   * Stable only for the current turn. Used to prevent a re-plan from
   * repeating the same non-idempotent action; never persisted in the trace.
   */
  dedupeKey?: string;
}

export interface RuntimeScheduledToolCall extends RuntimeToolCall {
  allowed: boolean;
  stepId: string | null;
  reason?: string;
}

export interface RuntimeVerificationDecision {
  shouldReplan: boolean;
  instruction?: string;
  verification: ElaineVerification;
}

const DEFAULT_BUDGET: ElaineRuntimeBudget = {
  maxModelRounds: 4,
  maxToolCalls: 16,
  maxReplans: 2,
  maxElapsedMs: 120_000,
};

function clonePlan(plan: ElainePlan): ElainePlan {
  return {
    ...plan,
    assumptions: [...plan.assumptions],
    completionCriteria: [...plan.completionCriteria],
    steps: plan.steps.map((step) => ({
      ...step,
      dependsOn: [...step.dependsOn],
    })),
  };
}

export class ElaineTurnRuntime {
  private readonly startedMs: number;
  private readonly now: () => Date;
  private readonly budget: ElaineRuntimeBudget;
  private readonly eventSink?: (
    event: ElaineRuntimeEvent,
    trace: ElaineRuntimeTrace,
  ) => void;
  private readonly callSteps = new Map<string, string>();
  private readonly attemptedConsequentialCalls = new Set<string>();
  private sequence = 0;
  private trace: ElaineRuntimeTrace;

  constructor(input: {
    traceId: string;
    requestClass: ElaineRequestClass;
    plan: ElainePlan;
    sourceRoute?: ElaineSourceRoute;
    traceAvailable?: boolean;
    budget?: Partial<ElaineRuntimeBudget>;
    now?: () => Date;
    eventSink?: (event: ElaineRuntimeEvent, trace: ElaineRuntimeTrace) => void;
  }) {
    this.now = input.now ?? (() => new Date());
    this.startedMs = this.now().getTime();
    this.budget = { ...DEFAULT_BUDGET, ...input.budget };
    this.eventSink = input.eventSink;
    this.trace = {
      version: 1,
      traceId: input.traceId,
      requestClass: input.requestClass,
      goal: input.plan.goal,
      plan: clonePlan(input.plan),
      ...(input.sourceRoute ? { sourceRoute: input.sourceRoute } : {}),
      observations: [],
      events: [],
      verification: null,
      status: "running",
      traceAvailable: input.traceAvailable ?? true,
      startedAt: this.now().toISOString(),
      completedAt: null,
      usage: {
        modelRounds: 0,
        toolCalls: 0,
        replans: 0,
        elapsedMs: 0,
      },
    };
    this.emit("turn_started", "Request classified and runtime started");
    this.emit("plan_created", "Plan ready");
  }

  snapshot(): ElaineRuntimeTrace {
    this.refreshElapsed();
    return {
      ...this.trace,
      requestClass: { ...this.trace.requestClass },
      plan: clonePlan(this.trace.plan),
      ...(this.trace.sourceRoute
        ? {
            sourceRoute: {
              ...this.trace.sourceRoute,
              preferredKinds: [...this.trace.sourceRoute.preferredKinds],
              fallbackKinds: [...this.trace.sourceRoute.fallbackKinds],
            },
          }
        : {}),
      observations: (this.trace.observations ?? []).map((observation) => ({
        ...observation,
        ...(observation.provenance
          ? {
              provenance: {
                ...observation.provenance,
                coverage: { ...observation.provenance.coverage },
              },
            }
          : {}),
      })),
      events: this.trace.events.map((event) => ({ ...event })),
      verification: this.trace.verification
        ? {
            ...this.trace.verification,
            satisfiedCriteria: [...this.trace.verification.satisfiedCriteria],
            unsatisfiedCriteria: [
              ...this.trace.verification.unsatisfiedCriteria,
            ],
          }
        : null,
      usage: { ...this.trace.usage },
    };
  }

  setTraceAvailable(available: boolean): void {
    this.trace.traceAvailable = available;
  }

  recordModelRound(): boolean {
    this.trace.usage.modelRounds += 1;
    this.refreshElapsed();
    return (
      this.trace.usage.modelRounds <= this.budget.maxModelRounds &&
      this.trace.usage.elapsedMs <= this.budget.maxElapsedMs
    );
  }

  registerToolCalls(calls: RuntimeToolCall[]): RuntimeScheduledToolCall[] {
    const completedIds = new Set(
      this.trace.plan.steps
        .filter((step) => step.status === "completed")
        .map((step) => step.id),
    );
    let revised = false;

    return calls
      .map((call) => {
        this.trace.usage.toolCalls += 1;
        if (this.trace.usage.toolCalls > this.budget.maxToolCalls) {
          return {
            ...call,
            allowed: false,
            stepId: null,
            reason: "The turn's tool-call budget was exhausted.",
          };
        }

        const consequentialDedupeKey = call.consequential
          ? call.dedupeKey
          : null;
        if (
          consequentialDedupeKey &&
          this.attemptedConsequentialCalls.has(consequentialDedupeKey)
        ) {
          return {
            ...call,
            allowed: false,
            stepId: null,
            reason:
              "The same consequential action was already attempted in this turn.",
          };
        }

        let step = this.findRunnableStep(call.name);
        if (!step) {
          step = this.addAdaptedStep(call);
          revised = revised || step !== null;
        }
        if (!step) {
          return {
            ...call,
            allowed: false,
            stepId: null,
            reason:
              "This tool was not in the validated plan and no re-plan budget remains.",
          };
        }

        const missingDependencies = step.dependsOn.filter(
          (dependency) => !completedIds.has(dependency),
        );
        if (missingDependencies.length > 0) {
          const reason = `Waiting for prerequisite step${missingDependencies.length > 1 ? "s" : ""}: ${missingDependencies.join(", ")}`;
          this.updateStep(step, "blocked", reason);
          return {
            ...call,
            allowed: false,
            stepId: step.id,
            reason,
          };
        }

        if (call.consequential) {
          this.attemptedConsequentialCalls.add(
            call.dedupeKey ?? `${call.name}:${step.id}`,
          );
        }

        const confirmationRequired =
          call.confirmationRequired ?? call.consequential === true;
        step.attempts += 1;
        this.updateStep(
          step,
          confirmationRequired ? "waiting_confirmation" : "active",
          confirmationRequired
            ? "Waiting for the configured confirmation flow"
            : "Running",
        );
        this.callSteps.set(call.id, step.id);
        return { ...call, allowed: true, stepId: step.id };
      })
      .map((result, index, results) => {
        if (revised && index === results.length - 1) {
          this.emit("plan_revised", "Plan adjusted to new information");
        }
        return result;
      });
  }

  recordObservation(input: {
    callId: string;
    toolName: string;
    success: boolean;
    summary: string;
    errorCategory?: string;
    waitingConfirmation?: boolean;
    resultReference?: string;
    provenance?: ElaineObservationProvenance;
  }): void {
    const stepId = this.callSteps.get(input.callId);
    const step = stepId
      ? this.trace.plan.steps.find((candidate) => candidate.id === stepId)
      : undefined;
    const summary = sanitizeRuntimeText(input.summary, 220);
    const observedAt = this.now().toISOString();
    this.trace.observations = [
      ...(this.trace.observations ?? []),
      {
        callId: input.callId,
        stepId: stepId ?? null,
        toolName: input.toolName,
        success: input.success,
        ...(input.errorCategory
          ? { errorCategory: sanitizeRuntimeText(input.errorCategory, 80) }
          : {}),
        evidenceSummary: summary,
        ...(input.resultReference
          ? {
              resultReference: sanitizeRuntimeText(input.resultReference, 240),
            }
          : {}),
        ...(input.provenance ? { provenance: input.provenance } : {}),
        startedAt: observedAt,
        completedAt: observedAt,
      },
    ].slice(-50);
    this.emit("observation", summary || "Tool result received", {
      stepId,
      toolName: input.toolName,
      errorCategory: input.errorCategory
        ? sanitizeRuntimeText(input.errorCategory, 80)
        : undefined,
      status: input.waitingConfirmation
        ? "waiting_confirmation"
        : input.success
          ? "completed"
          : "failed",
    });
    if (step) {
      this.updateStep(
        step,
        input.waitingConfirmation
          ? "waiting_confirmation"
          : input.success
            ? "completed"
            : "failed",
        summary ||
          (input.success
            ? "Evidence received"
            : "The tool did not provide the required evidence"),
      );
    }
  }

  markFailedReadStepsAdjusted(
    stepIds: readonly string[],
    replacementToolName: string,
  ): void {
    for (const stepId of stepIds) {
      const step = this.trace.plan.steps.find(
        (candidate) => candidate.id === stepId,
      );
      if (
        !step ||
        step.status !== "failed" ||
        step.riskClass !== "read_only" ||
        step.confirmation !== "none" ||
        !["lookup", "research"].includes(step.kind)
      ) {
        continue;
      }
      this.updateStep(
        step,
        "adjusted",
        `Replaced by fallback ${replacementToolName.replace(/_/g, " ")}`,
      );
    }
  }

  verify(input: {
    finalContent: string;
    hasPendingConfirmation: boolean;
  }): RuntimeVerificationDecision {
    if (input.finalContent.trim()) {
      for (const step of this.trace.plan.steps) {
        if (step.kind === "respond" && step.status === "planned") {
          this.updateStep(step, "completed", "Response prepared");
        }
      }
    }

    const unfinished = this.trace.plan.steps.filter(
      (step) =>
        step.required &&
        !["completed", "adjusted"].includes(step.status) &&
        step.status !== "waiting_confirmation",
    );
    const waiting =
      input.hasPendingConfirmation ||
      this.trace.plan.steps.some(
        (step) => step.status === "waiting_confirmation",
      );
    const retrievalDeferredByPendingResearch =
      waiting &&
      this.trace.plan.steps.some(
        (step) =>
          step.toolName === "queue_research_task" &&
          step.status === "waiting_confirmation",
      );
    const missingCurrentEvidence =
      this.trace.sourceRoute?.requiresRetrievedEvidence === true &&
      !retrievalDeferredByPendingResearch &&
      !hasCurrentRetrievedEvidence(this.trace.observations ?? []);
    const satisfiedCriteria =
      unfinished.length === 0 && !missingCurrentEvidence
        ? [...this.trace.plan.completionCriteria]
        : [];
    const unsatisfiedCriteria = [
      ...(missingCurrentEvidence
        ? ["A successful current source observation with matching coverage"]
        : []),
      ...(unfinished.length > 0
        ? unfinished.map((step) => step.expectedEvidence)
        : []),
    ];

    if (
      (unfinished.length > 0 || missingCurrentEvidence) &&
      this.trace.usage.replans < this.budget.maxReplans &&
      this.trace.usage.modelRounds < this.budget.maxModelRounds &&
      this.withinElapsedBudget()
    ) {
      this.trace.usage.replans += 1;
      const summary = missingCurrentEvidence
        ? "A current source is still needed before presenting volatile facts"
        : `More evidence is needed for: ${unfinished
            .map((step) => step.label)
            .join("; ")}`;
      const verification: ElaineVerification = {
        status: "needs_replan",
        satisfiedCriteria,
        unsatisfiedCriteria,
        summary,
        replanReason: summary,
      };
      this.trace.verification = verification;
      this.emit("verification", summary);
      this.emit("plan_revised", "Checking an adjusted route");
      return {
        shouldReplan: true,
        instruction:
          `SERVER VERIFICATION: The current response is not complete. ` +
          `${summary}. Use an appropriate available tool only if its prerequisites are grounded. ` +
          `Otherwise clearly ask for the exact missing input or explain the limitation. Do not repeat a completed non-idempotent action.`,
        verification,
      };
    }

    const status: ElaineVerification["status"] =
      unfinished.length > 0 || missingCurrentEvidence
        ? "blocked"
        : waiting
          ? "awaiting_confirmation"
          : "satisfied";
    const budgetExhausted =
      (unfinished.length > 0 || missingCurrentEvidence) &&
      this.budgetWasExhausted();
    const summary =
      status === "blocked"
        ? budgetExhausted
          ? "Runtime budget exhausted before all required evidence was verified"
          : missingCurrentEvidence
            ? "Could not verify the request with a current source"
            : `Could not satisfy ${unfinished.length} required plan step${unfinished.length === 1 ? "" : "s"}`
        : status === "awaiting_confirmation"
          ? "The answer is ready and one or more actions await confirmation"
          : "Plan criteria satisfied";
    const verification: ElaineVerification = {
      status,
      satisfiedCriteria,
      unsatisfiedCriteria,
      summary,
    };
    this.trace.verification = verification;
    this.emit("verification", summary);
    return { shouldReplan: false, verification };
  }

  complete(status?: ElaineTerminalStatus): ElaineRuntimeTrace {
    const resolvedStatus =
      status ??
      (this.trace.verification?.status === "satisfied"
        ? "completed"
        : this.trace.verification?.status === "awaiting_confirmation"
          ? "awaiting_confirmation"
          : "blocked");
    this.trace.status = resolvedStatus;
    this.trace.completedAt = this.now().toISOString();
    this.refreshElapsed();
    this.emit(
      "turn_completed",
      resolvedStatus === "completed"
        ? "Request completed"
        : resolvedStatus === "awaiting_confirmation"
          ? "Ready for confirmation"
          : resolvedStatus === "blocked"
            ? "Completed with a limitation"
            : `Turn ${resolvedStatus}`,
      { status: resolvedStatus },
    );
    return this.snapshot();
  }

  private findRunnableStep(toolName: string): ElainePlanStep | null {
    return (
      this.trace.plan.steps.find(
        (step) =>
          step.toolName === toolName &&
          ["planned", "blocked", "failed"].includes(step.status) &&
          step.attempts <= step.retryLimit,
      ) ?? null
    );
  }

  private addAdaptedStep(call: RuntimeToolCall): ElainePlanStep | null {
    if (this.trace.usage.replans >= this.budget.maxReplans) return null;
    this.trace.usage.replans += 1;
    const suffix = this.trace.plan.steps.length + 1;
    const id = `adjusted_${suffix}`;
    const step: ElainePlanStep = {
      id,
      label: call.consequential
        ? "Prepare the requested action"
        : `Check ${call.name.replace(/_/g, " ")}`,
      kind: call.consequential ? "action" : "lookup",
      toolName: call.name,
      dependsOn: this.trace.plan.steps
        .filter((candidate) => candidate.status === "completed")
        .map((candidate) => candidate.id),
      expectedEvidence: call.consequential
        ? "A validated action proposal or execution result"
        : "A successful, relevant tool observation",
      required: true,
      riskClass: call.consequential ? "consequential" : "read_only",
      confirmation: call.consequential ? "configured_policy" : "none",
      retryLimit: call.consequential ? 0 : 1,
      status: "planned",
      attempts: 0,
      summary: "Added after new information changed the route",
    };
    this.trace.plan.steps.push(step);
    return step;
  }

  private updateStep(
    step: ElainePlanStep,
    status: ElainePlanStep["status"],
    summary: string,
  ): void {
    step.status = status;
    step.summary = sanitizeRuntimeText(summary, 220);
    this.emit("step_updated", step.summary, {
      stepId: step.id,
      status,
      toolName: step.toolName ?? undefined,
    });
  }

  private emit(
    type: ElaineRuntimeEvent["type"],
    summary: string,
    extra: Partial<ElaineRuntimeEvent> = {},
  ): void {
    const event: ElaineRuntimeEvent = {
      id: `${this.trace.traceId}:${++this.sequence}`,
      sequence: this.sequence,
      type,
      at: this.now().toISOString(),
      summary: sanitizeRuntimeText(summary, 240),
      ...extra,
    };
    // Keep persistence and history payloads bounded even if a provider/model
    // behaves badly. The latest events are the most useful for diagnosis.
    this.trace.events = [...this.trace.events, event].slice(-100);
    this.eventSink?.(event, this.snapshot());
  }

  private withinElapsedBudget(): boolean {
    this.refreshElapsed();
    return this.trace.usage.elapsedMs <= this.budget.maxElapsedMs;
  }

  private budgetWasExhausted(): boolean {
    this.refreshElapsed();
    return (
      this.trace.usage.modelRounds >= this.budget.maxModelRounds ||
      this.trace.usage.toolCalls > this.budget.maxToolCalls ||
      this.trace.usage.replans >= this.budget.maxReplans ||
      this.trace.usage.elapsedMs > this.budget.maxElapsedMs
    );
  }

  private refreshElapsed(): void {
    this.trace.usage.elapsedMs = Math.max(
      0,
      this.now().getTime() - this.startedMs,
    );
  }
}
