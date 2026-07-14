import { Router, type IRouter } from "express";
import { eq, and, lte, isNull } from "drizzle-orm";
import { db, messengerMessages } from "@workspace/db";
import { MarkMessageReadParams, DeleteMessageParams } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

router.post("/messages/:id/read", async (req, res) => {
  const parsed = MarkMessageReadParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }

  const msg = await db
    .select({
      id: messengerMessages.id,
      conversationId: messengerMessages.conversationId,
    })
    .from(messengerMessages)
    .where(eq(messengerMessages.id, parsed.data.id))
    .limit(1);

  if (!msg[0]) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { conversationId } = msg[0];

  const result = await db
    .update(messengerMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messengerMessages.conversationId, conversationId),
        lte(messengerMessages.id, parsed.data.id),
        isNull(messengerMessages.readAt),
      ),
    )
    .returning({ id: messengerMessages.id });

  res.json({ markedCount: result.length });
});

router.delete("/messages/:id", async (req, res) => {
  const parsed = DeleteMessageParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }

  const userId = req.session?.userId;

  const msg = await db
    .select({ id: messengerMessages.id, senderId: messengerMessages.senderId })
    .from(messengerMessages)
    .where(eq(messengerMessages.id, parsed.data.id))
    .limit(1);

  if (!msg[0]) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (msg[0].senderId !== userId) {
    res.status(403).json({ error: "Cannot delete another user's message" });
    return;
  }

  await db
    .update(messengerMessages)
    .set({ deletedAt: new Date() })
    .where(eq(messengerMessages.id, parsed.data.id));

  logger.info({ messageId: parsed.data.id }, "messenger: message soft-deleted");
  res.status(204).send();
});

export default router;
