import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// Idempotency ledger for outbound side effects triggered by inbound webhooks.
// Delivery-level dedup prevents re-running an entire webhook delivery, while
// this table prevents repeating a specific send side effect (SMS/email) if a
// crash or retry path re-enters after some state has already changed.
export const webhookSideEffects = pgTable(
  "app_webhook_side_effects",
  {
    effectKey: text("effect_key").primaryKey(),
    provider: text("provider").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("processing"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    index("app_webhook_side_effects_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
).enableRLS();

export type WebhookSideEffectRow = typeof webhookSideEffects.$inferSelect;
export type InsertWebhookSideEffect = typeof webhookSideEffects.$inferInsert;
