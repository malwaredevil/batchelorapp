import { Router, type IRouter, type Request, type Response } from "express";
import { webhookLimiter } from "../middleware/rateLimit";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  appUsers,
  elaineEmailConversations,
  elaineEmailWebhookDeliveries,
  type ElaineEmailConversationRow,
} from "@workspace/db";
import { Resend } from "resend";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { sendElaineEmailReply } from "../lib/email";
import { runElaineEmailTurn, type ElaineEmailChatMessage } from "../elaine";
import {
  processEmailAttachments,
  processEmailBodyAsDocument,
  type EmailAttachmentOutcome,
} from "../lib/elaine-email-attachments";

// ---------------------------------------------------------------------------
// Resend inbound-email webhook for elaine@app.batchelor.app. Mirrors the
// AgentPhone webhook's security posture (see routes/agentphone.ts and
// threat_model.md's "API to AgentPhone" boundary): Svix-format HMAC
// signature verification over the raw body, a bounded timestamp window, and
// per-delivery dedup, all before any side effect runs. Sender identification
// is by exact From-address match against app_users.email — unrecognized
// senders are silently ignored (no reply, no data touched, no information
// disclosure about which addresses are recognized).
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// Resend/Svix webhooks are considered stale past this age, bounding replay
// of a captured signed request.
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

// Verifies a Svix-format webhook signature: secret is `whsec_<base64>`, the
// signed content is `${svix-id}.${svix-timestamp}.${rawBody}`, and the
// `svix-signature` header is a space-separated list of `v1,<base64 sig>`
// entries (only one is expected in practice, but all are checked).
function verifySignature(req: Request): boolean {
  if (!env.resendWebhookSecret) return false;

  const svixId = req.get("svix-id");
  const svixTimestamp = req.get("svix-timestamp");
  const svixSignature = req.get("svix-signature");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!svixId || !svixTimestamp || !svixSignature || !rawBody) return false;

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (
    Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const secretRaw = env.resendWebhookSecret.startsWith("whsec_")
    ? env.resendWebhookSecret.slice("whsec_".length)
    : env.resendWebhookSecret;
  let secretBuf: Buffer;
  try {
    secretBuf = Buffer.from(secretRaw, "base64");
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;
  const expectedBuf = createHmac("sha256", secretBuf)
    .update(signedContent)
    .digest();

  const candidates = svixSignature.split(" ");
  for (const candidate of candidates) {
    const [version, sigBase64] = candidate.split(",");
    if (version !== "v1" || !sigBase64) continue;
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(sigBase64, "base64");
    } catch {
      continue;
    }
    if (expectedBuf.length !== providedBuf.length) continue;
    if (timingSafeEqual(expectedBuf, providedBuf)) return true;
  }
  return false;
}

// Returns true when `err` looks like a PostgreSQL unique-constraint violation
// (SQLSTATE 23505) or an equivalent ORM-level duplicate-key error. Any other
// error is assumed to be a transient infrastructure problem (DB unreachable,
// timeout, etc.) and must NOT be silently swallowed.
function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const pgErr = err as Error & { code?: string };
  if (pgErr.code === "23505") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("unique") || msg.includes("duplicate key");
}

// Records the delivery id before any side effect runs so a redelivered
// webhook is a no-op. Returns false when the id was already claimed
// (duplicate delivery). Throws for any other DB error so the caller can
// fail closed (503) rather than silently treating the event as a duplicate.
async function claimDelivery(id: string): Promise<boolean> {
  try {
    await db.insert(elaineEmailWebhookDeliveries).values({ id });
    return true;
  } catch (err) {
    if (isDuplicateKeyError(err)) return false;
    throw err;
  }
}

async function getOrCreateEmailConversation(
  userId: number,
): Promise<ElaineEmailConversationRow> {
  const [existing] = await db
    .select()
    .from(elaineEmailConversations)
    .where(eq(elaineEmailConversations.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(elaineEmailConversations)
    .values({ userId, messages: [] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [row] = await db
    .select()
    .from(elaineEmailConversations)
    .where(eq(elaineEmailConversations.userId, userId));
  return row;
}

// Best-effort HTML->plain-text conversion for inbound emails that only send
// an HTML body (no `text` field) — some clients/senders (including Resend's
// own test inbox) omit plain text entirely. Not a full parser, just enough
// to give the model readable content: strips script/style blocks, turns
// block-level tags into line breaks, strips remaining tags, and decodes the
// handful of entities that show up in real mail.
function htmlToPlainText(html: string): string {
  // Cap input length before running the script/style stripper: it uses a
  // greedy-ish tag-content match that, on pathological input (thousands of
  // unclosed "<script" fragments), could otherwise cost more than one pass.
  const bounded = html.slice(0, 200_000);
  return (
    bounded
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/tr|\/li)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      // Decode &amp; LAST so a double-encoded entity like "&amp;lt;" (which
      // represents the literal text "&lt;") doesn't get collapsed into "<".
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Best-effort strip of quoted reply text / signature blocks from a plain-text
// email body so the model isn't fed the entire prior thread on every reply.
// Not perfect (mail clients vary wildly), but Elaine's own reply already
// says "— Elaine" and most clients quote with "On ... wrote:" or "> " lines.
function stripQuotedText(text: string): string {
  const lines = text.split(/\r?\n/);
  const cutIndex = lines.findIndex(
    (line) =>
      /^On .+wrote:$/.test(line.trim()) ||
      line.trim().startsWith(">") ||
      line.trim() === "-- " ||
      line.trim() === "—",
  );
  const kept = cutIndex === -1 ? lines : lines.slice(0, cutIndex);
  return kept.join("\n").trim();
}

router.post(
  "/email-webhook",
  webhookLimiter,
  async (req: Request, res: Response) => {
    if (!verifySignature(req)) {
      logger.warn("elaine-email: webhook signature verification failed");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const deliveryId = req.get("svix-id") ?? "";
    if (!deliveryId) {
      res.status(400).json({ error: "Missing svix-id" });
      return;
    }

    let claimed: boolean;
    try {
      claimed = await claimDelivery(deliveryId);
    } catch (err) {
      logger.error(
        { err, deliveryId },
        "elaine-email: dedup DB error — failing closed",
      );
      res.status(503).json({ error: "Service unavailable" });
      return;
    }
    if (!claimed) {
      logger.warn(
        { deliveryId },
        "elaine-email: duplicate webhook delivery rejected",
      );
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const body = req.body as {
      type?: string;
      data?: {
        email_id?: string;
        from?: string;
        subject?: string;
        text?: string;
        html?: string;
        headers?:
          | Record<string, string>
          | Array<{ name: string; value: string }>;
        message_id?: string;
      };
    };

    const eventType = typeof body?.type === "string" ? body.type : "";
    logger.info(
      { deliveryId, eventType },
      "elaine-email: webhook delivery received",
    );

    // Only inbound-email events carry a message to act on; other Resend
    // webhook event types (delivery/bounce/etc. on outbound sends) are no-ops.
    if (eventType !== "email.received" && eventType !== "inbound.email") {
      res.status(200).json({ ok: true });
      return;
    }

    let data = body.data ?? {};

    // Resend's inbound webhooks intentionally never include the body, headers,
    // or attachments inline (only metadata) — full content must be fetched via
    // the Received Emails API using the payload's email_id. See
    // https://resend.com/docs/dashboard/receiving/introduction.
    const emailId = typeof data.email_id === "string" ? data.email_id : "";
    if (
      emailId &&
      typeof data.text !== "string" &&
      typeof data.html !== "string" &&
      env.resendApiKey
    ) {
      try {
        const resend = new Resend(env.resendApiKey);
        const { data: fullEmail, error } =
          await resend.emails.receiving.get(emailId);
        if (error) {
          logger.warn(
            { deliveryId, emailId, error },
            "elaine-email: failed to fetch full email content",
          );
        } else if (fullEmail) {
          data = {
            ...data,
            text: fullEmail.text ?? undefined,
            html: fullEmail.html ?? undefined,
          };
        }
      } catch (err) {
        logger.warn(
          { deliveryId, emailId, err },
          "elaine-email: error fetching full email content",
        );
      }
    }

    const fromRaw = typeof data.from === "string" ? data.from : "";
    // From header is typically `"Name" <email@example.com>` — extract the bare
    // address for an exact match against app_users.email.
    const fromMatch = /<([^>]+)>/.exec(fromRaw);
    const fromEmail = (fromMatch ? fromMatch[1] : fromRaw).trim().toLowerCase();

    if (!fromEmail) {
      res.status(200).json({ ok: true });
      return;
    }

    const [user] = await db
      .select({ id: appUsers.id, email: appUsers.email })
      .from(appUsers)
      .where(eq(appUsers.email, fromEmail))
      .limit(1);

    if (!user) {
      // Unrecognized sender: never process or reply. No indication given back
      // to the sender either way (avoids account-enumeration via email).
      logger.info(
        { deliveryId },
        "elaine-email: sender not recognized, ignoring",
      );
      res.status(200).json({ ok: true });
      return;
    }

    const rawText = typeof data.text === "string" ? data.text : "";
    const rawHtml = typeof data.html === "string" ? data.html : "";
    const bodyText =
      rawText.trim() || (rawHtml ? htmlToPlainText(rawHtml) : "");
    const cleanedText = stripQuotedText(bodyText).slice(0, 8000);
    const subject =
      typeof data.subject === "string" ? data.subject : "Message from you";
    const inboundMessageId =
      typeof data.message_id === "string" ? data.message_id : undefined;

    // Forwarded booking-confirmation emails often carry an attachment with
    // little or no body text — process attachments regardless of whether
    // there's usable text, then let a missing-text email short-circuit only
    // when there were no attachments either.
    let attachmentOutcomes: EmailAttachmentOutcome[] = [];
    if (emailId) {
      try {
        attachmentOutcomes = await processEmailAttachments({
          emailId,
          userId: user.id,
          fromEmail: user.email,
          subject,
        });
      } catch (err) {
        logger.error(
          { err, deliveryId, emailId },
          "elaine-email: attachment processing failed",
        );
      }
    }

    // Also try to extract a booking document from the email body text itself.
    // Many hotel/tour confirmations arrive as HTML-only emails with no PDF
    // attachment — extractFromEmailText classifies whether the body is a genuine
    // booking confirmation before creating any document, so non-travel emails
    // are filtered out cheaply. If the same booking is also in an attachment,
    // the itinerary dedup logic (syncItineraryFromDocument) keeps the richer
    // source and discards the thinner one — no duplicate itinerary entries.
    if (cleanedText && emailId) {
      try {
        const bodyOutcome = await processEmailBodyAsDocument({
          emailId,
          userId: user.id,
          fromEmail: user.email,
          subject,
          bodyText: cleanedText,
        });
        if (bodyOutcome) {
          attachmentOutcomes = [...attachmentOutcomes, bodyOutcome];
        }
      } catch (err) {
        logger.error(
          { err, deliveryId, emailId },
          "elaine-email: body document processing failed",
        );
      }
    }

    if (!cleanedText && attachmentOutcomes.length === 0) {
      logger.info(
        {
          deliveryId,
          hasText: Boolean(rawText),
          hasHtml: Boolean(rawHtml),
          dataKeys: Object.keys(data),
        },
        "elaine-email: no usable body text or attachments extracted, ignoring",
      );
      res.status(200).json({ ok: true });
      return;
    }

    const attachmentSummaryLines = attachmentOutcomes.map((a) => {
      if (a.outcome === "linked") {
        return `- Attachment "${a.filename}": saved and matched to an existing trip${a.tripTitle ? ` (${a.tripTitle})` : ""}.`;
      }
      if (a.outcome === "unmatched") {
        return `- Attachment "${a.filename}": saved, but I couldn't confidently match it to a trip — it's waiting in the Documents triage inbox for someone to assign it.`;
      }
      if (a.outcome === "skipped") {
        return `- Attachment "${a.filename}": skipped (unsupported file type — only PDF and image files are supported).`;
      }
      return `- Attachment "${a.filename}": failed to process.`;
    });

    const effectiveInputText =
      attachmentSummaryLines.length > 0
        ? `${cleanedText || "(forwarded email with no body text)"}\n\n[System note — not from the user: the email had ${attachmentOutcomes.length} attachment(s) processed as follows. Mention this outcome briefly in your reply.]\n${attachmentSummaryLines.join("\n")}`
        : cleanedText;

    const conversation = await getOrCreateEmailConversation(user.id);
    const history =
      (conversation.messages as ElaineEmailChatMessage[] | null) ?? [];

    let replyText: string;
    let updatedHistory: ElaineEmailChatMessage[];
    try {
      const result = await runElaineEmailTurn({
        userId: user.id,
        inputText: effectiveInputText,
        history,
      });
      replyText = result.replyText;
      updatedHistory = result.history;
    } catch (err) {
      logger.error({ err }, "elaine-email: restricted Elaine turn failed");
      replyText =
        "Sorry, something went wrong on our end — please try again or use the app.";
      updatedHistory = history;
    }

    let sentMessageId: string | undefined;
    try {
      sentMessageId = await sendElaineEmailReply(
        user.email,
        subject,
        replyText,
        inboundMessageId,
      );
    } catch (err) {
      logger.error({ err }, "elaine-email: reply send failed");
    }

    await db
      .update(elaineEmailConversations)
      .set({
        messages: updatedHistory,
        lastMessageId: sentMessageId ?? conversation.lastMessageId,
        updatedAt: new Date(),
      })
      .where(eq(elaineEmailConversations.id, conversation.id));

    res.status(200).json({ ok: true });
  },
);

export default router;
