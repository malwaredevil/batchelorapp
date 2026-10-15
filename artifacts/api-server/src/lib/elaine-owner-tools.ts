import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  appUsers,
  db,
  elaineCodeSuggestions,
  elaineTurnTraces,
} from "@workspace/db";
import { OWNER_SUPPORT_TOOL_NAMES } from "../elaine/owner-tool-catalog";
import { summarizeElaineDiagnostics } from "../elaine/runtime/diagnostic-summary";
import type { ElaineRuntimeTrace } from "../elaine/runtime/contracts";
import {
  diagnoseObservedRuntimeFailure,
  hasSecretLikeContent,
  listElaineCodeSuggestions,
} from "./elaine-code-diagnosis";
import { listSentryIssues } from "./sentry-issues";
import { logger } from "./logger";

const SuggestionInput = z
  .object({
    title: z.string().trim().min(1).max(180),
    recommendation: z.string().trim().min(1).max(4000),
  })
  .strict();

export async function savePendingElaineSuggestion(input: {
  patternKey: string;
  title: string;
  recommendation: string;
}) {
  if (hasSecretLikeContent(`${input.title}\n${input.recommendation}`)) {
    throw new Error("Suggestions must not contain credentials.");
  }
  const [created] = await db
    .insert(elaineCodeSuggestions)
    .values({
      patternKey: input.patternKey,
      lessonId: null,
      occurrenceCount: 1,
      observedPattern: input.title,
      filesReviewed: [],
      hypothesis: `Unverified recommendation for owner review:\n${input.recommendation}`,
      status: "pending",
    })
    .onConflictDoNothing({
      target: elaineCodeSuggestions.patternKey,
      where: sql`status = 'pending'`,
    })
    .returning();
  if (created) return { suggestion: created, alreadySaved: false };
  const [existing] = await db
    .select()
    .from(elaineCodeSuggestions)
    .where(
      and(
        eq(elaineCodeSuggestions.patternKey, input.patternKey),
        eq(elaineCodeSuggestions.status, "pending"),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Suggestion could not be saved.");
  return { suggestion: existing, alreadySaved: true };
}

/** Only strongly authenticated channels may access privileged support tools. */
export function ownerSupportChannelAllowed(channel: string): boolean {
  return ["web", "SMS/voice", "Slack"].includes(channel);
}

export function ownerSupportResultSummary(
  name: string,
  resultText: string,
): string | null {
  const result = JSON.parse(resultText) as {
    error?: unknown;
    configured?: boolean;
    count?: number;
    environment?: string;
    query?: string;
    saved?: boolean;
    id?: number;
    alreadySaved?: boolean;
  };
  if (result.error) return null;
  if (
    name === "save_elaine_suggestion" &&
    result.saved &&
    Number.isInteger(result.id)
  ) {
    return `${result.alreadySaved ? "Already saved" : "Saved"} in Elaine Suggestions as #${result.id}, for owner review. No code or settings were changed.`;
  }
  if (
    name === "list_sentry_issues" &&
    result.configured &&
    Number.isInteger(result.count)
  ) {
    return `Sentry reports ${result.count} ${result.query === "is:resolved" ? "resolved" : "unresolved"} ${result.environment} issue${result.count === 1 ? "" : "s"}.`;
  }
  return null;
}

export async function executeOwnerSupportTool(
  name: string,
  args: string | undefined,
  userId: number,
  channel = "web",
): Promise<string> {
  if (!OWNER_SUPPORT_TOOL_NAMES.has(name))
    throw new Error("Unsupported owner support tool.");
  if (!ownerSupportChannelAllowed(channel)) {
    return JSON.stringify({
      error: "owner_channel_not_verified",
      message:
        "Use signed-in chat, SMS, voice or Slack for privileged owner tools.",
    });
  }
  const [user] = await db
    .select({ isOwner: appUsers.isOwner })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  if (user?.isOwner !== true) {
    return JSON.stringify({
      error: "owner_required",
      message: "Only the authenticated app owner can use this tool.",
    });
  }
  const raw: unknown = JSON.parse(args ?? "{}");
  if (name === "save_elaine_suggestion") {
    const input = SuggestionInput.parse(raw);
    const key = createHash("sha256")
      .update(
        `${input.title.toLowerCase()}\n${input.recommendation.toLowerCase()}`,
      )
      .digest("hex");
    const result = await savePendingElaineSuggestion({
      patternKey: `owner_recommendation:${key}`,
      title: input.title,
      recommendation: input.recommendation,
    });
    return JSON.stringify({
      saved: true,
      id: result.suggestion.id,
      status: result.suggestion.status,
      alreadySaved: result.alreadySaved,
      reviewLocation: "Owner Panel → Elaine Suggestions",
    });
  }
  if (name === "list_elaine_suggestions") {
    const input = z
      .object({
        status: z.enum(["pending", "accepted", "dismissed"]).optional(),
      })
      .strict()
      .parse(raw);
    const suggestions = await listElaineCodeSuggestions(
      input.status ?? "pending",
    );
    return JSON.stringify({
      suggestions: suggestions.slice(0, 20).map((item) => ({
        id: item.id,
        title: item.observedPattern,
        recommendation: item.hypothesis,
        status: item.status,
        filesReviewed: item.filesReviewed,
      })),
    });
  }
  if (name === "get_recent_elaine_diagnostics") {
    const input = z
      .object({ limit: z.number().int().min(1).max(5).default(3) })
      .strict()
      .parse(raw);
    const rows = await db
      .select({
        id: elaineTurnTraces.id,
        status: elaineTurnTraces.status,
        plan: elaineTurnTraces.plan,
        observations: elaineTurnTraces.observations,
        verification: elaineTurnTraces.verification,
      })
      .from(elaineTurnTraces)
      .where(
        and(
          eq(elaineTurnTraces.userId, userId),
          sql`${elaineTurnTraces.completedAt} is not null`,
        ),
      )
      .orderBy(desc(elaineTurnTraces.startedAt))
      .limit(input.limit);
    return JSON.stringify({
      turns: rows.map((row) =>
        summarizeElaineDiagnostics({
          traceId: row.id,
          status: row.status as ElaineRuntimeTrace["status"],
          plan: row.plan as ElaineRuntimeTrace["plan"],
          observations: row.observations as ElaineRuntimeTrace["observations"],
          verification: row.verification as ElaineRuntimeTrace["verification"],
        }),
      ),
    });
  }
  const input = z
    .object({
      environment: z.enum(["production", "development"]).default("production"),
      query: z.enum(["is:unresolved", "is:resolved"]).default("is:unresolved"),
    })
    .strict()
    .parse(raw);
  const result = await listSentryIssues(input);
  return JSON.stringify({ ...result, ...input, count: result.issues.length });
}

let investigationRunning = false;

/** At most one diagnosis at a time; persisted pending keys prevent repeat spend. */
export function queueAutomaticElaineTroubleshooting(
  trace: Parameters<typeof summarizeElaineDiagnostics>[0],
): void {
  const diagnostic = summarizeElaineDiagnostics(trace);
  const failure = diagnostic.steps.find(
    (step) =>
      step.outcome === "tool_failed" ||
      (trace.status === "blocked" &&
        step.required &&
        ![
          "completed",
          "adjusted",
          "waiting_input",
          "waiting_confirmation",
        ].includes(step.status)),
  );
  if (!failure || failure.tool === "save_elaine_suggestion") return;
  if (
    /owner_required|owner_channel_not_verified|not_configured/.test(
      failure.errorCategory ?? "",
    )
  )
    return;
  void (async () => {
    const key = `runtime_failure:${failure.tool ?? failure.kind}:${failure.outcome}`;
    const evidence = [
      `Operation: ${failure.tool ?? failure.kind}. Outcome: ${failure.outcome}.`,
      failure.errorCategory
        ? `Recorded error category: ${failure.errorCategory}.`
        : "",
      ...failure.evidence,
      `Successful tools in this turn: ${
        diagnostic.steps
          .filter((step) => step.outcome === "tool_succeeded")
          .map((step) => step.tool)
          .filter(Boolean)
          .join(", ") || "none"
      }.`,
    ]
      .filter(Boolean)
      .join("\n");
    const saved = await savePendingElaineSuggestion({
      patternKey: key,
      title: `Elaine could not finish ${failure.tool ?? "the final response"}`,
      recommendation: `${evidence}\nInvestigate the missing capability, routing, or result handling. This is an observed execution gap, not a verified code diagnosis. Never retry consequential actions automatically.`,
    });
    if (saved.alreadySaved || investigationRunning) return;
    investigationRunning = true;
    try {
      const diagnosis = await diagnoseObservedRuntimeFailure(
        failure.tool === "list_sentry_issues"
          ? "runtime:sentry_failure"
          : "runtime:turn_failure",
        evidence,
      );
      if (!diagnosis) return;
      await db
        .update(elaineCodeSuggestions)
        .set({
          hypothesis: `Unverified code-grounded hypothesis for owner review:\n${diagnosis.hypothesis}`,
          filesReviewed: diagnosis.filesReferenced.map((path) => ({ path })),
        })
        .where(
          and(
            eq(elaineCodeSuggestions.id, saved.suggestion.id),
            eq(elaineCodeSuggestions.status, "pending"),
          ),
        );
    } finally {
      investigationRunning = false;
    }
  })().catch(() => {
    logger.warn(
      "Elaine automatic troubleshooting could not finish; no app changes were applied.",
    );
  });
}

export function restrictedToolOutcome(resultText: string): {
  success: boolean;
  errorCategory?: string;
} {
  try {
    const result = JSON.parse(resultText) as {
      error?: unknown;
      configured?: boolean;
    };
    if (result && typeof result === "object") {
      if (result.configured === false)
        return { success: false, errorCategory: "not_configured" };
      if (result.error)
        return {
          success: false,
          errorCategory:
            typeof result.error === "string" &&
            ["owner_required", "owner_channel_not_verified"].includes(
              result.error,
            )
              ? result.error
              : "tool_returned_error",
        };
    }
  } catch {
    /* Plain-text tool results are expected on restricted channels. */
  }
  if (
    /^Failed \(|^That action failed on our end|^Unsupported tool/.test(
      resultText,
    )
  )
    return { success: false, errorCategory: "tool_failed" };
  return { success: true };
}

/** Persist actual restricted-channel results, never raw tool bodies or prompts. */
export async function saveRestrictedElaineDiagnostics(input: {
  userId: number;
  channel: string;
  requestClass: ElaineRuntimeTrace["requestClass"];
  outcomes: Array<{
    name: string;
    kind: "action" | "lookup";
    success: boolean;
    errorCategory?: string;
  }>;
  hasAnswer: boolean;
}): Promise<void> {
  const now = new Date();
  const steps: ElaineRuntimeTrace["plan"]["steps"] = input.outcomes.map(
    (item, index) => ({
      id: `tool_${index}`,
      label: `Run ${item.name}`,
      kind: item.kind,
      status: item.success ? "completed" : "failed",
      toolName: item.name,
      required: true,
      dependsOn: [],
      expectedEvidence: "Recorded server tool result",
      riskClass: item.kind === "action" ? "consequential" : "read_only",
      confirmation: "none",
      retryLimit: 0,
      attempts: 1,
    }),
  );
  steps.push({
    id: "reply",
    label: "Provide the final answer",
    kind: "respond",
    status: input.hasAnswer ? "completed" : "planned",
    toolName: null,
    required: true,
    dependsOn: [],
    expectedEvidence: "A final textual reply",
    riskClass: "read_only",
    confirmation: "none",
    retryLimit: 0,
    attempts: 0,
  });
  const trace = {
    traceId: randomUUID(),
    status:
      input.hasAnswer && input.outcomes.every((item) => item.success)
        ? ("completed" as const)
        : ("blocked" as const),
    plan: {
      version: 1 as const,
      goal: "Respond to the authenticated owner",
      steps,
      assumptions: [],
      completionCriteria: [
        "Report recorded tool outcomes and provide a final reply",
      ],
    },
    observations: input.outcomes.map((item, index) => ({
      callId: `call_${index}`,
      stepId: `tool_${index}`,
      toolName: item.name,
      success: item.success,
      errorCategory: item.errorCategory,
      evidenceSummary: item.success
        ? "Server tool returned a result"
        : "Server tool recorded a failure",
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
    })),
    verification: null,
  };
  await db.insert(elaineTurnTraces).values({
    id: trace.traceId,
    userId: input.userId,
    channel: input.channel,
    requestClass: input.requestClass,
    goal: trace.plan.goal,
    plan: trace.plan,
    observations: trace.observations,
    status: trace.status,
    startedAt: now,
    completedAt: now,
  });
  queueAutomaticElaineTroubleshooting(trace);
}
