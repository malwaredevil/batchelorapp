import crypto from "node:crypto";

// Fixed, non-secret context string for the HMAC derivation below. Bumping
// this value (e.g. to "-v2") invalidates every previously-derived agent
// screenshot token in one move, independent of rotating the underlying
// DEV_SCREENSHOT_TOKEN secret.
const DERIVATION_CONTEXT = "agent-screenshot-bypass-v1";

/**
 * Two-factor screenshot bypass token derivation.
 *
 * DEV_SCREENSHOT_TOKEN is a real Replit Secret ("pepper") that the agent can
 * never read or display. The value actually embedded in screenshot tool URLs
 * and forwarded as X-Screenshot-Token is this HMAC-SHA256 derivation of it —
 * a one-way, agent-safe value computed fresh from the live secret on every
 * request/response, never persisted as its own env var.
 *
 * This means:
 * - The agent can obtain the current derived token (e.g. via a server-side
 *   script that pipes the real secret into this function and prints only the
 *   digest) without ever seeing DEV_SCREENSHOT_TOKEN itself.
 * - If the derived token ever leaks (public repo, chat transcript, etc.), it
 *   is useless anywhere the matching DEV_SCREENSHOT_TOKEN secret isn't also
 *   independently configured — which Replit Secrets never sync across
 *   deployments or into version control.
 * - Rotating DEV_SCREENSHOT_TOKEN immediately invalidates every previously
 *   derived token, including any that leaked, without any other code change.
 */
export function deriveAgentScreenshotToken(pepper: string): string {
  return crypto
    .createHmac("sha256", pepper)
    .update(DERIVATION_CONTEXT)
    .digest("hex");
}
