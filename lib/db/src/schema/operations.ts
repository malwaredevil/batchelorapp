import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
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
import { appUsers } from "./users";

export const appSchemaMigrations = pgTable("app_schema_migrations", {
  version: bigint("version", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  appliedBy: text("applied_by"),
  executionMs: integer("execution_ms"),
  appCommitSha: text("app_commit_sha"),
}).enableRLS();

export const appJobs = pgTable(
  "app_jobs",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    queue: text("queue").notNull().default("default"),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    payloadSchemaVersion: integer("payload_schema_version")
      .notNull()
      .default(1),
    idempotencyKey: text("idempotency_key"),
    createdByUserId: integer("created_by_user_id").references(
      () => appUsers.id,
      {
        onDelete: "set null",
      },
    ),
    domain: text("domain"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .defaultNow()
      .notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    progressPercent: integer("progress_percent").notNull().default(0),
    progressMessage: text("progress_message"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    providerRequestId: text("provider_request_id"),
    parentJobId: integer("parent_job_id"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("app_jobs_status_scheduled_idx").on(t.status, t.scheduledFor),
    index("app_jobs_type_status_idx").on(t.type, t.status),
    index("app_jobs_parent_idx").on(t.parentJobId),
    uniqueIndex("app_jobs_idempotency_idx").on(t.type, t.idempotencyKey),
  ],
).enableRLS();

export const appJobAttempts = pgTable(
  "app_job_attempts",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => appJobs.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("app_job_attempts_job_idx").on(t.jobId)],
).enableRLS();

export const externalOperationEvents = pgTable(
  "external_operation_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    modelOrActor: text("model_or_actor"),
    feature: text("feature").notNull(),
    module: text("module").notNull(),
    userId: integer("user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    requestId: text("request_id"),
    jobId: integer("job_id").references(() => appJobs.id, {
      onDelete: "set null",
    }),
    parentJobId: integer("parent_job_id"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    retryCount: integer("retry_count").notNull().default(0),
    cacheStatus: text("cache_status").notNull().default("not_applicable"),
    inputUnits: integer("input_units"),
    outputUnits: integer("output_units"),
    billedUnits: numeric("billed_units", { precision: 18, scale: 6 }),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 18,
      scale: 8,
    }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 18, scale: 8 }),
    currency: text("currency").notNull().default("USD"),
    pricingVersionAt: timestamp("pricing_version_at", { withTimezone: true }),
    providerRequestId: text("provider_request_id"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("external_operation_events_provider_created_idx").on(
      t.provider,
      t.createdAt,
    ),
    index("external_operation_events_job_idx").on(t.jobId),
    index("external_operation_events_module_feature_idx").on(
      t.module,
      t.feature,
    ),
  ],
).enableRLS();

export const externalProviderPricing = pgTable(
  "external_provider_pricing",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    modelOrActor: text("model_or_actor"),
    unitType: text("unit_type").notNull(),
    priceUsd: numeric("price_usd", { precision: 18, scale: 8 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .defaultNow()
      .notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("external_provider_pricing_lookup_idx").on(
      t.provider,
      t.operation,
      t.modelOrActor,
      t.effectiveFrom,
    ),
  ],
).enableRLS();

export const externalBudgetPolicies = pgTable(
  "external_budget_policies",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    scopeValue: text("scope_value"),
    period: text("period").notNull(),
    softThresholdUsd: numeric("soft_threshold_usd", {
      precision: 18,
      scale: 2,
    }).notNull(),
    hardThresholdUsd: numeric("hard_threshold_usd", {
      precision: 18,
      scale: 2,
    }).notNull(),
    warningPolicy: text("warning_policy").notNull().default("owner_dashboard"),
    degradationAction: text("degradation_action")
      .notNull()
      .default("warn_only"),
    enabled: boolean("enabled").notNull().default(true),
    overrideUntil: timestamp("override_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("external_budget_policies_scope_idx").on(t.scope, t.scopeValue),
  ],
).enableRLS();

export type AppJob = typeof appJobs.$inferSelect;
export type InsertAppJob = typeof appJobs.$inferInsert;
export type ExternalOperationEvent =
  typeof externalOperationEvents.$inferSelect;

export const householdActivityLog = pgTable(
  "household_activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    actorUserId: integer("actor_user_id").references(() => appUsers.id),
    actorChannel: text("actor_channel").notNull(),
    actionType: text("action_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    entityLabel: text("entity_label"),
    payload: jsonb("payload"),
    reversible: boolean("reversible").notNull().default(false),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (table) => [
    index("household_activity_log_occurred_at_idx").on(table.occurredAt),
    index("household_activity_log_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  ],
).enableRLS();

export type HouseholdActivityLogRow = typeof householdActivityLog.$inferSelect;
export type InsertHouseholdActivityLog =
  typeof householdActivityLog.$inferInsert;

// ── Daily comms check ─────────────────────────────────────────────────────────
// One row per owner-local calendar day.
// Tracks send + verification status for each channel independently.
// Status values: 'pending' | 'sending' | 'sent' | 'error' | 'verified'
export const commChecks = pgTable("comm_checks", {
  id: serial("id").primaryKey(),
  checkDate: text("check_date").notNull().unique(),
  emailStatus: text("email_status").notNull().default("pending"),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailError: text("email_error"),
  smsStatus: text("sms_status").notNull().default("pending"),
  smsSentAt: timestamp("sms_sent_at", { withTimezone: true }),
  smsVerifiedAt: timestamp("sms_verified_at", { withTimezone: true }),
  smsError: text("sms_error"),
  slackStatus: text("slack_status").notNull().default("pending"),
  slackSentAt: timestamp("slack_sent_at", { withTimezone: true }),
  slackVerifiedAt: timestamp("slack_verified_at", { withTimezone: true }),
  slackError: text("slack_error"),
  // Phone call lane — fires at 19:00 Stuttgart. No verified_at: call placed = success.
  phoneStatus: text("phone_status").notNull().default("pending"),
  phoneSentAt: timestamp("phone_sent_at", { withTimezone: true }),
  phoneError: text("phone_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type CommCheckRow = typeof commChecks.$inferSelect;

// ── Integrations health state ─────────────────────────────────────────────────
// Persists per-service consecutive-error counts across scheduled cron runs so
// the stateless scheduled-deployment path can apply the same two-strike alert
// gate as the in-process scheduler. No RLS: admin/ops data, not user-scoped.
export const integrationsHealthState = pgTable("integrations_health_state", {
  service: text("service").primaryKey(),
  consecutiveErrorCount: integer("consecutive_error_count")
    .notNull()
    .default(0),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type IntegrationsHealthStateRow =
  typeof integrationsHealthState.$inferSelect;

// ── Sentry seen issues ────────────────────────────────────────────────────────
// Dedup ledger for proactive Sentry error nudges. One row per Sentry issue id
// that has ever been announced to the owner. `lastStatus` tracks whether the
// issue was last observed unresolved or resolved in Sentry — an issue that
// reappears in the unresolved list after being marked resolved has "reopened"
// and is announced again. No RLS: admin/ops data, not user-scoped.
export const sentrySeenIssues = pgTable("sentry_seen_issues", {
  issueId: text("issue_id").primaryKey(),
  lastStatus: text("last_status").notNull().default("unresolved"),
  // Incremented each time the issue is (re-)announced, so a reopen gets a
  // distinct nudge key even within the same UTC day.
  alertGeneration: integer("alert_generation").notNull().default(1),
  firstAlertedAt: timestamp("first_alerted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type SentrySeenIssueRow = typeof sentrySeenIssues.$inferSelect;
