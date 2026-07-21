import { createHmac, timingSafeEqual } from "node:crypto";
import { type Request } from "express";
import { env } from "./env";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Slack Web API helpers — verifying incoming request signatures, posting
// messages, and DM-based reminder delivery.
//
// The bot token (SLACK_BOT_TOKEN = xoxb-...) is used for all outbound Slack
// API calls. The signing secret (SLACK_SIGNING_SECRET) is used to verify
// every inbound request from the Events API and slash commands.
// ---------------------------------------------------------------------------

export function slackConfigured(): boolean {
  return Boolean(env.slackBotToken && env.slackSigningSecret);
}

// Slack signs every inbound request with HMAC-SHA256 over the basestring
// `v0:${X-Slack-Request-Timestamp}:${rawBody}`, using the Signing Secret.
// The hex digest is delivered as `v0=<hex>` in X-Slack-Signature.
// Requests older than 5 minutes are rejected to prevent replay attacks.
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export function verifySlackSignature(req: Request): boolean {
  if (!env.slackSigningSecret) return false;

  const signature = req.get("x-slack-signature");
  const timestamp = req.get("x-slack-request-timestamp");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!signature || !timestamp || !rawBody) return false;

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - tsSeconds) > SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expectedHex = createHmac("sha256", env.slackSigningSecret)
    .update(sigBasestring)
    .digest("hex");

  const match = /^v0=([0-9a-f]+)$/i.exec(signature);
  if (!match) return false;

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const providedBuf = Buffer.from(match[1].toLowerCase(), "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// ---------------------------------------------------------------------------
// Low-level Slack Web API call (JSON body, bearer auth)
// ---------------------------------------------------------------------------

async function slackApi(
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.slackBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Slack API ${method} HTTP ${response.status}`);
  }
  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API ${method} error: ${data.error ?? "unknown"}`);
  }
  return data;
}

// Opens (or retrieves the existing) DM channel between the bot and a Slack
// user. Returns the channel ID (starts with "D").
export async function openDmChannel(slackUserId: string): Promise<string> {
  const result = (await slackApi("conversations.open", {
    users: slackUserId,
  })) as { channel: { id: string } };
  return result.channel.id;
}

// Posts a plain-text / lightly Slack-markdown-formatted message to a channel
// or DM. For reminder DMs we open the channel first via openDmChannel; for
// webhook replies we use the event's channel ID directly.
export async function postSlackMessage(
  channelId: string,
  text: string,
): Promise<void> {
  await slackApi("chat.postMessage", { channel: channelId, text });
}

// Posts an ephemeral (visible only to one user) response to a slash command
// via the response_url supplied in the slash-command payload.
export async function postSlashCommandResponse(
  responseUrl: string,
  text: string,
): Promise<void> {
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Slack response_url POST HTTP ${response.status}`);
  }
}

// Looks up a Slack user's primary email via the users.info API.
// Requires the `users:read.email` scope on the bot token.
// Returns undefined when the call fails or the user has no email set.
export async function getSlackUserEmail(
  slackUserId: string,
): Promise<string | undefined> {
  try {
    const result = (await slackApi("users.info", { user: slackUserId })) as {
      user: { profile?: { email?: string } };
    };
    return result.user.profile?.email?.toLowerCase().trim() || undefined;
  } catch (err) {
    logger.warn({ err, slackUserId }, "slack: failed to look up user email");
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Reminder alert delivery via Slack DM
// ---------------------------------------------------------------------------

export async function sendReminderAlertSlack(
  slackUserId: string,
  reminderTitle: string,
  tripTitle: string,
  tripDestination: string,
  label: string,
  formattedDate: string,
): Promise<void> {
  const channelId = await openDmChannel(slackUserId);
  const text = [
    `*Reminder: ${reminderTitle}*`,
    `Trip: ${tripTitle} → ${tripDestination}`,
    `Due: ${formattedDate} _(${label})_`,
  ].join("\n");
  await postSlackMessage(channelId, text);
}
