import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

// Calendar access requires its own consent (separate from the login scopes)
// and offline access so we can refresh in the background without the user
// being present. Each family member connects their own Google account.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "email",
];

export function googleCalendarOAuthEnabled(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

/**
 * Build a fresh OAuth2 client bound to the given redirect URI, mirroring the
 * login OAuth client pattern (per-request redirect URI derived from the
 * incoming host) but scoped separately for calendar access.
 */
export function createGoogleCalendarClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri,
  });
}
