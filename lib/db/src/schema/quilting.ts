import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  real,
  text,
  date,
  timestamp,
  index,
  vector,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Categories (styled tags shared across all quilting entity types)
// ---------------------------------------------------------------------------

export const quiltingCategories = pgTable("quilting_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  bgColor: text("bg_color"),
  textColor: text("text_color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type QuiltingCategoryRow = typeof quiltingCategories.$inferSelect;

// ---------------------------------------------------------------------------
// Fabrics
// ---------------------------------------------------------------------------

export const fabrics = pgTable(
  "quilting_fabrics",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    lineName: text("line_name"),
    designer: text("designer"),
    manufacturer: text("manufacturer"),
    colorway: text("colorway"),
    printType: text("print_type"),
    fiberContent: text("fiber_content"),
    widthInches: real("width_inches"),
    quantity: real("quantity").notNull().default(1),
    quantityUnit: text("quantity_unit").notNull().default("yards"),
    sku: text("sku"),
    notes: text("notes"),
    aiDescription: text("ai_description"),
    dominantColors: text("dominant_colors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    motifs: text("motifs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    styleDescriptors: text("style_descriptors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    imagePath: text("image_path").notNull(),
    acquiredAt: date("acquired_at"),
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    embedding: vector("embedding", { dimensions: 1536 }),
    visualEmbedding: vector("visual_embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_fabrics_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("quilting_fabrics_visual_embedding_idx").using(
      "hnsw",
      table.visualEmbedding.op("vector_cosine_ops"),
    ),
  ],
).enableRLS();

export type FabricRow = typeof fabrics.$inferSelect;
export type InsertFabric = typeof fabrics.$inferInsert;

// ---------------------------------------------------------------------------
// Quilt Patterns
// ---------------------------------------------------------------------------

export const quiltPatterns = pgTable(
  "quilting_patterns",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    designer: text("designer"),
    blockSize: text("block_size"),
    difficulty: text("difficulty"),
    sourceType: text("source_type"),
    sourceReference: text("source_reference"),
    notes: text("notes"),
    imagePath: text("image_path"),
    acquiredAt: date("acquired_at"),
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    embedding: vector("embedding", { dimensions: 1536 }),
    visualEmbedding: vector("visual_embedding", { dimensions: 1024 }),
    designerBio: text("designer_bio"),
    designerWebsite: text("designer_website"),
    publicationName: text("publication_name"),
    publicationYear: text("publication_year"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_patterns_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("quilting_patterns_visual_embedding_idx").using(
      "hnsw",
      table.visualEmbedding.op("vector_cosine_ops"),
    ),
  ],
).enableRLS();

export type QuiltPatternRow = typeof quiltPatterns.$inferSelect;
export type InsertQuiltPattern = typeof quiltPatterns.$inferInsert;

// ---------------------------------------------------------------------------
// Finished Quilts
// ---------------------------------------------------------------------------

export const finishedQuilts = pgTable("quilting_finished_quilts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  dateCompleted: date("date_completed"),
  sizeWidth: real("size_width"),
  sizeHeight: real("size_height"),
  recipient: text("recipient"),
  notes: text("notes"),
  imagePath: text("image_path").notNull(),
  lockedFields: text("locked_fields")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type FinishedQuiltRow = typeof finishedQuilts.$inferSelect;
export type InsertFinishedQuilt = typeof finishedQuilts.$inferInsert;

// ---------------------------------------------------------------------------
// Quilt ↔ Fabric links (which fabrics were used in a finished quilt)
// ---------------------------------------------------------------------------

export const quiltFabricLinks = pgTable(
  "quilting_fabric_links",
  {
    quiltId: integer("quilt_id")
      .notNull()
      .references(() => finishedQuilts.id, { onDelete: "cascade" }),
    fabricId: integer("fabric_id")
      .notNull()
      .references(() => fabrics.id, { onDelete: "cascade" }),
    notes: text("notes"),
  },
  (table) => [
    primaryKey({ columns: [table.quiltId, table.fabricId] }),
    index("quilting_fabric_links_fabric_idx").on(table.fabricId),
  ],
).enableRLS();

export type QuiltFabricLinkRow = typeof quiltFabricLinks.$inferSelect;

// ---------------------------------------------------------------------------
// Quilt ↔ Pattern links (which pattern a finished quilt used)
// ---------------------------------------------------------------------------

export const quiltPatternLinks = pgTable(
  "quilting_pattern_links",
  {
    quiltId: integer("quilt_id")
      .notNull()
      .references(() => finishedQuilts.id, { onDelete: "cascade" }),
    patternId: integer("pattern_id")
      .notNull()
      .references(() => quiltPatterns.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.quiltId, table.patternId] }),
    index("quilting_pattern_links_pattern_idx").on(table.patternId),
  ],
).enableRLS();

export type QuiltPatternLinkRow = typeof quiltPatternLinks.$inferSelect;

// ---------------------------------------------------------------------------
// Polymorphic category join — works across fabrics, patterns, and quilts
// entityType: 'fabric' | 'pattern' | 'quilt'
// ---------------------------------------------------------------------------

export const entityCategories = pgTable(
  "quilting_entity_categories",
  {
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => quiltingCategories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.entityType, table.entityId, table.categoryId],
    }),
    index("quilting_entity_categories_cat_idx").on(table.categoryId),
    index("quilting_entity_categories_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  ],
).enableRLS();

export type EntityCategoryRow = typeof entityCategories.$inferSelect;

// ---------------------------------------------------------------------------
// Supplemental images — polymorphic, works across all entity types
// entityType: 'fabric' | 'pattern' | 'quilt'
// ---------------------------------------------------------------------------

export const quiltingImages = pgTable(
  "quilting_images",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    storagePath: text("storage_path").notNull(),
    label: text("label"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_images_entity_idx").on(table.entityType, table.entityId),
  ],
).enableRLS();

export type QuiltingImageRow = typeof quiltingImages.$inferSelect;
export type InsertQuiltingImage = typeof quiltingImages.$inferInsert;

// ---------------------------------------------------------------------------
// Block Designs (pattern designer)
// ---------------------------------------------------------------------------

export const blocks = pgTable("quilting_blocks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  gridSize: integer("grid_size").notNull().default(8),
  cells: text("cells")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Physical finished size of the entire block in inches (e.g. 12 for a 12" block). Null = not set. */
  blockSizeInches: real("block_size_inches"),
  /** Seam allowance per side in inches (e.g. 0.25 for ¼" standard). Null = use app default (0.25). */
  seamAllowanceInches: real("seam_allowance_inches"),
  /** H/V seam lines drawn in the block designer. Array of {axis,pos,cellIdx,clipStart?,clipEnd?}. */
  seams: jsonb("seams")
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type BlockRow = typeof blocks.$inferSelect;
export type InsertBlock = typeof blocks.$inferInsert;

// ---------------------------------------------------------------------------
// Quilt Layouts (layout composer)
// ---------------------------------------------------------------------------

export const layouts = pgTable("quilting_layouts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rows: integer("rows").notNull().default(5),
  cols: integer("cols").notNull().default(5),
  cells: jsonb("cells")
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Sashing strip width in inches. Null = no sashing. */
  sashingWidthInches: real("sashing_width_inches"),
  /** Hex colour for sashing strips (e.g. "#d4c5a9"). Null = UI default. */
  sashingColor: text("sashing_color"),
  /** Outer border width in inches. Null = no border. */
  borderWidthInches: real("border_width_inches"),
  /** Hex colour for outer border. Null = same as sashing / UI default. */
  borderColor: text("border_color"),
  /** Hex colour for cornerstone squares at sashing intersections. Null = no cornerstones. */
  cornerstoneColor: text("cornerstone_color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type LayoutRow = typeof layouts.$inferSelect;
export type InsertLayout = typeof layouts.$inferInsert;

// ---------------------------------------------------------------------------
// Shopping list & budget tracker
// ---------------------------------------------------------------------------

export const shoppingItems = pgTable("quilting_shopping_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  url: text("url"),
  quantity: real("quantity"),
  unit: text("unit").default("yards"),
  estimatedPriceUsd: real("estimated_price_usd"),
  actualPriceUsd: real("actual_price_usd"),
  store: text("store"),
  status: text("status").notNull().default("want"),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ShoppingItemRow = typeof shoppingItems.$inferSelect;
export type InsertShoppingItem = typeof shoppingItems.$inferInsert;
