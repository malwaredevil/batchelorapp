import { eq } from "drizzle-orm";
import {
  db,
  agentphoneConversations,
  type AgentphoneConversationRow,
} from "@workspace/db";
import { logger } from "./logger";

export interface AgentphoneChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
 * Seeds the outbound-call context an AgentPhone reminder call needs before
 * it's placed, so that if the recipient replies (e.g. "yes, read it to me"),
 * the restricted Elaine turn handling that reply already knows what was
 * just said and — for issue #521 — has the speech-safe reminder description
 * ready to read back, without ever having seen the raw HTML or a URL.
 *
 * Stored as an "assistant" history entry since it reflects what Elaine
 * actually said (the spoken greeting), plus an optional bracketed note that
 * is private context only — the system prompt instructs the model never to
 * read bracketed notes aloud verbatim.
 */
export async function seedOutboundCallContext(
  phoneNumber: string,
  userId: number,
  spokenGreeting: string,
  privateContextNote?: string,
): Promise<void> {
  try {
    const conversation = await getOrCreateAgentphoneConversation(
      phoneNumber,
      userId,
    );
    const history =
      (conversation.messages as AgentphoneChatMessage[] | null) ?? [];
    const content = privateContextNote
      ? `${spokenGreeting}\n\n[Not spoken aloud — private context for you only: ${privateContextNote}]`
      : spokenGreeting;
    const updated: AgentphoneChatMessage[] = [
      ...history,
      { role: "assistant", content },
    ];
    await db
      .update(agentphoneConversations)
      .set({
        messages: updated,
        version: conversation.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(agentphoneConversations.id, conversation.id));
  } catch (err) {
    // Best-effort only: a failure here must never block placing the call
    // itself — worst case the recipient's reply is handled without this
    // extra context, same as before issue #521.
    logger.warn(
      { err, phoneNumber },
      "agentphone-conversation: failed to seed outbound call context",
    );
  }
}
