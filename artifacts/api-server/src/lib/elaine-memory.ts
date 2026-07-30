import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  elaineMemory,
  elaineMemoryEvents,
  type ElaineMemoryRow,
} from "@workspace/db";
import {
  formatMemoryEvidence,
  rankElaineMemories,
} from "../elaine/runtime/memory-policy";

export type ElaineMemoryScope = "household" | "personal" | "temporary";
export type ElaineMemoryCategory =
  | "fact"
  | "preference"
  | "instruction"
  | "person"
  | "place"
  | "collection";
export type ElaineMemorySensitivity = "low" | "medium" | "high";

function canAccessMemory(
  row: Pick<ElaineMemoryRow, "scope" | "ownerUserId">,
  userId: number,
): boolean {
  return row.scope !== "personal" || row.ownerUserId === userId;
}

export async function getRelevantElaineMemory(input: {
  userId: number;
  query: string;
  limit?: number;
}): Promise<{
  memories: ReturnType<typeof rankElaineMemories>;
  evidenceBlock: string;
  existingFactContents: string[];
}> {
  const rows = await db
    .select()
    .from(elaineMemory)
    .where(
      and(
        eq(elaineMemory.type, "fact"),
        eq(elaineMemory.active, true),
        isNull(elaineMemory.deletedAt),
        or(
          isNull(elaineMemory.expiresAt),
          sql`${elaineMemory.expiresAt} > NOW()`,
        ),
        or(
          sql`${elaineMemory.scope} != 'personal'`,
          eq(elaineMemory.ownerUserId, input.userId),
        ),
      ),
    )
    .orderBy(desc(elaineMemory.lastConfirmedAt), desc(elaineMemory.updatedAt))
    .limit(100);
  const memories = rankElaineMemories({
    memories: rows,
    query: input.query,
    userId: input.userId,
    limit: input.limit,
  });
  return {
    memories,
    evidenceBlock: formatMemoryEvidence(memories),
    existingFactContents: memories.map(({ content }) => content),
  };
}

export async function getElaineMemorySummary(
  userId: number,
): Promise<string | null> {
  const rows = await db
    .select({
      content: elaineMemory.content,
      scope: elaineMemory.scope,
      ownerUserId: elaineMemory.ownerUserId,
      source: elaineMemory.source,
      updatedAt: elaineMemory.updatedAt,
    })
    .from(elaineMemory)
    .where(
      and(
        eq(elaineMemory.type, "summary"),
        eq(elaineMemory.active, true),
        isNull(elaineMemory.deletedAt),
        or(
          and(
            eq(elaineMemory.scope, "personal"),
            eq(elaineMemory.ownerUserId, userId),
          ),
          // Backward-compatible read of the legacy household summary until
          // every user has a personal generated summary.
          eq(elaineMemory.scope, "household"),
        ),
      ),
    )
    .orderBy(desc(elaineMemory.updatedAt))
    .limit(10);
  return (
    rows.find((row) => row.scope === "personal" && row.ownerUserId === userId)
      ?.content ??
    rows.find((row) => row.scope === "household")?.content ??
    null
  );
}

export async function rememberElaineMemory(input: {
  userId: number;
  content: string;
  scope?: ElaineMemoryScope;
  category?: ElaineMemoryCategory;
  sensitivity?: ElaineMemorySensitivity;
  expiresAt?: Date | null;
  source?: "explicit_user" | "explicit_assistant";
}): Promise<ElaineMemoryRow> {
  const scope = input.scope ?? "household";
  return db.transaction(async (tx) => {
    const [duplicate] = await tx
      .select()
      .from(elaineMemory)
      .where(
        and(
          eq(elaineMemory.type, "fact"),
          eq(elaineMemory.content, input.content),
          eq(elaineMemory.scope, scope),
          eq(elaineMemory.active, true),
          isNull(elaineMemory.deletedAt),
          scope === "personal"
            ? eq(elaineMemory.ownerUserId, input.userId)
            : isNull(elaineMemory.ownerUserId),
        ),
      )
      .limit(1);
    const now = new Date();
    if (duplicate) {
      const [confirmed] = await tx
        .update(elaineMemory)
        .set({
          lastConfirmedAt: now,
          confidence: "1.000",
          source: input.source ?? "explicit_user",
          updatedAt: now,
        })
        .where(eq(elaineMemory.id, duplicate.id))
        .returning();
      await tx.insert(elaineMemoryEvents).values({
        memoryId: confirmed.id,
        userId: input.userId,
        action: "confirmed",
        metadata: { scope },
      });
      return confirmed;
    }

    const [created] = await tx
      .insert(elaineMemory)
      .values({
        type: "fact",
        content: input.content,
        scope,
        category: input.category ?? "fact",
        sensitivity: input.sensitivity ?? "low",
        ownerUserId: scope === "personal" ? input.userId : null,
        expiresAt: input.expiresAt ?? undefined,
        source: input.source ?? "explicit_user",
        lastConfirmedAt: now,
        confidence: "1.000",
        createdByUserId: input.userId,
      })
      .returning();
    await tx.insert(elaineMemoryEvents).values({
      memoryId: created.id,
      userId: input.userId,
      action: "remembered",
      metadata: { scope },
    });
    return created;
  });
}

export async function correctElaineMemory(input: {
  userId: number;
  memoryId: number;
  correctedContent: string;
}): Promise<ElaineMemoryRow | null | "forbidden"> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(elaineMemory)
      .where(
        and(
          eq(elaineMemory.id, input.memoryId),
          eq(elaineMemory.active, true),
          isNull(elaineMemory.deletedAt),
        ),
      );
    if (!existing) return null;
    if (!canAccessMemory(existing, input.userId)) return "forbidden";

    const now = new Date();
    await tx
      .update(elaineMemory)
      .set({ active: false, deletedAt: now, updatedAt: now })
      .where(eq(elaineMemory.id, existing.id));
    const [corrected] = await tx
      .insert(elaineMemory)
      .values({
        type: "fact",
        content: input.correctedContent,
        scope: existing.scope,
        category: existing.category,
        sensitivity: existing.sensitivity,
        ownerUserId: existing.ownerUserId,
        expiresAt: existing.expiresAt,
        source: "explicit_user",
        lastConfirmedAt: now,
        confidence: "1.000",
        correctionOfId: existing.id,
        createdByUserId: input.userId,
      })
      .returning();
    await tx.insert(elaineMemoryEvents).values({
      memoryId: corrected.id,
      previousMemoryId: existing.id,
      userId: input.userId,
      action: "corrected",
      metadata: { scope: existing.scope },
    });
    return corrected;
  });
}

export async function forgetElaineMemory(input: {
  userId: number;
  memoryId: number;
}): Promise<boolean | "forbidden"> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(elaineMemory)
      .where(
        and(
          eq(elaineMemory.id, input.memoryId),
          eq(elaineMemory.active, true),
          isNull(elaineMemory.deletedAt),
        ),
      );
    if (!existing) return false;
    if (!canAccessMemory(existing, input.userId)) return "forbidden";

    const now = new Date();
    await tx
      .update(elaineMemory)
      .set({ active: false, deletedAt: now, updatedAt: now })
      .where(eq(elaineMemory.id, existing.id));
    await tx.insert(elaineMemoryEvents).values({
      memoryId: existing.id,
      userId: input.userId,
      action: "forgotten",
      metadata: { scope: existing.scope },
    });
    return true;
  });
}

export async function saveElaineMemorySummary(input: {
  userId: number;
  content: string;
}): Promise<void> {
  const [existing] = await db
    .select({ id: elaineMemory.id })
    .from(elaineMemory)
    .where(
      and(
        eq(elaineMemory.type, "summary"),
        eq(elaineMemory.scope, "personal"),
        eq(elaineMemory.ownerUserId, input.userId),
        eq(elaineMemory.active, true),
        isNull(elaineMemory.deletedAt),
      ),
    )
    .limit(1);
  const now = new Date();
  if (existing) {
    await db
      .update(elaineMemory)
      .set({
        content: input.content,
        source: "assistant_summary",
        confidence: "0.500",
        updatedAt: now,
      })
      .where(eq(elaineMemory.id, existing.id));
    return;
  }
  await db.insert(elaineMemory).values({
    type: "summary",
    content: input.content,
    scope: "personal",
    ownerUserId: input.userId,
    source: "assistant_summary",
    confidence: "0.500",
    createdByUserId: input.userId,
  });
}
