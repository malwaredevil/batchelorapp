import { Router, type IRouter, type Request, type Response } from "express";
import { webhookLimiter } from "../middleware/rateLimit";
import { eq } from "drizzle-orm";
import { db, appUsers, slackWebhookDeliveries } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  verifySlackSignature,
  postSlackMessage,
  getSlackUserEmail,
  postSlashCommandResponse,
} from "../lib/slack";
import { enqueueJob } from "../lib/jobs/queue";
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
// email if first contact), then enqueue a slack.turn job (processed by the
// dedicated "slack" queue worker). The webhook acknowledges immediately so the
// DB pool connection is released before the AI turn begins.
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

  // Resolve user synchronously before acknowledging so we can reply inline
  // for unrecognised users (no job to enqueue in that case).
  const user = await resolveUser(slackUserId).catch((err) => {
    logger.error({ err, slackUserId }, "slack: user resolution failed");
    return null;
  });

  if (!user) {
    // Acknowledge first, then post the help message asynchronously so we
    // don't hold up the 200 response.
    res.json({ ok: true });
    void postSlackMessage(
      channelId,
      "Hi! I don't recognise your Slack account yet. " +
        "Open the Batchelor app → Account Settings and connect your Slack account, " +
        "then send me another message.",
    ).catch((err) =>
      logger.warn({ err, slackUserId }, "slack: failed to post help message"),
    );
    return;
  }

  // Enqueue the turn job — the worker will run the AI turn and post the reply.
  // Using the event_id as idempotency key means a retried delivery (same
  // event_id, already claimed above) would be a DO UPDATE no-op in app_jobs,
  // but we never reach here for duplicates because claimDelivery returned
  // false above and we already exited.
  try {
    await enqueueJob({
      type: "slack.turn",
      payload: {
        userId: user.id,
        slackEventId: eventId,
        inputText: messageText || "(empty message)",
        channelId,
      },
      idempotencyKey: eventId,
      createdByUserId: user.id,
    });
    logger.info(
      { eventId, slackUserId, channelId, userId: user.id },
      "slack: DM enqueued",
    );
  } catch (err) {
    logger.error({ err, eventId }, "slack: failed to enqueue turn job");
    // Still ack 200 — Slack would retry otherwise and hit the dedup guard.
  }

  res.json({ ok: true });
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

  // Resolve user before the 200 so we can give an inline error for unknowns.
  const user = await resolveUser(slackUserId).catch((err) => {
    logger.error({ err, slackUserId }, "slack: slash user resolution failed");
    return null;
  });

  if (!user) {
    res.json({
      response_type: "ephemeral",
      text: "I don't recognise your Slack account. Send me a DM first so I can link it to your Batchelor account.",
    });
    return;
  }

  // Use a deterministic idempotency key so rapid double-submits don't fan out.
  // Slash commands don't have a stable event_id, so we use slackUserId + a
  // minute-bucketed timestamp to deduplicate within a 60-second window.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const idempotencyKey = `slash:${slackUserId}:${minuteBucket}`;

  // Acknowledge immediately with a brief ephemeral message. The LLM turn
  // result is posted via response_url once the worker picks up the job.
  res.json({
    response_type: "ephemeral",
    text: "_One moment, I'm thinking…_",
  });

  try {
    await enqueueJob({
      type: "slack.turn",
      payload: {
        userId: user.id,
        slackEventId: idempotencyKey,
        inputText: inputText || "Hi Elaine!",
        responseUrl,
      },
      idempotencyKey,
      createdByUserId: user.id,
    });
    logger.info(
      { slackUserId, userId: user.id, command: slashBody.command },
      "slack: slash command enqueued",
    );
  } catch (err) {
    logger.error({ err, slackUserId }, "slack: failed to enqueue slash job");
    void postSlashCommandResponse(
      responseUrl,
      "Sorry, something went wrong — please try again.",
    ).catch(() => undefined);
  }
});

export default router;
