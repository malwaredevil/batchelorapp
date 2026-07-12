import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── App-wide configurable constants ─────────────────────────────────────────
//
// Key/value pairs keyed by (module, key). All values are stored as TEXT
// and parsed by the reader into the appropriate type (integer, float,
// boolean, string). Defaults live in lib/app-config.ts and are seeded on
// first read; admin can override via PUT /api/config/:module/:key (owner only).
//
// NOT for security-critical limits (webhook body caps, rate-limit thresholds,
// batch-size safety caps) — those must stay hardcoded. This table covers
// quality/cost/UX knobs that a household owner may want to tune without a
// code deploy.

export const appConfig = pgTable(
  "app_config",
  {
    id: serial("id").primaryKey(),
    module: text("module").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    type: text("type").notNull().default("string"),
    label: text("label").notNull(),
    description: text("description"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /**
     * Set to the timestamp of the last deliberate admin override.
     * Null means the value was never intentionally changed by a human — it
     * either still holds the seeded default or drifted because a developer
     * renamed the default value in APP_CONFIG_DEFAULTS. The Control Panel
     * "customised" badge should key off this column, not a value comparison,
     * so that a renamed default doesn't falsely light up the badge.
     */
    customisedAt: timestamp("customised_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("app_config_module_key_idx").on(t.module, t.key)],
);

export type AppConfigRow = typeof appConfig.$inferSelect;
export type InsertAppConfig = typeof appConfig.$inferInsert;
