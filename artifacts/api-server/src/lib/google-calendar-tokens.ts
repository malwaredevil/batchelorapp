// Per-user Google Calendar token management: reads/refreshes the stored
// OAuth refresh token for a connected user and returns a live access token.
// Also resolves rows in travels_connected_calendars — the per-user,
// per-calendar table that replaced the old single calendarId/isHouseholdShared
// fields on travels_google_calendar_connections.
import { eq, asc } from "drizzle-orm";
import {
  db,
  travelsGoogleCalendarConnections,
  travelsConnectedCalendars,
} from "@workspace/db";
import { createGoogleCalendarClient } from "./google-calendar-oauth";
import { OAUTH_EXPIRY_BUFFER_MS, refreshGoogleToken } from "./google-oauth";
import { logger } from "./logger";

export interface ConnectedCalendar {
  id: number;
  userId: number;
  googleCalendarId: string;
  summary: string;
  source: string;
  primaryColor: string;
  isTravelCalendar: boolean;
}

export interface TravelCalendarConnection {
  connectedCalendarId: number;
  userId: number;
  googleEmail: string;
  googleCalendarId: string;
  summary: string;
  primaryColor: string;
}

export type HallmarkCalendarConnection = TravelCalendarConnection;

/**
 * Returns the single row (if any) marked as the shared "Travel" calendar —
 * every app_user's Travel Calendar requests are proxied through this row's
 * owning user's Google token, regardless of who is asking.
 */
export async function getTravelCalendarConnection(): Promise<TravelCalendarConnection | null> {
  const [row] = await db
    .select({
      id: travelsConnectedCalendars.id,
      userId: travelsConnectedCalendars.userId,
      googleCalendarId: travelsConnectedCalendars.googleCalendarId,
      summary: travelsConnectedCalendars.summary,
      primaryColor: travelsConnectedCalendars.primaryColor,
      googleEmail: travelsGoogleCalendarConnections.googleEmail,
    })
    .from(travelsConnectedCalendars)
    .innerJoin(
      travelsGoogleCalendarConnections,
      eq(
        travelsGoogleCalendarConnections.userId,
        travelsConnectedCalendars.userId,
      ),
    )
    .where(eq(travelsConnectedCalendars.isTravelCalendar, true))
    .limit(1);
  if (!row) return null;
  return {
    connectedCalendarId: row.id,
    userId: row.userId,
    googleEmail: row.googleEmail,
    googleCalendarId: row.googleCalendarId,
    summary: row.summary,
    primaryColor: row.primaryColor,
  };
}

/**
 * Returns the single row (if any) marked as the shared "Hallmark" calendar —
 * mirrors getTravelCalendarConnection(). Ornaments' Hallmark event writes
 * are proxied through this row's owning user's Google token, regardless of
 * who is asking, so any household member can add/edit a Hallmark event and
 * have it mirrored to the shared calendar.
 */
export async function getHallmarkCalendarConnection(): Promise<HallmarkCalendarConnection | null> {
  const [row] = await db
    .select({
      id: travelsConnectedCalendars.id,
      userId: travelsConnectedCalendars.userId,
      googleCalendarId: travelsConnectedCalendars.googleCalendarId,
      summary: travelsConnectedCalendars.summary,
      primaryColor: travelsConnectedCalendars.primaryColor,
      googleEmail: travelsGoogleCalendarConnections.googleEmail,
    })
    .from(travelsConnectedCalendars)
    .innerJoin(
      travelsGoogleCalendarConnections,
      eq(
        travelsGoogleCalendarConnections.userId,
        travelsConnectedCalendars.userId,
      ),
    )
    .where(eq(travelsConnectedCalendars.isHallmarkCalendar, true))
    .limit(1);
  if (!row) return null;
  return {
    connectedCalendarId: row.id,
    userId: row.userId,
    googleEmail: row.googleEmail,
    googleCalendarId: row.googleCalendarId,
    summary: row.summary,
    primaryColor: row.primaryColor,
  };
}

/** All calendars a given user has connected, oldest first. */
export async function getUserConnectedCalendars(
  userId: number,
): Promise<ConnectedCalendar[]> {
  return db
    .select()
    .from(travelsConnectedCalendars)
    .where(eq(travelsConnectedCalendars.userId, userId))
    .orderBy(asc(travelsConnectedCalendars.id));
}

/** Every connected calendar across every user — used by the AI trip scan. */
export async function getAllConnectedCalendars(): Promise<ConnectedCalendar[]> {
  return db
    .select()
    .from(travelsConnectedCalendars)
    .orderBy(asc(travelsConnectedCalendars.id));
}

export async function getConnectedCalendarById(
  id: number,
): Promise<ConnectedCalendar | null> {
  const [row] = await db
    .select()
    .from(travelsConnectedCalendars)
    .where(eq(travelsConnectedCalendars.id, id))
    .limit(1);
  return row ?? null;
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
    row.accessTokenExpiresAt.getTime() - OAUTH_EXPIRY_BUFFER_MS > Date.now();
  if (notExpired) return row.accessToken;

  try {
    const client = createGoogleCalendarClient("");
    client.setCredentials({ refresh_token: row.refreshToken });
    const refreshed = await refreshGoogleToken(client);
    if (!refreshed) return null;

    await db
      .update(travelsGoogleCalendarConnections)
      .set({
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: refreshed.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(travelsGoogleCalendarConnections.userId, userId));

    return refreshed.accessToken;
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), userId },
      "google-calendar: refresh token failed (revoked or expired)",
    );
    return null;
  }
}
