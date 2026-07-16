// Per-user token management for the hub webmail Gmail connection.
// Mirrors gmail-tokens.ts but reads from app_gmail_connections instead of
// travels_gmail_connections.
import { eq } from "drizzle-orm";
import { db, appGmailConnections } from "@workspace/db";
import { createAppGmailOAuthClient } from "./app-gmail-oauth";
import { OAUTH_EXPIRY_BUFFER_MS, refreshGoogleToken } from "./google-oauth";
import { logger } from "./logger";

export interface AppGmailConnection {
  id: number;
  userId: number;
  googleEmail: string;
}

export async function getAppGmailConnection(
  userId: number,
): Promise<AppGmailConnection | null> {
  const [row] = await db
    .select()
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, userId))
    .limit(1);
  if (!row) return null;
  return { id: row.id, userId: row.userId, googleEmail: row.googleEmail };
}

/**
 * Returns a valid (non-expired) access token for the user's hub Gmail
 * connection, refreshing via the stored refresh token if needed. Returns null
 * if the user has no connection or the token has been revoked.
 */
export async function getValidAppGmailAccessToken(
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appGmailConnections)
    .where(eq(appGmailConnections.userId, userId))
    .limit(1);
  if (!row) return null;

  const notExpired =
    row.accessToken &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - OAUTH_EXPIRY_BUFFER_MS > Date.now();
  if (notExpired) return row.accessToken;

  try {
    const client = createAppGmailOAuthClient("");
    client.setCredentials({ refresh_token: row.refreshToken });
    const refreshed = await refreshGoogleToken(client);
    if (!refreshed) return null;

    await db
      .update(appGmailConnections)
      .set({
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: refreshed.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(appGmailConnections.userId, userId));

    return refreshed.accessToken;
  } catch (err) {
    logger.warn(
      {
        errMessage: err instanceof Error ? err.message : String(err),
        userId,
      },
      "app-gmail: refresh token failed (revoked or expired)",
    );
    return null;
  }
}
