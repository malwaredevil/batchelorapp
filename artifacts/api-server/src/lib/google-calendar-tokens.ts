// Per-user Google Calendar token management: reads/refreshes the stored
// OAuth refresh token for a connected user and returns a live access token.
import { eq } from "drizzle-orm";
import { db, travelsGoogleCalendarConnections } from "@workspace/db";
import { createGoogleCalendarClient } from "./google-calendar-oauth";
import { logger } from "./logger";

// Refresh a little before actual expiry to avoid races against in-flight requests.
const EXPIRY_BUFFER_MS = 60_000;

export interface CalendarConnection {
  userId: number;
  googleEmail: string;
  calendarId: string | null;
  calendarSummary: string | null;
  travelColorId: string | null;
}

export interface HouseholdCalendarConnection extends CalendarConnection {
  isHouseholdShared: true;
}

/**
 * Returns the single connection (if any) marked as the household's shared
 * "Family Calendar" — every app_user's family-calendar requests are proxied
 * through this connection owner's Google token, regardless of who is asking.
 */
export async function getHouseholdCalendarConnection(): Promise<HouseholdCalendarConnection | null> {
  const [row] = await db
    .select()
    .from(travelsGoogleCalendarConnections)
    .where(eq(travelsGoogleCalendarConnections.isHouseholdShared, true))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    googleEmail: row.googleEmail,
    calendarId: row.calendarId,
    calendarSummary: row.calendarSummary,
    travelColorId: row.travelColorId,
    isHouseholdShared: true,
  };
}

export async function getCalendarConnection(
  userId: number,
): Promise<CalendarConnection | null> {
  const [row] = await db
    .select()
    .from(travelsGoogleCalendarConnections)
    .where(eq(travelsGoogleCalendarConnections.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    googleEmail: row.googleEmail,
    calendarId: row.calendarId,
    calendarSummary: row.calendarSummary,
    travelColorId: row.travelColorId,
  };
}

/**
 * Returns a valid (non-expired) access token for the user's connected Google
 * account, refreshing it via the stored refresh token if needed. Returns
 * null if the user has no connection or the refresh token has been revoked.
 */
export async function getValidAccessToken(
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(travelsGoogleCalendarConnections)
    .where(eq(travelsGoogleCalendarConnections.userId, userId))
    .limit(1);
  if (!row) return null;

  const notExpired =
    row.accessToken &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now();
  if (notExpired) return row.accessToken;

  try {
    const client = createGoogleCalendarClient("");
    client.setCredentials({ refresh_token: row.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) return null;

    await db
      .update(travelsGoogleCalendarConnections)
      .set({
        accessToken: credentials.access_token,
        accessTokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(travelsGoogleCalendarConnections.userId, userId));

    return credentials.access_token;
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), userId },
      "google-calendar: refresh token failed (revoked or expired)",
    );
    return null;
  }
}
