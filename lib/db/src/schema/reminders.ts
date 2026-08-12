import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { travelsConnectedCalendars } from "./travels";

// ── Generic cross-app reminder system ───────────────────────────────────────
//
// Replaces both `travelsReminders`/`travelsReminderAlertLog` (Travels-only)
// and `elaineScheduledActions` (Elaine's own parallel scheduled call/message
// system) with one generic system usable from any module — Office Notes,
// Travel Wishlist/trips, Pottery, Quilting, Ornaments, and Elaine's
// conversational scheduling. See lib/db/src/schema/travels.ts and
// lib/db/src/schema/elaine.ts for the old tables, which are left in place,
// untouched and read-only, until a later explicit cleanup migration drops
// them (never bundled with the cutover itself).

// One row per reminder, regardless of source. `entityType`/`entityId` is an
// optional polymorphic link to the record the reminder is about (nullable —
// a plain date/time reminder or an Elaine-created one may not be attached to
// any record at all).
export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    createdByUserId: integer("created_by_user_id").notNull(),
    title: text("title").notNull(),
    // Rich-text HTML description from the shared TipTap editor (links/images
    // supported — see EPIC 3 of the reminder-system programme).
    description: text("description"),
    // Anchor datetime this reminder is computed relative to. For
    // calendar-linked reminders this is kept in sync with the linked event's
    // start time. Interpreted using the creating user's app_users.timezone
    // (same fallback pattern as comm-check-scheduler.ts) when the user
    // specifies a relative/local time.
    // Nullable: a reminder can exist with no specific due date/time (a bare
    // note-like reminder). It simply never fires under the delivery
    // scheduler until a due date is set — mirrors the old
    // travelsReminders.dueDate, which was also nullable.
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Array of { value: number, unit: "minutes"|"hours"|"days"|"weeks" }.
    // A plain one-off reminder with no extra lead time has a single entry
    // { value: 0, unit: "minutes" }. Generalizes the old
    // travelsReminders.alertDaysBefore (integer days only) to arbitrary
    // units and multiple independent lead times per reminder.
    leadTimes: jsonb("lead_times")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Simple interval + specific-weekday/day-of-month recurrence (not
    // full RRULE — see the programme's explicit out-of-scope note).
    recurrenceIntervalValue: integer("recurrence_interval_value"),
    recurrenceIntervalUnit: text("recurrence_interval_unit"), // minutes|hours|days|weeks|months|years
    recurrenceWeekday: integer("recurrence_weekday"), // 0=Sunday..6=Saturday
    recurrenceDayOfMonth: integer("recurrence_day_of_month"), // 1-31
    recurrenceEndDate: date("recurrence_end_date"),
    recurrenceMaxOccurrences: integer("recurrence_max_occurrences"),
    recurrenceFiredCount: integer("recurrence_fired_count")
      .notNull()
      .default(0),
    // Set when this reminder is linked to an event on an already-connected
    // Travels calendar (reuses travelsConnectedCalendars — this is NOT a new
    // calendar integration).
    calendarConnectionId: integer("calendar_connection_id").references(
      () => travelsConnectedCalendars.id,
    ),
    googleEventId: text("google_event_id"),
    // Denormalized from the Google Calendar API's event.htmlLink at
    // link/re-link time (see resolveCalendarLink in routes/travels/
    // reminders.ts). Lets every reminder UI surface (bell popover, central
    // Reminders page, per-module lists) render a direct "view event" link
    // without an extra live Calendar API call per render (issue #519).
    googleEventHtmlLink: text("google_event_html_link"),
    emailRecipients: text("email_recipients")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    smsRecipientUserIds: integer("sms_recipient_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    callRecipientUserIds: integer("call_recipient_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    slackRecipientUserIds: integer("slack_recipient_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    // In-app messenger delivery — new channel, not present in the old
    // Travels system. Delivers the same way deliverElaineChat delivers
    // Elaine's own replies today.
    messengerRecipientUserIds: integer("messenger_recipient_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    // active | done | cancelled
    status: text("status").notNull().default("active"),
    // Set only when entityType = 'elaine_action'. Preserves what the old
    // elaineScheduledActions.actionType/actionPayload stored, so the unified
    // delivery scheduler knows which communication-actions.ts executor to
    // invoke for this reminder's "delivery".
    elaineActionType: text("elaine_action_type"),
    elaineActionPayload: jsonb("elaine_action_payload"),
    // Set only by one-time backfill scripts (e.g. the travels_reminders /
    // elaine_scheduled_actions migrations) so re-running a backfill is
    // idempotent (ON CONFLICT DO NOTHING) and so a migrated row's origin can
    // be traced. Never set or read by normal application code.
    legacySourceTable: text("legacy_source_table"),
    legacySourceId: integer("legacy_source_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("reminders_entity_idx").on(table.entityType, table.entityId),
    index("reminders_created_by_user_id_idx").on(table.createdByUserId),
    index("reminders_status_due_at_idx").on(table.status, table.dueAt),
    index("reminders_calendar_connection_id_idx").on(
      table.calendarConnectionId,
    ),
  ],
).enableRLS();

export type ReminderRow = typeof reminders.$inferSelect;
export type InsertReminder = typeof reminders.$inferInsert;

// One row per individual scheduled firing (one lead-time offset, or one
// recurrence occurrence, × one channel). Replaces both
// travelsReminderAlertLog/travelsReminderAlertDeliveries and the status
// columns that used to live directly on elaineScheduledActions.
//
// status MUST follow the same crash-safe claim pattern as the prior
// elaine-scheduled-actions-runner.ts: pending -> sending (atomic claim)
// before attempting delivery; only a confirmed successful provider call
// moves a row to fired; a recovery pass marks rows stuck in sending past a
// timeout as failed (no auto-retry, to avoid double-send).
export const reminderDeliveries = pgTable(
  "reminder_deliveries",
  {
    id: serial("id").primaryKey(),
    reminderId: integer("reminder_id")
      .notNull()
      .references(() => reminders.id, { onDelete: "cascade" }),
    // Deterministic key identifying which lead-time offset and/or which
    // recurrence occurrence this delivery is for — used for dedupe.
    occurrenceKey: text("occurrence_key").notNull(),
    channel: text("channel").notNull(), // email | sms | call | slack | messenger
    // Email address, or app_users.id as a string, depending on channel.
    recipientRef: text("recipient_ref").notNull(),
    scheduledFor: timestamp("scheduled_for", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull().default("pending"), // pending|sending|fired|failed
    firedAt: timestamp("fired_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("reminder_deliveries_reminder_id_idx").on(table.reminderId),
    index("reminder_deliveries_status_scheduled_for_idx").on(
      table.status,
      table.scheduledFor,
    ),
    uniqueIndex("reminder_deliveries_dedup_idx").on(
      table.reminderId,
      table.occurrenceKey,
      table.channel,
      table.recipientRef,
    ),
  ],
).enableRLS();

export type ReminderDeliveryRow = typeof reminderDeliveries.$inferSelect;
export type InsertReminderDelivery = typeof reminderDeliveries.$inferInsert;

// Small side-table supporting calendar-linked reminders: lets the unified
// scheduler detect that a linked Google Calendar event's title/start time
// changed since the last check, without re-pulling and diffing the full
// event on every single scheduler tick.
export const reminderCalendarSyncState = pgTable(
  "reminder_calendar_sync_state",
  {
    id: serial("id").primaryKey(),
    reminderId: integer("reminder_id")
      .notNull()
      .unique()
      .references(() => reminders.id, { onDelete: "cascade" }),
    lastSyncedEventTitle: text("last_synced_event_title"),
    lastSyncedEventStart: timestamp("last_synced_event_start", {
      withTimezone: true,
    }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  },
).enableRLS();

export type ReminderCalendarSyncStateRow =
  typeof reminderCalendarSyncState.$inferSelect;
export type InsertReminderCalendarSyncState =
  typeof reminderCalendarSyncState.$inferInsert;
