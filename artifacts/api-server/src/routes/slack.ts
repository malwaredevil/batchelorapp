import { Router, type IRouter, type Request, type Response } from "express";
import { webhookLimiter } from "../middleware/rateLimit";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  appUsers,
  elaineSlackConversations,
  slackWebhookDeliveries,
  type ElaineSlackConversationRow,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  verifySlackSignature,
  postSlackMessage,
  getSlackUserEmail,
  postSlashCommandResponse,
} from "../lib/slack";
import { runElaineSlackTurn, type ElaineSlackChatMessage } from "../elaine";
import { env } from "../lib/env";

// ---------------------------------------------------------------------------
// Elaine Slack bridge webhook (task: Slack integration).
//
// Two separate endpoints share this router:
//   POST /api/slack/webhook  — Slack Events API (JSON, HMAC signed)
//   POST /api/slack/slash    — /elaine slash command (form-encoded, HMAC signed)
//
// Security posture mirrors routes/agentphone.ts and routes/elaine-email.ts:
// HMAC-SHA256 signature verification over raw body + bounded timestamp, then
// dedup by event_id, then user resolution by slack_user_id (or auto-link via
// email if first contact), then runElaineSlackTurn (same restricted engine as
// AgentPhone and email — same tool allowlist, same auto-run semantics).
// See threat_model.md for the full security model.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// Returns true when err looks like a PostgreSQL unique-constraint violation
// or an equivalent ORM-level duplicate-key error.
function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const pgErr = err as Error & { code?: string; cause?: unknown };
  if (pgErr.code === "23505") return true;
  const cause = pgErr.cause as { code?: string; message?: string } | undefined;
  if (cause?.code === "23505") return true;
  const msg = err.message.toLowerCase();
  const causeMsg = (
    typeof cause?.message === "string" ? cause.message : ""
  ).toLowerCase();
  return (
    msg.includes("unique") ||
    msg.includes("duplicate key") ||
    causeMsg.includes("unique") ||
    causeMsg.includes("duplicate key")
  );
}

// Records the Slack event_id before any side effect so retried deliveries
// (Slack retries up to 3 times via X-Slack-Retry-Num) are no-ops.
async function claimDelivery(id: string): Promise<boolean> {
  try {
    await db.insert(slackWebhookDeliveries).values({ id });
    return true;
  } catch (err) {
    if (isDuplicateKeyError(err)) return false;
    throw err;
  }
}

async function getOrCreateSlackConversation(
  userId: number,
  slackUserId: string,
): Promise<ElaineSlackConversationRow> {
  const [existing] = await db
    .select()
    .from(elaineSlackConversations)
    .where(eq(elaineSlackConversations.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(elaineSlackConversations)
    .values({ userId, slackUserId, messages: [] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race (unlikely for Slack DMs, but safe to handle).
  const [row] = await db
    .select()
    .from(elaineSlackConversations)
    .where(eq(elaineSlackConversations.userId, userId));
  return row;
}

// Resolves a Slack user ID to a Batchelor app_user.
// Fast path: slack_user_id already stored on app_users.
// Auto-link path: if no match, fetch the Slack profile email via users.info
// and match against app_users.email — then persist slack_user_id for next time.
// Returns null if no match is found (unrecognized user).
async function resolveUser(
  slackUserId: string,
): Promise<{ id: number; email: string } | null> {
  const [bySlackId] = await db
    .select({ id: appUsers.id, email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.slackUserId, slackUserId))
    .limit(1);
  if (bySlackId) return bySlackId;

  if (!env.slackBotToken) return null;

  const slackEmail = await getSlackUserEmail(slackUserId);
  if (!slackEmail) return null;

  const [byEmail] = await db
    .select({ id: appUsers.id, email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.email, slackEmail))
    .limit(1);
  if (!byEmail) return null;

  await db
    .update(appUsers)
    .set({ slackUserId })
    .where(eq(appUsers.id, byEmail.id));

  logger.info(
    { userId: byEmail.id, slackUserId },
    "slack: auto-linked Slack user ID via email match",
  );
  return byEmail;
}

async function runTurnAndPersist(
  conversation: ElaineSlackConversationRow,
  userId: number,
  inputText: string,
): Promise<string> {
  // Acquire a session-level PostgreSQL advisory lock keyed by userId before
  // reading history. This serializes concurrent turns from the same Slack
  // user so two simultaneous messages cannot both read the same starting
  // history and then overwrite each other's writes (last-writer-wins).
  // We hold the lock for the full turn including the AI call; the pool
  // client is released in the finally block regardless of outcome.
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [userId]);

    // Re-read the conversation now that we hold the lock to get the
    // freshest history (a prior concurrent turn may have just written it).
    const [fresh] = await db
      .select()
      .from(elaineSlackConversations)
      .where(eq(elaineSlackConversations.userId, userId))
      .limit(1);
    const current = fresh ?? conversation;
    const history = (current.messages as ElaineSlackChatMessage[] | null) ?? [];

    let replyText: string;
    let updatedHistory: ElaineSlackChatMessage[];

    try {
      const result = await runElaineSlackTurn({ userId, inputText, history });
      replyText = result.replyText;
      updatedHistory = result.history;
    } catch (err) {
      logger.error({ err }, "slack: Elaine turn failed");
      replyText =
        "Sorry, something went wrong — please try again or open the app.";
      updatedHistory = history;
    }

    await db
      .update(elaineSlackConversations)
      .set({ messages: updatedHistory, updatedAt: new Date() })
      .where(eq(elaineSlackConversations.id, current.id));

    return replyText;
  } finally {
    // Inner try/finally guarantees client.release() runs even when the unlock
    // query itself throws (e.g. broken connection). Without this nesting,
    // a thrown unlock error exits the outer finally before release() is reached,
    // permanently leaking the pool slot.
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [userId]);
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// POST /webhook — Slack Events API (JSON body, HMAC signed)
// ---------------------------------------------------------------------------

router.post("/webhook", webhookLimiter, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  // URL verification challenge: Slack sends this once when you first save the
  // Events API URL. Respond immediately — it is safe to skip signature
  // verification here since the challenge response has no side effects and
  // the secret may not yet be configured when this runs during initial setup.
  if (body?.type === "url_verification") {
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    logger.info("slack: responding to url_verification challenge");
    res.json({ challenge });
    return;
  }

  // All other events require a valid signature.
  if (!verifySlackSignature(req)) {
    logger.warn("slack: Events API signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const eventType = typeof body?.type === "string" ? body.type : "";
  if (eventType !== "event_callback") {
    res.json({ ok: true });
    return;
  }

  const eventId = typeof body?.event_id === "string" ? body.event_id : "";
  if (!eventId) {
    res.status(400).json({ error: "Missing event_id" });
    return;
  }

  // Dedup before any side effect runs. Slack retries on slow/failed responses.
  let claimed: boolean;
  try {
    claimed = await claimDelivery(eventId);
  } catch (err) {
    logger.error({ err, eventId }, "slack: dedup DB error — failing closed");
    res.status(503).json({ error: "Service unavailable" });
    return;
  }
  if (!claimed) {
    logger.warn({ eventId }, "slack: duplicate event delivery rejected");
    res.json({ ok: true });
    return;
  }

  const event = (body?.event ?? {}) as Record<string, unknown>;
  const evType = typeof event.type === "string" ? event.type : "";
  const channelType =
    typeof event.channel_type === "string" ? event.channel_type : "";

  // Only handle direct messages — ignore bot messages to avoid reply loops.
  if (evType !== "message" || channelType !== "im") {
    res.json({ ok: true });
    return;
  }
  if (event.subtype === "bot_message" || event.bot_id) {
    res.json({ ok: true });
    return;
  }

  const slackUserId = typeof event.user === "string" ? event.user : "";
  const channelId = typeof event.channel === "string" ? event.channel : "";
  const messageText = typeof event.text === "string" ? event.text.trim() : "";

  if (!slackUserId || !channelId) {
    res.json({ ok: true });
    return;
  }

  logger.info(
    { eventId, slackUserId, channelId },
    "slack: inbound DM received",
  );

  // Acknowledge immediately — Slack requires a 200 response quickly. All
  // LLM processing happens after the response is sent, same as voice calls.
  res.json({ ok: true });

  void (async () => {
    try {
      const user = await resolveUser(slackUserId);
      if (!user) {
        await postSlackMessage(
          channelId,
          "Hi! I don't recognise your Slack account yet. " +
            "Open the Batchelor app → Account Settings and connect your Slack account, " +
            "then send me another message.",
        );
        return;
      }

      const conversation = await getOrCreateSlackConversation(
        user.id,
        slackUserId,
      );
      const replyText = await runTurnAndPersist(
        conversation,
        user.id,
        messageText || "(empty message)",
      );
      await postSlackMessage(channelId, replyText);
    } catch (err) {
      logger.error({ err, slackUserId }, "slack: DM processing failed");
    }
  })();
});

// ---------------------------------------------------------------------------
// POST /slash — /elaine slash command (form-encoded body, HMAC signed)
// ---------------------------------------------------------------------------

router.post("/slash", webhookLimiter, async (req: Request, res: Response) => {
  if (!verifySlackSignature(req)) {
    logger.warn("slack: slash command signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const slashBody = req.body as {
    command?: string;
    text?: string;
    user_id?: string;
    response_url?: string;
    channel_id?: string;
  };

  const slackUserId = slashBody.user_id ?? "";
  const inputText = (slashBody.text ?? "").trim();
  const responseUrl = slashBody.response_url ?? "";

  if (!slackUserId || !responseUrl) {
    res
      .status(400)
      .json({ response_type: "ephemeral", text: "Missing required fields." });
    return;
  }

  logger.info(
    { slackUserId, command: slashBody.command },
    "slack: slash command received",
  );

  // Acknowledge immediately with a brief ephemeral message. The LLM turn
  // result is posted via response_url once it's ready.
  res.json({
    response_type: "ephemeral",
    text: "_One moment, I'm thinking…_",
  });

  void (async () => {
    try {
      const user = await resolveUser(slackUserId);
      if (!user) {
        await postSlashCommandResponse(
          responseUrl,
          "I don't recognise your Slack account. Send me a DM first so I can link it to your Batchelor account.",
        );
        return;
      }

      const conversation = await getOrCreateSlackConversation(
        user.id,
        slackUserId,
      );
      const effectiveInput = inputText || "Hi Elaine!";
      const replyText = await runTurnAndPersist(
        conversation,
        user.id,
        effectiveInput,
      );
      await postSlashCommandResponse(responseUrl, replyText);
    } catch (err) {
      logger.error(
        { err, slackUserId },
        "slack: slash command processing failed",
      );
      try {
        await postSlashCommandResponse(
          responseUrl,
          "Sorry, something went wrong — please try again.",
        );
      } catch {
        // best effort
      }
    }
  })();
});

export default router;
