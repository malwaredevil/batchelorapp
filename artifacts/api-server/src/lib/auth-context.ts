import type { Request } from "express";

export type AuthSource = "session" | "screenshot-token";

export interface AuthContext {
  userId: number;
  source: AuthSource;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function setAuthContext(req: Request, auth: AuthContext): void {
  req.auth = auth;
}

export function getAuthenticatedUserId(req: Request): number {
  if (!req.auth) {
    throw Object.assign(new Error("Not authenticated"), { status: 401 });
  }
  return req.auth.userId;
}
