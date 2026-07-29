import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { appUsers, db } from "@workspace/db";
import { getAuthenticatedUserId } from "../lib/auth-context";

export async function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let userId: number;
  try {
    userId = getAuthenticatedUserId(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [me] = await db
    .select({ isOwner: appUsers.isOwner })
    .from(appUsers)
    .where(eq(appUsers.id, userId));

  if (!me?.isOwner) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
}
