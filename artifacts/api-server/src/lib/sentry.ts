import * as Sentry from "@sentry/node";
import { execSync } from "child_process";
import { ZodError } from "zod";
import { env } from "./env";

function getGitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

const appVersion = getGitSha();

const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "resetToken",
  "accessToken",
  "refreshToken",
  "idToken",
  "secret",
  "apiKey",
  "privateKey",
  "sessionSecret",
  "webhookSecret",
]);

function scrubSensitiveData(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Strip sensitive request headers
  if (event.request?.headers) {
    const h = event.request.headers as Record<string, string>;
    if (h["authorization"]) h["authorization"] = "[Filtered]";
    if (h["cookie"]) h["cookie"] = "[Filtered]";
    if (h["set-cookie"]) h["set-cookie"] = "[Filtered]";
    if (h["x-screenshot-token"]) h["x-screenshot-token"] = "[Filtered]";
  }
  // Strip sensitive fields from parsed request body
  if (event.request?.data && typeof event.request.data === "object") {
    const body = event.request.data as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (SENSITIVE_BODY_KEYS.has(key)) body[key] = "[Filtered]";
    }
  }
  // Clear cookies entirely — they carry session credentials
  if (event.request?.cookies) {
    event.request.cookies = {};
  }
  return event;
}

export function initSentry() {
  if (!env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.isProduction ? "production" : "development",
    release: appVersion,
    tracesSampleRate: 0.1,
    beforeSend(event, hint) {
      // ZodError from request validation is handled gracefully (400 response)
      // by the app's centralised error handler — it's expected client input
      // error, not an application bug, so don't create Sentry noise for it.
      if (hint.originalException instanceof ZodError) return null;
      return scrubSensitiveData(event);
    },
  });
}

export { Sentry };
