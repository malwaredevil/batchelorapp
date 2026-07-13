import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

// Office notes: a genuinely new household-shared feature (not ported from
// pottery/quilting/travels/ornaments). Follows the same household-sharing
// pattern as every other collection table in this app — `createdByUserId`
// is attribution-only (who created the note), never used to filter or gate
// reads/writes/deletes. Any authenticated household member may edit or
// delete any note. See replit.md's Architecture decisions and
// threat_model.md's Household-sharing boundary.
export const officeNotes = pgTable("office_notes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  backgroundColor: text("background_color"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type OfficeNoteRow = typeof officeNotes.$inferSelect;
export type InsertOfficeNote = typeof officeNotes.$inferInsert;
