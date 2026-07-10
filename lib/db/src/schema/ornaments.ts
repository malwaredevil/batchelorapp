import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  numeric,
  timestamp,
  index,
  vector,
  primaryKey,
} from "drizzle-orm/pg-core";

export const ornamentsItems = pgTable(
  "ornaments_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    name: text("name").notNull(),
    brand: text("brand").notNull().default("Hallmark"),
    seriesOrCollection: text("series_or_collection"),
    year: integer("year"),
    barcodeValue: text("barcode_value"),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),
    dimensions: text("dimensions"),
    condition: text("condition"),
    origin: text("origin"),
    acquiredAt: date("acquired_at"),
    aiDescription: text("ai_description"),
    dominantColors: text("dominant_colors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    motifs: text("motifs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    imagePath: text("image_path").notNull(),
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    bookValue: numeric("book_value", { precision: 10, scale: 2 }),
    bookValueSource: text("book_value_source"),
    bookValueUpdatedAt: timestamp("book_value_updated_at", {
      withTimezone: true,
    }),
    embedding: vector("embedding", { dimensions: 1536 }),
    visualEmbedding: vector("visual_embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ornaments_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("ornaments_visual_embedding_idx").using(
      "hnsw",
      table.visualEmbedding.op("vector_cosine_ops"),
    ),
    index("ornaments_items_user_id_idx").on(table.userId),
    index("ornaments_items_series_idx").on(table.seriesOrCollection),
  ],
).enableRLS();

export type OrnamentItemRow = typeof ornamentsItems.$inferSelect;
export type InsertOrnamentItem = typeof ornamentsItems.$inferInsert;

export const ornamentsCategories = pgTable("ornaments_categories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  bgColor: text("bg_color"),
  textColor: text("text_color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export const ornamentsItemCategories = pgTable(
  "ornaments_item_categories",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => ornamentsItems.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => ornamentsCategories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.categoryId] }),
    index("ornaments_item_categories_category_id_idx").on(table.categoryId),
  ],
).enableRLS();

/**
 * Supplemental images for an ornament — additional angles, box/tag shots,
 * etc. The primary image stays on ornaments_items.image_path.
 */
export const ornamentsImages = pgTable(
  "ornaments_images",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => ornamentsItems.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    label: text("label"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("ornaments_images_item_idx").on(table.itemId)],
).enableRLS();

/**
 * Per-UPC cache of UPCitemdb barcode lookups so repeat scans of the same
 * ornament (or ornaments bought in multiples) don't re-hit the outside API.
 */
export const ornamentsBarcodeCache = pgTable("ornaments_barcode_cache", {
  barcode: text("barcode").primaryKey(),
  found: integer("found").notNull().default(0),
  name: text("name"),
  brand: text("brand"),
  seriesOrCollection: text("series_or_collection"),
  year: integer("year"),
  description: text("description"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

/**
 * Household-shared major Hallmark collector events (Keepsake Ornament
 * Premiere / Open House, etc). The app's own source of truth for display
 * and editing; googleEventId links to a best-effort mirrored event on the
 * designated shared "Hallmark" calendar (travels_connected_calendars,
 * is_hallmark_calendar = true) when one exists.
 */
export const ornamentsHallmarkEvents = pgTable(
  "ornaments_hallmark_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    title: text("title").notNull(),
    description: text("description"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    googleEventId: text("google_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ornaments_hallmark_events_start_date_idx").on(table.startDate),
  ],
).enableRLS();

export type OrnamentHallmarkEventRow =
  typeof ornamentsHallmarkEvents.$inferSelect;
export type InsertOrnamentHallmarkEvent =
  typeof ornamentsHallmarkEvents.$inferInsert;

export type OrnamentCategoryRow = typeof ornamentsCategories.$inferSelect;
export type OrnamentItemCategoryRow =
  typeof ornamentsItemCategories.$inferSelect;
export type OrnamentImageRow = typeof ornamentsImages.$inferSelect;
export type InsertOrnamentImage = typeof ornamentsImages.$inferInsert;
export type OrnamentBarcodeCacheRow = typeof ornamentsBarcodeCache.$inferSelect;
