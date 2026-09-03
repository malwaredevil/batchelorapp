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
  boolean,
  jsonb,
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
    origin: text("origin"),
    acquiredAt: date("acquired_at"),
    // Verbatim text transcribed from the printed description on the back of
    // the ornament's box (or entered/looked-up manually) — NOT AI-authored.
    // Contrast with aiDescription below, which is an AI-written blurb.
    description: text("description"),
    // True when `description` above could not be transcribed from a real
    // box-back photo (no legible printed text found) and was instead written
    // by the AI as a stand-in. False for manual entries, verbatim
    // transcriptions, and catalog/barcode-lookup descriptions.
    descriptionGenerated: boolean("description_generated")
      .notNull()
      .default(false),
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
    // Original retail/MSRP value (distinct from bookValue, which is the
    // collector/secondary-market value) — looked up via a grounded web
    // search for "what is the retail value of hallmark ornament <name>
    // <year>", plus a link to the official product page when one is found.
    retailValueUsd: numeric("retail_value_usd", { precision: 10, scale: 2 }),
    retailValueProductUrl: text("retail_value_product_url"),
    retailValueSource: text("retail_value_source"),
    retailValueUpdatedAt: timestamp("retail_value_updated_at", {
      withTimezone: true,
    }),
    ebayPriceMinUsd: numeric("ebay_price_min_usd", { precision: 10, scale: 2 }),
    ebayPriceMaxUsd: numeric("ebay_price_max_usd", { precision: 10, scale: 2 }),
    ebayPriceMedianUsd: numeric("ebay_price_median_usd", {
      precision: 10,
      scale: 2,
    }),
    ebayPriceCachedAt: timestamp("ebay_price_cached_at", {
      withTimezone: true,
    }),
    ebayPriceListings: jsonb("ebay_price_listings"),
    ebayLastSoldPriceUsd: numeric("ebay_last_sold_price_usd", {
      precision: 10,
      scale: 2,
    }),
    ebayLastSoldDate: timestamp("ebay_last_sold_date", { withTimezone: true }),
    aiAppraisal: text("ai_appraisal"),
    aiAppraisalUpdatedAt: timestamp("ai_appraisal_updated_at", {
      withTimezone: true,
    }),
    embedding: vector("embedding", { dimensions: 1536 }),
    visualEmbedding: vector("visual_embedding", { dimensions: 1024 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    index("ornaments_items_name_trgm_idx")
      .using("gin", table.name.op("gin_trgm_ops"))
      .where(sql`${table.deletedAt} IS NULL`),
    index("ornaments_items_series_trgm_idx")
      .using("gin", table.seriesOrCollection.op("gin_trgm_ops"))
      .where(sql`${table.deletedAt} IS NULL`),
    index("ornaments_items_brand_trgm_idx")
      .using("gin", table.brand.op("gin_trgm_ops"))
      .where(sql`${table.deletedAt} IS NULL`),
    index("ornaments_items_notes_trgm_idx")
      .using("gin", table.notes.op("gin_trgm_ops"))
      .where(sql`${table.deletedAt} IS NULL`),
    index("ornaments_items_description_trgm_idx")
      .using("gin", table.description.op("gin_trgm_ops"))
      .where(sql`${table.deletedAt} IS NULL`),
    index("ornaments_items_ai_description_trgm_idx")
      .using("gin", table.aiDescription.op("gin_trgm_ops"))
      .where(sql`${table.deletedAt} IS NULL`),
    index("ornaments_items_user_id_idx").on(table.userId),
    index("ornaments_items_series_idx").on(table.seriesOrCollection),
  ],
).enableRLS();

export type OrnamentItemRow = typeof ornamentsItems.$inferSelect;
export type InsertOrnamentItem = typeof ornamentsItems.$inferInsert;

export const ornamentsCategories = pgTable("ornaments_categories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull().unique(),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("ornaments_images_item_idx").on(table.itemId)],
).enableRLS();

export type OrnamentCategoryRow = typeof ornamentsCategories.$inferSelect;
export type OrnamentItemCategoryRow =
  typeof ornamentsItemCategories.$inferSelect;
export type OrnamentImageRow = typeof ornamentsImages.$inferSelect;
export type InsertOrnamentImage = typeof ornamentsImages.$inferInsert;
