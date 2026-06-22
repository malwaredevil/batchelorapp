import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Because session cookies are SameSite=None (required for the embedded preview
 * iframe and cross-context use), we defend against CSRF by requiring that any
 * state-changing request whose browser sends an Origin header has an Origin
 * matching the request Host. Browsers always send Origin on cross-site POSTs,
 * so a forged cross-site request is rejected here.
 */
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
  if (!origin) {
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

  const host = req.get("host");
  if (originHost !== host) {
    res.status(403).json({ error: "Cross-origin request blocked" });
    return;
  }

  next();
}
