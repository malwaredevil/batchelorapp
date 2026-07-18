import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { appUsers, db } from "@workspace/db";

export async function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
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
