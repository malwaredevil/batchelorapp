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
    hasRentalCar: boolean("has_rental_car").notNull().default(false),
    accommodationName: text("accommodation_name"),
    accommodationArea: text("accommodation_area"),
    notes: text("notes"),
    travellerCount: integer("traveller_count").notNull().default(2),
    itinerary: jsonb("itinerary"),
    packingList: jsonb("packing_list"),
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
