import type { Request, Response, NextFunction } from "express";
import { env } from "../lib/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOriginHosts(req: Request): Set<string> {
  const hosts = new Set(env.replitDomains);
  if (env.publicAppUrl) {
    try {
      hosts.add(new URL(env.publicAppUrl).host);
    } catch {
      // Environment validation reports malformed URLs separately.
    }
  }
  if (!env.isProduction) {
    const host = req.get("host");
    if (host) hosts.add(host);
  }
  return hosts;
}

export function csrfGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const origin = req.get("origin");
  const hasSessionIdentity = Boolean(req.session?.userId);

  // Signed non-browser webhooks do not carry the application session cookie and
  // are authenticated by their own HMAC middleware. Session-authenticated state
  // changes must always provide Origin because the cookie is SameSite=None.
  if (!origin) {
    if (hasSessionIdentity) {
      res.status(403).json({ error: "Origin header required" });
      return;
    }
    next();
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    res.status(403).json({ error: "Invalid origin" });
    return;
  }

  if (!allowedOriginHosts(req).has(originHost)) {
    res.status(403).json({ error: "Cross-origin request blocked" });
    return;
  }

  next();
}
