import * as Sentry from "@sentry/react";

// Browser-side Sentry error monitoring.
// Only activates in production builds (import.meta.env.PROD = true).
// A missing or empty DSN is a silent no-op — safe to deploy without it.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const release = import.meta.env.VITE_APP_VERSION as string | undefined;

if (dsn && import.meta.env.PROD) {
  Sentry.init({
    dsn,
    environment: "production",
    release: release || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.1,
    // Don't capture normal session replays — only capture when an error occurs
    // (uses the 50 free replays/month on the Sentry Developer plan).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

export { Sentry };
