import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  notificationRecipients,
  notificationPreferences,
} from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import {
  getUserNotifications,
  getUnreadCounts,
  getUserPreferences,
} from "../lib/notifications";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// ── GET /api/notifications/counts ────────────────────────────────────────────

router.get("/counts", async (req, res) => {
  const userId = req.session.userId!;
  const counts = await getUnreadCounts(userId);
  res.json(counts);
});

// ── GET /api/notifications ────────────────────────────────────────────────────

const listQuerySchema = z.object({
  module: z.string().optional(),
  severity: z
    .enum(["informational", "attention", "important", "critical"])
    .optional(),
  unread: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(30),
});

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const q = listQuerySchema.parse(req.query);
  const result = await getUserNotifications(userId, q);
  res.json(result);
});

// ── PATCH /api/notifications/:recipientId ─────────────────────────────────────

const updateStateSchema = z.object({
  read: z.boolean().optional(),
  acknowledged: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
});

router.patch("/:recipientId", async (req, res) => {
  const userId = req.session.userId!;
  const recipientId = z.coerce
    .number()
    .int()
    .positive()
    .parse(req.params.recipientId);

  const body = updateStateSchema.parse(req.body);

  // Verify ownership
  const [row] = await db
    .select()
    .from(notificationRecipients)
    .where(
      and(
        eq(notificationRecipients.id, recipientId),
        eq(notificationRecipients.userId, userId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const now = new Date();
  const update: Partial<typeof notificationRecipients.$inferInsert> = {};

  if (body.read === true && !row.readAt) update.readAt = now;
  if (body.read === false) update.readAt = null as never;
  if (body.acknowledged === true && !row.acknowledgedAt)
    update.acknowledgedAt = now;
  if (body.dismissed === true && !row.dismissedAt) update.dismissedAt = now;
  if (body.dismissed === false) update.dismissedAt = null as never;
  if (body.snoozedUntil !== undefined) {
    update.snoozedUntil = body.snoozedUntil
      ? new Date(body.snoozedUntil)
      : (null as never);
  }

  const [updated] = await db
    .update(notificationRecipients)
    .set(update)
    .where(eq(notificationRecipients.id, recipientId))
    .returning();

  res.json({
    recipientId: updated.id,
    isRead: updated.readAt != null,
    readAt: updated.readAt ?? null,
    isAcknowledged: updated.acknowledgedAt != null,
    acknowledgedAt: updated.acknowledgedAt ?? null,
    isDismissed: updated.dismissedAt != null,
    dismissedAt: updated.dismissedAt ?? null,
    snoozedUntil: updated.snoozedUntil ?? null,
  });
});

// ── POST /api/notifications/bulk-state ───────────────────────────────────────

const bulkStateSchema = z.object({
  recipientIds: z.array(z.number().int().positive()).max(200),
  action: z.enum(["read", "unread", "dismissed", "acknowledged"]),
});

router.post("/bulk-state", async (req, res) => {
  const userId = req.session.userId!;
  const { recipientIds, action } = bulkStateSchema.parse(req.body);

  if (recipientIds.length === 0) {
    res.json({ updated: 0 });
    return;
  }

  const now = new Date();
  const updateMap: Record<
    string,
    Partial<typeof notificationRecipients.$inferInsert>
  > = {
    read: { readAt: now },
    unread: { readAt: null as never },
    dismissed: { dismissedAt: now, readAt: now },
    acknowledged: { acknowledgedAt: now, readAt: now },
  };

  const result = await db
    .update(notificationRecipients)
    .set(updateMap[action])
    .where(
      and(
        eq(notificationRecipients.userId, userId),
        inArray(notificationRecipients.id, recipientIds),
      ),
    )
    .returning({ id: notificationRecipients.id });

  res.json({ updated: result.length });
});

// ── GET /api/notifications/preferences ───────────────────────────────────────

router.get("/preferences", async (req, res) => {
  const userId = req.session.userId!;
  const entries = await getUserPreferences(userId);
  res.json({ entries });
});

// ── PUT /api/notifications/preferences ───────────────────────────────────────

const preferenceEntrySchema = z.object({
  scope: z.enum(["global", "module", "event_type"]),
  scopeValue: z.string().nullable().optional(),
  channelInApp: z.boolean().default(true),
  channelEmail: z.boolean().default(false),
  channelSms: z.boolean().default(false),
  channelPush: z.boolean().default(false),
  quietHoursEnabled: z.boolean().default(false),
  quietHoursTimezone: z.string().default("America/New_York"),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("22:00"),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("08:00"),
  criticalOverride: z.boolean().default(true),
});

const preferencesBodySchema = z.object({
  entries: z.array(preferenceEntrySchema).max(50),
});

router.put("/preferences", async (req, res) => {
  const userId = req.session.userId!;
  const { entries } = preferencesBodySchema.parse(req.body);

  // Replace all preferences for this user atomically
  await db.transaction(async (tx) => {
    await tx
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    if (entries.length > 0) {
      await tx.insert(notificationPreferences).values(
        entries.map((e) => ({
          userId,
          scope: e.scope,
          scopeValue: e.scopeValue ?? null,
          channelInApp: e.channelInApp,
          channelEmail: e.channelEmail,
          channelSms: e.channelSms,
          channelPush: e.channelPush,
          quietHoursEnabled: e.quietHoursEnabled,
          quietHoursTimezone: e.quietHoursTimezone,
          quietHoursStart: e.quietHoursStart,
          quietHoursEnd: e.quietHoursEnd,
          criticalOverride: e.criticalOverride,
        })),
      );
    }
  });

  const saved = await getUserPreferences(userId);
  res.json({ entries: saved });
});

export default router;
