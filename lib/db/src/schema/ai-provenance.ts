import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { appJobs, externalOperationEvents } from "./operations";
import { appUsers } from "./users";

export const aiGenerationRuns = pgTable(
  "ai_generation_runs",
  {
    id: serial("id").primaryKey(),
    module: text("module").notNull(),
    feature: text("feature").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id"),
    jobId: integer("job_id").references(() => appJobs.id, {
      onDelete: "set null",
    }),
    operationEventId: integer("operation_event_id").references(
      () => externalOperationEvents.id,
      { onDelete: "set null" },
    ),
    userId: integer("user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelProviderRunId: text("model_provider_run_id"),
    promptTemplateId: text("prompt_template_id"),
    promptVersionHash: text("prompt_version_hash"),
    toolSchemaVersion: integer("tool_schema_version").notNull().default(1),
    inputArtifactHashes: jsonb("input_artifact_hashes")
      .notNull()
      .$type<string[]>()
      .default([]),
    status: text("status").notNull().default("pending"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_generation_runs_target_idx").on(table.targetType, table.targetId),
    index("ai_generation_runs_module_feature_idx").on(
      table.module,
      table.feature,
    ),
    index("ai_generation_runs_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

export type AiGenerationRun = typeof aiGenerationRuns.$inferSelect;
export type InsertAiGenerationRun = typeof aiGenerationRuns.$inferInsert;

export const aiFieldCandidates = pgTable(
  "ai_field_candidates",
  {
    id: serial("id").primaryKey(),
    generationRunId: integer("generation_run_id")
      .notNull()
      .references(() => aiGenerationRuns.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id"),
    fieldPath: text("field_path").notNull(),
    candidateValue: jsonb("candidate_value"),
    normalizedValueHash: text("normalized_value_hash"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    confidenceMethod: text("confidence_method"),
    authorityClass: text("authority_class").notNull().default("vision"),
    sourceReferences: jsonb("source_references")
      .notNull()
      .$type<Record<string, unknown>[]>()
      .default([]),
    disposition: text("disposition").notNull().default("proposed"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_field_candidates_run_idx").on(table.generationRunId),
    index("ai_field_candidates_target_field_idx").on(
      table.targetType,
      table.targetId,
      table.fieldPath,
    ),
    index("ai_field_candidates_disposition_idx").on(table.disposition),
  ],
).enableRLS();

export type AiFieldCandidate = typeof aiFieldCandidates.$inferSelect;
export type InsertAiFieldCandidate = typeof aiFieldCandidates.$inferInsert;

export const aiFieldDecisions = pgTable(
  "ai_field_decisions",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => aiFieldCandidates.id, { onDelete: "cascade" }),
    decidingUserId: integer("deciding_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    decisionType: text("decision_type").notNull(),
    priorValue: jsonb("prior_value"),
    finalValue: jsonb("final_value"),
    correctionCategory: text("correction_category"),
    contextSource: text("context_source").notNull().default("manual_edit"),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_field_decisions_candidate_idx").on(table.candidateId),
    index("ai_field_decisions_user_idx").on(table.decidingUserId),
  ],
).enableRLS();

export type AiFieldDecision = typeof aiFieldDecisions.$inferSelect;
export type InsertAiFieldDecision = typeof aiFieldDecisions.$inferInsert;
