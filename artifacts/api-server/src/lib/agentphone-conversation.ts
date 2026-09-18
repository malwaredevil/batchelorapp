import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  agentphoneConversations,
  type AgentphoneConversationRow,
} from "@workspace/db";

export interface AgentphoneChatMessage {
  role: "user" | "assistant";
  content: string;
}

const PENDING_OUTBOUND_CONTEXT_TTL_MS = 60 * 60 * 1_000;

/**
 * Loads the rolling AgentPhone conversation for a phone number, creating an
 * empty one if none exists yet. Shared by the inbound webhook
 * (routes/agentphone.ts) and the outbound reminder-call context seeder
 * below, which both key off the same one-conversation-per-number row.
 */
export async function getOrCreateAgentphoneConversation(
  phoneNumber: string,
  userId: number,
): Promise<AgentphoneConversationRow> {
  const [existing] = await db
    .select()
    .from(agentphoneConversations)
    .where(eq(agentphoneConversations.phoneNumber, phoneNumber));
  if (existing) return existing;

  const [created] = await db
    .insert(agentphoneConversations)
    .values({ phoneNumber, userId, messages: [] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with another delivery for the same number.
  const [row] = await db
    .select()
    .from(agentphoneConversations)
    .where(eq(agentphoneConversations.phoneNumber, phoneNumber));
  return row;
}

/**
 * Seeds the pending purpose of an outbound AgentPhone call before it is placed.
 * AgentPhone starts the call silently; when the recipient first speaks, the
 * restricted Elaine turn knows to introduce herself and deliver this opening.
 *
 * Stored separately from shared SMS/voice history so an SMS cannot consume,
 * supersede, or receive a voice call's opening.
 */
export async function seedOutboundCallContext(
  phoneNumber: string,
  userId: number,
  openingMessage: string,
  privateContextNote?: string,
): Promise<string> {
  const conversation = await getOrCreateAgentphoneConversation(
    phoneNumber,
    userId,
  );
  const pendingId = randomUUID();
  await db
    .update(agentphoneConversations)
    .set({
      pendingOutboundId: pendingId,
      pendingOutboundCallId: null,
      pendingOutboundOpening: openingMessage,
      pendingOutboundPrivateContext: privateContextNote ?? null,
      pendingOutboundExpiresAt: new Date(
        Date.now() + PENDING_OUTBOUND_CONTEXT_TTL_MS,
      ),
      updatedAt: new Date(),
    })
    .where(eq(agentphoneConversations.id, conversation.id));
  return pendingId;
}

/** Clears only the pending purpose created by the matching call attempt. */
export async function clearPendingOutboundCallContext(
  phoneNumber: string,
  pendingId: string,
): Promise<void> {
  await db
    .update(agentphoneConversations)
    .set({
      pendingOutboundId: null,
      pendingOutboundCallId: null,
      pendingOutboundOpening: null,
      pendingOutboundPrivateContext: null,
      pendingOutboundExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentphoneConversations.phoneNumber, phoneNumber),
        eq(agentphoneConversations.pendingOutboundId, pendingId),
      ),
    );
}

/** Correlates the pending purpose with the provider call after creation. */
export async function attachPendingOutboundCallId(
  phoneNumber: string,
  pendingId: string,
  callId: string,
): Promise<void> {
  await db
    .update(agentphoneConversations)
    .set({ pendingOutboundCallId: callId, updatedAt: new Date() })
    .where(
      and(
        eq(agentphoneConversations.phoneNumber, phoneNumber),
        eq(agentphoneConversations.pendingOutboundId, pendingId),
      ),
    );
}

/** Clears pending context when the correlated provider call cannot answer. */
export async function clearPendingOutboundCallContextByCallId(
  callId: string,
): Promise<void> {
  await db
    .update(agentphoneConversations)
    .set({
      pendingOutboundId: null,
      pendingOutboundCallId: null,
      pendingOutboundOpening: null,
      pendingOutboundPrivateContext: null,
      pendingOutboundExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(agentphoneConversations.pendingOutboundCallId, callId));
}

/**
 * Returns true while the newest conversation entry is an outbound purpose that
 * has not yet received a vocal response. This lets the webhook stay silent even
 * if AgentPhone omits direction metadata from its empty startup event.
 */
export async function hasPendingOutboundCallContext(
  phoneNumber: string,
): Promise<boolean> {
  if (!phoneNumber) return false;
  const [conversation] = await db
    .select({
      pendingOutboundId: agentphoneConversations.pendingOutboundId,
      pendingOutboundExpiresAt:
        agentphoneConversations.pendingOutboundExpiresAt,
    })
    .from(agentphoneConversations)
    .where(eq(agentphoneConversations.phoneNumber, phoneNumber))
    .limit(1);
  return Boolean(
    conversation?.pendingOutboundId &&
    conversation.pendingOutboundExpiresAt &&
    conversation.pendingOutboundExpiresAt > new Date(),
  );
}
