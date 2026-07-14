import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { appUsers } from "./users";

export const messengerConversations = pgTable("messenger_conversations", {
  id: serial("id").primaryKey(),
  name: text("name"),
  isDirect: boolean("is_direct").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export const messengerConversationParticipants = pgTable(
  "messenger_conversation_participants",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    userId: integer("user_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.conversationId, t.userId)],
).enableRLS();

export const messengerMessages = pgTable("messenger_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id"),
  body: text("body").notNull().default(""),
  readAt: timestamp("read_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export const messengerAttachments = pgTable("messenger_attachments", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  fileName: text("file_name").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export const messengerLinkPreviews = pgTable("messenger_link_previews", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

export type MessengerConversationRow =
  typeof messengerConversations.$inferSelect;
export type InsertMessengerConversation =
  typeof messengerConversations.$inferInsert;
export type MessengerConversationParticipantRow =
  typeof messengerConversationParticipants.$inferSelect;
export type MessengerMessageRow = typeof messengerMessages.$inferSelect;
export type InsertMessengerMessage = typeof messengerMessages.$inferInsert;
export type MessengerAttachmentRow = typeof messengerAttachments.$inferSelect;
export type InsertMessengerAttachment =
  typeof messengerAttachments.$inferInsert;
export type MessengerLinkPreviewRow = typeof messengerLinkPreviews.$inferSelect;
export type InsertMessengerLinkPreview =
  typeof messengerLinkPreviews.$inferInsert;
