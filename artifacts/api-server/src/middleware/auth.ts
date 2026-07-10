import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { env } from "../lib/env";

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Dev-only automation bypass: the automated screenshot tool loads pages over
// plain HTTP against the container directly, which means the app's
// Secure+SameSite=None session cookie can never be set or sent to it (browser
// spec, not a bug). For normal API calls, the frontend forwards
// `?screenshotToken=...` as an `X-Screenshot-Token` header on every request
// (see `custom-fetch.ts`), which we validate here as a stand-in for a
// session. Raw `<img src>` / SVG `<image href>` requests (e.g. fabric tile
// pattern fills) can't attach a custom header at all, so those call sites
// append the same token as a `?screenshotToken=` query param instead (see
// `appendScreenshotToken()` in `custom-fetch.ts`) — we accept it from either
// place here so both request styles authenticate identically.
//
// Hard-disabled in production regardless of configuration, requires a secret
// token compared in constant time, and only ever authenticates as the single
// fixed automation account (AGENT_LOGIN_EMAIL) — it can never be pointed at
// an arbitrary account, so it cannot be used to impersonate a real user.
async function tryScreenshotTokenAuth(req: Request): Promise<number | null> {
  if (env.isProduction) return null;
  if (!env.screenshotAuthToken || !env.agentLoginEmail) return null;

  const header = req.header("x-screenshot-token");
  const queryToken =
    typeof req.query.screenshotToken === "string"
      ? req.query.screenshotToken
      : undefined;
  const provided = header || queryToken;
  if (!provided || !timingSafeTokenMatch(provided, env.screenshotAuthToken)) {
    return null;
  }

  const email = env.agentLoginEmail.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);

  return user?.id ?? null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.session.userId) {
    const userId = await tryScreenshotTokenAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    req.session.userId = userId;
  }
  next();
}
