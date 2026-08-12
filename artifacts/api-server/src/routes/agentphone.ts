import { Router, type IRouter, type Request, type Response } from "express";
import { webhookLimiter } from "../middleware/rateLimit";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, appUsers, agentphoneConversations } from "@workspace/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { sendSms, SmsOptedOutError } from "../lib/sms";
import {
  claimWebhookSideEffect,
  markWebhookSideEffectCompleted,
  markWebhookSideEffectFailed,
} from "../lib/webhook-side-effect-idempotency";
import { runAgentphoneTurn, type AgentphoneChatMessage } from "../elaine";
import { markCommCheckVerified } from "../lib/comm-check-scheduler";
import { getOrCreateAgentphoneConversation } from "../lib/agentphone-conversation";

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

// Returns the hex SHA-256 of the signed material on success, or false on
// failure. Using the content hash (rather than the unsigned X-Webhook-ID
// header) as the dedup key means a replay with a fresh delivery ID but the
// same authenticated body+timestamp still collides in the deliveries table
// and is rejected — closing the bypass the unsigned ID created.
function verifySignature(req: Request): string | false {
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
  if (!timingSafeEqual(expectedBuf, providedBuf)) return false;

  // The dedup key is a hash of the signed material — not the unsigned
  // X-Webhook-ID. This makes replay impossible: same body+timestamp always
  // produces the same hash, regardless of what ID the replayer supplies.
  return createHash("sha256").update(signedString).digest("hex");
}

// Records the delivery with status='processing' before any side effect runs.
// Dedup uses TWO keys, both checked atomically in this one statement:
//   1. `id` (the content hash) — the original replay-protection key. A retry
//      that resends the EXACT same signed body+timestamp collides here.
//   2. `deliveryId` (the raw X-Webhook-ID header, nullable) — closes a gap
//      discovered 2026-08-11: AgentPhone can redeliver the same logical
//      message under the same header ID but with a freshly-signed timestamp,
//      which produces a DIFFERENT content hash and used to sail through
//      dedup as if new, causing Elaine to send a second SMS reply to the
//      daily comms-check. The ID is still never trusted for AUTHENTICITY —
//      the caller only reaches this function after signature verification
//      already succeeded — it's used purely as a second duplicate signal.
// A row only blocks a new attempt if it is NOT a stale (>5 min old) 'processing'
// row, matching the existing crash-recovery behavior for the id key and
// extending the same reclaim window to the deliveryId key.
async function claimDelivery(
  id: string,
  deliveryId: string | null,
): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO agentphone_webhook_deliveries (id, delivery_id, status)
    SELECT ${id}, ${deliveryId}, 'processing'
    WHERE NOT EXISTS (
      SELECT 1 FROM agentphone_webhook_deliveries d
      WHERE (
          d.id = ${id}
          OR (${deliveryId}::text IS NOT NULL AND d.delivery_id = ${deliveryId})
        )
        AND NOT (
          d.status = 'processing'
          AND d.received_at < NOW() - INTERVAL '5 minutes'
        )
    )
    ON CONFLICT (id) DO UPDATE
      SET status = 'processing', received_at = NOW(), delivery_id = EXCLUDED.delivery_id
      WHERE agentphone_webhook_deliveries.status = 'processing'
        AND agentphone_webhook_deliveries.received_at < NOW() - INTERVAL '5 minutes'
    RETURNING id
  `);
  return result.rows.length > 0;
}

// Marks a claimed delivery as fully processed. Fire-and-forget: a failure
// here is logged but never affects the response already sent to AgentPhone.
async function markDeliveryProcessed(id: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE agentphone_webhook_deliveries
      SET status = 'processed', processed_at = NOW()
      WHERE id = ${id}
    `);
  } catch (err) {
    logger.warn({ err, id }, "agentphone: failed to mark delivery processed");
  }
}

async function runRestrictedTurnAndPersist(
  conversation: Awaited<ReturnType<typeof getOrCreateAgentphoneConversation>>,
  userId: number,
  inputText: string,
  channel: "sms" | "voice",
): Promise<string> {
  let current = conversation;
  for (let attempt = 0; attempt < 3; attempt++) {
    const history = (current.messages as AgentphoneChatMessage[] | null) ?? [];
    let replyText: string;
    let updatedHistory: AgentphoneChatMessage[];
    try {
      const result = await runAgentphoneTurn({
        userId,
        inputText,
        history,
        channel,
      });
      replyText = result.replyText;
      updatedHistory = result.history;
    } catch (err) {
      logger.error({ err }, "agentphone: restricted Elaine turn failed");
      replyText =
        "Sorry, something went wrong on our end — please try again or use the app.";
      updatedHistory = history;
    }

    const [saved] = await db
      .update(agentphoneConversations)
      .set({
        messages: updatedHistory,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentphoneConversations.id, current.id),
          eq(agentphoneConversations.version, current.version),
        ),
      )
      .returning({ id: agentphoneConversations.id });
    if (saved) return replyText;

    const [latest] = await db
      .select()
      .from(agentphoneConversations)
      .where(eq(agentphoneConversations.id, current.id))
      .limit(1);
    if (!latest) throw new Error("AgentPhone conversation disappeared");
    current = latest;
  }
  throw new Error(
    "AgentPhone conversation changed too many times; retry delivery",
  );
}

async function handleSms(
  req: Request,
  res: Response,
  deliveryKey: string,
): Promise<void> {
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
    const stopSideEffectKey = `agentphone:sms:${deliveryKey}:stop-confirmation`;
    const shouldSendStop = await claimWebhookSideEffect({
      effectKey: stopSideEffectKey,
      provider: "agentphone",
      channel: "sms",
    });
    if (!shouldSendStop) {
      logger.warn(
        { stopSideEffectKey },
        "agentphone: duplicate STOP confirmation suppressed",
      );
    } else {
      await sendSms(
        from,
        "You've been unsubscribed from Batchelor App texts and won't receive any more messages. Reply START to resubscribe.",
        { bypassOptOutCheck: true },
      )
        .then(async () => {
          await markWebhookSideEffectCompleted(stopSideEffectKey);
        })
        .catch(async (err) => {
          await markWebhookSideEffectFailed(stopSideEffectKey, err);
          logger.error({ err }, "agentphone: STOP confirmation send failed");
        });
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (HELP_WORDS.has(keyword)) {
    const helpSideEffectKey = `agentphone:sms:${deliveryKey}:help-reply`;
    const shouldSendHelp = await claimWebhookSideEffect({
      effectKey: helpSideEffectKey,
      provider: "agentphone",
      channel: "sms",
    });
    if (!shouldSendHelp) {
      logger.warn(
        { helpSideEffectKey },
        "agentphone: duplicate HELP reply suppressed",
      );
    } else {
      await sendSms(
        from,
        "Batchelor App: household trip reminder texts. Msg & data rates may apply. Reply STOP to unsubscribe. Questions? Use the app.",
        { bypassOptOutCheck: true },
      )
        .then(async () => {
          await markWebhookSideEffectCompleted(helpSideEffectKey);
        })
        .catch(async (err) => {
          await markWebhookSideEffectFailed(helpSideEffectKey, err);
          logger.error({ err }, "agentphone: HELP reply send failed");
        });
    }
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
    const startSideEffectKey = `agentphone:sms:${deliveryKey}:start-confirmation`;
    const shouldSendStart = await claimWebhookSideEffect({
      effectKey: startSideEffectKey,
      provider: "agentphone",
      channel: "sms",
    });
    if (!shouldSendStart) {
      logger.warn(
        { startSideEffectKey },
        "agentphone: duplicate START confirmation suppressed",
      );
    } else {
      await sendSms(
        from,
        "You're resubscribed to Batchelor App texts. Reply STOP at any time to opt out.",
        { bypassOptOutCheck: true },
      )
        .then(async () => {
          await markWebhookSideEffectCompleted(startSideEffectKey);
        })
        .catch(async (err) => {
          await markWebhookSideEffectFailed(startSideEffectKey, err);
          logger.error({ err }, "agentphone: START confirmation send failed");
        });
    }
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

  // Any inbound SMS from a recognized user marks today's SMS comm check
  // verified (fire-and-forget — never blocks the Elaine turn).
  void markCommCheckVerified("sms").catch((err) =>
    logger.warn({ err }, "agentphone: comm check mark-verified failed"),
  );

  const conversation = await getOrCreateAgentphoneConversation(from, user.id);
  const replyText = await runRestrictedTurnAndPersist(
    conversation,
    user.id,
    messageText,
    "sms",
  );

  const replySideEffectKey = `agentphone:sms:${deliveryKey}:assistant-reply`;
  const shouldSendReply = await claimWebhookSideEffect({
    effectKey: replySideEffectKey,
    provider: "agentphone",
    channel: "sms",
  });
  if (!shouldSendReply) {
    logger.warn(
      { replySideEffectKey },
      "agentphone: duplicate assistant reply suppressed",
    );
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await sendSms(from, replyText);
    await markWebhookSideEffectCompleted(replySideEffectKey);
  } catch (err) {
    if (!(err instanceof SmsOptedOutError)) {
      await markWebhookSideEffectFailed(replySideEffectKey, err);
      logger.error({ err }, "agentphone: reply send failed");
    } else {
      await markWebhookSideEffectCompleted(replySideEffectKey);
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
      "voice",
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

router.post("/webhook", webhookLimiter, async (req: Request, res: Response) => {
  // verifySignature returns the content hash (SHA-256 of signed material) on
  // success, or false on failure. The hash remains the PRIMARY dedup key so
  // replay-with-fresh-ID is blocked; claimDelivery() below also checks the
  // (unsigned, logging-only-for-auth-purposes) X-Webhook-ID as a second key
  // to catch same-ID-different-hash redeliveries — see its doc comment.
  const contentHash = verifySignature(req);
  if (!contentHash) {
    logger.warn("agentphone: webhook signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // The raw X-Webhook-ID header. Used both for logging and as a SECOND dedup
  // key in claimDelivery() (see that function's doc comment) — `null` (not
  // the string "(missing)") when absent, so two unrelated requests without an
  // ID header never collide with each other.
  const deliveryIdHeader = req.get("x-webhook-id") ?? null;

  const event = typeof req.body?.event === "string" ? req.body.event : "";
  const channel = typeof req.body?.channel === "string" ? req.body.channel : "";
  logger.info(
    {
      deliveryId: deliveryIdHeader ?? "(missing)",
      contentHash: contentHash.slice(0, 12),
      event,
      channel,
    },
    "agentphone: webhook delivery received",
  );

  let claimed: boolean;
  try {
    claimed = await claimDelivery(contentHash, deliveryIdHeader);
  } catch (err) {
    logger.error(
      { err, deliveryId: deliveryIdHeader ?? "(missing)" },
      "agentphone: dedup DB error — failing closed",
    );
    res.status(503).json({ error: "Service unavailable" });
    return;
  }
  if (!claimed) {
    logger.warn(
      { deliveryId: deliveryIdHeader ?? "(missing)", event, channel },
      "agentphone: duplicate webhook delivery rejected",
    );
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  if (event !== "agent.message") {
    void markDeliveryProcessed(contentHash);
    res.status(200).json({ ok: true });
    return;
  }

  try {
    if (channel === "sms") {
      await handleSms(req, res, contentHash);
      void markDeliveryProcessed(contentHash);
      return;
    }
    if (channel === "voice") {
      await handleVoice(req, res);
      void markDeliveryProcessed(contentHash);
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

  void markDeliveryProcessed(contentHash);
  res.status(200).json({ ok: true });
});

export default router;
