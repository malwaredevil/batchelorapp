import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
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
import {
  extractFromEmailText,
  extractFromImage,
  extractFromPdf,
} from "../../lib/travel-document-extraction";
import { uploadDocument, deleteDocument } from "../../lib/travels-storage";
import { scanGmailForUser } from "../../lib/gmail-scan";
import { markMessageAsIngestedTravel } from "../../lib/gmail-labels";
import { syncItineraryFromDocument } from "./documents";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const TEN_MINUTES_MS = 1000 * 60 * 10;
const OAUTH_STATE_COOKIE = "travels.gmail_oauth_state";
const OAUTH_COOKIE_PATH = "/api/travels/gmail";

// Manual "browse inbox" mode is a plain chronological view of the inbox —
// it intentionally does NOT apply the background scanner's travel-keyword
// pre-filter, so the default (no user-typed search) just lists the latest
// messages. Users can still narrow results with their own Gmail search.
const DEFAULT_INBOX_QUERY = "in:inbox";

const DEFAULT_INBOX_PAGE_SIZE = 20;
const MIN_INBOX_PAGE_SIZE = 10;
const MAX_INBOX_PAGE_SIZE = 50;

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
  const results: (Awaited<ReturnType<typeof getMessageSummary>> | null)[] =
    new Array(messageIds.length).fill(null);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= messageIds.length) return;
      results[i] = await getMessageSummary(accessToken, messageIds[i]!).catch(
        () => null,
      );
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(GMAIL_SUMMARY_CONCURRENCY, messageIds.length) },
      worker,
    ),
  );
  return results;
}

function callbackUrl(req: {
  protocol: string;
  get: (h: string) => string | undefined;
}): string {
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
      const userInfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      );
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
        accessTokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
      })
      .onConflictDoUpdate({
        target: travelsGmailConnections.userId,
        set: {
          googleEmail,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          accessTokenExpiresAt: tokens.expiry_date
            ? new Date(tokens.expiry_date)
            : null,
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
  await db
    .delete(travelsGmailConnections)
    .where(eq(travelsGmailConnections.userId, userId));
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
    res
      .status(502)
      .json({ error: "Could not scan your Gmail inbox right now." });
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
    .where(
      and(
        eq(travelsGmailScanDecisions.id, id),
        eq(travelsGmailScanDecisions.userId, userId),
      ),
    )
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

  const q =
    typeof req.query.q === "string" && req.query.q.trim()
      ? req.query.q
      : DEFAULT_INBOX_QUERY;
  const pageToken =
    typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
  const rawMaxResults =
    typeof req.query.maxResults === "string"
      ? Number(req.query.maxResults)
      : NaN;
  const maxResults =
    Number.isFinite(rawMaxResults) && rawMaxResults > 0
      ? Math.min(
          Math.max(Math.trunc(rawMaxResults), MIN_INBOX_PAGE_SIZE),
          MAX_INBOX_PAGE_SIZE,
        )
      : DEFAULT_INBOX_PAGE_SIZE;

  try {
    const page = await searchMessagesPage(
      accessToken,
      q,
      pageToken,
      maxResults,
    );
    const summaries = await getMessageSummariesLimited(
      accessToken,
      page.messages.map((m) => m.id),
    );
    // Bound the decision lookup to just the message IDs on this inbox page so
    // query volume stays flat as the user's decision history grows.
    const pageMessageIds = page.messages.map((m) => m.id);
    const decisions =
      pageMessageIds.length > 0
        ? await db
            .select({
              gmailMessageId: travelsGmailScanDecisions.gmailMessageId,
              status: travelsGmailScanDecisions.status,
              tripDocumentId: travelsGmailScanDecisions.tripDocumentId,
            })
            .from(travelsGmailScanDecisions)
            .where(
              and(
                eq(travelsGmailScanDecisions.userId, userId),
                inArray(
                  travelsGmailScanDecisions.gmailMessageId,
                  pageMessageIds,
                ),
              ),
            )
        : [];
    const decided = new Set(
      decisions.map((r) => `${r.gmailMessageId}:${r.status}`),
    );

    // For linked emails, resolve the document filename + its trip title so the
    // client can show exactly what an "unlink" would delete in a confirm
    // dialog. Everything is anchored to the requesting user's OWN trip
    // documents (travels_trip_documents.userId = userId): we only ever reveal a
    // trip title for a trip the user's own document belongs to, so a stray
    // decision row can never leak an unrelated trip's title. Trips themselves
    // are household-shared, so no extra per-user trip filter is applied (that
    // would wrongly hide titles for trips created by another household member).
    const linkedDocIds = [
      ...new Set(
        decisions
          .filter((d) => d.status === "linked" && d.tripDocumentId != null)
          .map((d) => d.tripDocumentId as number),
      ),
    ];
    const docInfoById = new Map<
      number,
      { tripId: number; name: string | null }
    >();
    if (linkedDocIds.length > 0) {
      for (const d of await db
        .select({
          id: travelsTripDocuments.id,
          tripId: travelsTripDocuments.tripId,
          originalFilename: travelsTripDocuments.originalFilename,
          documentType: travelsTripDocuments.documentType,
        })
        .from(travelsTripDocuments)
        .where(
          and(
            eq(travelsTripDocuments.userId, userId),
            inArray(travelsTripDocuments.id, linkedDocIds),
          ),
        )) {
        if (d.tripId == null) continue;
        docInfoById.set(d.id, {
          tripId: d.tripId,
          name: d.originalFilename ?? d.documentType ?? null,
        });
      }
    }
    const tripIds = [
      ...new Set([...docInfoById.values()].map((v) => v.tripId)),
    ];
    const tripTitleById = new Map<number, string>();
    if (tripIds.length > 0) {
      for (const t of await db
        .select({ id: travelsTrips.id, title: travelsTrips.title })
        .from(travelsTrips)
        .where(inArray(travelsTrips.id, tripIds))) {
        tripTitleById.set(t.id, t.title);
      }
    }
    const linkedInfoByMessageId = new Map<
      string,
      {
        linkedTripTitle: string | null;
        linkedDocumentName: string | null;
        linkedTripId: number;
      }
    >();
    for (const d of decisions) {
      if (d.status !== "linked" || d.tripDocumentId == null) continue;
      const docInfo = docInfoById.get(d.tripDocumentId);
      if (!docInfo) continue;
      linkedInfoByMessageId.set(d.gmailMessageId, {
        linkedTripTitle: tripTitleById.get(docInfo.tripId) ?? null,
        linkedDocumentName: docInfo.name,
        linkedTripId: docInfo.tripId,
      });
    }

    const messages = summaries
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => {
        const linkedInfo = linkedInfoByMessageId.get(s.id);
        return {
          ...s,
          alreadyLinked: decided.has(`${s.id}:linked`),
          alreadyIgnored:
            decided.has(`${s.id}:ignored`) || decided.has(`${s.id}:dismissed`),
          linkedTripTitle: linkedInfo?.linkedTripTitle ?? null,
          linkedDocumentName: linkedInfo?.linkedDocumentName ?? null,
          linkedTripId: linkedInfo?.linkedTripId ?? null,
        };
      });
    res.json({ messages, nextPageToken: page.nextPageToken ?? null });
  } catch (err) {
    logger.error({ err, userId }, "gmail: inbox search failed");
    res
      .status(502)
      .json({ error: "Could not search your Gmail inbox right now." });
  }
});

const LinkBody = z.object({
  tripId: z.number().int().positive(),
  // When provided, only process the listed attachment IDs (filtered from the
  // email's attachments). Pass an empty array with includeEmailBody:true to
  // attach only the email body text. Omit entirely for the legacy "process
  // everything" behaviour used by undo-relink and bulk-link.
  attachmentIds: z.array(z.string().min(1)).optional(),
  includeEmailBody: z.boolean().optional(),
  // Optional per-item title overrides: keys are attachmentId or "body".
  titles: z.record(z.string(), z.string()).optional(),
});

const MAX_BULK_LINK_MESSAGES = 25;
const BulkLinkBody = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_LINK_MESSAGES),
  tripId: z.number().int().positive(),
});

interface LinkedDocumentResult {
  doc: typeof travelsTripDocuments.$inferSelect;
  extractedData: Record<string, unknown>;
}

// Shared by the single-message and bulk-link routes. When the message has
// one or more attachments, EACH attachment becomes its own trip document
// (per product decision — a booking PDF plus a receipt on the same email
// should both show up as separate documents, not just the first one).
// Messages with no attachments keep the original single text-body document
// behavior. Idempotent per (userId, messageId) via the decision ledger —
// re-linking replaces the prior extractedData/status but does not create
// duplicate documents for an already-"linked" message (callers must check
// existingDecision.status before calling this).
async function linkMessageToTrip(
  userId: number,
  accessToken: string,
  messageId: string,
  tripId: number,
  existingDecision: typeof travelsGmailScanDecisions.$inferSelect | undefined,
  // Optional filter: when present, only process the specified attachment IDs
  // and/or the email body. When absent, falls back to the legacy behaviour:
  // process all attachments if any exist, otherwise the email body.
  attachmentFilter?: { attachmentIds: string[]; includeEmailBody: boolean },
  // Optional title overrides keyed by attachmentId or "body".
  titles?: Record<string, string>,
): Promise<LinkedDocumentResult[]> {
  const full = await getMessage(accessToken, messageId);
  const parsed = parseGmailMessage(full);
  const baseExtractedData =
    (existingDecision?.extractedData as Record<string, unknown> | null) ?? {};

  // Determine which attachments and whether to include the body.
  let attachmentsToProcess = parsed.attachments;
  let processBody = false;
  if (attachmentFilter) {
    const allowed = new Set(attachmentFilter.attachmentIds);
    attachmentsToProcess = parsed.attachments.filter((a) =>
      allowed.has(a.attachmentId),
    );
    processBody = attachmentFilter.includeEmailBody;
  } else {
    // Legacy: attachments take precedence; body only when there are none.
    processBody = parsed.attachments.length === 0;
  }

  const results: LinkedDocumentResult[] = [];

  // Process selected (or all) attachments.
  for (const attachment of attachmentsToProcess) {
    let extractedData: Record<string, unknown> = { ...baseExtractedData };
    const buffer = await getAttachment(
      accessToken,
      messageId,
      attachment.attachmentId,
    );
    const storagePath = await uploadDocument(
      buffer,
      attachment.mimeType,
      attachment.filename,
    );
    try {
      const attachmentData =
        attachment.mimeType === "application/pdf"
          ? await extractFromPdf(buffer)
          : await extractFromImage(buffer, attachment.mimeType);
      // Attachment-derived fields win where present.
      extractedData = { ...extractedData, ...attachmentData };
    } catch (err) {
      logger.warn(
        { err, messageId },
        "gmail: attachment extraction failed, using email-body data",
      );
    }
    const [doc] = await db
      .insert(travelsTripDocuments)
      .values({
        tripId,
        userId,
        storagePath,
        documentType:
          (extractedData.documentType as string | undefined) ?? null,
        originalFilename: attachment.filename,
        title: titles?.[attachment.attachmentId] ?? null,
        extractedData,
        gmailMessageId: messageId,
      })
      .returning();
    results.push({ doc: doc!, extractedData });
  }

  // Process email body text when requested (or when no attachments exist).
  if (processBody) {
    let extractedData = baseExtractedData;
    if (Object.keys(extractedData).length === 0) {
      extractedData = await extractFromEmailText(
        parsed.subject ?? "(no subject)",
        parsed.from ?? "",
        parsed.textBody,
      );
    }
    const textBuffer = Buffer.from(
      parsed.textBody || parsed.subject || "(empty email)",
      "utf-8",
    );
    const originalFilename = `${(parsed.subject ?? "email").slice(0, 60)}.txt`;
    const storagePath = await uploadDocument(
      textBuffer,
      "text/plain",
      originalFilename,
    );
    const [doc] = await db
      .insert(travelsTripDocuments)
      .values({
        tripId,
        userId,
        storagePath,
        documentType:
          (extractedData.documentType as string | undefined) ?? null,
        originalFilename,
        title: titles?.["body"] ?? null,
        extractedData,
        gmailMessageId: messageId,
      })
      .returning();
    results.push({ doc: doc!, extractedData });
  }

  for (const { doc, extractedData } of results) {
    try {
      await syncItineraryFromDocument(tripId, doc.id, extractedData);
    } catch (err) {
      logger.warn(
        { err },
        "gmail: failed to sync itinerary from linked email document",
      );
    }
  }

  const lastResult = results[results.length - 1]!;
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
      extractedData: lastResult.extractedData,
      dedupeKey,
      tripId,
      tripDocumentId: lastResult.doc.id,
    })
    .onConflictDoUpdate({
      target: [
        travelsGmailScanDecisions.userId,
        travelsGmailScanDecisions.gmailMessageId,
      ],
      set: {
        status: "linked",
        extractedData: lastResult.extractedData,
        tripId,
        tripDocumentId: lastResult.doc.id,
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

  return results;
}

async function loadExistingDecision(userId: number, messageId: string) {
  const [existingDecision] = await db
    .select()
    .from(travelsGmailScanDecisions)
    .where(
      and(
        eq(travelsGmailScanDecisions.userId, userId),
        eq(travelsGmailScanDecisions.gmailMessageId, messageId),
      ),
    );
  return existingDecision;
}

// GET /gmail/messages/:messageId — full content view (subject/from/date/body
// + attachment metadata only, no raw attachment bytes) so the user can read
// an email before deciding whether/how to attach it to a trip.
router.get("/gmail/messages/:messageId", async (req, res) => {
  const userId = req.session.userId!;
  const messageId = req.params.messageId as string;

  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Gmail is not connected." });
    return;
  }

  try {
    const full = await getMessage(accessToken, messageId);
    const parsed = parseGmailMessage(full);
    res.json({
      id: messageId,
      subject: parsed.subject,
      from: parsed.from,
      date: parsed.date,
      textBody: parsed.textBody,
      attachments: parsed.attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        attachmentId: a.attachmentId,
        size: a.size,
      })),
    });
  } catch (err) {
    logger.error(
      { err, userId, messageId },
      "gmail: failed to fetch message content",
    );
    res.status(502).json({ error: "Could not load this email right now." });
  }
});

// POST /gmail/messages/:messageId/link — associate a Gmail message (whether
// AI-suggested or manually picked) with a trip. See linkMessageToTrip for
// the attach-all-attachments behavior.
router.post("/gmail/messages/:messageId/link", async (req, res) => {
  const userId = req.session.userId!;
  const messageId = req.params.messageId as string;
  const body = LinkBody.parse(req.body ?? {});

  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Gmail is not connected." });
    return;
  }

  const [trip] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, body.tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const existingDecision = await loadExistingDecision(userId, messageId);
  if (existingDecision?.status === "linked") {
    res.status(409).json({ error: "This email is already linked to a trip." });
    return;
  }

  // Build the optional attachment filter (only when the client sent a
  // selection — legacy undo-relink and bulk-link callers omit it).
  const attachmentFilter =
    body.attachmentIds !== undefined
      ? {
          attachmentIds: body.attachmentIds,
          includeEmailBody: body.includeEmailBody ?? false,
        }
      : undefined;

  try {
    const results = await linkMessageToTrip(
      userId,
      accessToken,
      messageId,
      body.tripId,
      existingDecision,
      attachmentFilter,
      body.titles,
    );
    res
      .status(201)
      .json(results.length === 1 ? results[0]!.doc : results.map((r) => r.doc));
  } catch (err) {
    logger.error(
      { err, userId, messageId },
      "gmail: failed to link message as trip document",
    );
    res.status(502).json({ error: "Could not import this email right now." });
  }
});

// POST /gmail/messages/bulk-link — attach several selected emails to the
// same trip in one action. Each message is processed independently and a
// failure on one does not abort the rest; the response reports per-message
// outcomes. Bounded by MAX_BULK_LINK_MESSAGES to keep a single request from
// driving unbounded Gmail API / AI extraction usage. ("bulk-link" is a
// distinct literal path segment, not nested under "/messages/:messageId",
// so there's no Express route-ordering ambiguity here.)
router.post("/gmail/messages/bulk-link", async (req, res) => {
  const userId = req.session.userId!;
  const body = BulkLinkBody.parse(req.body ?? {});

  const accessToken = await getValidGmailAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Gmail is not connected." });
    return;
  }

  const [trip] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, body.tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const outcomes: {
    messageId: string;
    status: "linked" | "already_linked" | "failed";
    error?: string;
  }[] = [];
  for (const messageId of body.messageIds) {
    try {
      const existingDecision = await loadExistingDecision(userId, messageId);
      if (existingDecision?.status === "linked") {
        outcomes.push({ messageId, status: "already_linked" });
        continue;
      }
      await linkMessageToTrip(
        userId,
        accessToken,
        messageId,
        body.tripId,
        existingDecision,
      );
      outcomes.push({ messageId, status: "linked" });
    } catch (err) {
      logger.error(
        { err, userId, messageId },
        "gmail: bulk-link failed for message",
      );
      outcomes.push({
        messageId,
        status: "failed",
        error: "Could not import this email.",
      });
    }
  }

  res.json({ results: outcomes });
});

// POST /gmail/messages/bulk-unlink — reverse "linked" decisions for multiple
// selected emails in one request. Applies the same teardown as the single
// unlink: removes the referenced trip document (storage + DB row + derived
// itinerary entries) then deletes the decision row, freeing each email to be
// re-added. Capped at 25 messages per request (matching bulk-link). Results
// are per-message so the client can offer a targeted "Undo" action.
router.post("/gmail/messages/bulk-unlink", async (req, res) => {
  const userId = req.session.userId!;
  const { messageIds } = req.body as { messageIds?: unknown };
  if (
    !Array.isArray(messageIds) ||
    messageIds.length === 0 ||
    messageIds.length > 25 ||
    messageIds.some((id) => typeof id !== "string")
  ) {
    res.status(400).json({
      error: "messageIds must be a non-empty string array of at most 25 items.",
    });
    return;
  }

  const outcomes: {
    messageId: string;
    status: "unlinked" | "not_linked" | "failed";
    tripId: number | null;
  }[] = [];

  for (const messageId of messageIds as string[]) {
    try {
      const decision = await loadExistingDecision(userId, messageId);
      if (!decision || decision.status !== "linked") {
        outcomes.push({ messageId, status: "not_linked", tripId: null });
        continue;
      }
      const { tripId, tripDocumentId } = decision;
      if (tripId != null && tripDocumentId != null) {
        const [doc] = await db
          .select()
          .from(travelsTripDocuments)
          .where(
            and(
              eq(travelsTripDocuments.id, tripDocumentId),
              eq(travelsTripDocuments.userId, userId),
            ),
          );
        if (doc) {
          try {
            await deleteDocument(doc.storagePath);
          } catch (err) {
            logger.warn(
              { err, userId, messageId, docId: tripDocumentId },
              "gmail bulk-unlink: storage delete failed — removing DB record anyway",
            );
          }
          await db
            .delete(travelsTripDocuments)
            .where(eq(travelsTripDocuments.id, tripDocumentId));
          try {
            await syncItineraryFromDocument(tripId, tripDocumentId, {});
          } catch (err) {
            logger.warn(
              { err, userId, messageId, docId: tripDocumentId },
              "gmail bulk-unlink: failed to purge itinerary entries",
            );
          }
        }
      }
      await db
        .delete(travelsGmailScanDecisions)
        .where(
          and(
            eq(travelsGmailScanDecisions.userId, userId),
            eq(travelsGmailScanDecisions.gmailMessageId, messageId),
          ),
        );
      outcomes.push({ messageId, status: "unlinked", tripId: tripId ?? null });
    } catch (err) {
      logger.error(
        { err, userId, messageId },
        "gmail bulk-unlink: failed for message",
      );
      outcomes.push({ messageId, status: "failed", tripId: null });
    }
  }

  res.json({ results: outcomes });
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
        target: [
          travelsGmailScanDecisions.userId,
          travelsGmailScanDecisions.gmailMessageId,
        ],
        set: { status: "ignored", updatedAt: new Date() },
      });
    res.status(204).send();
  } catch (err) {
    logger.error({ err, userId, messageId }, "gmail: failed to ignore message");
    res.status(502).json({ error: "Could not update this email right now." });
  }
});

// POST /gmail/messages/:messageId/reconsider — undo an "ignored"/"dismissed"
// decision so the email can be re-selected in the browse/suggestions views.
// Deletes the decision row entirely (rather than flipping status) so the
// message goes back through the exact same "unhandled" code path used for
// never-seen emails. Only the connecting user's own decision can be
// reconsidered, and only from ignored/dismissed — an already-linked message
// must be unlinked through trip document management instead.
router.post("/gmail/messages/:messageId/reconsider", async (req, res) => {
  const userId = req.session.userId!;
  const messageId = req.params.messageId as string;

  const existingDecision = await loadExistingDecision(userId, messageId);
  if (!existingDecision) {
    res.status(404).json({ error: "No decision found for this email." });
    return;
  }
  if (
    existingDecision.status !== "ignored" &&
    existingDecision.status !== "dismissed"
  ) {
    res
      .status(409)
      .json({ error: "Only ignored or dismissed emails can be reconsidered." });
    return;
  }

  await db
    .delete(travelsGmailScanDecisions)
    .where(
      and(
        eq(travelsGmailScanDecisions.userId, userId),
        eq(travelsGmailScanDecisions.gmailMessageId, messageId),
      ),
    );
  res.status(204).send();
});

// POST /gmail/messages/:messageId/unlink — reverse a "linked" decision so the
// email becomes re-addable from the inbox browser without the user having to
// hunt down and delete the trip document by hand. Mirrors the delete-document
// lifecycle: it removes the document created from this email (storage object +
// row) and purges any itinerary entries derived from it, then deletes the
// decision row. Only the connecting user's own decision can be unlinked, and
// only from the "linked" state — ignored/dismissed emails use reconsider
// instead. Gmail access is single-owner, so everything is scoped strictly by
// the session userId, never by trip/household membership.
//
// Note: the decision row records only the last document created for this email
// (tripDocumentId). For a multi-attachment email that produced several docs,
// unlink removes that referenced doc and frees the email; any sibling docs
// remain in the trip (same limitation as the delete-document path).
router.post("/gmail/messages/:messageId/unlink", async (req, res) => {
  const userId = req.session.userId!;
  const messageId = req.params.messageId as string;

  const existingDecision = await loadExistingDecision(userId, messageId);
  if (!existingDecision) {
    res.status(404).json({ error: "No decision found for this email." });
    return;
  }
  if (existingDecision.status !== "linked") {
    res.status(409).json({ error: "Only linked emails can be unlinked." });
    return;
  }

  const { tripId, tripDocumentId } = existingDecision;

  // Best-effort teardown of the linked document and its derived itinerary
  // entries. Failures are logged, never surfaced — the primary goal is to free
  // the email to be re-added, and a lingering doc/itinerary row must not block
  // that. Scoped by userId so a session can only touch its own document.
  if (tripId != null && tripDocumentId != null) {
    const [doc] = await db
      .select()
      .from(travelsTripDocuments)
      .where(
        and(
          eq(travelsTripDocuments.id, tripDocumentId),
          eq(travelsTripDocuments.userId, userId),
        ),
      );
    if (doc) {
      try {
        await deleteDocument(doc.storagePath);
      } catch (err) {
        logger.warn(
          { err, userId, messageId, docId: tripDocumentId },
          "gmail unlink: storage delete failed — removing DB record anyway",
        );
      }
      await db
        .delete(travelsTripDocuments)
        .where(eq(travelsTripDocuments.id, tripDocumentId));
      try {
        await syncItineraryFromDocument(tripId, tripDocumentId, {});
      } catch (err) {
        logger.warn(
          { err, userId, messageId, docId: tripDocumentId },
          "gmail unlink: failed to purge itinerary entries",
        );
      }
    }
  }

  await db
    .delete(travelsGmailScanDecisions)
    .where(
      and(
        eq(travelsGmailScanDecisions.userId, userId),
        eq(travelsGmailScanDecisions.gmailMessageId, messageId),
      ),
    );
  res.status(204).send();
});

export default router;
