import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { webhookLimiter } from "../middleware/rateLimit";
import { eq } from "drizzle-orm";
import { db, pool, appUsers } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  verifySlackSignature,
  postSlackMessage,
  getSlackUserEmail,
  postSlashCommandResponse,
} from "../lib/slack";
import { enqueueJob, enqueueJobWithQuery } from "../lib/jobs/queue";
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

// Atomically claim a Slack delivery and enqueue its job. A stale processing
// claim can be recovered after five minutes; enqueued/processed deliveries are
// permanent duplicates. The delivery row and app_jobs row commit together.
async function enqueueSlackDelivery(input: {
  eventId: string;
  userId: number;
  inputText: string;
  channelId: string;
}): Promise<"enqueued" | "duplicate"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query<{ id: string }>(
      `INSERT INTO slack_webhook_deliveries (id, status, received_at)
       VALUES ($1, 'processing', now())
       ON CONFLICT (id) DO UPDATE
         SET status = 'processing', received_at = now(), last_error = NULL
         WHERE slack_webhook_deliveries.status = 'processing'
           AND slack_webhook_deliveries.received_at < now() - interval '5 minutes'
       RETURNING id`,
      [input.eventId],
    );
    if (claim.rows.length === 0) {
      await client.query("ROLLBACK");
      return "duplicate";
    }

    const jobId = await enqueueJobWithQuery(
      (query, values) => client.query<{ id: number }>(query, values),
      {
        type: "slack.turn",
        payload: {
          userId: input.userId,
          slackEventId: input.eventId,
          inputText: input.inputText || "(empty message)",
          channelId: input.channelId,
        },
        idempotencyKey: input.eventId,
        createdByUserId: input.userId,
      },
    );
    await client.query(
      `UPDATE slack_webhook_deliveries
       SET status = 'enqueued', job_id = $2, last_error = NULL
       WHERE id = $1`,
      [input.eventId, jobId],
    );
    await client.query("COMMIT");
    return "enqueued";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
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
    const result = await enqueueSlackDelivery({
      eventId,
      userId: user.id,
      inputText: messageText,
      channelId,
    });
    if (result === "duplicate") {
      logger.warn({ eventId }, "slack: duplicate event delivery rejected");
      // Preserve the public Slack acknowledgement contract: callers should not
      // need to distinguish a first delivery from an idempotent retry.
      res.json({ ok: true });
      return;
    }
    logger.info(
      { eventId, slackUserId, channelId, userId: user.id },
      "slack: DM enqueued",
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error(
      { err, eventId },
      "slack: failed to atomically enqueue turn job",
    );
    // A 5xx lets Slack retry. The transaction rolled back the delivery claim,
    // so the retry can safely claim and enqueue the same event.
    res.status(503).json({ error: "Service unavailable" });
  }
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
    trigger_id?: string;
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

  // Slack trigger_id uniquely identifies one slash-command invocation. For
  // defensive compatibility, fall back to a hash of the authenticated raw body.
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const requestIdentity = slashBody.trigger_id
    ? slashBody.trigger_id
    : createHash("sha256")
        .update(rawBody ?? Buffer.from(`${slackUserId}:${inputText}`))
        .digest("hex");
  const idempotencyKey = `slash:${requestIdentity}`;

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
