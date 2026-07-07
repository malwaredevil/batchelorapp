import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

// Full mailbox access for the hub webmail feature. Uses the same shared Google
// OAuth client id/secret as login, Calendar, and the travels Gmail scanner —
// no new credentials needed. The user will be prompted to grant the new scope
// when they connect for the first time in the hub.
//
// https://mail.google.com/ is a restricted scope; Google requires apps to
// complete a security assessment OR stay in OAuth "Testing" status. This app
// stays in Testing (household-only, ≤100 test users).
export const APP_GMAIL_SCOPES = ["https://mail.google.com/", "email"];

export function appGmailOAuthEnabled(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

/**
 * Build a fresh OAuth2 client for the hub Gmail connection. Uses the same
 * shared client id/secret but a different redirect URI and scope set from the
 * travels Gmail scanner. Mirrors the per-request redirect URI pattern of the
 * other OAuth helpers.
 */
export function createAppGmailOAuthClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri,
  });
}
