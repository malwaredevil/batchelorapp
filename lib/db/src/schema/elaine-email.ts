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

// ── Elaine inbound email (Resend) support ───────────────────────────────────
//
// Household members can email elaine@app.batchelor.app and get a reply.
// Inbound events are matched to an app_user by the From address (exact
// match against app_users.email) and, once matched, routed through the same
// restricted, auto-run-only Elaine turn used by the AgentPhone SMS/voice
// bridge (see AGENTPHONE_ACTION_TYPES in elaine/index.ts) — no destructive
// actions, no full in-app tool set. This schema only holds the email-side
// conversation + webhook dedup state.

// One rolling conversation per household member, independent from the
// in-app widget's `elaine_conversations` and the AgentPhone SMS/voice
// conversation. Keyed by userId since the sender's address is matched to a
// known app_user before any turn runs.
export const elaineEmailConversations = pgTable("elaine_email_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  messages: jsonb("messages")
    .notNull()
    .default(sql`'[]'::jsonb`),
  // Message-ID header of the most recent inbound/outbound message, so the
  // reply can be threaded with In-Reply-To/References.
  lastMessageId: text("last_message_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ElaineEmailConversationRow =
  typeof elaineEmailConversations.$inferSelect;
export type InsertElaineEmailConversation =
  typeof elaineEmailConversations.$inferInsert;

// Webhook delivery dedup log, keyed by Resend/Svix's `svix-id` header.
// Resend (like most webhook senders) may redeliver on a slow/ambiguous
// response, so every delivery id is recorded before any side effect runs;
// a repeat id is a no-op 200.
export const elaineEmailWebhookDeliveries = pgTable(
  "elaine_email_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("elaine_email_webhook_deliveries_received_at_idx").on(
      table.receivedAt,
    ),
  ],
).enableRLS();

export type ElaineEmailWebhookDeliveryRow =
  typeof elaineEmailWebhookDeliveries.$inferSelect;
export type InsertElaineEmailWebhookDelivery =
  typeof elaineEmailWebhookDeliveries.$inferInsert;
