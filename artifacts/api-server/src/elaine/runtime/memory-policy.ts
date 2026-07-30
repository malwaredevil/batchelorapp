import { sanitizeRuntimeText } from "./contracts";

export interface ElaineMemoryCandidate {
  id: number;
  content: string;
  type: string;
  scope: string;
  ownerUserId: number | null;
  active: boolean;
  deletedAt: Date | null;
  expiresAt: Date | null;
  source: string;
  lastConfirmedAt: Date | null;
  confidence: string | number;
  correctionOfId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RankedElaineMemory extends ElaineMemoryCandidate {
  relevanceScore: number;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "could",
  "from",
  "have",
  "just",
  "please",
  "that",
  "their",
  "there",
  "these",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? [],
  );
}

function confidenceNumber(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

export function rankElaineMemories(input: {
  memories: readonly ElaineMemoryCandidate[];
  query: string;
  userId: number;
  now?: Date;
  limit?: number;
}): RankedElaineMemory[] {
  const now = input.now ?? new Date();
  const queryTokens = tokens(input.query);
  const correctedIds = new Set(
    input.memories
      .map((memory) => memory.correctionOfId)
      .filter((id): id is number => id !== null),
  );

  return input.memories
    .filter(
      (memory) =>
        memory.type === "fact" &&
        memory.active &&
        memory.deletedAt === null &&
        (memory.expiresAt === null || memory.expiresAt > now) &&
        (memory.scope !== "personal" || memory.ownerUserId === input.userId) &&
        !correctedIds.has(memory.id),
    )
    .map((memory): RankedElaineMemory => {
      const memoryTokens = tokens(memory.content);
      const overlap = [...queryTokens].filter((token) =>
        memoryTokens.has(token),
      ).length;
      const lexical =
        queryTokens.size === 0 ? 0.25 : overlap / Math.max(queryTokens.size, 1);
      const confirmedAt =
        memory.lastConfirmedAt ?? memory.updatedAt ?? memory.createdAt;
      const ageDays = Math.max(
        0,
        (now.getTime() - confirmedAt.getTime()) / 86_400_000,
      );
      const recency = Math.max(0, 1 - ageDays / 365);
      const explicit = memory.source.startsWith("explicit") ? 0.2 : 0;
      const personal = memory.scope === "personal" ? 0.05 : 0;
      return {
        ...memory,
        content: sanitizeRuntimeText(memory.content, 500),
        relevanceScore:
          lexical * 0.55 +
          recency * 0.15 +
          confidenceNumber(memory.confidence) * 0.25 +
          explicit +
          personal,
      };
    })
    .filter(
      (memory) =>
        queryTokens.size === 0 ||
        memory.relevanceScore >= 0.3 ||
        memory.source.startsWith("explicit"),
    )
    .sort(
      (a, b) =>
        b.relevanceScore - a.relevanceScore ||
        (b.lastConfirmedAt ?? b.updatedAt).getTime() -
          (a.lastConfirmedAt ?? a.updatedAt).getTime(),
    )
    .slice(0, Math.max(1, Math.min(input.limit ?? 12, 30)));
}

export function formatMemoryEvidence(
  memories: readonly RankedElaineMemory[],
): string {
  if (memories.length === 0) return "(no relevant durable memory)";
  return memories
    .map(
      (memory) =>
        `- [${memory.scope}; ${memory.source}; last confirmed ${
          memory.lastConfirmedAt?.toISOString() ?? "unknown"
        }] ${memory.content}`,
    )
    .join("\n");
}
