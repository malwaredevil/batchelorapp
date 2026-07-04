import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { env } from "../lib/env";

// Dev-only automation endpoint. Lets the automated screenshot tool (which can
// navigate to a URL but cannot type into a form or click a button) obtain an
// authenticated session in one hop, by setting the session cookie and then
// redirecting, so it can capture screenshots of pages that require login.
//
// Hard-disabled in production regardless of configuration, requires a secret
// token compared in constant time, and only ever logs in the single fixed
// automation account (AGENT_LOGIN_EMAIL) — it can never be pointed at an
// arbitrary account, so it cannot be used to impersonate a real user.
function sanitizeNext(value: unknown): string {
  if (typeof value !== "string" || !value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const router: IRouter = Router();

router.get("/dev/screenshot-login", async (req, res) => {
  if (env.isProduction) {
    res.status(404).end();
    return;
  }
  if (!env.screenshotAuthToken || !env.agentLoginEmail) {
    res.status(404).end();
    return;
  }

  const token = req.query.token;
  if (
    typeof token !== "string" ||
    !timingSafeTokenMatch(token, env.screenshotAuthToken)
  ) {
    res.status(401).json({ error: "Invalid or missing token." });
    return;
  }

  const email = env.agentLoginEmail.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "Automation account not found." });
    return;
  }

  const next = sanitizeNext(req.query.next);

  req.session.regenerate((err) => {
    if (err) {
      req.log.error({ err }, "screenshot-login: session regenerate failed");
      res.status(500).json({ error: "Could not create session." });
      return;
    }
    req.session.userId = user.id;
    req.session.save((saveErr) => {
      if (saveErr) {
        req.log.error(
          { err: saveErr },
          "screenshot-login: session save failed",
        );
        res.status(500).json({ error: "Could not create session." });
        return;
      }
      res.redirect(next);
    });
  });
});

export default router;
