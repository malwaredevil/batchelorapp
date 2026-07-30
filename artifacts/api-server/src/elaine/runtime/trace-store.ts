import { and, eq, inArray } from "drizzle-orm";
import { db, elaineTurnTraces } from "@workspace/db";
import type { ElaineRuntimeTrace } from "./contracts";

export async function createElaineTurnTrace(input: {
  trace: ElaineRuntimeTrace;
  userId: number;
  conversationId: number | null;
  channel: string;
  model: string;
}): Promise<void> {
  await db.insert(elaineTurnTraces).values({
    id: input.trace.traceId,
    userId: input.userId,
    conversationId: input.conversationId,
    channel: input.channel,
    schemaVersion: input.trace.version,
    requestClass: input.trace.requestClass,
    goal: input.trace.goal,
    plan: input.trace.plan,
    sourceRoute: input.trace.sourceRoute ?? null,
    observations: input.trace.observations ?? [],
    events: input.trace.events,
    verification: input.trace.verification,
    status: input.trace.status,
    model: input.model,
    traceAvailable: input.trace.traceAvailable,
    startedAt: new Date(input.trace.startedAt),
    completedAt: input.trace.completedAt
      ? new Date(input.trace.completedAt)
      : null,
  });
}

export async function finishElaineTurnTrace(input: {
  trace: ElaineRuntimeTrace;
  assistantMessageId?: number | null;
}): Promise<void> {
  await db
    .update(elaineTurnTraces)
    .set({
      assistantMessageId: input.assistantMessageId ?? null,
      requestClass: input.trace.requestClass,
      goal: input.trace.goal,
      plan: input.trace.plan,
      sourceRoute: input.trace.sourceRoute ?? null,
      observations: input.trace.observations ?? [],
      events: input.trace.events,
      verification: input.trace.verification,
      status: input.trace.status,
      traceAvailable: input.trace.traceAvailable,
      completedAt: input.trace.completedAt
        ? new Date(input.trace.completedAt)
        : null,
    })
    .where(eq(elaineTurnTraces.id, input.trace.traceId));
}

export async function loadElaineTurnTracesForMessages(
  userId: number,
  messageIds: number[],
): Promise<Map<number, ElaineRuntimeTrace>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      assistantMessageId: elaineTurnTraces.assistantMessageId,
      id: elaineTurnTraces.id,
      requestClass: elaineTurnTraces.requestClass,
      goal: elaineTurnTraces.goal,
      plan: elaineTurnTraces.plan,
      sourceRoute: elaineTurnTraces.sourceRoute,
      observations: elaineTurnTraces.observations,
      events: elaineTurnTraces.events,
      verification: elaineTurnTraces.verification,
      status: elaineTurnTraces.status,
      traceAvailable: elaineTurnTraces.traceAvailable,
      startedAt: elaineTurnTraces.startedAt,
      completedAt: elaineTurnTraces.completedAt,
    })
    .from(elaineTurnTraces)
    .where(
      and(
        eq(elaineTurnTraces.userId, userId),
        inArray(elaineTurnTraces.assistantMessageId, messageIds),
      ),
    );

  const result = new Map<number, ElaineRuntimeTrace>();
  for (const row of rows) {
    if (row.assistantMessageId === null) continue;
    result.set(row.assistantMessageId, {
      version: 1,
      traceId: row.id,
      requestClass: row.requestClass as ElaineRuntimeTrace["requestClass"],
      goal: row.goal,
      plan: row.plan as ElaineRuntimeTrace["plan"],
      ...(row.sourceRoute
        ? {
            sourceRoute: row.sourceRoute as NonNullable<
              ElaineRuntimeTrace["sourceRoute"]
            >,
          }
        : {}),
      observations: row.observations as NonNullable<
        ElaineRuntimeTrace["observations"]
      >,
      events: row.events as ElaineRuntimeTrace["events"],
      verification:
        (row.verification as ElaineRuntimeTrace["verification"]) ?? null,
      status: row.status as ElaineRuntimeTrace["status"],
      traceAvailable: row.traceAvailable,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      usage: {
        modelRounds: 0,
        toolCalls: 0,
        replans: 0,
        elapsedMs: row.completedAt
          ? Math.max(0, row.completedAt.getTime() - row.startedAt.getTime())
          : 0,
      },
    });
  }
  return result;
}

/**
 * Trace storage is diagnostic. A migration/deployment race or database issue
 * must never prevent Elaine from answering the family.
 */
export async function persistElaineTraceBestEffort(
  operation: () => Promise<void>,
  onFailure?: (error: unknown) => void,
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    onFailure?.(error);
    return false;
  }
}
