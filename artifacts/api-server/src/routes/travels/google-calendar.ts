import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  travelsGoogleCalendarConnections,
  travelsConnectedCalendars,
} from "@workspace/db";
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

function callbackUrl(req: {
  protocol: string;
  get: (h: string) => string | undefined;
}): string {
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

// Only allow redirecting back into our own app's relative paths — never an
// absolute/external URL — to prevent this becoming an open-redirect vector.
function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return null;
  }
  return raw;
}

// GET /google-calendar/connect — begin the per-user OAuth flow
router.get("/google-calendar/connect", requireAuth, (req, res) => {
  if (!googleCalendarOAuthEnabled()) {
    res.status(503).json({ error: "Google Calendar is not configured." });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  const cookieValue = returnTo
    ? `${state}:${Buffer.from(returnTo, "utf8").toString("base64url")}`
    : state;
  res.cookie(OAUTH_STATE_COOKIE, cookieValue, {
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

  const { code, state } = req.query;
  const rawCookie = req.signedCookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: OAUTH_COOKIE_PATH,
  });

  let expectedState: string | undefined;
  let returnTo = "/account";
  if (typeof rawCookie === "string") {
    const sepIndex = rawCookie.indexOf(":");
    if (sepIndex === -1) {
      expectedState = rawCookie;
    } else {
      expectedState = rawCookie.slice(0, sepIndex);
      try {
        const decoded = Buffer.from(
          rawCookie.slice(sepIndex + 1),
          "base64url",
        ).toString("utf8");
        const sanitized = sanitizeReturnTo(decoded);
        if (sanitized) returnTo = sanitized;
      } catch {
        // Ignore a malformed returnTo segment — fall back to the default.
      }
    }
  }

  const FAILURE_REDIRECT = `${returnTo}${returnTo.includes("?") ? "&" : "?"}calendar=error`;
  const SUCCESS_REDIRECT = `${returnTo}${returnTo.includes("?") ? "&" : "?"}calendar=connected`;

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

// DELETE /google-calendar/disconnect — revoke the stored OAuth connection
// and clean up every connected-calendar row that depended on it (there's no
// DB-level cascade, so we do it explicitly here) — otherwise a disconnected
// user would still see stale calendar entries in Settings/overlay that
// silently reappear, pre-selected, on reconnect.
router.delete("/google-calendar/disconnect", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  await db
    .delete(travelsConnectedCalendars)
    .where(eq(travelsConnectedCalendars.userId, userId));
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
