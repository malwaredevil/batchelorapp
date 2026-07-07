import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Per-user Gmail OAuth connection for the main Batchelor hub webmail feature.
// Separate from travels_gmail_connections (which has gmail.readonly + gmail.labels
// scopes for travel-email scanning). This connection uses the full
// https://mail.google.com/ scope so users can read, compose, send and manage
// their inbox directly inside the app.
//
// Like the travels connection, this stays in Google OAuth Testing mode with
// household emails as test users — no CASA audit required.
export const appGmailConnections = pgTable("app_gmail_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  googleEmail: text("google_email").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type AppGmailConnectionRow = typeof appGmailConnections.$inferSelect;
export type InsertAppGmailConnection = typeof appGmailConnections.$inferInsert;
