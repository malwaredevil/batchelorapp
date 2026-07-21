import rateLimit from "express-rate-limit";
import { PostgresRateLimitStore } from "./pgRateLimitStore";

const jsonLimitMessage = {
  error: "Too many requests, please try again later.",
};

// Every limiter below is backed by a Postgres store (see pgRateLimitStore.ts)
// instead of the express-rate-limit default in-memory store. The app runs on
// an autoscaled deployment where each warm instance is a separate process —
// an in-memory store would let an attacker reset their budget on every new
// instance the load balancer routes them to. The shared `rate_limits` table
// makes these caps a real, deployment-wide ceiling instead of a per-process
// one. `passOnStoreError: false` fails CLOSED if the DB is briefly unreachable,
// so a database hiccup returns 429 (deny) rather than allowing unlimited requests.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("login"),
  passOnStoreError: false,
});

// Covers fabric creation (AI cataloguing + embedding) and reanalyze — both
// invoke OpenAI and are significantly more expensive than a read.
// Set generously because the user owns the API keys and runs the app personally.
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("ai"),
  passOnStoreError: false,
});

// Bulk re-analyze endpoints send small batches (3 items each) due to the
// 30-second proxy timeout. A full collection of ~200 items needs ~70 requests
// per run, so the limit must be well above that.
export const bulkAiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("bulk-ai"),
  passOnStoreError: false,
});

// The compare endpoint is the most expensive request shape in the app: it fans
// a single upload out into a multi-image vision request. Cap it well below the
// general AI limiter so one authenticated session cannot cheaply exhaust
// compute, outbound bandwidth, or third-party AI quota.
export const compareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("compare"),
  passOnStoreError: false,
});

// Phone verification codes send a real SMS via AgentPhone (cost + abuse
// surface similar to email sends, but SMS costs money per message). Capped
// tightly per session/IP; test-sms reuses the same limiter since it also
// sends a real message.
export const phoneVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("phone-verify"),
  passOnStoreError: false,
});

// Supplemental image uploads attach extra photos to an existing pottery piece.
// They do not invoke AI, so they get a more generous cap than aiLimiter, but
// still bounded to prevent storage abuse from a single session.
export const supplementalUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("supplemental-upload"),
  passOnStoreError: false,
});

// Password reset token submission. Each request runs bcrypt (cost 12) before
// the token lookup, making it an amplified DoS vector without a cap. A tight
// window matches the login limiter since the two endpoints share a threat model.
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("password-reset"),
  passOnStoreError: false,
});

// Webhook endpoints for AgentPhone SMS/voice and Resend inbound-email. These
// are unauthenticated (HMAC-gated) public routes, so rate-limiting by IP is the
// primary DoS defence in front of the signature verification step. 60 requests
// per 15-minute window is generous for legitimate webhook re-delivery (AgentPhone
// and Resend retry with exponential back-off, never hammering at constant rate),
// but tight enough to blunt a brute-force attempt on the shared HMAC secret.
export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("webhook"),
  passOnStoreError: false,
});

// Admin/owner-only operational routes (jobs dashboard, operations telemetry).
// Generous cap since they are already gated behind requireOwner, but still
// bounded to prevent accidental tight-loop polling from saturating the DB.
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
  store: new PostgresRateLimitStore("admin"),
  passOnStoreError: false,
});
