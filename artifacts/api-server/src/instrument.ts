import * as Sentry from "@sentry/node";
import { execSync } from "child_process";
import { ZodError } from "zod";
import OpenAI from "openai";

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
    // 100% sample rate: single-user household app, low traffic. Needed so
    // every Elaine conversation is captured in Sentry AI Conversations.
    tracesSampleRate: 1.0,
    // Record AI inputs and outputs so the AI Conversations dashboard can
    // display the full message thread (prompts + responses + tool calls).
    // Without this, spans are captured but conversations appear empty.
    dataCollection: {
      genAI: { inputs: true, outputs: true },
    },
    // Single-user household app — richer request context (IP, headers) is
    // safe here and helps diagnose issues, since there's no third-party user
    // privacy boundary to protect. Sensitive keys are still scrubbed below.
    sendDefaultPii: true,
    // Sentry Logs: search/filter pino output in Sentry, trace-linked to the
    // request that produced it, instead of only having it in workflow logs.
    enableLogs: true,
    integrations: [
      // Auto-instruments all calls through the `openai` npm package (including
      // our OpenRouter client which uses it with a custom baseURL). Each model
      // call becomes a child span inside the parent request trace, and Sentry
      // groups them into AI Conversations via setConversationId() call sites.
      Sentry.openAIIntegration(),
      // Forwards every pino log line as a Sentry structured log. Left at
      // defaults (autoInstrument: true, error.levels: []) so this only adds
      // Logs visibility — it does not also turn warn/error log lines into
      // duplicate Sentry issues, since those already reach Sentry via the
      // automatic Express/http error instrumentation.
      Sentry.pinoIntegration(),
    ],
    beforeSend(event, hint) {
      // ZodError = request validation failure (already returned 400) — not a crash.
      if (hint.originalException instanceof ZodError) return null;
      // RateLimitError (429) = external rate limit from OpenRouter — not a bug in
      // our code. Callers post a friendly fallback reply to the user instead.
      if (hint.originalException instanceof OpenAI.RateLimitError) return null;
      return scrubSensitiveData(event);
    },
  });
}
