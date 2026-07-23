import * as Sentry from "@sentry/react";

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
      // Captures failed HTTP requests (4xx/5xx) as Sentry events.
      // 401 excluded: always unauthenticated page load / expired session;
      //   useAuth handles the redirect to login before the user notices.
      // 502/503 excluded: deployment-restart noise (container briefly down).
      Sentry.httpClientIntegration({
        failedRequestStatusCodes: [
          [400, 400],
          [402, 501],
          [504, 599],
        ],
      }),
    ],
    // 100% trace sample rate — single-household app, very low traffic.
    // Captures every page load / navigation / API call for full performance visibility.
    tracesSampleRate: 1.0,
    // Replays: only on errors (50 free/month on Developer plan, 0 wasted on routine visits)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

export { Sentry };
