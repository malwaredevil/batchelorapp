/**
 * Market intelligence schema (#234).
 *
 * Stores cross-module market observations (raw price sightings), aggregated
 * valuations, and user-defined watch rules. Module-agnostic by design — works
 * for pottery, ornaments, quilting, or any future module.
 */

import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ── Raw market observations ────────────────────────────────────────────────────
// One row per sighted price/listing from any source (Apify scrape, REST feed,
// manual entry, etc.). Linked to an ingestion candidate when the observation
// arrived via the ingestion pipeline.

export const marketObservations = pgTable(
  "market_observations",
  {
    id: serial("id").primaryKey(),
    module: text("module").notNull(),
    itemType: text("item_type").notNull(),
    itemId: integer("item_id"),
    ingestionCandidateId: integer("ingestion_candidate_id"),
    platform: text("platform").notNull(),
    listingUrl: text("listing_url"),
    listingTitle: text("listing_title"),
    observedPrice: numeric("observed_price", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    condition: text("condition"),
    listingStatus: text("listing_status").notNull().default("active"),
    listedAt: timestamp("listed_at", { withTimezone: true }),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    sourceJson: jsonb("source_json"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("market_observations_module_item_idx").on(
      table.module,
      table.itemType,
      table.itemId,
    ),
    index("market_observations_platform_idx").on(table.platform),
    index("market_observations_status_idx").on(table.listingStatus),
    index("market_observations_created_at_idx").on(table.createdAt),
    index("market_observations_candidate_idx").on(table.ingestionCandidateId),
  ],
).enableRLS();

export type MarketObservation = typeof marketObservations.$inferSelect;
export type InsertMarketObservation = typeof marketObservations.$inferInsert;

// ── Market valuations ──────────────────────────────────────────────────────────
// Derived value estimates computed from a batch of observations.
// A new row is inserted each time we recompute; use the latest row per item.

export const marketValuations = pgTable(
  "market_valuations",
  {
    id: serial("id").primaryKey(),
    module: text("module").notNull(),
    itemType: text("item_type").notNull(),
    itemId: integer("item_id"),
    valuationMethod: text("valuation_method").notNull().default("median"),
    estimatedValue: numeric("estimated_value", {
      precision: 12,
      scale: 2,
    }).notNull(),
    valueLow: numeric("value_low", { precision: 12, scale: 2 }),
    valueHigh: numeric("value_high", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    sampleSize: integer("sample_size"),
    observationIds: jsonb("observation_ids").$type<number[]>(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    notes: text("notes"),
    createdBy: integer("created_by"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("market_valuations_module_item_idx").on(
      table.module,
      table.itemType,
      table.itemId,
    ),
    index("market_valuations_computed_at_idx").on(table.computedAt),
  ],
).enableRLS();

export type MarketValuation = typeof marketValuations.$inferSelect;
export type InsertMarketValuation = typeof marketValuations.$inferInsert;

// ── Market watches ─────────────────────────────────────────────────────────────
// User-configured watch targets. A watch can track a specific item or a
// free-text search query across one or more platforms.

export const marketWatches = pgTable(
  "market_watches",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    module: text("module").notNull(),
    itemType: text("item_type"),
    itemId: integer("item_id"),
    searchQuery: text("search_query"),
    platforms: jsonb("platforms").$type<string[]>().default([]),
    enabled: boolean("enabled").notNull().default(true),
    alertThresholdLow: numeric("alert_threshold_low", {
      precision: 12,
      scale: 2,
    }),
    alertThresholdHigh: numeric("alert_threshold_high", {
      precision: 12,
      scale: 2,
    }),
    alertCurrency: text("alert_currency").notNull().default("USD"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("market_watches_user_idx").on(table.userId),
    index("market_watches_module_item_idx").on(
      table.module,
      table.itemType,
      table.itemId,
    ),
    index("market_watches_enabled_idx").on(table.enabled),
  ],
).enableRLS();

export type MarketWatch = typeof marketWatches.$inferSelect;
export type InsertMarketWatch = typeof marketWatches.$inferInsert;
