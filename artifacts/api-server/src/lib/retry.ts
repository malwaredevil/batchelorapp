/**
 * Exponential-backoff retry utility for transient external API failures.
 *
 * Usage:
 *   const result = await withRetry(() => fetch(...), { maxAttempts: 3 });
 *
 * Defaults:
 *   - 3 attempts (1 original + 2 retries)
 *   - 500ms base delay, doubled each attempt plus ±200ms jitter
 *   - 10s cap on individual delay
 *   - Only retries on network errors or HTTP 5xx (not 4xx / auth failures)
 */

import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
  label?: string;
}

function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("network") ||
      msg.includes("socket hang up") ||
      msg.includes("fetch failed")
    ) {
      return true;
    }
    const match = /http (\d+)/.exec(msg);
    if (match) {
      const status = parseInt(match[1], 10);
      return status >= 500 && status < 600;
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    shouldRetry = isTransientError,
    label = "unknown",
  } = options;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err;
      }
      const jitter = Math.random() * 200;
      const waitMs = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs);
      logger.warn(
        { label, attempt, nextAttemptInMs: Math.round(waitMs) },
        "retry: transient failure, retrying",
      );
      await delay(waitMs);
    }
  }
  throw lastErr;
}
