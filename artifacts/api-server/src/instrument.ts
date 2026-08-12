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

// Architecture hardening (#754): request bodies for chat/email/messaging
// routes (Elaine chat, AgentPhone/Resend webhooks, messenger sends) carry the
// actual private message/conversation text as these field names. A crash
// report needs to know THAT a request failed, not the full private content
// of what was said — so these are redacted to a length marker instead of
// dropped outright (keeps enough shape to spot e.g. an unexpectedly huge or
// empty payload without exposing the content).
const CONTENT_BODY_KEYS = new Set([
  "message",
  "messages",
  "content",
  "body",
  "text",
  "html",
  "prompt",
  "reply",
  "transcript",
  "note",
  "notes",
]);

export function redactBodyValue(value: unknown): string {
  let len: number;
  try {
    len =
      typeof value === "string" ? value.length : JSON.stringify(value).length;
  } catch {
    // Circular or otherwise non-serializable value — still redact it, just
    // without a precise length.
    len = -1;
  }
  return `[Redacted:${len >= 0 ? `${len}chars` : "unknown-length"}]`;
}

// Max recursion depth for the redaction walk below. Request bodies in this
// app are shallow (a handful of levels at most, e.g. AgentPhone webhooks
// nest content under `data`), so this is purely a defensive cap against a
// pathological/circular payload spinning forever — it is not expected to be
// hit in practice.
const MAX_REDACT_DEPTH = 12;

// Recursively walks the ENTIRE body (arrays included), redacting sensitive
// and content-bearing keys AT EVERY DEPTH, not just the top level.
//
// Why recursive: webhook payloads in this app nest private content under an
// intermediate key — e.g. AgentPhone's SMS/voice webhooks carry the actual
// message text / call transcript at `req.body.data.message` /
// `req.body.data.transcript`, not at the top level. A shallow, top-level-only
// scrub would leave that untouched while still matching `SENSITIVE_BODY_KEYS`
// / `CONTENT_BODY_KEYS` names literally — reviewed and fixed as part of
// architecture hardening (#754) after a completion review caught the gap.
export function deepScrubBody(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) return "[Redacted:max-depth-exceeded]";
  if (Array.isArray(value)) {
    return value.map((item) => deepScrubBody(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_BODY_KEYS.has(key)) {
        out[key] = "[Filtered]";
      } else if (CONTENT_BODY_KEYS.has(key)) {
        out[key] = redactBodyValue(val);
      } else {
        out[key] = deepScrubBody(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function scrubSensitiveData(
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent {
  if (event.request?.headers) {
    const h = event.request.headers as Record<string, string>;
    if (h["authorization"]) h["authorization"] = "[Filtered]";
    if (h["cookie"]) h["cookie"] = "[Filtered]";
    if (h["set-cookie"]) h["set-cookie"] = "[Filtered]";
    if (h["x-screenshot-token"]) h["x-screenshot-token"] = "[Filtered]";
  }
  if (event.request?.data && typeof event.request.data === "object") {
    event.request.data = deepScrubBody(
      event.request.data,
    ) as typeof event.request.data;
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
    // 100% sample rate: single-user household app, low traffic.
    tracesSampleRate: 1.0,
    // Architecture hardening (#754): previously this was {inputs: true,
    // outputs: true}, which sent the full text of every Elaine AI
    // conversation, and by extension every email/SMS/chat message a user
    // typed, to Sentry so the "AI Conversations" dashboard could render full
    // transcripts. That is far more private content than a crash-diagnostics
    // tool needs. Model call spans (latency, token counts, model name,
    // error status) are still captured automatically — that's enough to
    // diagnose a crash or a bad response — just not the prompt/response text
    // itself. Do not re-enable without discussing the privacy trade-off.
    dataCollection: {
      genAI: { inputs: false, outputs: false },
    },
    // Single-user household app — richer request context (method, route,
    // status, IP) is useful for diagnosing crashes. `sendDefaultPii` also
    // widens body/header capture (see scrubSensitiveData below for the
    // auth-secret scrub applied to whatever body/header data comes through);
    // it does not by itself resend AI/message content — that's controlled by
    // dataCollection.genAI above and the request-body scrub below.
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
