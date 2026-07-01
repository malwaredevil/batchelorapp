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
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("travels_trip_photos_trip_id_idx").on(table.tripId),
    index("travels_trip_photos_user_id_idx").on(table.userId),
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
