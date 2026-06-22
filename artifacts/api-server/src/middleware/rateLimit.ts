import rateLimit from "express-rate-limit";

const jsonLimitMessage = {
  error: "Too many requests, please try again later.",
};

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
});

// Covers fabric creation (AI cataloguing + embedding) and reanalyze — both
// invoke OpenAI and are significantly more expensive than a read. Keep well
// below the compare limiter to reflect total per-IP AI spend across all routes.
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
});

// Bulk re-analyze endpoints batch up to 20 individual AI analyses into one
// HTTP request, making them up to 20× more expensive than a single aiLimiter
// request. Apply a much stricter cap so one session cannot exhaust OpenAI
// quota or monopolise the server with a single call.
export const bulkAiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
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
});
