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
