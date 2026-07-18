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

export type OrnamentCategoryRow = typeof ornamentsCategories.$inferSelect;
export type OrnamentItemCategoryRow =
  typeof ornamentsItemCategories.$inferSelect;
export type OrnamentImageRow = typeof ornamentsImages.$inferSelect;
export type InsertOrnamentImage = typeof ornamentsImages.$inferInsert;
export type OrnamentBarcodeCacheRow = typeof ornamentsBarcodeCache.$inferSelect;

// ---------------------------------------------------------------------------
// Canonical series catalog — distinct from household ownership
// ---------------------------------------------------------------------------

/**
 * Known ornament series (e.g. "Hallmark Keepsake - Frosty Friends").
 * Household-shared; rows are catalog data, not per-user.
 */
export const ornamentSeries = pgTable(
  "ornament_series",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    brand: text("brand").notNull().default("Hallmark"),
    description: text("description"),
    startYear: integer("start_year"),
    endYear: integer("end_year"),
    isActive: boolean("is_active").notNull().default(true),
    totalKnownEntries: integer("total_known_entries"),
    sourceUrl: text("source_url"),
    sourceAuthority: text("source_authority"),
    isProvisional: boolean("is_provisional").notNull().default(false),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ornament_series_brand_idx").on(table.brand),
    index("ornament_series_name_idx").on(table.name),
  ],
).enableRLS();

export type OrnamentSeriesRow = typeof ornamentSeries.$inferSelect;
export type InsertOrnamentSeries = typeof ornamentSeries.$inferInsert;

/**
 * Individual entries within a series (e.g. "Frosty Friends #1 — 1980").
 */
export const ornamentSeriesEntries = pgTable(
  "ornament_series_entries",
  {
    id: serial("id").primaryKey(),
    seriesId: integer("series_id")
      .notNull()
      .references(() => ornamentSeries.id, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number"),
    year: integer("year").notNull(),
    officialName: text("official_name").notNull(),
    catalogNumber: text("catalog_number"),
    upc: text("upc"),
    artist: text("artist"),
    retailPriceUsd: numeric("retail_price_usd", { precision: 10, scale: 2 }),
    releaseType: text("release_type"),
    isExclusive: boolean("is_exclusive").notNull().default(false),
    notes: text("notes"),
    sourceUrl: text("source_url"),
    isProvisional: boolean("is_provisional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ornament_series_entries_series_idx").on(table.seriesId),
    index("ornament_series_entries_year_idx").on(table.year),
    index("ornament_series_entries_catalog_idx").on(table.catalogNumber),
  ],
).enableRLS();

export type OrnamentSeriesEntryRow = typeof ornamentSeriesEntries.$inferSelect;
export type InsertOrnamentSeriesEntry =
  typeof ornamentSeriesEntries.$inferInsert;

/**
 * Links a household ornament item to a canonical series entry.
 * One item may be linked to one entry; one entry may be owned in multiples.
 */
export const ornamentItemSeriesLinks = pgTable(
  "ornament_item_series_links",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => ornamentsItems.id, { onDelete: "cascade" }),
    seriesEntryId: integer("series_entry_id")
      .notNull()
      .references(() => ornamentSeriesEntries.id, { onDelete: "restrict" }),
    confirmedByUserId: integer("confirmed_by_user_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confidence: text("confidence").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId] }),
    index("ornament_item_series_links_entry_idx").on(table.seriesEntryId),
  ],
).enableRLS();

export type OrnamentItemSeriesLinkRow =
  typeof ornamentItemSeriesLinks.$inferSelect;

// ---------------------------------------------------------------------------
// Identity research — candidates and decisions
// ---------------------------------------------------------------------------

/**
 * Persisted identity-research results for an ornament item.
 * Each research run produces a ranked list of candidates.
 */
export const ornamentIdentityResearch = pgTable(
  "ornament_identity_research",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => ornamentsItems.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    candidates: jsonb("candidates")
      .notNull()
      .default(sql`'[]'::jsonb`),
    selectedCandidateIndex: integer("selected_candidate_index"),
    decidedByUserId: integer("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("ornament_identity_research_item_idx").on(table.itemId)],
).enableRLS();

export type OrnamentIdentityResearchRow =
  typeof ornamentIdentityResearch.$inferSelect;
