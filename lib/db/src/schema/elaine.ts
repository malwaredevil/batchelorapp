import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  numeric,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── Elaine — shared AI assistant, used identically across Pottery, Quilting,
// Travels, and the hub ───────────────────────────────────────────────────────
//
// Unlike the old travels-only implementation (travels_assistant_*, now
// dropped), these tables are NOT namespaced per-app: Elaine keeps one
// continuous conversation and memory per user across every surface of the
// Batchelor app. Individual write-actions are still scoped per-app by the
// executor that runs them (pottery/quilting stay strictly per-account;
// travels stays household-shared) — this schema only holds the
// conversation/settings/memory/nudge state, not app data.

// One ongoing conversation per user that follows them across every app.
// "New conversation" just clears messages back to [].
export const elaineConversations = pgTable("elaine_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  messages: jsonb("messages")
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ElaineConversationRow = typeof elaineConversations.$inferSelect;
export type InsertElaineConversation = typeof elaineConversations.$inferInsert;

// Per-user on/off preference for Elaine (default on), plus how she should
// confirm multi-action turns: "one_by_one" (default, safest), "all_at_once",
// or "auto_run" (no confirmation — she just does them and reports back).
// `chatWindowSize` controls the floating widget popup's desktop dimensions
// ("compact" default, "comfortable", "large") — mobile always fills the
// available width regardless of this setting.
export const elaineSettings = pgTable("elaine_settings", {
  userId: integer("user_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  actionConfirmationMode: text("action_confirmation_mode")
    .notNull()
    .default("one_by_one"),
  chatWindowSize: text("chat_window_size").notNull().default("compact"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ElaineSettingsRow = typeof elaineSettings.$inferSelect;
export type InsertElaineSettings = typeof elaineSettings.$inferInsert;

// Shared household memory — facts Elaine has learned from any family member
// that are relevant across the whole Batchelor app, not siloed per-user.
// Populated by the assistant itself via a remember_household_fact tool call.
//
// Scoped memory model (#240):
//   scope = 'household'  — visible to all authenticated household members
//   scope = 'personal'   — visible only to owner_user_id
//   scope = 'temporary'  — auto-expires at expires_at (or 30 days by default)
//
// category: fact | preference | instruction | person | place | collection
// sensitivity: low | medium | high
export const elaineMemory = pgTable("elaine_memory", {
  id: serial("id").primaryKey(),
  // 'fact'    — an explicit fact stored by the remember/correct flows
  // 'summary' — a per-user prose continuity summary updated after each turn
  type: text("type").notNull().default("fact"),
  content: text("content").notNull(),
  scope: text("scope").notNull().default("household"),
  category: text("category").notNull().default("fact"),
  sensitivity: text("sensitivity").notNull().default("low"),
  ownerUserId: integer("owner_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  source: text("source").notNull().default("legacy"),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  confidence: numeric("confidence", { precision: 4, scale: 3 })
    .notNull()
    .default("0.500"),
  correctionOfId: integer("correction_of_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ElaineMemoryRow = typeof elaineMemory.$inferSelect;
export type InsertElaineMemory = typeof elaineMemory.$inferInsert;

// Append-only audit trail for explicit remember/correct/forget operations.
// Event metadata is deliberately small and sanitized; memory contents remain
// on the memory row and are never copied into this ledger.
export const elaineMemoryEvents = pgTable(
  "elaine_memory_events",
  {
    id: serial("id").primaryKey(),
    memoryId: integer("memory_id").references(() => elaineMemory.id, {
      onDelete: "set null",
    }),
    previousMemoryId: integer("previous_memory_id"),
    userId: integer("user_id").notNull(),
    action: text("action").notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_memory_events_memory_idx").on(table.memoryId),
    index("elaine_memory_events_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
).enableRLS();

export type ElaineMemoryEventRow = typeof elaineMemoryEvents.$inferSelect;
export type InsertElaineMemoryEvent = typeof elaineMemoryEvents.$inferInsert;

// Proactive nudges — messages Elaine generates unprompted (e.g. "your trip
// starts in 2 days and the packing list is empty"), produced by scheduled
// jobs rather than in response to a chat turn. `sourceApp`/`sourceId` record
// which app/entity (if any) the nudge is about, for a future "open this"
// affordance — nullable since not every nudge is app/entity specific.
// `nudgeKey` is a stable dedup key per condition instance so a job never
// nags about the same thing twice; unique on (user_id, nudge_key) makes
// inserts idempotent via ON CONFLICT DO NOTHING.
export const elaineNudges = pgTable(
  "elaine_nudges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    sourceApp: text("source_app"),
    sourceId: integer("source_id"),
    nudgeKey: text("nudge_key").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => [
    index("elaine_nudges_user_id_idx").on(table.userId),
    index("elaine_nudges_user_id_seen_at_idx").on(table.userId, table.seenAt),
    uniqueIndex("elaine_nudges_user_id_nudge_key_idx").on(
      table.userId,
      table.nudgeKey,
    ),
  ],
).enableRLS();

export type ElaineNudgeRow = typeof elaineNudges.$inferSelect;
export type InsertElaineNudge = typeof elaineNudges.$inferInsert;

// Single-row (id fixed at 1) global config, editable only by the app owner.
// Originally Elaine-only (chatModel/subagentModel/requestTimeoutMs/
// maxResponseTokens); now doubles as the whole Batchelor app's global AI
// configuration (models, timeouts, feature toggles, thresholds) used by
// Pottery, Quilting, and Travels as well — table name kept as-is since
// renaming it would not be an additive-only migration. The four grouped
// JSONB columns are intentionally loosely-typed at the DB layer: the app-side
// resolver (`lib/global-config.ts`) deep-merges whatever is stored here over
// a full set of hardcoded defaults, so adding a new configurable key never
// requires a migration or breaks on a partially-populated row.
export const elaineGlobalConfig = pgTable("elaine_global_config", {
  id: integer("id").primaryKey().default(1),
  chatModel: text("chat_model").notNull().default("google/gemini-2.5-flash"),
  subagentModel: text("subagent_model").notNull().default("z-ai/glm-5.2"),
  requestTimeoutMs: integer("request_timeout_ms").notNull().default(12000),
  maxResponseTokens: integer("max_response_tokens").notNull().default(700),
  // Every other OpenRouter/Voyage/Jina model slot used anywhere in the app
  // (fast/smart vision, advisor, research, expert-panel-alt, embedding,
  // reranker, visual classifier, Fusion panel + judge).
  extraModels: jsonb("extra_models")
    .notNull()
    .default(sql`'{}'::jsonb`),
  // Per-feature request timeouts other than the main chat one above (expert
  // consult, reranker, geocoding).
  timeouts: jsonb("timeouts")
    .notNull()
    .default(sql`'{}'::jsonb`),
  // Boolean toggles: enable Advisor escalation, enable Subagent delegation,
  // enable Fusion for the pottery-expert and travel-doc-extraction fallback
  // tiers.
  features: jsonb("features")
    .notNull()
    .default(sql`'{}'::jsonb`),
  // Numeric thresholds and per-feature max_tokens caps: pottery similarity
  // bands, image crop ratios, JPEG quality, etc.
  thresholds: jsonb("thresholds")
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedByUserId: integer("updated_by_user_id"),
}).enableRLS();

export type ElaineGlobalConfigRow = typeof elaineGlobalConfig.$inferSelect;
export type InsertElaineGlobalConfig = typeof elaineGlobalConfig.$inferInsert;

// Named conversation history — one row per saved conversation.
// These are distinct from `elaineConversations` (the single-threaded rolling
// history) and power the multi-conversation sidebar in the Elaine app.
// Messages live in elaine_history_messages below.
export const elaineHistoryConversations = pgTable(
  "elaine_history_conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    // When true, this conversation is the shared household widget thread used
    // by the embedded chat widget across all apps. At most one row per user
    // may have isWidgetDefault=true (enforced by a partial unique index in
    // schema-statements.ts).
    isWidgetDefault: boolean("is_widget_default").notNull().default(false),
    // Cached summary of older messages when the thread exceeds 40 turns.
    // summarizedUpToId is the elaineHistoryMessages.id of the last message
    // covered by the summary — used to detect when the cache is stale.
    summary: text("summary"),
    summarizedUpToId: integer("summarized_up_to_id"),
    // Durable pointer to OpenAI's retained Responses context. Local message
    // history remains authoritative and is used to rebuild state if this
    // nullable provider pointer is stale, expired, disabled, or unavailable.
    openaiLastResponseId: text("openai_last_response_id"),
    openaiStateModel: text("openai_state_model"),
    openaiStateUpdatedAt: timestamp("openai_state_updated_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_history_conversations_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
).enableRLS();

export type ElaineHistoryConversationRow =
  typeof elaineHistoryConversations.$inferSelect;
export type InsertElaineHistoryConversation =
  typeof elaineHistoryConversations.$inferInsert;

// One message per row for a named conversation.
// `attachment_urls` stores public Supabase Storage URLs for any images the
// user attached to a user message (empty array for assistant messages and
// unattached user messages).
export const elaineHistoryMessages = pgTable(
  "elaine_history_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => elaineHistoryConversations.id, {
        onDelete: "cascade",
      }),
    userId: integer("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    attachmentUrls: jsonb("attachment_urls")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Model-produced reasoning summary for the assistant turn, null for user
     *  messages and older rows written before this column existed. */
    reasoningSummary: text("reasoning_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_history_messages_conversation_id_idx").on(
      table.conversationId,
    ),
  ],
).enableRLS();

export type ElaineHistoryMessageRow = typeof elaineHistoryMessages.$inferSelect;
export type InsertElaineHistoryMessage =
  typeof elaineHistoryMessages.$inferInsert;

// Sanitized, structured runtime telemetry for one Elaine turn. The plan and
// events contain concise user-safe labels/status/evidence summaries only —
// never raw prompts, chain-of-thought, unrestricted tool payloads, provider
// errors, or secrets. The row is optional at runtime so chat remains usable if
// trace persistence is temporarily unavailable during a rolling deployment.
export const elaineTurnTraces = pgTable(
  "elaine_turn_traces",
  {
    id: uuid("id").primaryKey(),
    userId: integer("user_id").notNull(),
    conversationId: integer("conversation_id").references(
      () => elaineHistoryConversations.id,
      { onDelete: "cascade" },
    ),
    assistantMessageId: integer("assistant_message_id").references(
      () => elaineHistoryMessages.id,
      { onDelete: "cascade" },
    ),
    channel: text("channel").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    requestClass: jsonb("request_class")
      .notNull()
      .default(sql`'{}'::jsonb`),
    goal: text("goal").notNull().default(""),
    plan: jsonb("plan")
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceRoute: jsonb("source_route"),
    observations: jsonb("observations")
      .notNull()
      .default(sql`'[]'::jsonb`),
    events: jsonb("events")
      .notNull()
      .default(sql`'[]'::jsonb`),
    verification: jsonb("verification"),
    status: text("status").notNull().default("running"),
    model: text("model"),
    traceAvailable: boolean("trace_available").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("elaine_turn_traces_user_started_idx").on(
      table.userId,
      table.startedAt,
    ),
    index("elaine_turn_traces_conversation_started_idx").on(
      table.conversationId,
      table.startedAt,
    ),
    uniqueIndex("elaine_turn_traces_assistant_message_idx").on(
      table.assistantMessageId,
    ),
  ],
).enableRLS();

export type ElaineTurnTraceRow = typeof elaineTurnTraces.$inferSelect;
export type InsertElaineTurnTrace = typeof elaineTurnTraces.$inferInsert;

// Durable future-action scheduler — Elaine writes a row here when the user
// asks her to call or message someone "at a time" in the future. A background
// job polls every minute and fires any due row, then marks it fired/failed.
// Rows are scoped to the user who initiated them; cancel sets status='cancelled'.
export const elaineScheduledActions = pgTable(
  "elaine_scheduled_actions",
  {
    id: serial("id").primaryKey(),
    scheduledFor: timestamp("scheduled_for", {
      withTimezone: true,
    }).notNull(),
    actionType: text("action_type").notNull(),
    actionPayload: jsonb("action_payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    initiatedByUserId: integer("initiated_by_user_id").notNull(),
    targetContactId: integer("target_contact_id"),
    // pending → fired (success) | failed (error) | cancelled (user-cancelled)
    status: text("status").notNull().default("pending"),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_scheduled_actions_status_scheduled_for_idx").on(
      table.status,
      table.scheduledFor,
    ),
    index("elaine_scheduled_actions_user_id_idx").on(
      table.initiatedByUserId,
    ),
  ],
).enableRLS();

export type ElaineScheduledActionRow =
  typeof elaineScheduledActions.$inferSelect;
export type InsertElaineScheduledAction =
  typeof elaineScheduledActions.$inferInsert;

// Daily morning brief — one personalised summary per user per UTC day.
// Cached in this table; dismissed flag hides the card until regenerated.
export const elaineDailyBriefs = pgTable("elaine_daily_briefs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  dismissed: boolean("dismissed").notNull().default(false),
}).enableRLS();

export type ElaineDailyBriefRow = typeof elaineDailyBriefs.$inferSelect;
export type InsertElaineDailyBrief = typeof elaineDailyBriefs.$inferInsert;
