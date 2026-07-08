import { Router, type IRouter, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  appUsers,
  agentphoneConversations,
  agentphoneWebhookDeliveries,
  type AgentphoneConversationRow,
} from "@workspace/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { sendSms, SmsOptedOutError } from "../lib/sms";
import { runAgentphoneTurn, type AgentphoneChatMessage } from "../elaine";

// ---------------------------------------------------------------------------
// AgentPhone SMS/voice webhook (task #105). Handles three things:
//  1. A2P 10DLC compliance keywords (STOP/HELP/START family), which must
//     work even for unrecognized numbers and even while opted out.
//  2. Household member SMS routed through a restricted, non-destructive
//     Elaine turn (see runAgentphoneTurn in ../elaine).
//  3. Voice call turns, which must respond with `{ text }` JSON instead of
//     sending an SMS.
// See threat_model.md's "API to AgentPhone" boundary for the security
// requirements this route must uphold (signature verification, replay
// protection, no cross-household-member confusion).
// ---------------------------------------------------------------------------

const router: IRouter = Router();

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);
const HELP_WORDS = new Set(["HELP", "INFO"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);

// Rejects a signature whose timestamp is stale, even if the HMAC itself is
// valid — bounds how long a captured request could be replayed.
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

function normalizeKeyword(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function verifySignature(req: Request): boolean {
  if (!env.agentphoneWebhookSecret) return false;

  const signatureHeader = req.get("x-webhook-signature");
  const timestampHeader = req.get("x-webhook-timestamp");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!signatureHeader || !timestampHeader || !rawBody) return false;

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (
    Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const match = /^sha256=([0-9a-f]+)$/i.exec(signatureHeader);
  if (!match) return false;

  const signedString = `${timestampHeader}.${rawBody.toString("utf8")}`;
  const expectedHex = createHmac("sha256", env.agentphoneWebhookSecret)
    .update(signedString)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const providedBuf = Buffer.from(match[1].toLowerCase(), "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Records the delivery id before any side effect runs so a redelivered
// webhook (AgentPhone retries on slow/ambiguous responses) is a no-op.
// Returns false when the id was already claimed (duplicate delivery).
async function claimDelivery(id: string): Promise<boolean> {
  try {
    await db.insert(agentphoneWebhookDeliveries).values({ id });
    return true;
  } catch {
    return false;
  }
}

async function getOrCreateAgentphoneConversation(
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

async function runRestrictedTurnAndPersist(
  conversation: AgentphoneConversationRow,
  userId: number,
  inputText: string,
): Promise<string> {
  const history =
    (conversation.messages as AgentphoneChatMessage[] | null) ?? [];
  let replyText: string;
  let updatedHistory: AgentphoneChatMessage[];
  try {
    const result = await runAgentphoneTurn({ userId, inputText, history });
    replyText = result.replyText;
    updatedHistory = result.history;
  } catch (err) {
    logger.error({ err }, "agentphone: restricted Elaine turn failed");
    replyText =
      "Sorry, something went wrong on our end — please try again or use the app.";
    updatedHistory = history;
  }

  await db
    .update(agentphoneConversations)
    .set({ messages: updatedHistory, updatedAt: new Date() })
    .where(eq(agentphoneConversations.id, conversation.id));

  return replyText;
}

async function handleSms(req: Request, res: Response): Promise<void> {
  const data = (req.body?.data ?? {}) as {
    from?: unknown;
    message?: unknown;
  };
  const from = typeof data.from === "string" ? data.from : "";
  const messageText = typeof data.message === "string" ? data.message : "";
  if (!from) {
    res.status(200).json({ ok: true });
    return;
  }

  const [user] = await db
    .select({
      id: appUsers.id,
      smsOptedOutAt: appUsers.smsOptedOutAt,
    })
    .from(appUsers)
    .where(eq(appUsers.phoneNumber, from))
    .limit(1);

  const keyword = normalizeKeyword(messageText);

  // STOP/HELP/START must work regardless of whether we recognize the
  // number as a household member, and regardless of current opt-out state
  // — this is a carrier compliance requirement (A2P 10DLC), not an app
  // feature gated on auth.
  if (STOP_WORDS.has(keyword)) {
    if (user) {
      await db
        .update(appUsers)
        .set({ smsOptedOutAt: new Date() })
        .where(eq(appUsers.id, user.id));
    }
    await sendSms(
      from,
      "You've been unsubscribed from Batchelor App texts and won't receive any more messages. Reply START to resubscribe.",
      { bypassOptOutCheck: true },
    ).catch((err) =>
      logger.error({ err }, "agentphone: STOP confirmation send failed"),
    );
    res.status(200).json({ ok: true });
    return;
  }

  if (HELP_WORDS.has(keyword)) {
    await sendSms(
      from,
      "Batchelor App: household trip reminder texts. Msg & data rates may apply. Reply STOP to unsubscribe. Questions? Use the app.",
      { bypassOptOutCheck: true },
    ).catch((err) =>
      logger.error({ err }, "agentphone: HELP reply send failed"),
    );
    res.status(200).json({ ok: true });
    return;
  }

  if (START_WORDS.has(keyword)) {
    if (user) {
      await db
        .update(appUsers)
        .set({ smsOptedOutAt: null })
        .where(eq(appUsers.id, user.id));
    }
    await sendSms(
      from,
      "You're resubscribed to Batchelor App texts. Reply STOP at any time to opt out.",
      { bypassOptOutCheck: true },
    ).catch((err) =>
      logger.error({ err }, "agentphone: START confirmation send failed"),
    );
    res.status(200).json({ ok: true });
    return;
  }

  if (!user) {
    // Unrecognized number: never process or reply to non-compliance
    // messages from a number we can't tie to a household account.
    res.status(200).json({ ok: true });
    return;
  }

  if (user.smsOptedOutAt) {
    // Opted out: no reply except the STOP/HELP/START handling above.
    res.status(200).json({ ok: true });
    return;
  }

  const conversation = await getOrCreateAgentphoneConversation(from, user.id);
  const replyText = await runRestrictedTurnAndPersist(
    conversation,
    user.id,
    messageText,
  );

  try {
    await sendSms(from, replyText);
  } catch (err) {
    if (!(err instanceof SmsOptedOutError)) {
      logger.error({ err }, "agentphone: reply send failed");
    }
  }

  res.status(200).json({ ok: true });
}

async function handleVoice(req: Request, res: Response): Promise<void> {
  const data = (req.body?.data ?? {}) as {
    from?: unknown;
    transcript?: unknown;
  };
  const from = typeof data.from === "string" ? data.from : "";
  const transcript =
    typeof data.transcript === "string" ? data.transcript.trim() : "";

  logger.info(
    { hasFrom: Boolean(from), transcriptLength: transcript.length },
    "agentphone: voice turn received",
  );

  if (!transcript) {
    // First turn of the call — greet instead of reacting to empty input.
    // In practice AgentPhone speaks the agent's configured `beginMessage`
    // itself without calling this webhook, so this branch is a defensive
    // fallback rather than the normal greeting path.
    res.status(200).json({
      text: "Hi, this is Elaine from the Batchelor household. I can help with trip reminders, packing lists, or trip status — what can I help with?",
    });
    return;
  }

  const [user] = from
    ? await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(eq(appUsers.phoneNumber, from))
        .limit(1)
    : [];

  if (!user) {
    res.status(200).json({
      text: "Sorry, I don't recognize this number, so I can't help over the phone. Goodbye.",
      hangup: true,
    });
    return;
  }

  const conversation = await getOrCreateAgentphoneConversation(from, user.id);

  // Every real spoken turn runs a full LLM (and sometimes tool-calling) turn,
  // which regularly takes several seconds — well past the ~1s AgentPhone's
  // docs cite as the point where a caller notices dead air. A single
  // buffered JSON response sends nothing until it's fully ready, and
  // real-world testing showed AgentPhone re-delivering the same voice turn
  // (with a new X-Webhook-ID) before our slow reply arrived, which our
  // dedup then correctly rejected as a duplicate of the earlier attempt —
  // leaving the caller with silence on both. Streaming an interim
  // acknowledgement immediately (per AgentPhone's documented NDJSON
  // contract) keeps the turn alive so no redelivery/duplicate ever happens.
  const turnStartedAt = Date.now();
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson");
  res.write(`${JSON.stringify({ text: "Mm, one sec.", interim: true })}\n`);
  (res as Response & { flush?: () => void }).flush?.();

  let replyText: string;
  try {
    replyText = await runRestrictedTurnAndPersist(
      conversation,
      user.id,
      transcript,
    );
  } catch (err) {
    logger.error(
      { err },
      "agentphone: voice turn failed after interim ack was sent",
    );
    replyText =
      "Sorry, something went wrong on our end — please try again or use the app.";
  }

  logger.info(
    { durationMs: Date.now() - turnStartedAt },
    "agentphone: voice turn completed",
  );
  res.write(`${JSON.stringify({ text: replyText })}\n`);
  res.end();
}

router.post("/webhook", async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    logger.warn("agentphone: webhook signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const deliveryId = req.get("x-webhook-id");
  if (!deliveryId) {
    res.status(400).json({ error: "Missing X-Webhook-ID" });
    return;
  }

  const event = typeof req.body?.event === "string" ? req.body.event : "";
  const channel = typeof req.body?.channel === "string" ? req.body.channel : "";
  logger.info(
    { deliveryId, event, channel },
    "agentphone: webhook delivery received",
  );

  if (!(await claimDelivery(deliveryId))) {
    logger.warn(
      { deliveryId, event, channel },
      "agentphone: duplicate webhook delivery rejected",
    );
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  if (event !== "agent.message") {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    if (channel === "sms") {
      await handleSms(req, res);
      return;
    }
    if (channel === "voice") {
      await handleVoice(req, res);
      return;
    }
  } catch (err) {
    logger.error({ err, channel }, "agentphone: webhook handler failed");
    if (!res.headersSent) {
      res
        .status(200)
        .json(
          channel === "voice"
            ? { text: "Sorry, something went wrong. Please try again later." }
            : { ok: true },
        );
    }
    return;
  }

  res.status(200).json({ ok: true });
});

export default router;
