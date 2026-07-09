/**
 * In-memory error rate tracker. Records 4xx/5xx response counts per
 * rolling hour window and logs a summary once per hour. Gives visibility
 * into whether a route is silently degrading without needing external tooling.
 */

import { logger } from "./logger";

let count4xx = 0;
let count5xx = 0;
let totalRequests = 0;
let windowStart = Date.now();

export function recordResponseStatus(statusCode: number): void {
  totalRequests++;
  if (statusCode >= 500) count5xx++;
  else if (statusCode >= 400) count4xx++;
}

export function startErrorRateSummary(): void {
  const interval = setInterval(() => {
    const durationMs = Date.now() - windowStart;
    const errorRate =
      totalRequests > 0
        ? (((count4xx + count5xx) / totalRequests) * 100).toFixed(1)
        : "0.0";
    logger.info(
      {
        count4xx,
        count5xx,
        totalRequests,
        errorRatePct: parseFloat(errorRate),
        windowMs: durationMs,
      },
      "error-rate-summary",
    );
    count4xx = 0;
    count5xx = 0;
    totalRequests = 0;
    windowStart = Date.now();
  }, 60 * 60 * 1_000);

  interval.unref();
  logger.info("error-rate-summary: started (logs hourly)");
}
