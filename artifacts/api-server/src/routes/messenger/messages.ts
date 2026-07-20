import { Router, type IRouter } from "express";
import { eq, and, lte, isNull, gt } from "drizzle-orm";
import { db, messengerMessages, messengerReactions } from "@workspace/db";
import {
  MarkMessageReadParams,
  DeleteMessageParams,
  EditMessageParams,
  EditMessageBody,
} from "@workspace/api-zod";
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

router.patch("/messages/:id", async (req, res) => {
  const parsed = EditMessageParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }

  const bodyParsed = EditMessageBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const userId = req.session?.userId;

  const msg = await db
    .select({
      id: messengerMessages.id,
      senderId: messengerMessages.senderId,
      conversationId: messengerMessages.conversationId,
    })
    .from(messengerMessages)
    .where(
      and(
        eq(messengerMessages.id, parsed.data.id),
        isNull(messengerMessages.deletedAt),
      ),
    )
    .limit(1);

  if (!msg[0]) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (msg[0].senderId !== userId) {
    res.status(403).json({ error: "Cannot edit another user's message" });
    return;
  }

  // Only the last non-deleted message in the conversation may be edited
  const laterMessages = await db
    .select({ id: messengerMessages.id })
    .from(messengerMessages)
    .where(
      and(
        eq(messengerMessages.conversationId, msg[0].conversationId),
        gt(messengerMessages.id, parsed.data.id),
        isNull(messengerMessages.deletedAt),
      ),
    )
    .limit(1);

  if (laterMessages.length > 0) {
    res.status(409).json({
      error: "Cannot edit — a later message exists in this conversation",
    });
    return;
  }

  const [updated] = await db
    .update(messengerMessages)
    .set({ body: bodyParsed.data.body.trim(), editedAt: new Date() })
    .where(eq(messengerMessages.id, parsed.data.id))
    .returning({
      id: messengerMessages.id,
      editedAt: messengerMessages.editedAt,
    });

  logger.info({ messageId: parsed.data.id }, "messenger: message edited");
  res.json({
    id: updated.id,
    editedAt: updated.editedAt?.toISOString() ?? new Date().toISOString(),
  });
});

router.post("/messages/:id/reactions", async (req, res) => {
  const msgId = Number(req.params.id);
  if (isNaN(msgId)) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }

  const emoji =
    typeof req.body?.emoji === "string" ? req.body.emoji.trim() : "";
  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  const userId = req.session?.userId as number;

  await db
    .insert(messengerReactions)
    .values({ messageId: msgId, userId, emoji })
    .onConflictDoNothing();

  res.status(204).send();
});

router.delete("/messages/:id/reactions/:emoji", async (req, res) => {
  const msgId = Number(req.params.id);
  if (isNaN(msgId)) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }

  const emoji = req.params.emoji;
  const userId = req.session?.userId as number;

  await db
    .delete(messengerReactions)
    .where(
      and(
        eq(messengerReactions.messageId, msgId),
        eq(messengerReactions.userId, userId),
        eq(messengerReactions.emoji, emoji),
      ),
    );

  res.status(204).send();
});

export default router;
