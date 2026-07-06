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
  uniqueIndex,
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
export const elaineMemory = pgTable("elaine_memory", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ElaineMemoryRow = typeof elaineMemory.$inferSelect;
export type InsertElaineMemory = typeof elaineMemory.$inferInsert;

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

// Single-row (id fixed at 1) global config for Elaine's AI behaviour, editable
// only by the app owner from her settings page. Applies across every user and
// every app surface — distinct from `elaineSettings` above, which is a
// per-user on/off + confirmation-mode preference.
export const elaineGlobalConfig = pgTable("elaine_global_config", {
  id: integer("id").primaryKey().default(1),
  chatModel: text("chat_model").notNull().default("google/gemini-2.5-flash"),
  subagentModel: text("subagent_model").notNull().default("z-ai/glm-5.2"),
  requestTimeoutMs: integer("request_timeout_ms").notNull().default(12000),
  maxResponseTokens: integer("max_response_tokens").notNull().default(700),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedByUserId: integer("updated_by_user_id"),
}).enableRLS();

export type ElaineGlobalConfigRow = typeof elaineGlobalConfig.$inferSelect;
export type InsertElaineGlobalConfig = typeof elaineGlobalConfig.$inferInsert;
