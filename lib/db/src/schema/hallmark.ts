import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Singleton operational state for the Hallmark event scanner.
 *
 * The events themselves intentionally remain in Google Calendar. This row only
 * makes source health, previews, and the last safe reconciliation observable
 * across API-server restarts.
 */
export const ornamentsHallmarkEventSync = pgTable(
  "ornaments_hallmark_event_sync",
  {
    id: integer("id").primaryKey().default(1),
    sourceUrl: text("source_url").notNull(),
    sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
    sourceFingerprint: text("source_fingerprint"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastStatus: text("last_status").notNull().default("never"),
    lastError: text("last_error"),
    candidateCount: integer("candidate_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    candidates: jsonb("candidates").$type<unknown[]>().notNull().default([]),
    rejected: jsonb("rejected").$type<unknown[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
).enableRLS();

export type HallmarkEventSyncState =
  typeof ornamentsHallmarkEventSync.$inferSelect;
