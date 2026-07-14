import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  db,
  messengerConversations,
  messengerMessages,
  messengerAttachments,
  appUsers,
} from "@workspace/db";
import {
  GetConversationMessagesQueryParams,
  SendMessageBody,
} from "@workspace/api-zod";
import { callModel, getModels } from "../../lib/ai-client";
import { getSignedUrls } from "../../lib/messenger/storage";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// Ensure at least one conversation exists; return its id.
async function ensureDefaultConversation(): Promise<number> {
  const existing = await db
    .select({ id: messengerConversations.id })
    .from(messengerConversations)
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db
    .insert(messengerConversations)
    .values({})
    .returning({ id: messengerConversations.id });
  return created.id;
}

// Serialize a DB message row + attachments rows into the API shape.
async function serializeMessages(
  msgRows: Array<{
    id: number;
    conversationId: number;
    senderId: number | null;
    senderName: string | null;
    body: string;
    createdAt: Date;
    readAt: Date | null;
    deletedAt: Date | null;
  }>,
  attachmentRows: Array<{
    id: number;
    messageId: number;
    storagePath: string;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
  }>,
) {
  const paths = attachmentRows.map((a) => a.storagePath);
  const urlMap = await getSignedUrls(paths);

  const attachmentsByMessage = new Map<
    number,
    Array<{
      id: number;
      messageId: number;
      mimeType: string;
      fileName: string;
      sizeBytes: number;
      url: string;
    }>
  >();
  for (const a of attachmentRows) {
    const url = urlMap.get(a.storagePath) ?? "";
    const list = attachmentsByMessage.get(a.messageId) ?? [];
    list.push({
      id: a.id,
      messageId: a.messageId,
      mimeType: a.mimeType,
      fileName: a.fileName,
      sizeBytes: a.sizeBytes,
      url,
    });
    attachmentsByMessage.set(a.messageId, list);
  }

  return msgRows.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: m.senderName,
    body: m.deletedAt ? "" : m.body,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    attachments: attachmentsByMessage.get(m.id) ?? [],
  }));
}

// -----------------------------------------------------------------------
// GET /conversations — list with last message + unread count
// -----------------------------------------------------------------------
router.get("/conversations", async (req, res) => {
  const convId = await ensureDefaultConversation();
  const userId = req.session?.userId as number;

  const unreadCount = await db
    .select({ count: sql<string>`count(*)` })
    .from(messengerMessages)
    .where(
      and(
        eq(messengerMessages.conversationId, convId),
        isNull(messengerMessages.readAt),
        isNull(messengerMessages.deletedAt),
        or(
          isNull(messengerMessages.senderId),
          ne(messengerMessages.senderId, userId),
        ),
      ),
    );

  const lastMsgs = await db
    .select({
      id: messengerMessages.id,
      conversationId: messengerMessages.conversationId,
      senderId: messengerMessages.senderId,
      senderName: appUsers.displayName,
      body: messengerMessages.body,
      createdAt: messengerMessages.createdAt,
      readAt: messengerMessages.readAt,
      deletedAt: messengerMessages.deletedAt,
    })
    .from(messengerMessages)
    .leftJoin(appUsers, eq(appUsers.id, messengerMessages.senderId))
    .where(eq(messengerMessages.conversationId, convId))
    .orderBy(desc(messengerMessages.createdAt))
    .limit(1);

  const lastMsg = lastMsgs[0] ?? null;
  let lastMsgSerialized = null;
  if (lastMsg) {
    const attRows = await db
      .select()
      .from(messengerAttachments)
      .where(eq(messengerAttachments.messageId, lastMsg.id));
    const serialized = await serializeMessages([lastMsg], attRows);
    lastMsgSerialized = serialized[0];
  }

  res.json([
    {
      id: convId,
      createdAt: (
        await db
          .select({ createdAt: messengerConversations.createdAt })
          .from(messengerConversations)
          .where(eq(messengerConversations.id, convId))
          .limit(1)
      )[0]?.createdAt.toISOString(),
      unreadCount: Number(unreadCount[0]?.count ?? 0),
      lastMessage: lastMsgSerialized,
    },
  ]);
});

// -----------------------------------------------------------------------
// GET /conversations/members — MUST be before /:id routes
// -----------------------------------------------------------------------
router.get("/conversations/members", async (_req, res) => {
  const members = await db
    .select({
      id: appUsers.id,
      displayName: appUsers.displayName,
      email: appUsers.email,
    })
    .from(appUsers)
    .orderBy(appUsers.displayName);
  res.json(members);
});

// -----------------------------------------------------------------------
// GET /conversations/unread-count — MUST be before /:id routes
// -----------------------------------------------------------------------
router.get("/conversations/unread-count", async (req, res) => {
  const convId = await ensureDefaultConversation();
  const userId = req.session?.userId as number;

  const result = await db
    .select({ count: sql<string>`count(*)` })
    .from(messengerMessages)
    .where(
      and(
        eq(messengerMessages.conversationId, convId),
        isNull(messengerMessages.readAt),
        isNull(messengerMessages.deletedAt),
        or(
          isNull(messengerMessages.senderId),
          ne(messengerMessages.senderId, userId),
        ),
      ),
    );

  res.json({ count: Number(result[0]?.count ?? 0) });
});

// -----------------------------------------------------------------------
// GET /conversations/:id/messages
// -----------------------------------------------------------------------
router.get("/conversations/:id/messages", async (req, res) => {
  const convId = Number(req.params.id);
  if (isNaN(convId)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const qp = GetConversationMessagesQueryParams.safeParse(req.query);
  const since = qp.success ? qp.data.since : undefined;
  const before = qp.success ? qp.data.before : undefined;
  const limit = qp.success && qp.data.limit ? Math.min(qp.data.limit, 100) : 50;

  const conv = await db
    .select({ id: messengerConversations.id })
    .from(messengerConversations)
    .where(eq(messengerConversations.id, convId))
    .limit(1);
  if (!conv[0]) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const filters = [eq(messengerMessages.conversationId, convId)];
  if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      filters.push(gt(messengerMessages.createdAt, sinceDate));
    }
  }
  if (before && !since) {
    const beforeDate = new Date(before);
    if (!isNaN(beforeDate.getTime())) {
      filters.push(lt(messengerMessages.createdAt, beforeDate));
    }
  }

  const msgRows = await db
    .select({
      id: messengerMessages.id,
      conversationId: messengerMessages.conversationId,
      senderId: messengerMessages.senderId,
      senderName: appUsers.displayName,
      body: messengerMessages.body,
      createdAt: messengerMessages.createdAt,
      readAt: messengerMessages.readAt,
      deletedAt: messengerMessages.deletedAt,
    })
    .from(messengerMessages)
    .leftJoin(appUsers, eq(appUsers.id, messengerMessages.senderId))
    .where(and(...filters))
    .orderBy(
      since
        ? desc(messengerMessages.createdAt)
        : desc(messengerMessages.createdAt),
    )
    .limit(limit);

  if (msgRows.length === 0) {
    res.json([]);
    return;
  }

  const msgIds = msgRows.map((m) => m.id);
  const attRows = await db
    .select()
    .from(messengerAttachments)
    .where(
      sql`${messengerAttachments.messageId} = ANY(${sql.raw(`ARRAY[${msgIds.join(",")}]::integer[]`)})`,
    );

  const serialized = await serializeMessages(msgRows, attRows);
  res.json(serialized.reverse());
});

// -----------------------------------------------------------------------
// POST /conversations/:id/messages
// -----------------------------------------------------------------------
router.post("/conversations/:id/messages", async (req, res) => {
  const convId = Number(req.params.id);
  if (isNaN(convId)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const userId = req.session?.userId as number;
  const { body, attachments: attachmentInputs = [] } = parsed.data;

  const conv = await db
    .select({ id: messengerConversations.id })
    .from(messengerConversations)
    .where(eq(messengerConversations.id, convId))
    .limit(1);
  if (!conv[0]) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const [msg] = await db
    .insert(messengerMessages)
    .values({ conversationId: convId, senderId: userId, body })
    .returning();

  if (attachmentInputs.length > 0) {
    await db.insert(messengerAttachments).values(
      attachmentInputs.map((a) => ({
        messageId: msg.id,
        storagePath: a.storagePath,
        mimeType: a.mimeType,
        fileName: a.fileName,
        sizeBytes: a.sizeBytes,
      })),
    );
  }

  const attRows = await db
    .select()
    .from(messengerAttachments)
    .where(eq(messengerAttachments.messageId, msg.id));

  const [senderRow] = await db
    .select({ displayName: appUsers.displayName })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);

  const [serialized] = await serializeMessages(
    [
      {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        senderName: senderRow?.displayName ?? null,
        body: msg.body,
        createdAt: msg.createdAt,
        readAt: msg.readAt,
        deletedAt: msg.deletedAt,
      },
    ],
    attRows,
  );

  res.status(201).json(serialized);

  // If message mentions @elaine, spawn an async AI reply (fire-and-forget)
  if (/@elaine\b/i.test(body)) {
    const senderName = senderRow?.displayName ?? "a household member";
    generateElaineReply(convId, body, senderName).catch((err) =>
      logger.error(err, "messenger: @elaine reply error"),
    );
  }
});

async function generateElaineReply(
  conversationId: number,
  userMessage: string,
  senderName: string,
): Promise<void> {
  const models = await getModels();
  const cleanMsg = userMessage.replace(/@elaine\b/gi, "").trim();
  const systemPrompt = `You are Elaine, a warm and helpful AI assistant living in the Batchelor household group chat. A household member named ${senderName} has addressed you with @elaine. Respond helpfully and concisely. You assist with pottery collection management, quilting projects, travel planning, ornament cataloguing, household organisation, and general questions. Keep replies friendly and under 200 words unless detail is truly needed.`;

  const result = await callModel(models.advisor, (client, m) =>
    client.chat.completions.create({
      model: m,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: cleanMsg || "Hello!" },
      ],
      max_tokens: 500,
    }),
  );

  const replyBody = result.choices[0]?.message?.content?.trim() ?? "";
  if (!replyBody) return;

  await db.insert(messengerMessages).values({
    conversationId,
    senderId: null,
    body: replyBody,
  });

  logger.info(
    { conversationId, chars: replyBody.length },
    "messenger: @elaine reply saved",
  );
}

export default router;
