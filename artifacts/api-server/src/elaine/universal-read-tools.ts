import { z } from "zod/v4";
import type OpenAI from "openai";
import { getOfficeNote, listOfficeNotes } from "../lib/office-notes";
import {
  getUnreadCounts,
  getUserNotifications,
  getUserPreferences,
} from "../lib/notifications";

export const LIST_NOTES_TOOL_NAME = "list_notes";
export const GET_NOTE_TOOL_NAME = "get_note";
export const LIST_NOTIFICATIONS_TOOL_NAME = "list_notifications";
export const GET_NOTIFICATION_COUNTS_TOOL_NAME = "get_notification_counts";
export const GET_NOTIFICATION_PREFERENCES_TOOL_NAME =
  "get_notification_preferences";

const ListNotesPayload = z.object({
  limit: z.number().int().min(1).max(100).default(30),
});
const GetNotePayload = z.object({ noteId: z.number().int().positive() });
const ListNotificationsPayload = z.object({
  module: z.string().max(100).optional(),
  severity: z
    .enum(["informational", "attention", "important", "critical"])
    .optional(),
  unread: z.boolean().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(30),
});

export const universalReadTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: LIST_NOTES_TOOL_NAME,
        description:
          "List recent household Office notes with their numeric IDs, titles, bodies, creators, and timestamps. Use this before editing or deleting a note and whenever the user asks what notes exist.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: GET_NOTE_TOOL_NAME,
        description:
          "Read one household Office note by a numeric ID returned by list_notes. Never guess the ID.",
        parameters: {
          type: "object",
          properties: { noteId: { type: "integer" } },
          required: ["noteId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: LIST_NOTIFICATIONS_TOOL_NAME,
        description:
          "List the current user's notifications, including recipient IDs required for state changes. Supports module, minimum severity, unread-only, and pagination filters.",
        parameters: {
          type: "object",
          properties: {
            module: { type: "string" },
            severity: {
              type: "string",
              enum: ["informational", "attention", "important", "critical"],
            },
            unread: { type: "boolean" },
            page: { type: "integer", minimum: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: GET_NOTIFICATION_COUNTS_TOOL_NAME,
        description:
          "Get the current user's exact unread notification count and counts by app module.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: GET_NOTIFICATION_PREFERENCES_TOOL_NAME,
        description:
          "Get the current user's complete notification preference entries. Always use this before proposing a preference change so unchanged entries are preserved.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

function toolResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function executeUniversalReadTool(
  name: string,
  args: string,
  userId: number,
): Promise<string | null> {
  const input = JSON.parse(args || "{}") as unknown;
  if (name === LIST_NOTES_TOOL_NAME) {
    const parsed = ListNotesPayload.safeParse(input);
    if (!parsed.success) return "Invalid note list request.";
    const notes = await listOfficeNotes();
    return toolResult({
      notes: notes.slice(0, parsed.data.limit),
      returned: Math.min(notes.length, parsed.data.limit),
      total: notes.length,
    });
  }
  if (name === GET_NOTE_TOOL_NAME) {
    const parsed = GetNotePayload.safeParse(input);
    if (!parsed.success) return "Invalid note request.";
    const note = await getOfficeNote(parsed.data.noteId);
    return note ? toolResult(note) : "Note not found.";
  }
  if (name === LIST_NOTIFICATIONS_TOOL_NAME) {
    const parsed = ListNotificationsPayload.safeParse(input);
    if (!parsed.success) return "Invalid notification list request.";
    return toolResult(await getUserNotifications(userId, parsed.data));
  }
  if (name === GET_NOTIFICATION_COUNTS_TOOL_NAME) {
    return toolResult(await getUnreadCounts(userId));
  }
  if (name === GET_NOTIFICATION_PREFERENCES_TOOL_NAME) {
    return toolResult({ entries: await getUserPreferences(userId) });
  }
  return null;
}
