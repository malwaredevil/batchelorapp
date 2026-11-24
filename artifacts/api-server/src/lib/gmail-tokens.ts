// Per-user Gmail token management: reads/refreshes the stored OAuth refresh
// token for a connected user and returns a live access token. Mirrors
// google-calendar-tokens.ts.
import { eq } from "drizzle-orm";
import { db, travelsGmailConnections } from "@workspace/db";
import { createGmailOAuthClient } from "./gmail-oauth";
import { OAUTH_EXPIRY_BUFFER_MS, refreshGoogleToken } from "./google-oauth";
import { logger } from "./logger";
import { withRetry } from "./retry";
import { encryptToken, decryptToken } from "./token-encryption";

export interface GmailConnection {
  id: number;
  userId: number;
  googleEmail: string;
  lastScanAt: Date | null;
}

export async function getGmailConnection(
  userId: number,
): Promise<GmailConnection | null> {
  const [row] = await db
    .select()
    .from(travelsGmailConnections)
    .where(eq(travelsGmailConnections.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    googleEmail: row.googleEmail,
    lastScanAt: row.lastScanAt,
  };
}

/** Every household member with a connected Gmail account. */
export async function getAllGmailConnections(): Promise<GmailConnection[]> {
  const rows = await withRetry(
    async () => await db.select().from(travelsGmailConnections),
    { maxAttempts: 2, label: "gmail-connections-read" },
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    googleEmail: row.googleEmail,
    lastScanAt: row.lastScanAt,
  }));
}

/**
 * Returns a valid (non-expired) access token for the user's connected Gmail
 * account, refreshing it via the stored refresh token if needed. Returns
 * null if the user has no connection or the refresh token has been revoked.
 */
export async function getValidGmailAccessToken(
  userId: number,
): Promise<string | null> {
  // Retry only this read. Replaying the token refresh or the whole scan could
  // duplicate external work after a partially successful attempt.
  const [row] = await withRetry(
    async () =>
      await db
        .select()
        .from(travelsGmailConnections)
        .where(eq(travelsGmailConnections.userId, userId))
        .limit(1),
    { maxAttempts: 2, label: "gmail-access-token-read" },
  );
  if (!row) return null;

  const notExpired =
    row.accessToken &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - OAUTH_EXPIRY_BUFFER_MS > Date.now();
  if (notExpired) return decryptToken(row.accessToken!);

  try {
    const client = createGmailOAuthClient("");
    client.setCredentials({ refresh_token: decryptToken(row.refreshToken) });
    const refreshed = await refreshGoogleToken(client);
    if (!refreshed) return null;

    await db
      .update(travelsGmailConnections)
      .set({
        accessToken: encryptToken(refreshed.accessToken),
        accessTokenExpiresAt: refreshed.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(travelsGmailConnections.userId, userId));

    return refreshed.accessToken;
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), userId },
      "gmail: refresh token failed (revoked or expired)",
    );
    return null;
  }
}
