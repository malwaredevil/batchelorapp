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
 */
export function createGoogleClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri,
  });
}
