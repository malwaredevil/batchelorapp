import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { appJobs } from "./operations";
import { appUsers } from "./users";

export const ingestionSources = pgTable(
  "ingestion_sources",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    adapterType: text("adapter_type").notNull(),
    adapterConfig: jsonb("adapter_config")
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),
    configSchemaVersion: integer("config_schema_version").notNull().default(1),
    module: text("module").notNull(),
    feature: text("feature"),
    enabled: boolean("enabled").notNull().default(true),
    ownerNotes: text("owner_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ingestion_sources_slug_idx").on(table.slug),
    index("ingestion_sources_module_idx").on(table.module),
  ],
).enableRLS();

export type IngestionSource = typeof ingestionSources.$inferSelect;
export type InsertIngestionSource = typeof ingestionSources.$inferInsert;

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => ingestionSources.id, { onDelete: "cascade" }),
    jobId: integer("job_id").references(() => appJobs.id, {
      onDelete: "set null",
    }),
    triggeredBy: integer("triggered_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    triggerType: text("trigger_type").notNull().default("manual"),
    status: text("status").notNull().default("pending"),
    itemsFetched: integer("items_fetched").notNull().default(0),
    itemsMatched: integer("items_matched").notNull().default(0),
    itemsMerged: integer("items_merged").notNull().default(0),
    itemsRejected: integer("items_rejected").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ingestion_runs_source_idx").on(table.sourceId),
    index("ingestion_runs_status_idx").on(table.status),
    index("ingestion_runs_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type InsertIngestionRun = typeof ingestionRuns.$inferInsert;

export const ingestionCandidates = pgTable(
  "ingestion_candidates",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => ingestionSources.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    targetType: text("target_type"),
    targetId: integer("target_id"),
    normalizedData: jsonb("normalized_data")
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    status: text("status").notNull().default("pending"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ingestion_candidates_run_idx").on(table.runId),
    index("ingestion_candidates_target_idx").on(
      table.targetType,
      table.targetId,
    ),
    index("ingestion_candidates_status_idx").on(table.status),
    uniqueIndex("ingestion_candidates_source_key_idx").on(
      table.sourceId,
      table.sourceKey,
    ),
  ],
).enableRLS();

export type IngestionCandidate = typeof ingestionCandidates.$inferSelect;
export type InsertIngestionCandidate = typeof ingestionCandidates.$inferInsert;
