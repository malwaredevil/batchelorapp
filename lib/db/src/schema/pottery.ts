import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  index,
  vector,
  primaryKey,
} from "drizzle-orm/pg-core";

export const potteryItems = pgTable(
  "pottery_items",
  {
    id: serial("id").primaryKey(),
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
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("pottery_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
).enableRLS();

export type PotteryItemRow = typeof potteryItems.$inferSelect;
export type InsertPotteryItem = typeof potteryItems.$inferInsert;

export const potteryCategories = pgTable("pottery_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
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
