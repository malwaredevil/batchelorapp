import * as Sentry from "@sentry/react";

export interface BrowserMonitoringOptions {
  dsn?: string;
  release?: string;
  enabled: boolean;
}

/**
 * Shared browser-monitoring policy for every Batchelor App SPA. Each artifact
 * supplies only environment-derived configuration; privacy, sampling, and
 * request filtering remain identical across the singular app experience.
 */
export function initBrowserMonitoring({
  dsn,
  release,
  enabled,
}: BrowserMonitoringOptions): void {
  if (!dsn || !enabled) return;

  Sentry.init({
    dsn,
    environment: "production",
    release: release || undefined,
    // Single-user household app — richer request/user context is safe here.
    sendDefaultPii: true,
    // Sentry Logs: capture console.warn/error as searchable, trace-linked logs.
    enableLogs: true,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Architecture hardening (#754): previously false/false, which
        // recorded the literal on-screen text and media of every screen —
        // including full Elaine AI chat transcripts, email bodies, and
        // messenger content — in every session replay. A crash replay only
        // needs to show WHERE the user was and WHAT UI state broke, not the
        // private conversation content behind it. Masked/blocked by default;
        // do not flip back without discussing the privacy trade-off.
        maskAllText: true,
        blockAllMedia: true,
      }),
      Sentry.replayCanvasIntegration(),
      Sentry.httpClientIntegration({
        failedRequestStatusCodes: [
          [400, 400],
          [402, 428],
          [430, 501],
          [504, 599],
        ],
      }),
      Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
    tracesSampleRate: 1.0,
    // Always record a slice of normal sessions (not just error sessions) so
    // there's visibility into everyday usage, not only crashes. Kept modest
    // to stay within the free plan's monthly replay quota.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
