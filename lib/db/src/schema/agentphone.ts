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
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type AgentphoneConversationRow =
  typeof agentphoneConversations.$inferSelect;
export type InsertAgentphoneConversation =
  typeof agentphoneConversations.$inferInsert;

// Webhook delivery dedup log. Primary dedup key is `id`, the SHA-256 of the
// HMAC-signed material (timestamp + "." + rawBody) — NOT the unsigned
// X-Webhook-ID header. Using the content hash means a replayer cannot bypass
// dedup by swapping in a fresh delivery ID; the same authenticated
// body+timestamp always produces the same hash and hits the primary-key
// conflict.
//
// `deliveryId` (nullable) additionally stores the raw X-Webhook-ID header,
// checked as a SECOND dedup key in claimDelivery() (agentphone.ts). This
// closes a gap discovered 2026-08-11: AgentPhone can redeliver the same
// logical message under the same X-Webhook-ID but with a freshly-signed
// timestamp, producing a DIFFERENT content hash — so content-hash-only dedup
// let the retry through as if it were new, and Elaine sent a second SMS reply
// to the daily comms-check confirmation. The ID is still never trusted alone
// for authenticity (a request must still pass signature verification before
// either key is consulted), so this only adds duplicate-detection, not a new
// way to authenticate.
export const agentphoneWebhookDeliveries = pgTable(
  "agentphone_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").notNull().default("processing"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("agentphone_webhook_deliveries_received_at_idx").on(table.receivedAt),
    index("agentphone_webhook_deliveries_delivery_id_idx").on(table.deliveryId),
  ],
).enableRLS();

export type AgentphoneWebhookDeliveryRow =
  typeof agentphoneWebhookDeliveries.$inferSelect;
export type InsertAgentphoneWebhookDelivery =
  typeof agentphoneWebhookDeliveries.$inferInsert;
