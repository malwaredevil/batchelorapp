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
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // This is a private single-household app with no third-party users.
        // Keep actual content visible so owner-only replays are useful.
        maskAllText: false,
        blockAllMedia: false,
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
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}
