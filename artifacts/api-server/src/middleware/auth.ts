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
// spec, not a bug). Instead, the frontend forwards a `?screenshotToken=...`
// query param as an `X-Screenshot-Token` header on every request (see
// `custom-fetch.ts`), which we validate here as a stand-in for a session.
//
// Hard-disabled in production regardless of configuration, requires a secret
// token compared in constant time, and only ever authenticates as the single
// fixed automation account (AGENT_LOGIN_EMAIL) — it can never be pointed at
// an arbitrary account, so it cannot be used to impersonate a real user.
async function tryScreenshotTokenAuth(req: Request): Promise<number | null> {
  if (env.isProduction) return null;
  if (!env.screenshotAuthToken || !env.agentLoginEmail) return null;

  const header = req.header("x-screenshot-token");
  if (!header || !timingSafeTokenMatch(header, env.screenshotAuthToken)) {
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
