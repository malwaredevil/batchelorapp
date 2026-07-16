import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

export const GOOGLE_SCOPES = ["openid", "email", "profile"];

/** True when both Google OAuth credentials are configured. */
export function googleEnabled(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

/**
 * Build a fresh OAuth2 client bound to the given redirect URI. The redirect URI
 * is derived per-request from the incoming host so the same code works across
 * the dev preview domain and the published production domain.
 *
 * All four Google OAuth flows (login, Calendar, Gmail scanner, hub webmail) use
 * the same client id/secret — the scope difference is handled when building the
 * authorisation URL in each route, not here.
 */
export function createGoogleClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri,
  });
}

// ─── Shared token-refresh helpers ───────────────────────────────────────────
// Used by google-calendar-tokens.ts, gmail-tokens.ts, and app-gmail-tokens.ts
// to avoid duplicating the same EXPIRY_BUFFER_MS constant and refreshAccessToken
// try/catch pattern across all three files.

/** Refresh a little before actual expiry to avoid races with in-flight requests. */
export const OAUTH_EXPIRY_BUFFER_MS = 60_000;

export interface RefreshedCredentials {
  accessToken: string;
  expiresAt: Date | null;
}

/**
 * Calls `client.refreshAccessToken()` and extracts the new access token.
 * The client must already have `{ refresh_token }` set via setCredentials().
 * Returns null if the server returned no access_token (token revoked / expired).
 */
export async function refreshGoogleToken(
  client: OAuth2Client,
): Promise<RefreshedCredentials | null> {
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) return null;
  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : null,
  };
}
