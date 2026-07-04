import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsGmailConnections,
  travelsGmailScanDecisions,
  travelsTrips,
  travelsTripDocuments,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createGmailOAuthClient,
  gmailOAuthEnabled,
  GMAIL_SCOPES,
} from "../../lib/gmail-oauth";
import { getValidGmailAccessToken } from "../../lib/gmail-tokens";
import {
  getAttachment,
  getMessage,
  getMessageSummary,
  parseGmailMessage,
  searchMessagesPage,
} from "../../lib/gmail-api";
import { extractFromEmailText, extractFromImage, extractFromPdf } from "../../lib/travel-document-extraction";
import { uploadDocument } from "../../lib/travels-storage";
import { scanGmailForUser } from "../../lib/gmail-scan";
import { markMessageAsIngestedTravel } from "../../lib/gmail-labels";
import { syncItineraryFromDocument } from "./documents";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const TEN_MINUTES_MS = 1000 * 60 * 10;
const OAUTH_STATE_COOKIE = "travels.gmail_oauth_state";
const OAUTH_COOKIE_PATH = "/api/travels/gmail";

// Same coarse pre-filter as the background scanner, reused so the manual
// inbox browser's default search matches what auto-scan would have found —
// the user can still type their own query in the search box.
const DEFAULT_INBOX_QUERY =
  '(subject:(flight OR itinerary OR "boarding pass" OR "e-ticket" OR eticket OR reservation OR booking OR confirmation OR "check-in" OR hotel OR train OR "car rental" OR "rental car")) -category:promotions -category:social';

// Gmail enforces a per-user *concurrent* request cap (distinct from its
// per-second quota) — an unbounded Promise.all over ~25 message-summary
// fetches reliably triggers 429 "Too many concurrent requests for user" and
// silently drops those rows (each summary fetch is individually caught and
// filtered to null downstream). Cap concurrency to stay under that limit.
const GMAIL_SUMMARY_CONCURRENCY = 5;

async function getMessageSummariesLimited(
  accessToken: string,
  messageIds: string[],
): Promise<(Awaited<ReturnType<typeof getMessageSummary>> | null)[]> {
  const results: (Awaited<ReturnType<typeof getMessageSummary>> | null)[] = new Array(
    messageIds.length,
  ).fill(null);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= messageIds.length) return;
      results[i] = await getMessageSummary(accessToken, messageIds[i]!).catch(() => null);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(GMAIL_SUMMARY_CONCURRENCY, messageIds.length) }, worker),
  );
  return results;
}

function callbackUrl(req: { protocol: string; get: (h: string) => string | undefined }): string {
  const host = req.get("host");
  return `${req.protocol}://${host}/api/travels/gmail/callback`;
}

// GET /gmail/status
router.get("/gmail/status", async (req, res) => {
  const userId = req.session.userId!;
  const [connection] = await db
    .select()
    .from(travelsGmailConnections)
    .where(eq(travelsGmailConnections.userId, userId))
    .limit(1);
  res.json({
    connected: Boolean(connection),
    googleEmail: connection?.googleEmail ?? null,
    lastScanAt: connection?.lastScanAt ?? null,
  });
});

// GET /gmail/connect — begin the per-user OAuth flow (separate consent from
// Calendar; gmail.readonly is a restricted scope, see gmail-oauth.ts).
router.get("/gmail/connect", (req, res) => {
  if (!gmailOAuthEnabled()) {
    res.status(503).json({ error: "Gmail scanning is not configured." });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(OAUTH_STATE_COOKIE, state, {
    signed: true,
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: TEN_MINUTES_MS,
    path: OAUTH_COOKIE_PATH,
  });
  const url = createGmailOAuthClient(callbackUrl(req)).generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    state,
    prompt: "consent",
  });
  res.redirect(url);
});

// GET /gmail/callback
router.get("/gmail/callback", async (req, res) => {
  const userId = req.session.userId!;
  const FAILURE_REDIRECT = "/travels/settings?gmail=error";
  const SUCCESS_REDIRECT = "/travels/settings?gmail=connected";

  const { code, state } = req.query;
  const expectedState = req.signedCookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: OAUTH_COOKIE_PATH,
  });

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    typeof expectedState !== "string" ||
    !expectedState ||
    state !== expectedState
  ) {
    res.redirect(FAILURE_REDIRECT);
    return;
  }

  try {
    const client = createGmailOAuthClient(callbackUrl(req));
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token || !tokens.access_token) {
      // Google only issues a refresh_token on first consent; if previously
      // connected+revoked outside our disconnect flow, the user needs to
      // revisit Google's permissions page once before reconnecting works.
      res.redirect(FAILURE_REDIRECT);
      return;
    }

    let googleEmail: string | null = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token });
      googleEmail = ticket.getPayload()?.email?.trim().toLowerCase() ?? null;
    }
    if (!googleEmail) {
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfoRes.ok) {
        const info = (await userInfoRes.json()) as { email?: string };
        googleEmail = info.email?.trim().toLowerCase() ?? null;
      }
    }
    if (!googleEmail) {
      res.redirect(FAILURE_REDIRECT);
      return;
    }

    await db
      .insert(travelsGmailConnections)
      .values({
        userId,
        googleEmail,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      })
      .onConflictDoUpdate({
        target: travelsGmailConnections.userId,
        set: {
          googleEmail,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          updatedAt: new Date(),
        },
      });

    res.redirect(SUCCESS_REDIRECT);
  } catch (err) {
    logger.error({ err, userId }, "gmail: OAuth callback failed");
    res.redirect(FAILURE_REDIRECT);
  }
});

// DELETE /gmail/disconnect — revoke the stored connection. Past decisions
// are kept (they're a permanent ledger of what's already been reviewed) so
// reconnecting later doesn't re-surface already-handled emails.
router.delete("/gmail/disconnect", async (req, res) => {
  const userId = req.session.userId!;
  await db.delete(travelsGmailConnections).where(eq(travelsGmailConnections.userId, userId));
  res.status(204).send();
});

// POST /gmail/scan — manual "Scan now" trigger for the current user's inbox.
router.post("/gmail/scan", async (req, res) => {
  const userId = req.session.userId!;
  try {
    const result = await scanGmailForUser(userId);
    await db
      .update(travelsGmailConnections)
      .set({ lastScanAt: new Date() })
      .where(eq(travelsGmailConnections.userId, userId));
    res.json(result);
  } catch (err) {
    logger.error({ err, userId }, "gmail: manual scan failed");
    res.status(502).json({ error: "Could not scan your Gmail inbox right now." });
  }
});

// GET /gmail/suggestions — AI-found pending travel emails awaiting review,
// for the current user only (their own inbox contents are private).
router.get("/gmail/suggestions", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(travelsGmailScanDecisions)
    .where(
      and(
        eq(travelsGmailScanDecisions.userId, userId),
        eq(travelsGmailScanDecisions.status, "pending"),
      ),
    )
    .orderBy(desc(travelsGmailScanDecisions.receivedAt));
  res.json(rows);
});

// POST /gmail/suggestions/:id/dismiss — permanently decide not to link this
// email to any trip. Decided emails are never re-surfaced by future scans.
router.post("/gmail/suggestions/:id/dismiss", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = req.session.userId!;
  const [updated] = await db
    .update(travelsGmailScanDecisions)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(and(eq(travelsGmailScanDecisions.id, id), eq(travelsGmailScanDecisions.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

// GET /gmail/inbox — manual mode: live-search the connected inbox (not
// limited to already-scanned/decided messages) so the user can pick any
// email, not just AI-flagged ones, to associate with a trip.
router.get("/gmail/inbox", async (req, res) => {
  const userId = req.session.userId!;
  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Gmail is not connected." });
    return;
  }

  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q : DEFAULT_INBOX_QUERY;
  const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;

  try {
    const page = await searchMessagesPage(accessToken, q, pageToken, 25);
    const summaries = await getMessageSummariesLimited(
      accessToken,
      page.messages.map((m) => m.id),
    );
    const decided = new Set(
      (
        await db
          .select({ gmailMessageId: travelsGmailScanDecisions.gmailMessageId, status: travelsGmailScanDecisions.status })
          .from(travelsGmailScanDecisions)
          .where(eq(travelsGmailScanDecisions.userId, userId))
      ).map((r) => `${r.gmailMessageId}:${r.status}`),
    );
    const messages = summaries
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({
        ...s,
        alreadyLinked: decided.has(`${s.id}:linked`),
        alreadyIgnored: decided.has(`${s.id}:ignored`) || decided.has(`${s.id}:dismissed`),
      }));
    res.json({ messages, nextPageToken: page.nextPageToken ?? null });
  } catch (err) {
    logger.error({ err, userId }, "gmail: inbox search failed");
    res.status(502).json({ error: "Could not search your Gmail inbox right now." });
  }
});

const LinkBody = z.object({
  tripId: z.number().int().positive(),
  attachmentIndex: z.number().int().min(0).optional(),
});

// POST /gmail/messages/:messageId/link — associate a Gmail message (whether
// AI-suggested or manually picked) with a trip as a trip document. If the
// message has a PDF/image attachment, it's downloaded into the same
// document-storage pipeline used for manual uploads and re-extracted from
// the attachment (generally more reliable than the email body text);
// otherwise the email body itself is stored and used as the extraction
// source. Idempotent per (userId, messageId) via the decision ledger.
router.post("/gmail/messages/:messageId/link", async (req, res) => {
  const userId = req.session.userId!;
  const messageId = req.params.messageId as string;
  const body = LinkBody.parse(req.body ?? {});

  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Gmail is not connected." });
    return;
  }

  const [trip] = await db.select({ id: travelsTrips.id }).from(travelsTrips).where(eq(travelsTrips.id, body.tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const [existingDecision] = await db
    .select()
    .from(travelsGmailScanDecisions)
    .where(
      and(
        eq(travelsGmailScanDecisions.userId, userId),
        eq(travelsGmailScanDecisions.gmailMessageId, messageId),
      ),
    );
  if (existingDecision?.status === "linked") {
    res.status(409).json({ error: "This email is already linked to a trip." });
    return;
  }

  try {
    const full = await getMessage(accessToken, messageId);
    const parsed = parseGmailMessage(full);

    let extractedData: Record<string, unknown> =
      (existingDecision?.extractedData as Record<string, unknown> | null) ?? {};
    let storagePath: string;
    let originalFilename: string;

    const attachment = parsed.attachments[body.attachmentIndex ?? 0];
    if (attachment) {
      const buffer = await getAttachment(accessToken, messageId, attachment.attachmentId);
      storagePath = await uploadDocument(buffer, attachment.mimeType, attachment.filename);
      originalFilename = attachment.filename;
      try {
        const attachmentData =
          attachment.mimeType === "application/pdf"
            ? await extractFromPdf(buffer)
            : await extractFromImage(buffer, attachment.mimeType);
        // Attachment-derived fields win where present (the source document
        // is generally more reliable than the surrounding email body).
        extractedData = { ...extractedData, ...attachmentData };
      } catch (err) {
        logger.warn({ err, messageId }, "gmail: attachment extraction failed, using email-body data");
      }
    } else {
      if (Object.keys(extractedData).length === 0) {
        extractedData = await extractFromEmailText(
          parsed.subject ?? "(no subject)",
          parsed.from ?? "",
          parsed.textBody,
        );
      }
      const textBuffer = Buffer.from(parsed.textBody || parsed.subject || "(empty email)", "utf-8");
      originalFilename = `${(parsed.subject ?? "email").slice(0, 60)}.txt`;
      storagePath = await uploadDocument(textBuffer, "text/plain", originalFilename);
    }

    const [doc] = await db
      .insert(travelsTripDocuments)
      .values({
        tripId: body.tripId,
        userId,
        storagePath,
        documentType: (extractedData.documentType as string | undefined) ?? null,
        originalFilename,
        extractedData,
      })
      .returning();

    try {
      await syncItineraryFromDocument(body.tripId, doc!.id, extractedData);
    } catch (err) {
      logger.warn({ err }, "gmail: failed to sync itinerary from linked email document");
    }

    const dedupeKey = existingDecision?.dedupeKey ?? null;
    await db
      .insert(travelsGmailScanDecisions)
      .values({
        userId,
        gmailMessageId: messageId,
        threadId: full.threadId,
        subject: parsed.subject,
        fromAddress: parsed.from,
        receivedAt: parsed.date,
        status: "linked",
        extractedData,
        dedupeKey,
        tripId: body.tripId,
        tripDocumentId: doc!.id,
      })
      .onConflictDoUpdate({
        target: [travelsGmailScanDecisions.userId, travelsGmailScanDecisions.gmailMessageId],
        set: {
          status: "linked",
          extractedData,
          tripId: body.tripId,
          tripDocumentId: doc!.id,
          updatedAt: new Date(),
        },
      });

    // Only mark the email in Gmail (Travel + Batchelor App labels) when this
    // link confirms an AI-generated suggestion the user is accepting — a
    // fresh manual pick from the inbox browser was never labeled "Travel" by
    // the app in the first place, and per product decision manual picks stay
    // ledger-only (no Gmail write), so they're excluded here.
    if (existingDecision?.status === "pending") {
      await markMessageAsIngestedTravel(userId, accessToken, messageId);
    }

    res.status(201).json(doc);
  } catch (err) {
    logger.error({ err, userId, messageId }, "gmail: failed to link message as trip document");
    res.status(502).json({ error: "Could not import this email right now." });
  }
});

// POST /gmail/messages/:messageId/ignore — manual-mode equivalent of
// dismissing a suggestion: permanently mark a browsed email as not
// travel-related so it never appears in future scans or browse results as
// unhandled.
router.post("/gmail/messages/:messageId/ignore", async (req, res) => {
  const userId = req.session.userId!;
  const messageId = req.params.messageId as string;

  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Gmail is not connected." });
    return;
  }

  try {
    const summary = await getMessageSummary(accessToken, messageId);
    await db
      .insert(travelsGmailScanDecisions)
      .values({
        userId,
        gmailMessageId: messageId,
        threadId: summary.threadId,
        subject: summary.subject,
        fromAddress: summary.from,
        receivedAt: summary.date,
        status: "ignored",
      })
      .onConflictDoUpdate({
        target: [travelsGmailScanDecisions.userId, travelsGmailScanDecisions.gmailMessageId],
        set: { status: "ignored", updatedAt: new Date() },
      });
    res.status(204).send();
  } catch (err) {
    logger.error({ err, userId, messageId }, "gmail: failed to ignore message");
    res.status(502).json({ error: "Could not update this email right now." });
  }
});

export default router;
