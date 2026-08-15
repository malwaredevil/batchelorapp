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

// Elaine's own operational memory — distinct from elaine_memory above, which
// stores HOUSEHOLD FACTS ("the dog's name is Rex"). This table stores
// lessons about ELAINE'S OWN PAST BEHAVIOR: something she got wrong and how
// it was corrected, or an approach that worked well and is worth repeating.
// Never conflate the two when reading or writing.
//
// Written today only via an explicit remember_lesson tool call in web chat
// (see RECORD_LESSON_TOOL_NAME in planner-tool-catalog.ts); a future
// self-heal flow may also write here when Elaine detects her own wrong
// outcome without being told. Read-side retrieval
// (getRelevantElaineLessons in lib/elaine-lessons.ts) ranks and caps the
// rows so the prompt only ever sees a small relevant slice, not the whole
// table — kept bounded/tagged rather than an unbounded free-text dump.
export const elaineLessons = pgTable(
  "elaine_lessons",
  {
    id: serial("id").primaryKey(),
    // 'mistake' — something Elaine got wrong that was corrected
    // 'success' — an approach that worked well and is worth repeating
    outcome: text("outcome").notNull(),
    // Conventional-but-freeform bucket ("travels", "reminders", "memory",
    // "general", ...) used to narrow candidates before ranking by text
    // relevance — validated against ELAINE_LESSON_DOMAINS at the write layer.
    domain: text("domain").notNull().default("general"),
    // What was attempted / the situation that produced the outcome.
    situation: text("situation").notNull(),
    // Short, reusable takeaway to apply next time a similar situation arises.
    takeaway: text("takeaway").notNull(),
    // Extra freeform keywords for retrieval beyond the domain bucket.
    tags: jsonb("tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    // 'explicit_assistant' — Elaine recorded it herself mid-conversation
    // 'explicit_user'      — the user asked Elaine to remember the lesson
    // 'self_heal'          — a self-detected-correction flow wrote this
    source: text("source").notNull().default("explicit_assistant"),
    // How many times this exact (userId, outcome, situation, takeaway)
    // lesson has recurred — starts at 1 on insert, incremented each time
    // recordElaineLesson's dedup path touches the row instead of inserting
    // a new one. Used by the code-diagnosis flow (#895) to decide when a
    // *behavioral* correction has recurred often enough that the real cause
    // is likely a gap in the code itself, not something a better prompt can
    // fix — see maybeDiagnoseRecurringFailure in lib/elaine-code-diagnosis.ts.
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_lessons_domain_active_idx").on(table.domain, table.active),
    index("elaine_lessons_created_at_idx").on(table.createdAt),
    index("elaine_lessons_user_active_idx").on(
      table.createdByUserId,
      table.active,
    ),
  ],
).enableRLS();

export type ElaineLessonRow = typeof elaineLessons.$inferSelect;
export type InsertElaineLesson = typeof elaineLessons.$inferInsert;

// Code-grounded diagnosis suggestions (#895) — materially different from
// both tables above:
//   - elaine_lessons is BEHAVIORAL memory, private to Elaine's own prompt
//     context: "I should ask before assuming X." It is never shown to a
//     human and never references actual source code.
//   - elaine_nudges is a proactive household FYI with no review workflow —
//     it just appears in chat and gets marked seen.
// This table is neither: when the *same* self-heal lesson has recurred at
// least a configured number of times (see
// thresholds.codeDiagnosisRecurrenceThreshold in lib/elaine-config.ts),
// Elaine is given a narrow, read-only, secret-excluding tool to look at the
// specific source file(s) tied to that failure pattern (see
// CODE_DIAGNOSIS_FILE_ALLOWLIST in lib/elaine-code-diagnosis.ts) and form a
// hypothesis grounded in the real code — not just a repeat of the
// behavioral lesson. Elaine never edits or ships code herself; this row is
// a suggestion a human reviews (accept/dismiss) in the Owner Panel and, if
// accepted, may turn into a real follow-up task. Nothing here is ever
// auto-applied.
export const elaineCodeSuggestions = pgTable(
  "elaine_code_suggestions",
  {
    id: serial("id").primaryKey(),
    // Stable identity for the recurring failure shape (e.g.
    // "self_heal:claimed_check_without_tool_call") — used both to look up
    // the narrow file allowlist for this pattern and to dedup/rate-limit:
    // only one 'pending' suggestion may exist per pattern key at a time
    // (enforced by a partial unique index in schema-statements.ts), so a
    // recurring issue doesn't spam a new suggestion on every occurrence
    // once one is already awaiting review.
    patternKey: text("pattern_key").notNull(),
    // The elaine_lessons row this suggestion was generated from. Nullable
    // (set null) since a lesson can later be edited/deactivated without
    // invalidating the historical suggestion record.
    lessonId: integer("lesson_id").references(() => elaineLessons.id, {
      onDelete: "set null",
    }),
    // Snapshot of the lesson's recurrence count at the moment this
    // suggestion was generated, for the reviewer's context.
    occurrenceCount: integer("occurrence_count").notNull(),
    // Plain-language description of the recurring failure pattern observed
    // (drawn from the lesson's situation/takeaway).
    observedPattern: text("observed_pattern").notNull(),
    // The specific file paths (relative to repo root) Elaine actually read
    // while forming this hypothesis — always a subset of the pattern's
    // allowlist, never arbitrary paths.
    filesReviewed: jsonb("files_reviewed")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Plain-language description of what Elaine thinks should change in the
    // code, grounded in the files reviewed above.
    hypothesis: text("hypothesis").notNull(),
    // 'pending' — awaiting owner review
    // 'accepted' — owner agreed there's a real gap worth acting on
    // 'dismissed' — owner reviewed and declined
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: integer("decided_by_user_id"),
    // Optional reference to the project task (e.g. "#920") the owner created
    // from this suggestion — populated via the owner panel's "link task" flow
    // after accepting. Null until the owner explicitly links one. Stored as a
    // short ref string so it can be displayed as "→ Task #NNN" in the panel.
    linkedTaskRef: text("linked_task_ref"),
  },
  (table) => [
    index("elaine_code_suggestions_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("elaine_code_suggestions_pattern_key_idx").on(table.patternKey),
  ],
).enableRLS();

export type ElaineCodeSuggestionRow = typeof elaineCodeSuggestions.$inferSelect;
export type InsertElaineCodeSuggestion =
  typeof elaineCodeSuggestions.$inferInsert;

// Code tasks (#913) — lightweight action items the owner creates from an
// accepted code-diagnosis suggestion with one click. These are distinct from
// the Replit agent task system (which is not reachable from the running app
// server) and from elaine_nudges / elaine_lessons. Each row has a stable
// sequential id that becomes the display ref shown in the panel as "#NNN".
// One suggestion may produce at most one task (enforced by the unique index
// on created_from_suggestion_id so re-clicking never duplicates).
export const elaineCodeTasks = pgTable(
  "elaine_code_tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // 'open' — created, not yet acted on
    // 'done' — owner has resolved the underlying code gap
    status: text("status").notNull().default("open"),
    createdFromSuggestionId: integer("created_from_suggestion_id").references(
      () => elaineCodeSuggestions.id,
      { onDelete: "set null" },
    ),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_code_tasks_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    uniqueIndex("elaine_code_tasks_suggestion_idx").on(
      table.createdFromSuggestionId,
    ),
  ],
).enableRLS();

export type ElaineCodeTaskRow = typeof elaineCodeTasks.$inferSelect;
export type InsertElaineCodeTask = typeof elaineCodeTasks.$inferInsert;

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
    // Ephemeral travel-companion location — the last place the user stated
    // they were in ("I'm in Gion", "just arrived in Kyoto"). Only meaningful
    // for Travels-app turns; never shown to other sessions or persisted beyond
    // this conversation. Cleared if a new explicit location is stated; kept
    // until then so the user doesn't have to repeat themselves every turn.
    statedLocation: text("stated_location"),
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
    /** Server-measured wall-clock duration (ms) of the reasoning phase for the
     *  assistant turn. Null for user messages, non-reasoning turns, and rows
     *  written before this column was added. */
    reasoningDurationMs: integer("reasoning_duration_ms"),
    /** Channel the message came from: "web", "Slack", "SMS/voice", "email".
     *  Null on rows written before this column was added — render as "web". */
    channel: text("channel"),
    /** True when this assistant turn was interrupted by the user clicking
     *  Stop before the model finished responding. The persisted `content` is
     *  whatever had streamed so far — never silently dropped — and this flag
     *  lets the UI show a "Stopped" marker and lets Elaine's own context
     *  building recognize the turn was cut short. Always false for user
     *  messages and for rows written before this column was added. */
    stopped: boolean("stopped").notNull().default(false),
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
    index("elaine_scheduled_actions_user_id_idx").on(table.initiatedByUserId),
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

// Rolling cross-channel context — one row per user, shared across all channels
// (web widget, Slack, SMS/voice, email). After every Elaine turn on any channel,
// a compact entry is prepended here (newest first) recording which channel was
// used and a brief gist of what was discussed. The last ~15 entries are injected
// into the system prompt of every subsequent turn as "CROSS-CHANNEL CONTEXT" so
// Elaine can reference earlier exchanges on any channel without separate history
// merging. Deliberately lightweight: entries are plain text, never tool payloads
// or raw prompts, so injection cost stays well under 400 tokens.
export const elaineCrossChannelContext = pgTable(
  "elaine_cross_channel_context",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    // Array of {channel, gist, ts} objects, newest first, capped at 15 entries.
    entries: jsonb("entries")
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type ElaineCrossChannelContextRow =
  typeof elaineCrossChannelContext.$inferSelect;
export type InsertElaineCrossChannelContext =
  typeof elaineCrossChannelContext.$inferInsert;

// Broadcast rate-limit log — one row per successful broadcast_message action.
// checkBroadcastRateLimit counts rows WHERE user_id = ? AND created_at > now()
// - interval '1 hour'; if ≥ 3, the request is rejected with a 429. Storing
// this in the DB (not an in-memory Map) makes the 3-per-hour cap survive
// server restarts and deployments.
export const elaineBroadcastLog = pgTable(
  "elaine_broadcast_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_broadcast_log_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
).enableRLS();

export type ElaineBroadcastLogRow = typeof elaineBroadcastLog.$inferSelect;
export type InsertElaineBroadcastLog = typeof elaineBroadcastLog.$inferInsert;
