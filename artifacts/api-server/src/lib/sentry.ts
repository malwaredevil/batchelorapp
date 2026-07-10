import * as Sentry from "@sentry/node";
import { ZodError } from "zod";
import { env } from "./env";

export function initSentry() {
  if (!env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.isProduction ? "production" : "development",
    tracesSampleRate: 0.1,
    beforeSend(event, hint) {
      // ZodError from request validation is handled gracefully (400 response)
      // by the app's centralised error handler — it's expected client input
      // error, not an application bug, so don't create Sentry noise for it.
      if (hint.originalException instanceof ZodError) return null;
      return event;
    },
  });
}

export { Sentry };
