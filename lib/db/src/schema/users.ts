import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Shared between the pottery and quilting apps — a single account logs into both.
export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Account settings shared across both apps.
  displayName: text("display_name"),
  themePreference: text("theme_preference"),
  // Per-user hub dashboard widget config — JSON-serialised string[] of widget IDs in order.
  hubWidgetIds: text("hub_widget_ids"),
  // Per-user weather widget location — JSON { city, country, lat, lon, unit }.
  hubWeatherConfig: text("hub_weather_config"),
  // Email address for travels trip-reminder alerts (14-day, 7-day, 3-day).
  travelsReminderEmail: text("travels_reminder_email"),
  // IANA timezone name (e.g. "America/Denver"), used to render dates/times
  // extracted from scanned Gmail travel documents and elsewhere in Travels.
  // Nullable — falls back to UTC display until the user sets it.
  timezone: text("timezone"),
  // True for the single app owner (batchelorjc@gmail.com) — the only account
  // allowed to assign/reassign which connected calendar is the shared
  // "Travel" calendar in the Travels app.
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// Superset of the two apps' definitions, matching the live table (7 columns):
// integer FK to app_users, unique token hash, plus `used` and `used_at`.
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;
