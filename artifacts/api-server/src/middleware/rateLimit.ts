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
// invoke OpenAI and are significantly more expensive than a read.
// Set generously because the user owns the API keys and runs the app personally.
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonLimitMessage,
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
