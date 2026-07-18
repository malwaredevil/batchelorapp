import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  vector,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";

export const potteryItems = pgTable(
  "pottery_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),
    dimensions: text("dimensions"),
    patternDescription: text("pattern_description"),
    style: text("style"),
    shape: text("shape"),
    maker: text("maker"),
    makerInfo: text("maker_info"),
    dominantColors: text("dominant_colors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    motifs: text("motifs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    imagePath: text("image_path").notNull(),
    patternCropPath: text("pattern_crop_path"),
    acquiredAt: date("acquired_at"),
    condition: text("condition"),
    origin: text("origin"),
    approximateEra: text("approximate_era"),
    aiDescription: text("ai_description"),
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    glazeType: text("glaze_type"),
    surfaceZones: jsonb("surface_zones"),
    embedding: vector("embedding", { dimensions: 1536 }),
    visualEmbedding: vector("visual_embedding", { dimensions: 1024 }),
    zoneEmbedding: vector("zone_embedding", { dimensions: 1024 }),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("pottery_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("pottery_visual_embedding_idx").using(
      "hnsw",
      table.visualEmbedding.op("vector_cosine_ops"),
    ),
    index("pottery_zone_embedding_idx").using(
      "hnsw",
      table.zoneEmbedding.op("vector_cosine_ops"),
    ),
    index("pottery_items_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type PotteryItemRow = typeof potteryItems.$inferSelect;
export type InsertPotteryItem = typeof potteryItems.$inferInsert;

export const potteryCategories = pgTable("pottery_categories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  bgColor: text("bg_color"),
  textColor: text("text_color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export const potteryItemCategories = pgTable(
  "pottery_item_categories",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => potteryItems.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => potteryCategories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.categoryId] }),
    index("item_categories_category_id_idx").on(table.categoryId),
  ],
).enableRLS();

/**
 * Supplemental images for a pottery piece — additional angles, detail shots,
 * maker's marks, etc.  The primary image stays on pottery_items.image_path.
 */
export const potteryImages = pgTable(
  "pottery_images",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => potteryItems.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    label: text("label"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("pottery_images_item_idx").on(table.itemId)],
).enableRLS();

export type PotteryCategoryRow = typeof potteryCategories.$inferSelect;
export type PotteryItemCategoryRow = typeof potteryItemCategories.$inferSelect;
export type PotteryImageRow = typeof potteryImages.$inferSelect;
export type InsertPotteryImage = typeof potteryImages.$inferInsert;

// ---------------------------------------------------------------------------
// Marketplace watchlist (#249)
// ---------------------------------------------------------------------------

/**
 * Persistent saved search for a piece the household wants to acquire.
 * A background job periodically runs the search on eBay/Etsy and creates
 * alerts when new matching listings appear.
 */
export const potteryWatchlistItems = pgTable(
  "pottery_watchlist_items",
  {
    id: serial("id").primaryKey(),
    createdByUserId: integer("created_by_user_id"),
    title: text("title").notNull(),
    keywords: text("keywords").notNull(),
    priceMinUsd: numeric("price_min_usd", { precision: 10, scale: 2 }),
    priceMaxUsd: numeric("price_max_usd", { precision: 10, scale: 2 }),
    active: boolean("active").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("pottery_watchlist_active_idx").on(table.active),
    index("pottery_watchlist_user_idx").on(table.createdByUserId),
  ],
).enableRLS();

/**
 * Individual alert rows — one per matching listing found by the background job.
 */
export const potteryWatchlistAlerts = pgTable(
  "pottery_watchlist_alerts",
  {
    id: serial("id").primaryKey(),
    watchlistItemId: integer("watchlist_item_id")
      .notNull()
      .references(() => potteryWatchlistItems.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    listingId: text("listing_id").notNull(),
    title: text("title").notNull(),
    priceUsd: numeric("price_usd", { precision: 10, scale: 2 }),
    condition: text("condition"),
    imageUrl: text("image_url"),
    listingUrl: text("listing_url").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
    dismissed: boolean("dismissed").notNull().default(false),
  },
  (table) => [
    uniqueIndex("pottery_watchlist_alerts_dedup_idx").on(
      table.watchlistItemId,
      table.platform,
      table.listingId,
    ),
    index("pottery_watchlist_alerts_item_idx").on(table.watchlistItemId),
  ],
).enableRLS();

export type PotteryWatchlistItemRow = typeof potteryWatchlistItems.$inferSelect;
export type InsertPotteryWatchlistItem =
  typeof potteryWatchlistItems.$inferInsert;
export type PotteryWatchlistAlertRow =
  typeof potteryWatchlistAlerts.$inferSelect;
export type InsertPotteryWatchlistAlert =
  typeof potteryWatchlistAlerts.$inferInsert;
