import * as Sentry from "@sentry/node";
import { execSync } from "child_process";
import { ZodError } from "zod";

// This file is loaded via `node --import ./dist/instrument.mjs` before the
// main bundle executes, so Sentry can hook into Express before it is evaluated.
// @sentry/node is externalized from the esbuild bundle so this file and the
// main bundle share one SDK instance.

function getGitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

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
  if (event.request?.headers) {
    const h = event.request.headers as Record<string, string>;
    if (h["authorization"]) h["authorization"] = "[Filtered]";
    if (h["cookie"]) h["cookie"] = "[Filtered]";
    if (h["set-cookie"]) h["set-cookie"] = "[Filtered]";
    if (h["x-screenshot-token"]) h["x-screenshot-token"] = "[Filtered]";
  }
  if (event.request?.data && typeof event.request.data === "object") {
    const body = event.request.data as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (SENSITIVE_BODY_KEYS.has(key)) body[key] = "[Filtered]";
    }
  }
  if (event.request?.cookies) {
    event.request.cookies = {};
  }
  return event;
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.NODE_ENV === "production" ? "production" : "development",
    release: getGitSha(),
    tracesSampleRate: 0.1,
    beforeSend(event, hint) {
      if (hint.originalException instanceof ZodError) return null;
      return scrubSensitiveData(event);
    },
  });
}
