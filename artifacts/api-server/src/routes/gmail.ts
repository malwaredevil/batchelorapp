import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, appGmailConnections } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import {
  createAppGmailOAuthClient,
  appGmailOAuthEnabled,
  APP_GMAIL_SCOPES,
} from "../lib/app-gmail-oauth";
import { getValidAppGmailAccessToken } from "../lib/app-gmail-tokens";
import {
  getUserProfile,
  listLabels,
  listThreads,
  getThreadSummariesLimited,
  getFullThread,
  buildRawMessage,
  sendMessage,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
  listDrafts,
  modifyMessage,
  trashMessage,
  untrashMessage,
} from "../lib/gmail-api-extended";
import { getAttachment } from "../lib/gmail-api";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const TEN_MINUTES_MS = 1000 * 60 * 10;
const OAUTH_STATE_COOKIE = "hub.gmail_oauth_state";
const OAUTH_COOKIE_PATH = "/api/gmail";

function callbackUrl(req: {
  protocol: string;
  get: (h: string) => string | undefined;
}): string {
  const host = req.get("host");
  return `${req.protocol}://${host}/api/gmail/callback`;
}

/** Resolve a valid access token or respond 401/503. */
async function resolveToken(
  req: { session: { userId?: number } },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<string | null> {
  const token = await getValidAppGmailAccessToken(req.session.userId!);
  if (!token) {
    (res.status(401) as { json: (b: unknown) => void }).json({
      error: "Gmail account not connected. Visit /api/gmail/connect.",
    });
    return null;
  }
  return token;
}

// ── Status ───────────────────────────────────────────────────────────────────

router.get("/status", async (req, res) => {
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, userId))
    .limit(1);

  if (!row) {
    res.json({ connected: false, email: null, profile: null });
    return;
  }

  let profile = null;
  const token = await getValidAppGmailAccessToken(userId);
  if (token) {
    try {
      profile = await getUserProfile(token);
    } catch {
      // non-fatal — return connected: true even if profile fetch fails
    }
  }

  res.json({
    connected: true,
    email: row.googleEmail,
    profile,
  });
});

// ── OAuth connect ─────────────────────────────────────────────────────────────

router.get("/connect", (req, res) => {
  if (!appGmailOAuthEnabled()) {
    res.status(503).json({ error: "Gmail is not configured." });
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
  const url = createAppGmailOAuthClient(callbackUrl(req)).generateAuthUrl({
    access_type: "offline",
    scope: APP_GMAIL_SCOPES,
    state,
    prompt: "consent",
  });
  res.redirect(url);
});

// ── OAuth callback ────────────────────────────────────────────────────────────

router.get("/callback", async (req, res) => {
  const userId = req.session.userId!;
  const FAILURE = "/gmail?gmail=error";
  const SUCCESS = "/gmail?gmail=connected";

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
    res.redirect(FAILURE);
    return;
  }

  try {
    const client = createAppGmailOAuthClient(callbackUrl(req));
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) {
      res.redirect(FAILURE);
      return;
    }
    if (!tokens.refresh_token) {
      // No refresh token — user may need to revoke the existing grant first.
      res.redirect("/gmail?gmail=no_refresh_token");
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
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (userInfoRes.ok) {
        const info = (await userInfoRes.json()) as { email?: string };
        googleEmail = info.email?.trim().toLowerCase() ?? null;
      }
    }
    if (!googleEmail) {
      res.redirect(FAILURE);
      return;
    }

    await db
      .insert(appGmailConnections)
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
        target: appGmailConnections.userId,
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

    res.redirect(SUCCESS);
  } catch (err) {
    req.log.error({ err }, "hub gmail oauth callback failed");
    res.redirect(FAILURE);
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────

router.delete("/disconnect", async (req, res) => {
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, userId))
    .limit(1);

  if (row) {
    // Best-effort token revoke
    try {
      const client = createAppGmailOAuthClient("");
      await client.revokeToken(row.refreshToken);
    } catch {
      /* ignore */
    }
    await db
      .delete(appGmailConnections)
      .where(eq(appGmailConnections.userId, userId));
  }
  res.json({ ok: true });
});

// ── Labels ────────────────────────────────────────────────────────────────────

router.get("/labels", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  try {
    const labels = await listLabels(token);
    res.json({ labels });
  } catch (err) {
    req.log.error({ err }, "gmail list-labels failed");
    res.status(502).json({ error: "Failed to fetch labels." });
  }
});

// ── Thread list ───────────────────────────────────────────────────────────────

const ThreadListQuery = z.object({
  labelIds: z.string().optional(), // comma-separated
  q: z.string().optional(),
  pageToken: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(50).default(20),
});

router.get("/threads", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;

  const parsed = ThreadListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters." });
    return;
  }
  const { labelIds, q, pageToken, maxResults } = parsed.data;
  const labelIdList = labelIds ? labelIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  try {
    const page = await listThreads(token, {
      labelIds: labelIdList,
      q,
      pageToken,
      maxResults,
    });

    const summaries = await getThreadSummariesLimited(
      token,
      page.threads.map((t) => t.id),
    );

    res.json({
      threads: summaries.filter(Boolean),
      nextPageToken: page.nextPageToken ?? null,
      resultSizeEstimate: page.resultSizeEstimate ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "gmail list-threads failed");
    res.status(502).json({ error: "Failed to fetch threads." });
  }
});

// ── Full thread ───────────────────────────────────────────────────────────────

router.get("/threads/:threadId", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  try {
    const thread = await getFullThread(token, req.params.threadId);
    res.json(thread);
  } catch (err) {
    req.log.error({ err, threadId: req.params.threadId }, "gmail get-thread failed");
    res.status(502).json({ error: "Failed to fetch thread." });
  }
});

// ── Attachments ───────────────────────────────────────────────────────────────

router.get(
  "/messages/:messageId/attachments/:attachmentId",
  async (req, res) => {
    const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
    if (!token) return;
    const { filename } = req.query;
    try {
      const buf = await getAttachment(
        token,
        req.params.messageId,
        req.params.attachmentId,
      );
      const safeFilename = (typeof filename === "string" ? filename : "attachment")
        .replace(/["\r\n\\]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename}"`,
      );
      res.setHeader("Content-Type", "application/octet-stream");
      res.send(buf);
    } catch (err) {
      req.log.error({ err }, "gmail get-attachment failed");
      res.status(502).json({ error: "Failed to fetch attachment." });
    }
  },
);

// ── Send / Draft ──────────────────────────────────────────────────────────────

const ComposeSchema = z.object({
  to: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  body: z.string(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  threadId: z.string().optional(),
});

router.post("/messages/send", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;

  const parsed = ComposeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  // Resolve sender email from connection row
  const [row] = await db
    .select({ googleEmail: appGmailConnections.googleEmail })
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, req.session.userId!))
    .limit(1);
  if (!row) {
    res.status(401).json({ error: "Not connected." });
    return;
  }

  try {
    const raw = buildRawMessage({
      from: row.googleEmail,
      ...parsed.data,
    });
    const result = await sendMessage(token, raw, parsed.data.threadId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "gmail send-message failed");
    res.status(502).json({ error: "Failed to send message." });
  }
});

router.post("/drafts", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;

  const parsed = ComposeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  const [row] = await db
    .select({ googleEmail: appGmailConnections.googleEmail })
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, req.session.userId!))
    .limit(1);
  if (!row) {
    res.status(401).json({ error: "Not connected." });
    return;
  }

  try {
    const raw = buildRawMessage({ from: row.googleEmail, ...parsed.data });
    const result = await createDraft(token, raw, parsed.data.threadId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "gmail create-draft failed");
    res.status(502).json({ error: "Failed to create draft." });
  }
});

router.put("/drafts/:draftId", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;

  const parsed = ComposeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  const [row] = await db
    .select({ googleEmail: appGmailConnections.googleEmail })
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, req.session.userId!))
    .limit(1);
  if (!row) {
    res.status(401).json({ error: "Not connected." });
    return;
  }

  try {
    const raw = buildRawMessage({ from: row.googleEmail, ...parsed.data });
    const result = await updateDraft(token, req.params.draftId, raw, parsed.data.threadId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "gmail update-draft failed");
    res.status(502).json({ error: "Failed to update draft." });
  }
});

router.post("/drafts/:draftId/send", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  try {
    const result = await sendDraft(token, req.params.draftId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "gmail send-draft failed");
    res.status(502).json({ error: "Failed to send draft." });
  }
});

router.delete("/drafts/:draftId", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  try {
    await deleteDraft(token, req.params.draftId);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "gmail delete-draft failed");
    res.status(502).json({ error: "Failed to delete draft." });
  }
});

router.get("/drafts", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  const { pageToken, maxResults } = req.query;
  try {
    const result = await listDrafts(
      token,
      typeof pageToken === "string" ? pageToken : undefined,
      typeof maxResults === "string" ? Math.min(50, Math.max(1, parseInt(maxResults, 10))) : 20,
    );
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "gmail list-drafts failed");
    res.status(502).json({ error: "Failed to list drafts." });
  }
});

// ── Modify message ─────────────────────────────────────────────────────────────

const ModifySchema = z.object({
  addLabelIds: z.array(z.string()).optional().default([]),
  removeLabelIds: z.array(z.string()).optional().default([]),
});

router.patch("/messages/:messageId", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;

  const parsed = ModifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  try {
    await modifyMessage(
      token,
      req.params.messageId,
      parsed.data.addLabelIds,
      parsed.data.removeLabelIds,
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "gmail modify-message failed");
    res.status(502).json({ error: "Failed to modify message." });
  }
});

router.post("/messages/:messageId/trash", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  try {
    await trashMessage(token, req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "gmail trash-message failed");
    res.status(502).json({ error: "Failed to trash message." });
  }
});

router.post("/messages/:messageId/untrash", async (req, res) => {
  const token = await resolveToken(req, res as Parameters<typeof resolveToken>[1]);
  if (!token) return;
  try {
    await untrashMessage(token, req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "gmail untrash-message failed");
    res.status(502).json({ error: "Failed to untrash message." });
  }
});

export default router;
