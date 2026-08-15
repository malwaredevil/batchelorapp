import { z } from "zod/v4";

export const ElaineRequestKindSchema = z.enum([
  "answer",
  "read",
  "research",
  "action",
  "mixed",
]);
export type ElaineRequestKind = z.infer<typeof ElaineRequestKindSchema>;

export const ElaineRequestComplexitySchema = z.enum(["simple", "multi_step"]);
export type ElaineRequestComplexity = z.infer<
  typeof ElaineRequestComplexitySchema
>;

export const ElaineRequestClassSchema = z.object({
  kind: ElaineRequestKindSchema,
  complexity: ElaineRequestComplexitySchema,
  requiresFreshData: z.boolean(),
  hasAttachment: z.boolean(),
});
export type ElaineRequestClass = z.infer<typeof ElaineRequestClassSchema>;

export const ElainePlanStepKindSchema = z.enum([
  "lookup",
  "research",
  "action",
  "clarify",
  "respond",
]);
export type ElainePlanStepKind = z.infer<typeof ElainePlanStepKindSchema>;

export const ElainePlanStepStatusSchema = z.enum([
  "planned",
  "active",
  "waiting_confirmation",
  "waiting_input",
  "adjusted",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);
export type ElainePlanStepStatus = z.infer<typeof ElainePlanStepStatusSchema>;

export const ElainePlanStepInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i),
  label: z.string().trim().min(1).max(140),
  kind: ElainePlanStepKindSchema,
  toolName: z.string().trim().min(1).max(100).nullable().optional(),
  dependsOn: z.array(z.string().trim().min(1).max(48)).max(8).default([]),
  expectedEvidence: z.string().trim().min(1).max(220),
  required: z.boolean().default(true),
});
export type ElainePlanStepInput = z.infer<typeof ElainePlanStepInputSchema>;

export const ElainePlanInputSchema = z.object({
  version: z.literal(1).default(1),
  goal: z.string().trim().min(1).max(240),
  assumptions: z.array(z.string().trim().min(1).max(180)).max(4).default([]),
  completionCriteria: z.array(z.string().trim().min(1).max(220)).min(1).max(6),
  steps: z.array(ElainePlanStepInputSchema).min(1).max(10),
});
export type ElainePlanInput = z.infer<typeof ElainePlanInputSchema>;

export interface ElainePlanStep extends ElainePlanStepInput {
  riskClass: "read_only" | "consequential";
  confirmation: "none" | "configured_policy";
  retryLimit: number;
  status: ElainePlanStepStatus;
  summary?: string;
  attempts: number;
}

export interface ElainePlanSelection {
  /** Short label for the approach that was ultimately chosen. */
  chosenApproach: string;
  /** Short labels for the other candidate approach(es) that were rejected. */
  alternativeApproaches: string[];
  /** Concrete, user-safe reason the chosen approach beat the alternative(s). */
  reason: string;
  /**
   * Zero-based index of the chosen candidate in the original ordered list
   * produced by the planner. Index 0 means the first/default candidate was
   * kept; any higher value means a non-default approach was selected.
   * Absent on traces written before this field was added.
   */
  chosenIndex?: number;
}

export interface ElainePlan {
  version: 1;
  goal: string;
  assumptions: string[];
  completionCriteria: string[];
  steps: ElainePlanStep[];
  /**
   * Present when this plan was picked among >=2 candidate approaches by the
   * multi-path planning step (only runs for requests that already trigger
   * structured planning — see `requestNeedsStructuredPlan`). Riding along on
   * the plan itself means the existing plan-progress trace shows the
   * comparison for free, with no schema/DB migration since `plan` is stored
   * as jsonb as-is.
   */
  planSelection?: ElainePlanSelection;
}

export const ElaineObservationSchema = z.object({
  callId: z.string().min(1).max(160),
  stepId: z.string().min(1).max(48).nullable(),
  toolName: z.string().min(1).max(100),
  success: z.boolean(),
  // True when this observation is a proposed-but-not-yet-confirmed action
  // (e.g. a confirmation card was sent to the user) rather than an action
  // that actually executed. `success: true` alone does not mean "this
  // happened" for these — the self-heal detector in self-heal-policy.ts
  // relies on this to avoid treating a pending confirmation card as proof
  // that "I already saved/sent/scheduled that" is true.
  waitingConfirmation: z.boolean().optional(),
  errorCategory: z.string().max(80).optional(),
  evidenceSummary: z.string().max(220),
  resultReference: z.string().max(240).optional(),
  source: z.string().max(120).optional(),
  provenance: z
    .object({
      sourceKind: z.enum([
        "current_context",
        "batchelor_app",
        "first_party_provider",
        "specialized_api",
        "web",
        "model_synthesis",
      ]),
      sourceName: z.string().max(120),
      observedAt: z.iso.datetime(),
      evidenceKind: z.enum(["retrieved_fact", "inference"]),
      confidence: z.enum(["high", "medium", "low"]),
      sourceUrl: z.string().max(500).optional(),
      internalReference: z.string().max(240).optional(),
      coverage: z.object({
        status: z.enum(["matched", "partial", "outside", "unknown"]),
        start: z.string().max(80).optional(),
        end: z.string().max(80).optional(),
        geography: z.string().max(160).optional(),
      }),
    })
    .optional(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});
export type ElaineObservation = z.infer<typeof ElaineObservationSchema>;

export type ElaineSourceKind =
  | "current_context"
  | "batchelor_app"
  | "first_party_provider"
  | "specialized_api"
  | "web"
  | "model_synthesis";

export type ElaineObservationProvenance = NonNullable<
  ElaineObservation["provenance"]
>;

export interface ElaineSourceRoute {
  freshness: "stable" | "recent" | "current";
  requiresRetrievedEvidence: boolean;
  preferredKinds: ElaineSourceKind[];
  fallbackKinds: ElaineSourceKind[];
  rationale: string;
}

export const ElaineTerminalStatusSchema = z.enum([
  "completed",
  "awaiting_confirmation",
  "awaiting_input",
  "blocked",
  "failed",
  "cancelled",
]);
export type ElaineTerminalStatus = z.infer<typeof ElaineTerminalStatusSchema>;

export const ElaineRuntimeEventTypeSchema = z.enum([
  "turn_started",
  "plan_created",
  "plan_compared",
  "plan_revised",
  "step_updated",
  "observation",
  "verification",
  "turn_completed",
]);
export type ElaineRuntimeEventType = z.infer<
  typeof ElaineRuntimeEventTypeSchema
>;

export interface ElaineRuntimeEvent {
  id: string;
  sequence: number;
  type: ElaineRuntimeEventType;
  at: string;
  stepId?: string;
  status?: ElainePlanStepStatus | ElaineTerminalStatus;
  summary: string;
  toolName?: string;
  errorCategory?: string;
}

export interface ElaineVerification {
  status:
    | "satisfied"
    | "needs_replan"
    | "awaiting_confirmation"
    | "awaiting_input"
    | "blocked";
  satisfiedCriteria: string[];
  unsatisfiedCriteria: string[];
  summary: string;
  replanReason?: string;
}

export interface ElaineRuntimeBudget {
  maxModelRounds: number;
  maxToolCalls: number;
  maxReplans: number;
  maxElapsedMs: number;
}

export interface ElaineRuntimeUsage {
  modelRounds: number;
  toolCalls: number;
  replans: number;
  elapsedMs: number;
}

export interface ElaineRuntimeTrace {
  version: 1;
  traceId: string;
  requestClass: ElaineRequestClass;
  goal: string;
  plan: ElainePlan;
  sourceRoute?: ElaineSourceRoute;
  observations?: ElaineObservation[];
  events: ElaineRuntimeEvent[];
  verification: ElaineVerification | null;
  status: ElaineTerminalStatus | "running";
  traceAvailable: boolean;
  startedAt: string;
  completedAt: string | null;
  usage: ElaineRuntimeUsage;
}

/**
 * The exact string that `sanitizeRuntimeText` substitutes when the entire
 * value is a hidden-reasoning block (e.g. `<think>…</think>`).
 * Exported so callers can detect a pure-reasoning result without duplicating
 * the literal string.
 */
export const PRIVATE_REASONING_SENTINEL = "[private reasoning omitted]";

const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\b\s*[:=]\s*["']?[^,\s"']+/gi;
const BEARER_RE = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const DATABASE_URL_RE =
  /\bpostgres(?:ql)?:\/\/[^\s]+|\b(?:SUPABASE|DATABASE)_URL\s*[:=]\s*\S+/gi;
const HIDDEN_REASONING_RE =
  /<(?:think|thinking|reasoning)>[\s\S]*?<\/(?:think|thinking|reasoning)>/gi;

/**
 * Runtime traces only accept concise user-safe summaries. This is a final
 * defense in depth layer; callers should never pass raw prompts, tool
 * arguments, provider payloads, documents, or chain-of-thought here.
 */
export function sanitizeRuntimeText(value: unknown, maxLength = 240): string {
  const text = String(value ?? "")
    .replace(HIDDEN_REASONING_RE, "[private reasoning omitted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT_RE, "$1=[redacted]")
    .replace(DATABASE_URL_RE, "[database connection redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

export function toRuntimePlan(input: ElainePlanInput): ElainePlan {
  return {
    version: 1,
    goal: sanitizeRuntimeText(input.goal),
    assumptions: input.assumptions.map((value) =>
      sanitizeRuntimeText(value, 180),
    ),
    completionCriteria: input.completionCriteria.map((value) =>
      sanitizeRuntimeText(value, 220),
    ),
    steps: input.steps.map((step) => ({
      ...step,
      label: sanitizeRuntimeText(step.label, 140),
      expectedEvidence: sanitizeRuntimeText(step.expectedEvidence, 220),
      toolName: step.toolName ?? null,
      riskClass: step.kind === "action" ? "consequential" : "read_only",
      confirmation: step.kind === "action" ? "configured_policy" : "none",
      retryLimit: step.kind === "action" || step.kind === "clarify" ? 0 : 1,
      status: "planned",
      attempts: 0,
    })),
  };
}
