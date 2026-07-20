import { Router } from "express";
import { db, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

const router = Router();

// In-memory registry: convId -> userId -> { displayName, lastTypedAt }
// No database writes — typing state is ephemeral and expires automatically.
const typingRegistry = new Map<
  number,
  Map<number, { displayName: string; lastTypedAt: number }>
>();

// Process-level display-name cache to avoid a DB hit on every keystroke.
const displayNameCache = new Map<number, string>();

const TYPING_TTL_MS = 2500;

async function resolveDisplayName(userId: number): Promise<string> {
  const cached = displayNameCache.get(userId);
  if (cached) return cached;
  try {
    const [user] = await db
      .select({ displayName: appUsers.displayName, email: appUsers.email })
      .from(appUsers)
      .where(eq(appUsers.id, userId));
    const name = user?.displayName ?? user?.email?.split("@")[0] ?? "Someone";
    displayNameCache.set(userId, name);
    return name;
  } catch (err) {
    logger.error({ err }, "typing: failed to resolve display name");
    return "Someone";
  }
}

// POST /conversations/:id/typing — called while the user is composing
router.post("/conversations/:id/typing", async (req, res) => {
  const convId = Number(req.params["id"]);
  const userId = req.session.userId!;

  const displayName = await resolveDisplayName(userId);

  if (!typingRegistry.has(convId)) typingRegistry.set(convId, new Map());
  typingRegistry.get(convId)!.set(userId, {
    displayName,
    lastTypedAt: Date.now(),
  });

  res.status(204).end();
});

// GET /conversations/:id/typing — returns who's currently typing (excluding caller)
router.get("/conversations/:id/typing", (req, res) => {
  const convId = Number(req.params["id"]);
  const currentUserId = req.session.userId!;

  const conv = typingRegistry.get(convId);
  if (conv) {
    const now = Date.now();
    for (const [uid, entry] of conv.entries()) {
      if (now - entry.lastTypedAt > TYPING_TTL_MS) conv.delete(uid);
    }
    if (conv.size === 0) typingRegistry.delete(convId);
  }

  const typing = conv
    ? [...conv.entries()]
        .filter(([uid]) => uid !== currentUserId)
        .map(([userId, { displayName }]) => ({ userId, displayName }))
    : [];

  res.json({ typing });
});

export default router;
