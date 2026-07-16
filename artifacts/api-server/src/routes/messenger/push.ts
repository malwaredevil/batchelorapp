import { Router, type IRouter } from "express";
import webpush from "web-push";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  messengerConversationParticipants,
  messengerMessages,
  messengerPushSubscriptions,
} from "@workspace/db";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// Configure VAPID keys once at module load.
// Missing keys → push silently disabled (no crash), so dev environments without
// VAPID secrets still work fine.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT ?? "mailto:batchelorjc@gmail.com";

let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (err) {
    logger.warn({ err }, "messenger: VAPID config failed — push disabled");
  }
}

// ---------------------------------------------------------------------------
// POST /push-subscribe — upsert a browser PushSubscription
// ---------------------------------------------------------------------------
router.post("/push-subscribe", async (req, res) => {
  const userId = req.session?.userId as number;
  const body = req.body as { endpoint?: unknown; keys?: unknown };

  if (
    typeof body.endpoint !== "string" ||
    !body.endpoint ||
    typeof body.keys !== "object" ||
    body.keys === null
  ) {
    res.status(400).json({ error: "endpoint and keys required" });
    return;
  }

  const keys = body.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    res.status(400).json({ error: "keys.p256dh and keys.auth required" });
    return;
  }

  await db
    .insert(messengerPushSubscriptions)
    .values({
      userId,
      endpoint: body.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: messengerPushSubscriptions.endpoint,
      set: {
        userId,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        updatedAt: new Date(),
      },
    });

  logger.info({ userId }, "messenger: push subscription saved");
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// DELETE /push-unsubscribe — remove a browser PushSubscription
// ---------------------------------------------------------------------------
router.delete("/push-unsubscribe", async (req, res) => {
  const userId = req.session?.userId as number;
  const body = req.body as { endpoint?: unknown };

  if (typeof body.endpoint !== "string" || !body.endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }

  await db
    .delete(messengerPushSubscriptions)
    .where(
      and(
        eq(messengerPushSubscriptions.endpoint, body.endpoint),
        eq(messengerPushSubscriptions.userId, userId),
      ),
    );

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Fan-out helper — called (fire-and-forget) after a message is saved
// ---------------------------------------------------------------------------

/** Compute total unread count for a user across all their conversations. */
async function getUnreadCountForUser(userId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(messengerMessages)
    .innerJoin(
      messengerConversationParticipants,
      and(
        eq(
          messengerConversationParticipants.conversationId,
          messengerMessages.conversationId,
        ),
        eq(messengerConversationParticipants.userId, userId),
      ),
    )
    .where(
      and(
        isNull(messengerMessages.readAt),
        isNull(messengerMessages.deletedAt),
        or(
          isNull(messengerMessages.senderId),
          ne(messengerMessages.senderId, userId),
        ),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Send a push notification to all conversation participants except the sender.
 * Fires asynchronously — do not await at the call site.
 */
export async function fanOutPushNotifications(
  convId: number,
  senderId: number,
  messageBody: string,
  senderName: string | null,
): Promise<void> {
  if (!vapidReady) return;

  const participants = await db
    .select({ userId: messengerConversationParticipants.userId })
    .from(messengerConversationParticipants)
    .where(
      and(
        eq(messengerConversationParticipants.conversationId, convId),
        ne(messengerConversationParticipants.userId, senderId),
      ),
    );

  if (!participants.length) return;

  const recipientIds = participants.map((p) => p.userId);

  const subscriptions = await db
    .select()
    .from(messengerPushSubscriptions)
    .where(inArray(messengerPushSubscriptions.userId, recipientIds));

  if (!subscriptions.length) return;

  const preview =
    messageBody.length > 100 ? messageBody.slice(0, 100) + "…" : messageBody;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const unreadCount = await getUnreadCountForUser(sub.userId);
      const payload = JSON.stringify({
        unreadCount,
        senderName: senderName ?? "New message",
        messagePreview: preview,
      });

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys as { p256dh: string; auth: string },
          },
          payload,
          { TTL: 3600 },
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await db
            .delete(messengerPushSubscriptions)
            .where(eq(messengerPushSubscriptions.endpoint, sub.endpoint))
            .catch(() => {});
          logger.info(
            { endpoint: sub.endpoint },
            "messenger: stale push subscription removed",
          );
        } else {
          logger.warn(
            { endpoint: sub.endpoint, status },
            "messenger: push delivery failed",
          );
        }
      }
    }),
  );
}

export default router;
