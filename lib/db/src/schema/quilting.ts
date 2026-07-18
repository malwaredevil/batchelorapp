import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  real,
  smallint,
  text,
  date,
  timestamp,
  index,
  vector,
  primaryKey,
  jsonb,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Categories (styled tags scoped per user)
// ---------------------------------------------------------------------------

export const quiltingCategories = pgTable("quilting_categories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
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
    userId: integer("user_id"),
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
    index("quilting_fabrics_user_id_idx").on(table.userId),
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
    userId: integer("user_id"),
    name: text("name").notNull(),
    designer: text("designer"),
    blockSize: text("block_size"),
    difficulty: text("difficulty"),
    sourceType: text("source_type"),
    sourceReference: text("source_reference"),
    notes: text("notes"),
    imagePath: text("image_path"),
    acquiredAt: date("acquired_at"),
    dominantColors: text("dominant_colors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    index("quilting_patterns_user_id_idx").on(table.userId),
  ],
).enableRLS();

export type QuiltPatternRow = typeof quiltPatterns.$inferSelect;
export type InsertQuiltPattern = typeof quiltPatterns.$inferInsert;

// ---------------------------------------------------------------------------
// Finished Quilts
// ---------------------------------------------------------------------------

export const finishedQuilts = pgTable("quilting_finished_quilts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  dateCompleted: date("date_completed"),
  sizeWidth: real("size_width"),
  sizeHeight: real("size_height"),
  recipient: text("recipient"),
  notes: text("notes"),
  imagePath: text("image_path").notNull(),
  dominantColors: text("dominant_colors")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  lockedFields: text("locked_fields")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  completionPercentage: smallint("completion_percentage").default(0),
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
  userId: integer("user_id"),
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
// Block Templates (reusable library snapshots)
// ---------------------------------------------------------------------------

export const blockTemplates = pgTable("quilting_block_templates", {
  id: serial("id").primaryKey(),
  /** Attribution only — household-shared (not a filter). */
  createdByUserId: integer("created_by_user_id"),
  name: text("name").notNull(),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  gridW: integer("grid_w").notNull().default(8),
  gridH: integer("grid_h").notNull().default(8),
  cells: text("cells")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  seams: jsonb("seams")
    .notNull()
    .default(sql`'[]'::jsonb`),
  blockSizeInches: real("block_size_inches"),
  seamAllowanceInches: real("seam_allowance_inches"),
  /** Pre-rendered SVG thumbnail string, generated client-side on save. */
  thumbnailSvg: text("thumbnail_svg"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type BlockTemplateRow = typeof blockTemplates.$inferSelect;
export type InsertBlockTemplate = typeof blockTemplates.$inferInsert;

// ---------------------------------------------------------------------------
// Quilt Layouts (layout composer)
// ---------------------------------------------------------------------------

export const layouts = pgTable("quilting_layouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  etsyPriceSuggestionUsd: real("etsy_price_suggestion_usd"),
  etsyPriceCachedAt: timestamp("etsy_price_cached_at", {
    withTimezone: true,
  }),
  etsyPriceListings: jsonb("etsy_price_listings"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ShoppingItemRow = typeof shoppingItems.$inferSelect;
export type InsertShoppingItem = typeof shoppingItems.$inferInsert;

// ---------------------------------------------------------------------------
// Fabric external identifiers / aliases
// ---------------------------------------------------------------------------

/**
 * External product identifiers for fabrics (SKU, manufacturer reference, etc.).
 * Supports confirmed identity links to manufacturer/retailer databases.
 */
export const fabricIdentifiers = pgTable(
  "quilting_fabric_identifiers",
  {
    id: serial("id").primaryKey(),
    fabricId: integer("fabric_id")
      .notNull()
      .references(() => fabrics.id, { onDelete: "cascade" }),
    identifierType: text("identifier_type").notNull(),
    identifierValue: text("identifier_value").notNull(),
    sourceUrl: text("source_url"),
    confirmedByUserId: integer("confirmed_by_user_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confidence: text("confidence").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_fabric_identifiers_fabric_idx").on(table.fabricId),
    index("quilting_fabric_identifiers_type_val_idx").on(
      table.identifierType,
      table.identifierValue,
    ),
  ],
).enableRLS();

export type FabricIdentifierRow = typeof fabricIdentifiers.$inferSelect;
export type InsertFabricIdentifier = typeof fabricIdentifiers.$inferInsert;

// ---------------------------------------------------------------------------
// Pattern requirements — size variants and fabric requirements
// ---------------------------------------------------------------------------

/**
 * A size/variant of a pattern (e.g. "Lap 60×72", "King 108×108").
 */
export const patternVariants = pgTable(
  "quilting_pattern_variants",
  {
    id: serial("id").primaryKey(),
    patternId: integer("pattern_id")
      .notNull()
      .references(() => quiltPatterns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    finishedWidth: real("finished_width"),
    finishedHeight: real("finished_height"),
    sizeUnit: text("size_unit").notNull().default("inches"),
    blockCount: integer("block_count"),
    skillLevel: text("skill_level"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_pattern_variants_pattern_idx").on(table.patternId),
  ],
).enableRLS();

export type PatternVariantRow = typeof patternVariants.$inferSelect;
export type InsertPatternVariant = typeof patternVariants.$inferInsert;

/**
 * Individual fabric requirements for a pattern variant.
 * Each row is one fabric role (e.g. "Background", "Accent A", "Binding").
 */
export const patternRequirements = pgTable(
  "quilting_pattern_requirements",
  {
    id: serial("id").primaryKey(),
    variantId: integer("variant_id")
      .notNull()
      .references(() => patternVariants.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    colorDescription: text("color_description"),
    quantityYards: real("quantity_yards"),
    quantityFatQuarters: real("quantity_fat_quarters"),
    widthAssumptionInches: real("width_assumption_inches").default(44),
    seamAllowanceInches: real("seam_allowance_inches").default(0.25),
    notes: text("notes"),
    isExtracted: boolean("is_extracted").notNull().default(false),
    extractionConfidence: text("extraction_confidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_pattern_requirements_variant_idx").on(table.variantId),
  ],
).enableRLS();

export type PatternRequirementRow = typeof patternRequirements.$inferSelect;
export type InsertPatternRequirement = typeof patternRequirements.$inferInsert;

// ---------------------------------------------------------------------------
// "Can I make this?" analysis runs
// ---------------------------------------------------------------------------

/**
 * A single "Can I make this?" analysis comparing a pattern variant against
 * the current stash. Results are immutable once created — re-run creates a
 * new row.
 */
export const quiltingAnalyses = pgTable(
  "quilting_analyses",
  {
    id: serial("id").primaryKey(),
    patternId: integer("pattern_id")
      .notNull()
      .references(() => quiltPatterns.id, { onDelete: "cascade" }),
    variantId: integer("variant_id").references(() => patternVariants.id, {
      onDelete: "set null",
    }),
    createdByUserId: integer("created_by_user_id"),
    status: text("status").notNull().default("pending"),
    readiness: text("readiness"),
    stashSnapshotAt: timestamp("stash_snapshot_at", { withTimezone: true }),
    assumptions: jsonb("assumptions")
      .notNull()
      .default(sql`'{}'::jsonb`),
    requirementRows: jsonb("requirement_rows")
      .notNull()
      .default(sql`'[]'::jsonb`),
    shoppingProposal: jsonb("shopping_proposal")
      .notNull()
      .default(sql`'[]'::jsonb`),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedByUserId: integer("applied_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quilting_analyses_pattern_idx").on(table.patternId),
    index("quilting_analyses_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export type QuiltingAnalysisRow = typeof quiltingAnalyses.$inferSelect;
export type InsertQuiltingAnalysis = typeof quiltingAnalyses.$inferInsert;

// ---------------------------------------------------------------------------
// Fabric identity research — candidates and decisions
// ---------------------------------------------------------------------------

export const fabricIdentityResearch = pgTable(
  "quilting_fabric_identity_research",
  {
    id: serial("id").primaryKey(),
    fabricId: integer("fabric_id")
      .notNull()
      .references(() => fabrics.id, { onDelete: "cascade" }),
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
  (table) => [
    index("quilting_fabric_identity_research_fabric_idx").on(table.fabricId),
  ],
).enableRLS();

export type FabricIdentityResearchRow =
  typeof fabricIdentityResearch.$inferSelect;
export type InsertFabricIdentityResearch =
  typeof fabricIdentityResearch.$inferInsert;
