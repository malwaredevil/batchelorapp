/**
 * Notification center library (#235).
 *
 * Provides a single createNotification() function that all event producers call.
 * Handles deduplication (by dedupKey), household fan-out, and in-app delivery
 * record creation in one atomic-ish transaction.
 */

import { and, count, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import {
  db,
  appUsers,
  notificationEvents,
  notificationRecipients,
  notificationDeliveries,
  notificationPreferences,
} from "@workspace/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Event taxonomy — stable string constants for event_type column
// ---------------------------------------------------------------------------
export const NOTIFICATION_TYPES = {
  TRAVEL_REMINDER_DUE: "travel.reminder_due",
  TRAVEL_RESERVATION_CHANGE: "travel.reservation_change",
  TRAVEL_DOCUMENT_REVIEW: "travel.document_review",
  GMAIL_SUGGESTION_REVIEW: "travel.gmail_suggestion_review",
  MARKET_WATCH_TRIGGER: "market.watch_trigger",
  HALLMARK_EVENT_REMINDER: "ornaments.hallmark_event",
  JOB_FAILED: "system.job_failed",
  PROVIDER_DEGRADED: "system.provider_degraded",
  SECURITY_EVENT: "system.security_event",
  MESSENGER_UNREAD: "messenger.unread",
  ELAINE_NUDGE: "elaine.nudge",
  ELAINE_DAILY_BRIEF: "elaine.daily_brief",
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationSeverity =
  | "informational"
  | "attention"
  | "important"
  | "critical";

// ---------------------------------------------------------------------------
// Create / upsert a notification event + fan out to recipients
// ---------------------------------------------------------------------------

interface CreateNotificationOptions {
  eventType: string;
  module: string;
  severity?: NotificationSeverity;
  scope?: "household" | "personal";
  subjectType?: string;
  subjectId?: number;
  title: string;
  summary: string;
  actionUrl?: string;
  actionLabel?: string;
  payload?: Record<string, unknown>;
  /** Deterministic key — prevents duplicate events for the same condition. */
  dedupKey?: string;
  expiresAt?: Date;
  /** Explicit list of recipient user IDs; defaults to all household members. */
  recipientUserIds?: number[];
  createdBy?: number;
}

/**
 * Create or upsert a notification event and fan it out to in-app recipients.
 * Returns the event ID.
 */
export async function createNotification(
  opts: CreateNotificationOptions,
): Promise<number> {
  const {
    eventType,
    module,
    severity = "informational",
    scope = "household",
    subjectType,
    subjectId,
    title,
    summary,
    actionUrl,
    actionLabel,
    payload,
    dedupKey,
    expiresAt,
    recipientUserIds,
    createdBy,
  } = opts;

  // 1. Upsert the event (dedup by dedupKey if present) -----------------------
  let eventId: number;

  if (dedupKey) {
    const existing = await db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(eq(notificationEvents.dedupKey, dedupKey))
      .limit(1);

    if (existing.length > 0) {
      // Update last_seen_at so the event stays visible
      await db
        .update(notificationEvents)
        .set({ lastSeenAt: new Date() })
        .where(eq(notificationEvents.id, existing[0].id));
      return existing[0].id;
    }
  }

  const [inserted] = await db
    .insert(notificationEvents)
    .values({
      eventType,
      module,
      severity,
      scope,
      subjectType,
      subjectId,
      title,
      summary,
      actionUrl,
      actionLabel,
      payload: payload as never,
      dedupKey,
      expiresAt,
      createdBy,
    })
    .returning({ id: notificationEvents.id });
  eventId = inserted.id;

  // 2. Resolve recipient user IDs -------------------------------------------
  let userIds: number[];
  if (recipientUserIds && recipientUserIds.length > 0) {
    userIds = recipientUserIds;
  } else {
    // Fan out to all household members
    const users = await db.select({ id: appUsers.id }).from(appUsers);
    userIds = users.map((u) => u.id);
  }

  if (userIds.length === 0) return eventId;

  // 3. Create notification_recipients rows (skip if already exists) ----------
  const recipientValues = userIds.map((userId) => ({
    eventId,
    userId,
  }));

  const recipientRows = await db
    .insert(notificationRecipients)
    .values(recipientValues)
    .onConflictDoNothing()
    .returning({ id: notificationRecipients.id });

  // 4. Create in-app delivery records for each new recipient -----------------
  if (recipientRows.length > 0) {
    const deliveryValues = recipientRows.map((r) => ({
      recipientId: r.id,
      eventId,
      channel: "in_app" as const,
      status: "delivered" as const,
      attemptCount: 1,
      deliveredAt: new Date(),
    }));

    await db
      .insert(notificationDeliveries)
      .values(deliveryValues)
      .onConflictDoNothing();
  }

  logger.info(
    { eventType, module, eventId, recipientCount: userIds.length },
    "notification created",
  );

  return eventId;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface NotificationListItem {
  recipientId: number;
  eventId: number;
  eventType: string;
  module: string;
  severity: string;
  subjectType: string | null;
  subjectId: number | null;
  title: string;
  summary: string;
  actionUrl: string | null;
  actionLabel: string | null;
  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  isRead: boolean;
  readAt: Date | null;
  isAcknowledged: boolean;
  acknowledgedAt: Date | null;
  isDismissed: boolean;
  dismissedAt: Date | null;
  snoozedUntil: Date | null;
}

export async function getUserNotifications(
  userId: number,
  opts: {
    module?: string;
    severity?: string;
    unread?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ items: NotificationListItem[]; total: number }> {
  const { module, severity, unread, page = 1, pageSize = 30 } = opts;

  const now = new Date();

  // Build WHERE conditions
  const conditions = [eq(notificationRecipients.userId, userId)];

  if (unread) {
    conditions.push(isNull(notificationRecipients.readAt));
    conditions.push(isNull(notificationRecipients.dismissedAt));
  }

  // Exclude dismissed unless explicitly requesting them
  if (!unread) {
    conditions.push(isNull(notificationRecipients.dismissedAt));
  }

  // Exclude snoozed notifications where snooze is still active
  conditions.push(
    sql`(${notificationRecipients.snoozedUntil} IS NULL OR ${notificationRecipients.snoozedUntil} < ${now.toISOString()})`,
  );

  const joined = db
    .select({
      recipientId: notificationRecipients.id,
      eventId: notificationEvents.id,
      eventType: notificationEvents.eventType,
      module: notificationEvents.module,
      severity: notificationEvents.severity,
      subjectType: notificationEvents.subjectType,
      subjectId: notificationEvents.subjectId,
      title: notificationEvents.title,
      summary: notificationEvents.summary,
      actionUrl: notificationEvents.actionUrl,
      actionLabel: notificationEvents.actionLabel,
      occurredAt: notificationEvents.occurredAt,
      expiresAt: notificationEvents.expiresAt,
      createdAt: notificationEvents.createdAt,
      readAt: notificationRecipients.readAt,
      acknowledgedAt: notificationRecipients.acknowledgedAt,
      dismissedAt: notificationRecipients.dismissedAt,
      snoozedUntil: notificationRecipients.snoozedUntil,
    })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId),
    )
    .where(and(...conditions));

  if (module) {
    conditions.push(eq(notificationEvents.module, module));
  }
  if (severity) {
    // show at-or-above the requested severity
    const order = ["informational", "attention", "important", "critical"];
    const minIdx = order.indexOf(severity);
    if (minIdx >= 0) {
      conditions.push(
        inArray(notificationEvents.severity, order.slice(minIdx)),
      );
    }
  }

  const [totalRow] = await db
    .select({ c: count() })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId),
    )
    .where(and(...conditions));

  const rows = await joined
    .orderBy(desc(notificationEvents.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    total: Number(totalRow?.c ?? 0),
    items: rows.map((r) => ({
      ...r,
      isRead: r.readAt != null,
      isAcknowledged: r.acknowledgedAt != null,
      isDismissed: r.dismissedAt != null,
    })),
  };
}

export async function getUnreadCounts(
  userId: number,
): Promise<{ total: number; byModule: Record<string, number> }> {
  const rows = await db
    .select({
      module: notificationEvents.module,
      c: count(),
    })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId),
    )
    .where(
      and(
        eq(notificationRecipients.userId, userId),
        isNull(notificationRecipients.readAt),
        isNull(notificationRecipients.dismissedAt),
      ),
    )
    .groupBy(notificationEvents.module);

  const byModule: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.c);
    byModule[r.module] = n;
    total += n;
  }
  return { total, byModule };
}

// ---------------------------------------------------------------------------
// Preferences helpers
// ---------------------------------------------------------------------------

export async function getUserPreferences(userId: number) {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
}

export async function upsertUserPreferences(
  userId: number,
  entries: Array<{
    scope: "global" | "module" | "event_type";
    scopeValue?: string | null;
    channelInApp?: boolean;
    channelEmail?: boolean;
    channelSms?: boolean;
    channelPush?: boolean;
    quietHoursEnabled?: boolean;
    quietHoursTimezone?: string;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    criticalOverride?: boolean;
  }>,
) {
  for (const entry of entries) {
    await db
      .insert(notificationPreferences)
      .values({
        userId,
        scope: entry.scope,
        scopeValue: entry.scopeValue ?? null,
        channelInApp: entry.channelInApp ?? true,
        channelEmail: entry.channelEmail ?? false,
        channelSms: entry.channelSms ?? false,
        channelPush: entry.channelPush ?? false,
        quietHoursEnabled: entry.quietHoursEnabled ?? false,
        quietHoursTimezone: entry.quietHoursTimezone ?? "America/New_York",
        quietHoursStart: entry.quietHoursStart ?? "22:00",
        quietHoursEnd: entry.quietHoursEnd ?? "08:00",
        criticalOverride: entry.criticalOverride ?? true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.scope],
        set: {
          channelInApp: entry.channelInApp ?? true,
          channelEmail: entry.channelEmail ?? false,
          channelSms: entry.channelSms ?? false,
          channelPush: entry.channelPush ?? false,
          quietHoursEnabled: entry.quietHoursEnabled ?? false,
          quietHoursTimezone: entry.quietHoursTimezone ?? "America/New_York",
          quietHoursStart: entry.quietHoursStart ?? "22:00",
          quietHoursEnd: entry.quietHoursEnd ?? "08:00",
          criticalOverride: entry.criticalOverride ?? true,
          updatedAt: new Date(),
        },
      });
  }
}
