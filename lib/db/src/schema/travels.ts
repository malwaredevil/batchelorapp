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
  numeric,
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
    shareToken: text("share_token"),
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
    tripId: integer("trip_id"),
    userId: integer("user_id").notNull(),
    storagePath: text("storage_path").notNull(),
    title: text("title"),
    documentType: text("document_type"),
    originalFilename: text("original_filename"),
    extractedData: jsonb("extracted_data"),
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    gmailMessageId: text("gmail_message_id"),
    iconOverride: text("icon_override"),
    rawText: text("raw_text"),
    status: text("status").notNull().default("linked"),
    source: text("source").notNull().default("upload"),
    sourceEmailFrom: text("source_email_from"),
    sourceEmailSubject: text("source_email_subject"),
    sourceReceivedAt: timestamp("source_received_at", { withTimezone: true }),
    sourceSpans: jsonb("source_spans"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_trip_documents_trip_id_idx").on(table.tripId),
    index("travels_trip_documents_user_id_idx").on(table.userId),
    index("travels_trip_documents_status_idx").on(table.status),
  ],
).enableRLS();

export type TravelsTripDocumentRow = typeof travelsTripDocuments.$inferSelect;
export type InsertTravelsTripDocument =
  typeof travelsTripDocuments.$inferInsert;

export const travelsDocChunks = pgTable(
  "travels_doc_chunks",
  {
    id: serial("id").primaryKey(),
    tripDocumentId: integer("trip_document_id")
      .notNull()
      .references(() => travelsTripDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_doc_chunks_doc_id_idx").on(table.tripDocumentId),
    index("travels_doc_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
).enableRLS();

export type TravelsDocChunkRow = typeof travelsDocChunks.$inferSelect;

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
    index("travels_trip_photos_visual_embedding_idx").using(
      "hnsw",
      table.visualEmbedding.op("vector_cosine_ops"),
    ),
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
    // app_users.id values (must have a verified phone number) who should also
    // get an SMS alert for this reminder, alongside/instead of the email
    // recipients above. Unlike recipientEmails, this can never contain
    // freeform numbers — only verified household accounts.
    smsRecipientUserIds: integer("sms_recipient_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
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
    flightOriginIata: text("flight_origin_iata"),
    flightPriceMinUsd: numeric("flight_price_min_usd", {
      precision: 10,
      scale: 2,
    }),
    flightPriceCachedAt: timestamp("flight_price_cached_at", {
      withTimezone: true,
    }),
    flightPriceOptions: jsonb("flight_price_options"),
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
    // 'email' (default, preserves existing rows) or 'sms' — dedup key is
    // (reminderId, userId, alertType, channel).
    channel: text("channel").notNull().default("email"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("travels_reminder_alert_log_reminder_id_idx").on(table.reminderId),
    index("travels_reminder_alert_log_user_id_idx").on(table.userId),
    // Dedup key: prevents concurrent scheduler runs from inserting duplicate
    // log rows and firing the same alert twice.
    uniqueIndex("travels_reminder_alert_log_dedup_idx").on(
      table.reminderId,
      table.alertType,
      table.channel,
    ),
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
    // Mirrors isTravelCalendar: exactly one row system-wide may be the
    // shared "Hallmark" calendar used by the Ornaments app's event
    // countdown/calendar feature. Owner-only assignment, same pattern.
    isHallmarkCalendar: boolean("is_hallmark_calendar")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_connected_calendars_user_id_idx").on(table.userId),
    uniqueIndex(
      "travels_connected_calendars_user_id_google_calendar_id_idx",
    ).on(table.userId, table.googleCalendarId),
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
// userId records which household member's personal connected calendar
// produced the suggestion (nullable — legacy rows predating this column have
// no owner on record; insert attribution only, not an access filter).
// isFromSharedCalendar is true when the suggestion came from the
// household-wide Travel calendar. Suggestions are household-shared trip
// data — every authenticated household member can view/dismiss/accept any
// suggestion regardless of which calendar produced it.
export const travelsCalendarTripSuggestions = pgTable(
  "travels_calendar_trip_suggestions",
  {
    id: serial("id").primaryKey(),
    suggestedTitle: text("suggested_title").notNull(),
    destination: text("destination"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    relatedEventIds: jsonb("related_event_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'accepted' | 'dismissed'
    userId: integer("user_id"),
    isFromSharedCalendar: boolean("is_from_shared_calendar")
      .notNull()
      .default(false),
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

// ── Elaine assistant ─────────────────────────────────────────────────────────
// Elaine's conversation/settings/memory/nudge tables now live in
// lib/db/src/schema/elaine.ts (elaine_conversations, elaine_settings,
// elaine_memory, elaine_nudges) as a shared, non-namespaced schema used
// identically across Pottery, Quilting, Travels, and the hub. The former
// travels_assistant_* / travels_household_memory tables were migrated into
// those tables and dropped — see scripts/src/migrate-to-elaine.ts.

// ---------------------------------------------------------------------------
// Gmail travel-document scanning
// ---------------------------------------------------------------------------

// Per-user Gmail OAuth connection (restricted gmail.readonly scope, separate
// consent from Calendar). Mirrors travels_google_calendar_connections'
// per-user single-row shape. App stays in Google OAuth "Testing" status with
// household emails added as test users, avoiding a CASA security assessment.
export const travelsGmailConnections = pgTable("travels_gmail_connections", {
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
  // Cached Gmail label ids for this user's own mailbox (label ids are
  // per-account, so each connected user gets their own pair). Resolved and
  // created on first use by gmail-labels.ts; cached here to avoid a
  // labels.list call on every message link.
  travelLabelId: text("travel_label_id"),
  reviewedLabelId: text("reviewed_label_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

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
    uniqueIndex("travels_gmail_scan_decisions_user_id_gmail_message_id_idx").on(
      table.userId,
      table.gmailMessageId,
    ),
  ],
).enableRLS();

export type TravelsGmailScanDecisionRow =
  typeof travelsGmailScanDecisions.$inferSelect;
export type InsertTravelsGmailScanDecision =
  typeof travelsGmailScanDecisions.$inferInsert;

// Card layout preferences — lets each household member choose their own
// display order for the movable Trip Detail page cards (top trip-info card
// is always first and not reorderable). One row per user; `cardOrder` is the
// list of card ids in display order, whitelisted server-side before saving.
export const travelsCardLayoutPreferences = pgTable(
  "travels_card_layout_preferences",
  {
    userId: integer("user_id").primaryKey(),
    cardOrder: text("card_order")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type TravelsCardLayoutPreferencesRow =
  typeof travelsCardLayoutPreferences.$inferSelect;
export type InsertTravelsCardLayoutPreferences =
  typeof travelsCardLayoutPreferences.$inferInsert;

// Per-trip, per-user collapse state for Trip Detail page cards — lets each
// household member collapse cards they aren't using on a given trip (e.g.
// hide "Packing List" once packing is done) without affecting what other
// household members see, since trips themselves are shared.
export const travelsTripCardCollapseState = pgTable(
  "travels_trip_card_collapse_state",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    tripId: integer("trip_id").notNull(),
    collapsedCards: text("collapsed_cards")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("travels_trip_card_collapse_state_user_id_trip_id_idx").on(
      table.userId,
      table.tripId,
    ),
  ],
).enableRLS();

export type TravelsTripCardCollapseStateRow =
  typeof travelsTripCardCollapseState.$inferSelect;
export type InsertTravelsTripCardCollapseState =
  typeof travelsTripCardCollapseState.$inferInsert;

// User-defined custom document types — trained by the user to help the AI
// recognise new document categories not in the built-in list.
export const travelsCustomDocumentTypes = pgTable(
  "travels_custom_document_types",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    typeKey: text("type_key").notNull(),
    typeName: text("type_name").notNull(),
    description: text("description"),
    iconName: text("icon_name"),
    colorKey: text("color_key"),
    fields: jsonb("fields"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("travels_custom_document_types_user_id_type_key_idx").on(
      table.userId,
      table.typeKey,
    ),
    index("travels_custom_document_types_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type TravelsCustomDocumentTypeRow =
  typeof travelsCustomDocumentTypes.$inferSelect;
export type InsertTravelsCustomDocumentType =
  typeof travelsCustomDocumentTypes.$inferInsert;

// ── Packing Lists ─────────────────────────────────────────────────────────────
// One list per trip (auto-created on first use). Items are stored in
// travels_packing_items. Templates are reusable named lists stored separately.

export const travelsPackingLists = pgTable(
  "travels_packing_lists",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull().unique(),
    name: text("name").notNull().default("Packing List"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("travels_packing_lists_trip_id_idx").on(table.tripId)],
).enableRLS();

export type TravelsPackingListRow = typeof travelsPackingLists.$inferSelect;
export type InsertTravelsPackingList = typeof travelsPackingLists.$inferInsert;

export const travelsPackingItems = pgTable(
  "travels_packing_items",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id").notNull(),
    text: text("text").notNull(),
    packed: boolean("packed").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    addedByUserId: integer("added_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("travels_packing_items_list_id_idx").on(table.listId)],
).enableRLS();

export type TravelsPackingItemRow = typeof travelsPackingItems.$inferSelect;
export type InsertTravelsPackingItem = typeof travelsPackingItems.$inferInsert;

export const travelsPackingTemplates = pgTable(
  "travels_packing_templates",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    items: jsonb("items")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("travels_packing_templates_user_id_idx").on(table.userId)],
).enableRLS();

export type TravelsPackingTemplateRow =
  typeof travelsPackingTemplates.$inferSelect;
export type InsertTravelsPackingTemplate =
  typeof travelsPackingTemplates.$inferInsert;

export const travelsDocumentPages = pgTable(
  "travels_document_pages",
  {
    id: serial("id").primaryKey(),
    tripDocumentId: integer("trip_document_id")
      .notNull()
      .references(() => travelsTripDocuments.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull(),
    mediaType: text("media_type").notNull().default("application/pdf"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    extractedText: text("extracted_text"),
    ocrEngine: text("ocr_engine"),
    ocrEngineVersion: text("ocr_engine_version"),
    extractionStatus: text("extraction_status").notNull().default("pending"),
    extractionWarnings: text("extraction_warnings"),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_document_pages_doc_idx").on(table.tripDocumentId),
    uniqueIndex("travels_document_pages_doc_page_idx").on(
      table.tripDocumentId,
      table.pageIndex,
    ),
  ],
).enableRLS();

export type TravelsDocumentPageRow = typeof travelsDocumentPages.$inferSelect;
export type InsertTravelsDocumentPage =
  typeof travelsDocumentPages.$inferInsert;

export const travelsDocumentFieldEvidence = pgTable(
  "travels_document_field_evidence",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    documentPageId: integer("document_page_id"),
    evidenceKind: text("evidence_kind").notNull(),
    textStart: integer("text_start"),
    textEnd: integer("text_end"),
    bbox: jsonb("bbox"),
    snippet: text("snippet"),
    ocrConfidence: numeric("ocr_confidence", { precision: 5, scale: 4 }),
    evidenceHash: text("evidence_hash"),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    effectiveTimestamp: timestamp("effective_timestamp", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_document_field_evidence_candidate_idx").on(
      table.candidateId,
    ),
    index("travels_document_field_evidence_page_idx").on(table.documentPageId),
  ],
).enableRLS();

export type TravelsDocumentFieldEvidenceRow =
  typeof travelsDocumentFieldEvidence.$inferSelect;
export type InsertTravelsDocumentFieldEvidence =
  typeof travelsDocumentFieldEvidence.$inferInsert;

export const travelsFieldConflicts = pgTable(
  "travels_field_conflicts",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id")
      .notNull()
      .references(() => travelsTrips.id, { onDelete: "cascade" }),
    fieldPath: text("field_path").notNull(),
    acceptedCandidateId: integer("accepted_candidate_id"),
    acceptedValue: jsonb("accepted_value"),
    competingCandidateIds: jsonb("competing_candidate_ids")
      .notNull()
      .$type<number[]>()
      .default([]),
    conflictType: text("conflict_type").notNull(),
    recommendedCandidateId: integer("recommended_candidate_id"),
    recommendedRationale: text("recommended_rationale"),
    status: text("status").notNull().default("open"),
    decidingUserId: integer("deciding_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_field_conflicts_trip_idx").on(table.tripId),
    index("travels_field_conflicts_status_idx").on(table.status),
    index("travels_field_conflicts_field_path_idx").on(table.fieldPath),
  ],
).enableRLS();

export type TravelsFieldConflictRow = typeof travelsFieldConflicts.$inferSelect;
export type InsertTravelsFieldConflict =
  typeof travelsFieldConflicts.$inferInsert;

// ─── Disruption Monitoring (#238) ─────────────────────────────────────────

export const travelsReservations = pgTable(
  "travels_reservations",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id")
      .notNull()
      .references(() => travelsTrips.id, { onDelete: "cascade" }),
    documentId: integer("document_id"),
    reservationType: text("reservation_type").notNull().default("general"),
    status: text("status").notNull().default("confirmed"),
    providerName: text("provider_name"),
    confirmationRef: text("confirmation_ref"),
    passengerNames: jsonb("passenger_names").$type<string[]>().default([]),
    segments: jsonb("segments").$type<Record<string, unknown>[]>().default([]),
    checkInDate: date("check_in_date"),
    checkOutDate: date("check_out_date"),
    destinationIata: text("destination_iata"),
    originIata: text("origin_iata"),
    rawExtracted: jsonb("raw_extracted")
      .$type<Record<string, unknown>>()
      .default({}),
    monitoringEnabled: boolean("monitoring_enabled").notNull().default(true),
    monitoringPolicy: text("monitoring_policy").notNull().default("standard"),
    lastBaselineAt: timestamp("last_baseline_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_reservations_trip_idx").on(table.tripId),
    index("travels_reservations_type_idx").on(table.reservationType),
    index("travels_reservations_status_idx").on(table.status),
  ],
).enableRLS();

export type TravelsReservationRow = typeof travelsReservations.$inferSelect;
export type InsertTravelsReservation = typeof travelsReservations.$inferInsert;

export const travelMonitoringBaselines = pgTable(
  "travel_monitoring_baselines",
  {
    id: serial("id").primaryKey(),
    reservationId: integer("reservation_id")
      .notNull()
      .references(() => travelsReservations.id, { onDelete: "cascade" }),
    normalizedData: jsonb("normalized_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    schemaVersion: text("schema_version").notNull().default("1"),
    contentHash: text("content_hash"),
    confirmedBy: text("confirmed_by").notNull().default("auto"),
    confirmedByUserId: integer("confirmed_by_user_id"),
    sourceRefs: jsonb("source_refs").$type<string[]>().default([]),
    effectiveAt: timestamp("effective_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travel_monitoring_baselines_reservation_idx").on(
      table.reservationId,
    ),
    index("travel_monitoring_baselines_effective_at_idx").on(table.effectiveAt),
  ],
).enableRLS();

export type TravelMonitoringBaselineRow =
  typeof travelMonitoringBaselines.$inferSelect;
export type InsertTravelMonitoringBaseline =
  typeof travelMonitoringBaselines.$inferInsert;

export const travelMonitoringObservations = pgTable(
  "travel_monitoring_observations",
  {
    id: serial("id").primaryKey(),
    reservationId: integer("reservation_id")
      .notNull()
      .references(() => travelsReservations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalRecordId: text("external_record_id"),
    observedData: jsonb("observed_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    contentHash: text("content_hash"),
    authority: text("authority").notNull().default("document"),
    rawSnapshot: jsonb("raw_snapshot")
      .$type<Record<string, unknown>>()
      .default({}),
    jobId: integer("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travel_monitoring_observations_reservation_idx").on(
      table.reservationId,
    ),
    index("travel_monitoring_observations_observed_at_idx").on(
      table.observedAt,
    ),
  ],
).enableRLS();

export type TravelMonitoringObservationRow =
  typeof travelMonitoringObservations.$inferSelect;
export type InsertTravelMonitoringObservation =
  typeof travelMonitoringObservations.$inferInsert;

export const travelChangeEvents = pgTable(
  "travel_change_events",
  {
    id: serial("id").primaryKey(),
    reservationId: integer("reservation_id")
      .notNull()
      .references(() => travelsReservations.id, { onDelete: "cascade" }),
    baselineId: integer("baseline_id"),
    previousObservationId: integer("previous_observation_id"),
    newObservationId: integer("new_observation_id"),
    changeType: text("change_type").notNull(),
    severity: text("severity").notNull().default("informational"),
    fieldDiffs: jsonb("field_diffs")
      .$type<
        Array<{
          field: string;
          before: unknown;
          after: unknown;
          reason?: string;
        }>
      >()
      .notNull()
      .default([]),
    materialityReason: text("materiality_reason"),
    downstreamImpacts: jsonb("downstream_impacts")
      .$type<string[]>()
      .default([]),
    state: text("state").notNull().default("detected"),
    decidedByUserId: integer("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNotes: text("decision_notes"),
    notificationEventId: integer("notification_event_id"),
    dedupKey: text("dedup_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travel_change_events_reservation_idx").on(table.reservationId),
    index("travel_change_events_state_idx").on(table.state),
    index("travel_change_events_severity_idx").on(table.severity),
  ],
).enableRLS();

export type TravelChangeEventRow = typeof travelChangeEvents.$inferSelect;
export type InsertTravelChangeEvent = typeof travelChangeEvents.$inferInsert;

export const travelsMonitoringPreferences = pgTable(
  "travels_monitoring_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    monitoringEnabled: boolean("monitoring_enabled").notNull().default(true),
    weatherAlerts: boolean("weather_alerts").notNull().default(true),
    checkInReminders: boolean("check_in_reminders").notNull().default(true),
    documentReminders: boolean("document_reminders").notNull().default(true),
    minSeverity: text("min_severity").notNull().default("attention"),
    notifyChannels: jsonb("notify_channels")
      .$type<{ inApp: boolean; email: boolean }>()
      .notNull()
      .default({ inApp: true, email: false }),
    scheduleChangeThresholdMinutes: integer("schedule_change_threshold_minutes")
      .notNull()
      .default(30),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("travels_monitoring_prefs_user_idx").on(table.userId)],
).enableRLS();

export type TravelsMonitoringPreferencesRow =
  typeof travelsMonitoringPreferences.$inferSelect;
export type InsertTravelsMonitoringPreferences =
  typeof travelsMonitoringPreferences.$inferInsert;
