/**
 * Unified notification center schema (#235).
 *
 * Four tables:
 * - notification_events      — the underlying event, once per occurrence
 * - notification_recipients  — per-user read/ack/dismiss state
 * - notification_deliveries  — per-channel delivery tracking
 * - notification_preferences — per-user channel preferences
 */

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";

// ── notification_events ───────────────────────────────────────────────────────

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: serial("id").primaryKey(),
    eventType: text("event_type").notNull(),
    module: text("module").notNull(),
    severity: text("severity").notNull().default("informational"),
    scope: text("scope").notNull().default("household"),
    subjectType: text("subject_type"),
    subjectId: integer("subject_id"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    actionUrl: text("action_url"),
    actionLabel: text("action_label"),
    payload: jsonb("payload"),
    dedupKey: text("dedup_key").unique(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: integer("superseded_by"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notification_events_type_idx").on(table.eventType),
    index("notification_events_module_idx").on(table.module),
    index("notification_events_occurred_at_idx").on(table.occurredAt),
  ],
);

// ── notification_recipients ───────────────────────────────────────────────────

export const notificationRecipients = pgTable(
  "notification_recipients",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    userId: integer("user_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("notification_recipients_event_user_uidx").on(
      table.eventId,
      table.userId,
    ),
    index("notification_recipients_user_idx").on(table.userId),
    index("notification_recipients_event_idx").on(table.eventId),
  ],
);

// ── notification_deliveries ───────────────────────────────────────────────────

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: serial("id").primaryKey(),
    recipientId: integer("recipient_id").notNull(),
    eventId: integer("event_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureClass: text("failure_class"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notification_deliveries_recipient_idx").on(table.recipientId),
    index("notification_deliveries_status_idx").on(table.status),
    index("notification_deliveries_channel_status_idx").on(
      table.channel,
      table.status,
    ),
  ],
);

// ── notification_preferences ──────────────────────────────────────────────────

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    scope: text("scope").notNull().default("global"),
    scopeValue: text("scope_value"),
    channelInApp: boolean("channel_in_app").notNull().default(true),
    channelEmail: boolean("channel_email").notNull().default(false),
    channelSms: boolean("channel_sms").notNull().default(false),
    channelPush: boolean("channel_push").notNull().default(false),
    quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
    quietHoursTimezone: text("quiet_hours_timezone")
      .notNull()
      .default("America/New_York"),
    quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("08:00"),
    criticalOverride: boolean("critical_override").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("notification_preferences_user_idx").on(table.userId)],
);
