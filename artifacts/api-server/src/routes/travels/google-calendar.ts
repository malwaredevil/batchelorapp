import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsGoogleCalendarConnections } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createGoogleCalendarClient,
  googleCalendarOAuthEnabled,
  GOOGLE_CALENDAR_SCOPES,
} from "../../lib/google-calendar-oauth";
import {
  getCalendarConnection,
  getValidAccessToken,
} from "../../lib/google-calendar-tokens";
import { listGoogleCalendars } from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const TEN_MINUTES_MS = 1000 * 60 * 10;
const OAUTH_STATE_COOKIE = "travels.gcal_oauth_state";
const OAUTH_COOKIE_PATH = "/api/travels/google-calendar";

function callbackUrl(req: { protocol: string; get: (h: string) => string | undefined }): string {
  const host = req.get("host");
  return `${req.protocol}://${host}/api/travels/google-calendar/callback`;
}

// GET /google-calendar/status — is the current user connected, and to which calendar
router.get("/google-calendar/status", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const connection = await getCalendarConnection(userId);
  res.json({
    connected: Boolean(connection),
    googleEmail: connection?.googleEmail ?? null,
    calendarId: connection?.calendarId ?? null,
    calendarSummary: connection?.calendarSummary ?? null,
  });
});

// GET /google-calendar/connect — begin the per-user OAuth flow
router.get("/google-calendar/connect", requireAuth, (req, res) => {
  if (!googleCalendarOAuthEnabled()) {
    res.status(503).json({ error: "Google Calendar is not configured." });
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
  const url = createGoogleCalendarClient(callbackUrl(req)).generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
    prompt: "consent",
  });
  res.redirect(url);
});

// GET /google-calendar/callback — Google redirects back here with a one-time code
router.get("/google-calendar/callback", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const FAILURE_REDIRECT = "/travels/settings?calendar=error";
  const SUCCESS_REDIRECT = "/travels/settings?calendar=connected";

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
    const client = createGoogleCalendarClient(callbackUrl(req));
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token || !tokens.access_token) {
      // Google only returns a refresh_token on the first consent; if the user
      // previously connected and revoked outside our disconnect flow, they
      // may need to be sent through Google's account permissions page once.
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
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
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
      .insert(travelsGoogleCalendarConnections)
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
        target: travelsGoogleCalendarConnections.userId,
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
    logger.error({ err, userId }, "google-calendar: OAuth callback failed");
    res.redirect(FAILURE_REDIRECT);
  }
});

// GET /google-calendar/calendars — list calendars on the current user's connected account
router.get("/google-calendar/calendars", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Google Calendar is not connected." });
    return;
  }
  try {
    const calendars = await listGoogleCalendars(accessToken);
    res.json(calendars);
  } catch (err) {
    logger.error({ err, userId }, "google-calendar: failed to list calendars");
    res.status(502).json({ error: "Could not reach Google Calendar." });
  }
});

const SelectCalendarBody = z.object({
  calendarId: z.string().min(1),
  calendarSummary: z.string().min(1),
});

// PUT /google-calendar/settings — choose which calendar reminders sync to
router.put("/google-calendar/settings", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const body = SelectCalendarBody.parse(req.body);

  const [updated] = await db
    .update(travelsGoogleCalendarConnections)
    .set({
      calendarId: body.calendarId,
      calendarSummary: body.calendarSummary,
      updatedAt: new Date(),
    })
    .where(eq(travelsGoogleCalendarConnections.userId, userId))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Google Calendar is not connected." });
    return;
  }

  res.json({
    calendarId: body.calendarId,
    calendarSummary: body.calendarSummary,
  });
});

// DELETE /google-calendar/disconnect — remove the stored connection
router.delete("/google-calendar/disconnect", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  await db
    .delete(travelsGoogleCalendarConnections)
    .where(eq(travelsGoogleCalendarConnections.userId, userId));
  res.status(204).send();
});

export default router;
