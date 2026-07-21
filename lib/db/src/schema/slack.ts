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

// ── Elaine Slack bridge support ─────────────────────────────────────────────
//
// Household members can DM the Elaine Slack bot and get a reply, using the
// same restricted Elaine turn as AgentPhone SMS/voice and the Resend email
// channel. Inbound Slack events are matched to an app_user by their
// slack_user_id column on app_users — auto-linked on first DM via email
// address lookup from the Slack API when the Slack user ID is not yet known.

// One rolling conversation per household member, independent from the in-app
// widget's elaine_conversations, the AgentPhone conversation, and the email
// conversation. Keyed by userId (from the matched app_user) since Slack user
// IDs are resolved to known accounts before any turn runs.
export const elaineSlackConversations = pgTable("elaine_slack_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  slackUserId: text("slack_user_id").notNull(),
  messages: jsonb("messages")
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type ElaineSlackConversationRow =
  typeof elaineSlackConversations.$inferSelect;
export type InsertElaineSlackConversation =
  typeof elaineSlackConversations.$inferInsert;

// Webhook delivery dedup log, keyed by Slack's event_id from the event body.
// Slack retries up to 3 times (X-Slack-Retry-Num header) on slow/failed
// responses, so every event_id is recorded before any side effect runs;
// a repeat id is a no-op 200.
export const slackWebhookDeliveries = pgTable(
  "slack_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("slack_webhook_deliveries_received_at_idx").on(table.receivedAt),
  ],
).enableRLS();

export type SlackWebhookDeliveryRow =
  typeof slackWebhookDeliveries.$inferSelect;
export type InsertSlackWebhookDelivery =
  typeof slackWebhookDeliveries.$inferInsert;
