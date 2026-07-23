import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ── AgentPhone webhook (SMS/voice) support ──────────────────────────────────
//
// A single AgentPhone number serves the whole household. Inbound SMS/voice
// events are matched to an app_user by phoneNumber (see users.ts) and, for
// non-compliance messages, routed through a restricted, auto-run-only Elaine
// turn. This schema only holds the SMS/voice-side conversation + webhook
// dedup state — the actual write-actions still run through Elaine's existing
// ACTION_EXECUTORS in elaine/index.ts.

// One rolling conversation per phone number, independent from the in-app
// Elaine widget's `elaine_conversations` (different system prompt, restricted
// tool set, and channel). Keyed by phone number rather than userId since the
// webhook only ever has the sender's number to key off of.
export const agentphoneConversations = pgTable("agentphone_conversations", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull().unique(),
  userId: integer("user_id").notNull(),
  messages: jsonb("messages")
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type AgentphoneConversationRow =
  typeof agentphoneConversations.$inferSelect;
export type InsertAgentphoneConversation =
  typeof agentphoneConversations.$inferInsert;

// Webhook delivery dedup log, keyed by AgentPhone's `X-Webhook-ID` header.
// AgentPhone (like most webhook senders) may redeliver on a slow/ambiguous
// response, so every delivery id is recorded before any side effect runs;
// a repeat id is a no-op 200. Rows are pruned on insert (best-effort) since
// only a short dedup window is ever needed.
export const agentphoneWebhookDeliveries = pgTable(
  "agentphone_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").notNull().default("processing"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("agentphone_webhook_deliveries_received_at_idx").on(table.receivedAt),
  ],
).enableRLS();

export type AgentphoneWebhookDeliveryRow =
  typeof agentphoneWebhookDeliveries.$inferSelect;
export type InsertAgentphoneWebhookDelivery =
  typeof agentphoneWebhookDeliveries.$inferInsert;
