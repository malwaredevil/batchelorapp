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
  // Per-user hub app card order — JSON-serialised string[] of app IDs in display order.
  hubAppCardOrder: text("hub_app_card_order"),
  // Per-user weather widget location — JSON { city, country, lat, lon, unit }.
  hubWeatherConfig: text("hub_weather_config"),
  // Email address for travels trip-reminder alerts (14-day, 7-day, 3-day).
  travelsReminderEmail: text("travels_reminder_email"),
  // IANA timezone name (e.g. "America/Denver"), used to render dates/times
  // extracted from scanned Gmail travel documents and elsewhere in Travels.
  // Nullable — falls back to UTC display until the user sets it.
  timezone: text("timezone"),
  // True for the single app owner — the only account
  // allowed to assign/reassign which connected calendar is the shared
  // "Travel" calendar in the Travels app.
  isOwner: boolean("is_owner").notNull().default(false),
  // Phone number for SMS reminders/notifications (AgentPhone), E.164 format
  // (e.g. "+12105551234"). Only usable for sending once phoneVerified is
  // true — set by completing the one-time-code flow in
  // phoneVerificationCodes below.
  phoneNumber: text("phone_number").unique(),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  // A2P 10DLC compliance: timestamp of the most recent explicit opt-in
  // consent checkbox submission (recorded when the user requests a
  // verification code, alongside the phone number they consented for).
  // Required evidence for carrier campaign registration — never inferred,
  // only ever set by the send-code endpoint after `consent === true`.
  smsConsentAt: timestamp("sms_consent_at", { withTimezone: true }),
  // A2P 10DLC compliance: set when this number replies STOP/STOPALL/
  // UNSUBSCRIBE/CANCEL/END/QUIT to the AgentPhone webhook. While set, every
  // outbound SMS send path (verification code, test SMS, reminder alerts)
  // must skip this number. Cleared when the number replies START/UNSTOP/YES.
  smsOptedOutAt: timestamp("sms_opted_out_at", { withTimezone: true }),
  // A2P 10DLC first-message compliance: timestamp of the first successfully
  // sent outbound SMS to this number (non-compliance messages only — STOP/
  // HELP/START responses are exempted). Once set, the per-carrier required
  // compliance header (brand + opt-in confirmation + STOP instructions) is
  // no longer prepended to outbound messages sent to this number.
  smsFirstOutboundSentAt: timestamp("sms_first_outbound_sent_at", {
    withTimezone: true,
  }),
  // Slack user ID (e.g. "U1234567890") for the Elaine Slack bot. Used to
  // route inbound DMs and deliver reminder notifications via Slack DM.
  // Set automatically on first DM via Slack email-address lookup, or
  // manually cleared via account settings.
  slackUserId: text("slack_user_id").unique(),
  // Birthday as "MM-DD" string (year omitted — just month and day).
  // Used to show a birthday banner on login and trigger a birthday email from Elaine.
  birthday: text("birthday"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// One-time codes for verifying a candidate phone number before it is
// committed to appUsers.phoneNumber. The candidate number lives on this row
// (not read from app_users) so a user can verify a brand-new number without
// it becoming "their" number until the code actually matches.
export const phoneVerificationCodes = pgTable("phone_verification_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  used: boolean("used").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type PhoneVerificationCode = typeof phoneVerificationCodes.$inferSelect;
export type InsertPhoneVerificationCode =
  typeof phoneVerificationCodes.$inferInsert;

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

// Persisted last-run timestamp per in-process scheduler (hallmark events
// scan, gmail scan, calendar trip scan, nudges, reminders, etc). Exists
// solely to survive process restarts: every scheduler's `void run()` used to
// fire an unconditional AI-calling run immediately on startup with no
// cooldown, so during active development (many workflow restarts per hour)
// the same expensive scan could re-run dozens of times in quick succession.
// shouldRunScheduledTask() in api-server uses this table as an atomic
// UPSERT-with-WHERE guard so a run only proceeds if the persisted last run
// was more than `minIntervalMs` ago, regardless of how many times the
// process has restarted since. Ephemeral/regenerable — intentionally
// excluded from Supabase<->Replit backups (same category as session tables).
export const schedulerRuns = pgTable("scheduler_runs", {
  name: text("name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
}).enableRLS();

export type SchedulerRun = typeof schedulerRuns.$inferSelect;
