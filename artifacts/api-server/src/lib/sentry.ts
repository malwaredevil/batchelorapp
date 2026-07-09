import * as Sentry from "@sentry/node";
import { env } from "./env";

export function initSentry() {
  if (!env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.isProduction ? "production" : "development",
    tracesSampleRate: 0.1,
  });
}

export { Sentry };
