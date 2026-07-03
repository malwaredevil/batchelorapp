import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, travelsGoogleCalendarConnections } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createGoogleCalendarClient,
  googleCalendarOAuthEnabled,
  GOOGLE_CALENDAR_SCOPES,
} from "../../lib/google-calendar-oauth";
import { getValidAccessToken } from "../../lib/google-calendar-tokens";
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

// GET /google-calendar/status — is the current user's Google account connected
router.get("/google-calendar/status", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const [connection] = await db
    .select()
    .from(travelsGoogleCalendarConnections)
    .where(eq(travelsGoogleCalendarConnections.userId, userId))
    .limit(1);
  res.json({
    connected: Boolean(connection),
    googleEmail: connection?.googleEmail ?? null,
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

// DELETE /google-calendar/disconnect — remove the stored connection (and,
// by extension, every connected calendar row that depended on this token —
// handled by the connected-calendars route via ON DELETE semantics is not
// enforced at the DB level, so callers should remove connected calendars
// first if they want a clean teardown; this just revokes the token).
router.delete("/google-calendar/disconnect", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  await db
    .delete(travelsGoogleCalendarConnections)
    .where(eq(travelsGoogleCalendarConnections.userId, userId));
  res.status(204).send();
});

// Google's fixed per-event color palette (colorId "1".."11"). Hardcoded
// since it never changes and calling Google's /colors endpoint would just
// be an extra round trip for a static list.
const GOOGLE_EVENT_COLORS = [
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "5", name: "Banana", hex: "#f6c026" },
  { id: "6", name: "Tangerine", hex: "#f5511d" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "8", name: "Graphite", hex: "#616161" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "11", name: "Tomato", hex: "#d60000" },
] as const;

// GET /google-calendar/colors — Google's fixed event color palette, used for
// the per-event colorId in the Travel Calendar overlay UI.
router.get("/google-calendar/colors", requireAuth, (_req, res) => {
  res.json(GOOGLE_EVENT_COLORS);
});

export default router;
