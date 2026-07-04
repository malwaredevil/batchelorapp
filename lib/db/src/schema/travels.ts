import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const travelsTrips = pgTable(
  "travels_trips",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    title: text("title").notNull(),
    destination: text("destination").notNull(),
    lat: real("lat"),
    lng: real("lng"),
    status: text("status").notNull().default("wishlist"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    transportTo: text("transport_to"),
    transportDetails: text("transport_details"),
    hasRentalCar: boolean("has_rental_car").notNull().default(false),
    accommodationName: text("accommodation_name"),
    accommodationArea: text("accommodation_area"),
    notes: text("notes"),
    funFact: text("fun_fact"),
    travellerCount: integer("traveller_count").notNull().default(2),
    travelers: jsonb("travelers"),
    theOneThing: jsonb("the_one_thing"),
    itinerary: jsonb("itinerary"),
    packingList: jsonb("packing_list"),
    chatHistory: jsonb("chat_history"),
    todoList: jsonb("todo_list"),
    iconPhotoId: integer("icon_photo_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_trips_user_id_idx").on(table.userId),
    index("travels_trips_status_idx").on(table.status),
  ],
).enableRLS();

export type TravelsTripRow = typeof travelsTrips.$inferSelect;
export type InsertTravelsTrip = typeof travelsTrips.$inferInsert;

export const travelsTripDocuments = pgTable(
  "travels_trip_documents",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull(),
    userId: integer("user_id").notNull(),
    storagePath: text("storage_path").notNull(),
    documentType: text("document_type"),
    originalFilename: text("original_filename"),
    extractedData: jsonb("extracted_data"),
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_trip_documents_trip_id_idx").on(table.tripId),
    index("travels_trip_documents_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type TravelsTripDocumentRow = typeof travelsTripDocuments.$inferSelect;
export type InsertTravelsTripDocument =
  typeof travelsTripDocuments.$inferInsert;

export const travelsTripPhotos = pgTable(
  "travels_trip_photos",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull(),
    userId: integer("user_id").notNull(),
    storagePath: text("storage_path").notNull(),
    caption: text("caption"),
    photoType: text("photo_type").notNull().default("photo"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Jina CLIP v2 visual embedding — only populated for photoType = 'magnet',
    // used to check whether a magnet spotted in a store is already owned.
    visualEmbedding: vector("visual_embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_trip_photos_trip_id_idx").on(table.tripId),
    index("travels_trip_photos_user_id_idx").on(table.userId),
    index("travels_trip_photos_visual_embedding_idx")
      .using("hnsw", table.visualEmbedding.op("vector_cosine_ops")),
  ],
).enableRLS();

export type TravelsTripPhotoRow = typeof travelsTripPhotos.$inferSelect;
export type InsertTravelsTripPhoto = typeof travelsTripPhotos.$inferInsert;

export const travelsReminders = pgTable(
  "travels_reminders",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull(),
    userId: integer("user_id").notNull(),
    title: text("title").notNull(),
    // Optional rich text (TipTap HTML) description/notes for the reminder.
    // Not shown inline in reminder lists — only in the detail dialog.
    description: text("description"),
    dueDate: date("due_date"),
    done: boolean("done").notNull().default(false),
    // Email addresses that receive alerts for this reminder — either picked from
    // app_users' login emails, or freeform custom addresses added by the user.
    recipientEmails: text("recipient_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Whether this reminder should have a matching event on the shared family
    // Google Calendar (created via the connected Google Calendar integration).
    syncToCalendar: boolean("sync_to_calendar").notNull().default(true),
    // Google Calendar event id, so we can update/delete the event later.
    // Null if sync is off, not yet attempted, or the last sync attempt failed.
    googleEventId: text("google_event_id"),
    // Which day-offsets before dueDate should trigger an alert (email + a
    // matching popup override on the synced Travel-calendar Google event).
    // Bidirectionally synced: editing this array pushes new reminder
    // overrides to Google; editing the event's reminders directly in Google
    // pulls the offsets back into this array on next read.
    alertDaysBefore: integer("alert_days_before")
      .array()
      .notNull()
      .default(sql`'{14,7,3}'::integer[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_reminders_trip_id_idx").on(table.tripId),
    index("travels_reminders_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type TravelsReminderRow = typeof travelsReminders.$inferSelect;
export type InsertTravelsReminder = typeof travelsReminders.$inferInsert;

export const travelsWishlist = pgTable(
  "travels_wishlist",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    destination: text("destination").notNull(),
    targetDate: date("target_date"),
    notes: text("notes"),
    lat: real("lat"),
    lng: real("lng"),
    done: boolean("done").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("travels_wishlist_user_id_idx").on(table.userId)],
).enableRLS();

export type TravelsWishlistRow = typeof travelsWishlist.$inferSelect;
export type InsertTravelsWishlist = typeof travelsWishlist.$inferInsert;

export const travelsReminderAlertLog = pgTable(
  "travels_reminder_alert_log",
  {
    id: serial("id").primaryKey(),
    reminderId: integer("reminder_id").notNull(),
    userId: integer("user_id").notNull(),
    alertType: text("alert_type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("travels_reminder_alert_log_reminder_id_idx").on(table.reminderId),
    index("travels_reminder_alert_log_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type TravelsReminderAlertLogRow =
  typeof travelsReminderAlertLog.$inferSelect;

// Singleton row (id = 1) holding the shared household's chosen Google
// Calendar for auto-synced reminders. There is exactly one connected Google
// account for this app (via the Replit Google Calendar integration) and it
// writes to a single shared "Family" calendar picked here.
export const travelsCalendarSettings = pgTable("travels_calendar_settings", {
  id: integer("id").primaryKey().default(1),
  calendarId: text("calendar_id"),
  calendarSummary: text("calendar_summary"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type TravelsCalendarSettingsRow =
  typeof travelsCalendarSettings.$inferSelect;

// Per-user connected Google Calendar account. Each family member connects
// their own Google account (OAuth, offline access) and picks which of their
// own calendars reminders should sync to. Replaces the old single shared
// household connection (travels_calendar_settings, now unused).
export const travelsGoogleCalendarConnections = pgTable(
  "travels_google_calendar_connections",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    googleEmail: text("google_email").notNull(),
    refreshToken: text("refresh_token").notNull(),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    calendarId: text("calendar_id"),
    calendarSummary: text("calendar_summary"),
    // When true, this connection's calendar is the household's shared
    // Travel Calendar — every app_user (whether or not they've connected
    // their own Google account) can view/add/edit/delete events on it, with
    // requests proxied through this connection's owner's Google token.
    // Application logic enforces at most one shared connection at a time.
    isHouseholdShared: boolean("is_household_shared").notNull().default(false),
    // Which of Google's fixed event colorIds ("1".."11") the household has
    // chosen to mean "Travel". Only meaningful on the row currently marked
    // isHouseholdShared.
    travelColorId: text("travel_color_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type TravelsGoogleCalendarConnectionRow =
  typeof travelsGoogleCalendarConnections.$inferSelect;
export type InsertTravelsGoogleCalendarConnection =
  typeof travelsGoogleCalendarConnections.$inferInsert;

// Per-user, per-calendar rows: each user can connect an unlimited number of
// their own Google calendars (picked from their calendar list, or entered
// manually by id), each with its own chosen primary color. Exactly one row
// across the WHOLE table may have isTravelCalendar = true (enforced in
// application code, not the DB) — that row is the shared "Travel" calendar:
// every app_user can view/create/edit/delete events on it, proxied through
// its owning user's Google token. All other rows are private to their owner
// and only toggle visibility in that owner's own Travel Calendar page.
export const travelsConnectedCalendars = pgTable(
  "travels_connected_calendars",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    // 'picked' — chosen from the user's Google calendar list via the API.
    // 'manual' — calendar id typed/pasted in directly.
    source: text("source").notNull().default("picked"),
    primaryColor: text("primary_color").notNull().default("#4285f4"),
    isTravelCalendar: boolean("is_travel_calendar").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_connected_calendars_user_id_idx").on(table.userId),
    uniqueIndex("travels_connected_calendars_user_id_google_calendar_id_idx").on(
      table.userId,
      table.googleCalendarId,
    ),
  ],
).enableRLS();

export type TravelsConnectedCalendarRow =
  typeof travelsConnectedCalendars.$inferSelect;
export type InsertTravelsConnectedCalendar =
  typeof travelsConnectedCalendars.$inferInsert;

// Maps a trip's itinerary content to the Google Calendar event(s) synced for
// it — one row for the trip-level event, plus one per itinerary activity.
// itemKey is content-derived (not array index), so reordering/editing
// itinerary days/activities doesn't desync the mapping; contentHash lets the
// reconciler skip no-op updates against the Google API.
export const travelsTripCalendarEvents = pgTable(
  "travels_trip_calendar_events",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull(),
    itemKey: text("item_key").notNull(),
    kind: text("kind").notNull(), // 'trip' | 'itinerary_activity' | 'suggested_event'
    contentHash: text("content_hash").notNull(),
    googleEventId: text("google_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_trip_calendar_events_trip_id_idx").on(table.tripId),
    uniqueIndex("travels_trip_calendar_events_trip_id_item_key_idx").on(
      table.tripId,
      table.itemKey,
    ),
  ],
).enableRLS();

export type TravelsTripCalendarEventRow =
  typeof travelsTripCalendarEvents.$inferSelect;
export type InsertTravelsTripCalendarEvent =
  typeof travelsTripCalendarEvents.$inferInsert;

// AI-detected candidate trips found by scanning connected calendars for
// travel-looking events (flights, hotels, etc) not already linked to a
// trip. dedupeKey makes repeated scans (daily scheduler + manual button)
// idempotent via ON CONFLICT DO NOTHING.
//
// userId is the owner of the personal connected calendar that produced the
// suggestion (nullable — legacy rows predating this column have no owner on
// record). isFromSharedCalendar is true when the suggestion came from the
// household-wide Travel calendar. Visibility rule enforced at the route
// layer: a user sees their own personal-calendar suggestions plus every
// shared-calendar suggestion, never another user's personal-calendar ones.
export const travelsCalendarTripSuggestions = pgTable(
  "travels_calendar_trip_suggestions",
  {
    id: serial("id").primaryKey(),
    suggestedTitle: text("suggested_title").notNull(),
    destination: text("destination"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    relatedEventIds: jsonb("related_event_ids").notNull().default(sql`'[]'::jsonb`),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'accepted' | 'dismissed'
    userId: integer("user_id"),
    isFromSharedCalendar: boolean("is_from_shared_calendar").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("travels_calendar_trip_suggestions_dedupe_key_idx").on(
      table.dedupeKey,
    ),
    index("travels_calendar_trip_suggestions_status_idx").on(table.status),
    index("travels_calendar_trip_suggestions_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type TravelsCalendarTripSuggestionRow =
  typeof travelsCalendarTripSuggestions.$inferSelect;
export type InsertTravelsCalendarTripSuggestion =
  typeof travelsCalendarTripSuggestions.$inferInsert;

// Tracks the Google Calendar event id created for a given reminder in a
// given connected user's calendar — one reminder can fan out into multiple
// users' calendars (each recipient who has connected their own account).
export const travelsReminderCalendarEvents = pgTable(
  "travels_reminder_calendar_events",
  {
    id: serial("id").primaryKey(),
    reminderId: integer("reminder_id").notNull(),
    userId: integer("user_id").notNull(),
    // Which of the user's connected calendars this event lives in — needed
    // now that a user may have more than one connected Google calendar.
    calendarId: text("calendar_id").notNull().default(""),
    googleEventId: text("google_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_reminder_calendar_events_reminder_id_idx").on(
      table.reminderId,
    ),
    index("travels_reminder_calendar_events_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type TravelsReminderCalendarEventRow =
  typeof travelsReminderCalendarEvents.$inferSelect;
export type InsertTravelsReminderCalendarEvent =
  typeof travelsReminderCalendarEvents.$inferInsert;

// ── elAIne assistant ─────────────────────────────────────────────────────────

// One ongoing conversation per user that follows them across every page.
// "New conversation" just clears messages back to []. Not to be confused with
// the (now-retired) per-trip chatHistory column on travelsTrips.
export const travelsAssistantConversations = pgTable(
  "travels_assistant_conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type TravelsAssistantConversationRow =
  typeof travelsAssistantConversations.$inferSelect;
export type InsertTravelsAssistantConversation =
  typeof travelsAssistantConversations.$inferInsert;

// Per-user on/off preference for elAIne (default on). "Hide for this visit"
// is session-only (client-side), so it does not need a row here.
// `actionConfirmationMode` controls how she confirms multi-action turns:
// "one_by_one" (default, safest), "all_at_once", or "auto_run" (no
// confirmation — she just does them and reports back).
export const travelsAssistantSettings = pgTable("travels_assistant_settings", {
  userId: integer("user_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  actionConfirmationMode: text("action_confirmation_mode")
    .notNull()
    .default("one_by_one"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type TravelsAssistantSettingsRow =
  typeof travelsAssistantSettings.$inferSelect;
export type InsertTravelsAssistantSettings =
  typeof travelsAssistantSettings.$inferInsert;

// Shared household memory — facts elAIne has learned from any family member
// that are relevant to everyone, not siloed per-user. Populated by the
// assistant itself via a save_household_memory tool call, not hand-authored.
export const travelsHouseholdMemory = pgTable(
  "travels_household_memory",
  {
    id: serial("id").primaryKey(),
    content: text("content").notNull(),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type TravelsHouseholdMemoryRow =
  typeof travelsHouseholdMemory.$inferSelect;
export type InsertTravelsHouseholdMemory =
  typeof travelsHouseholdMemory.$inferInsert;

// Proactive nudges — messages elAIne generates unprompted (e.g. "your trip
// starts in 2 days and the packing list is empty"), produced by a scheduled
// job (lib/travels-nudges.ts) rather than in response to a chat turn.
// `nudgeKey` is a stable dedup key per condition instance (e.g.
// "packing_empty:<tripId>") so the job never nags about the same thing
// twice; the unique constraint on (user_id, nudge_key) makes inserts
// idempotent via ON CONFLICT DO NOTHING. Once picked up by
// GET /assistant/conversation, a nudge's message is appended to the user's
// conversation history as a normal assistant chat bubble and `seenAt` is
// stamped so it never appears twice and drops off the unseen-count badge.
export const travelsAssistantNudges = pgTable(
  "travels_assistant_nudges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    tripId: integer("trip_id"),
    nudgeKey: text("nudge_key").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => [
    index("travels_assistant_nudges_user_id_idx").on(table.userId),
    index("travels_assistant_nudges_user_id_seen_at_idx").on(
      table.userId,
      table.seenAt,
    ),
    uniqueIndex("travels_assistant_nudges_user_id_nudge_key_idx").on(
      table.userId,
      table.nudgeKey,
    ),
  ],
).enableRLS();

export type TravelsAssistantNudgeRow =
  typeof travelsAssistantNudges.$inferSelect;
export type InsertTravelsAssistantNudge =
  typeof travelsAssistantNudges.$inferInsert;

// ---------------------------------------------------------------------------
// Gmail travel-document scanning
// ---------------------------------------------------------------------------

// Per-user Gmail OAuth connection (restricted gmail.readonly scope, separate
// consent from Calendar). Mirrors travels_google_calendar_connections'
// per-user single-row shape. App stays in Google OAuth "Testing" status with
// household emails added as test users, avoiding a CASA security assessment.
export const travelsGmailConnections = pgTable(
  "travels_gmail_connections",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    googleEmail: text("google_email").notNull(),
    refreshToken: text("refresh_token").notNull(),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    // Gmail history id watermark — lets future incremental scans (not yet
    // implemented) resume from the last-seen point instead of a full re-scan.
    lastHistoryId: text("last_history_id"),
    lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type TravelsGmailConnectionRow =
  typeof travelsGmailConnections.$inferSelect;
export type InsertTravelsGmailConnection =
  typeof travelsGmailConnections.$inferInsert;

// One row per (owning user, Gmail message) ever surfaced by a scan — the
// permanent "decided" ledger that guarantees a dismissed or already-linked
// email is never re-suggested, even across repeated scans or different
// household members scanning their own inbox. status:
//   'pending'   — surfaced, awaiting the user's decision (suggestion review UI)
//   'linked'    — accepted and attached to a trip as a document
//   'dismissed' — explicitly rejected by the user
//   'ignored'   — auto-skipped by the scanner (not travel-related enough)
// dedupeKey is a hash of (household-wide) normalized reference number +
// provider + date, so the exact same booking forwarded to two household
// members' inboxes is only ever linked once.
export const travelsGmailScanDecisions = pgTable(
  "travels_gmail_scan_decisions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    threadId: text("thread_id"),
    subject: text("subject"),
    fromAddress: text("from_address"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    // AI-extracted structured fields, same shape as document extraction
    // (documentType, providerName, referenceNumber, dates, etc) — see
    // extractFromEmail() in gmail-scan.ts.
    extractedData: jsonb("extracted_data"),
    // Household-wide dedup key (hash of normalized provider+reference+date).
    // Null when extraction couldn't produce enough fields to dedupe on.
    dedupeKey: text("dedupe_key"),
    suggestedTripId: integer("suggested_trip_id"),
    tripId: integer("trip_id"),
    tripDocumentId: integer("trip_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_gmail_scan_decisions_user_id_idx").on(table.userId),
    index("travels_gmail_scan_decisions_status_idx").on(table.status),
    index("travels_gmail_scan_decisions_dedupe_key_idx").on(table.dedupeKey),
    uniqueIndex(
      "travels_gmail_scan_decisions_user_id_gmail_message_id_idx",
    ).on(table.userId, table.gmailMessageId),
  ],
).enableRLS();

export type TravelsGmailScanDecisionRow =
  typeof travelsGmailScanDecisions.$inferSelect;
export type InsertTravelsGmailScanDecision =
  typeof travelsGmailScanDecisions.$inferInsert;
