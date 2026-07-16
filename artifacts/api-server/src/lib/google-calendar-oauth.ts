import type { OAuth2Client } from "google-auth-library";
import { createGoogleClient, googleEnabled } from "./google-oauth";

// Calendar access requires its own consent (separate from the login scopes)
// and offline access so we can refresh in the background without the user
// being present. Each family member connects their own Google account.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "email",
];

export function googleCalendarOAuthEnabled(): boolean {
  return googleEnabled();
}

/**
 * Build a fresh OAuth2 client bound to the given redirect URI, mirroring the
 * login OAuth client pattern (per-request redirect URI derived from the
 * incoming host) but scoped separately for calendar access.
 *
 * Delegates to `createGoogleClient` — all four Google OAuth flows share the
 * same client id/secret; scope differences are applied when building the
 * authorisation URL in the route, not here.
 */
export function createGoogleCalendarClient(redirectUri: string): OAuth2Client {
  return createGoogleClient(redirectUri);
}
