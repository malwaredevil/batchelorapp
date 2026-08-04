import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { env } from "../lib/env";
import { Sentry } from "../lib/sentry";
import { setAuthContext } from "../lib/auth-context";
import { deriveAgentScreenshotToken } from "../lib/agent-screenshot-auth";

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function tryScreenshotTokenAuth(req: Request): Promise<number | null> {
  if (env.isProduction) return null;
  if (!env.screenshotAuthToken || !env.agentLoginEmail) return null;

  const header = req.header("x-screenshot-token");
  const queryToken =
    typeof req.query.screenshotToken === "string"
      ? req.query.screenshotToken
      : undefined;
  const provided = header || queryToken;
  const expectedToken = deriveAgentScreenshotToken(env.screenshotAuthToken);
  if (!provided || !timingSafeTokenMatch(provided, expectedToken)) {
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

function installLegacySessionCompatibility(req: Request, userId: number): void {
  // Existing route handlers still read req.session.userId. A non-enumerable
  // compatibility value keeps those handlers working without changing the
  // serialized session payload, so saveUninitialized=false remains effective.
  Object.defineProperty(req.session, "userId", {
    value: userId,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionUserId = req.session.userId;
  if (sessionUserId) {
    setAuthContext(req, { userId: sessionUserId, source: "session" });
    Sentry.setUser({ id: String(sessionUserId) });
    next();
    return;
  }

  const screenshotUserId = await tryScreenshotTokenAuth(req);
  if (!screenshotUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  setAuthContext(req, {
    userId: screenshotUserId,
    source: "screenshot-token",
  });
  installLegacySessionCompatibility(req, screenshotUserId);
  Sentry.setUser({ id: String(screenshotUserId) });
  next();
}
