import {
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { appUsers } from "./users";

export const searchFeedback = pgTable(
  "search_feedback",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    module: text("module").notNull(),
    itemAType: text("item_a_type").notNull(),
    itemAId: integer("item_a_id").notNull(),
    itemBType: text("item_b_type").notNull(),
    itemBId: integer("item_b_id").notNull(),
    verdict: text("verdict").notNull(),
    weight: numeric("weight", { precision: 4, scale: 3 })
      .notNull()
      .default("1.000"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("search_feedback_module_idx").on(table.module),
    index("search_feedback_items_idx").on(
      table.itemAType,
      table.itemAId,
      table.itemBType,
      table.itemBId,
    ),
    uniqueIndex("search_feedback_pair_user_idx").on(
      table.userId,
      table.itemAType,
      table.itemAId,
      table.itemBType,
      table.itemBId,
    ),
  ],
).enableRLS();

export type SearchFeedback = typeof searchFeedback.$inferSelect;
export type InsertSearchFeedback = typeof searchFeedback.$inferInsert;
