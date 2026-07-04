import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

// Gmail access requires its own consent (separate from login and Calendar
// scopes) and offline access so scans can run without the user present.
// gmail.readonly and gmail.labels are both restricted scopes — Google
// requires the app to either pass a CASA security assessment or stay in
// OAuth "Testing" status with each Gmail account added as a test user. This
// app intentionally stays in Testing (household-only, <=100 test users) to
// avoid the CASA audit.
//
// gmail.labels (not the broader gmail.modify) is deliberately used for label
// writes — it only grants label create/list/apply/remove, never message
// content changes, trashing, or deletion. See gmail-labels.ts.
//
// NOTE: this is an *additive* scope change — anyone who connected Gmail
// before gmail.labels was added must reconnect once; Google does not
// silently upgrade an existing grant to a new scope.
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
  "email",
];

export function gmailOAuthEnabled(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

/**
 * Build a fresh OAuth2 client bound to the given redirect URI, mirroring
 * google-calendar-oauth.ts's per-request redirect URI pattern but scoped
 * separately for Gmail read access. Reuses the same shared Google OAuth
 * client id/secret — no new secrets needed.
 */
export function createGmailOAuthClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri,
  });
}
