import { z } from "zod/v4";
import type OpenAI from "openai";
import {
  createOfficeNote,
  deleteOfficeNote,
  getOfficeNote,
  updateOfficeNote,
} from "../lib/office-notes";
import {
  bulkUpdateNotificationState,
  replaceUserPreferences,
  updateNotificationState,
} from "../lib/notifications";

const CreateNotePayload = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000),
  backgroundColor: z.string().max(50).nullable().optional(),
});

const UpdateNotePayload = z
  .object({
    noteId: z.number().int().positive(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
    backgroundColor: z.string().max(50).nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.body !== undefined ||
      value.backgroundColor !== undefined,
    { message: "At least one note field must be provided" },
  );

const DeleteNotePayload = z.object({
  noteId: z.number().int().positive(),
});

const UpdateNotificationStatePayload = z
  .object({
    recipientId: z.number().int().positive(),
    read: z.boolean().optional(),
    acknowledged: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    snoozedUntil: z.iso.datetime().nullable().optional(),
  })
  .refine(
    (value) =>
      value.read !== undefined ||
      value.acknowledged !== undefined ||
      value.dismissed !== undefined ||
      value.snoozedUntil !== undefined,
    { message: "At least one notification state field must be provided" },
  );

const BulkUpdateNotificationsPayload = z.object({
  recipientIds: z.array(z.number().int().positive()).min(1).max(200),
  action: z.enum(["read", "unread", "dismissed", "acknowledged"]),
});

const NotificationPreferenceEntry = z.object({
  scope: z.enum(["global", "module", "event_type"]),
  scopeValue: z.string().max(200).nullable().optional(),
  channelInApp: z.boolean().default(true),
  channelEmail: z.boolean().default(false),
  channelSms: z.boolean().default(false),
  channelPush: z.boolean().default(false),
  quietHoursEnabled: z.boolean().default(false),
  quietHoursTimezone: z.string().min(1).max(100).default("America/New_York"),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("22:00"),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("08:00"),
  criticalOverride: z.boolean().default(true),
});

const UpdateNotificationPreferencesPayload = z.object({
  entries: z.array(NotificationPreferenceEntry).max(50),
});

export const universalActionSchemas = [
  z.object({ type: z.literal("create_note"), payload: CreateNotePayload }),
  z.object({ type: z.literal("update_note"), payload: UpdateNotePayload }),
  z.object({ type: z.literal("delete_note"), payload: DeleteNotePayload }),
  z.object({
    type: z.literal("update_notification_state"),
    payload: UpdateNotificationStatePayload,
  }),
  z.object({
    type: z.literal("bulk_update_notifications"),
    payload: BulkUpdateNotificationsPayload,
  }),
  z.object({
    type: z.literal("update_notification_preferences"),
    payload: UpdateNotificationPreferencesPayload,
  }),
] as const;

export const UNIVERSAL_ACTION_TYPES = [
  "create_note",
  "update_note",
  "delete_note",
  "update_notification_state",
  "bulk_update_notifications",
  "update_notification_preferences",
] as const;

export type UniversalActionType = (typeof UNIVERSAL_ACTION_TYPES)[number];

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const universalActionExecutors: Record<
  UniversalActionType,
  ActionExecutor
> = {
  create_note: (async (
    payload: z.infer<typeof CreateNotePayload>,
    userId: number,
  ) => {
    const note = await createOfficeNote(payload, userId);
    return { status: 201, body: { type: "create_note", result: note } };
  }) as ActionExecutor,
  update_note: (async (payload: z.infer<typeof UpdateNotePayload>) => {
    const note = await updateOfficeNote(payload.noteId, {
      title: payload.title,
      body: payload.body,
      backgroundColor: payload.backgroundColor,
    });
    return note
      ? { status: 200, body: { type: "update_note", result: note } }
      : { status: 404, body: { error: "Note not found" } };
  }) as ActionExecutor,
  delete_note: (async (payload: z.infer<typeof DeleteNotePayload>) => {
    const deleted = await deleteOfficeNote(payload.noteId);
    return deleted
      ? {
          status: 200,
          body: { type: "delete_note", result: { deleted: true } },
        }
      : { status: 404, body: { error: "Note not found" } };
  }) as ActionExecutor,
  update_notification_state: (async (
    payload: z.infer<typeof UpdateNotificationStatePayload>,
    userId: number,
  ) => {
    const state = await updateNotificationState(
      userId,
      payload.recipientId,
      payload,
    );
    return state
      ? {
          status: 200,
          body: { type: "update_notification_state", result: state },
        }
      : { status: 404, body: { error: "Notification not found" } };
  }) as ActionExecutor,
  bulk_update_notifications: (async (
    payload: z.infer<typeof BulkUpdateNotificationsPayload>,
    userId: number,
  ) => {
    const updated = await bulkUpdateNotificationState(
      userId,
      payload.recipientIds,
      payload.action,
    );
    return {
      status: 200,
      body: { type: "bulk_update_notifications", result: { updated } },
    };
  }) as ActionExecutor,
  update_notification_preferences: (async (
    payload: z.infer<typeof UpdateNotificationPreferencesPayload>,
    userId: number,
  ) => {
    const entries = await replaceUserPreferences(userId, payload.entries);
    return {
      status: 200,
      body: { type: "update_notification_preferences", result: { entries } },
    };
  }) as ActionExecutor,
};

export async function buildUniversalActionLabel(action: {
  type: UniversalActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "create_note": {
      const payload = CreateNotePayload.parse(action.payload);
      return `Create the household note "${payload.title}"`;
    }
    case "update_note": {
      const payload = UpdateNotePayload.parse(action.payload);
      const note = await getOfficeNote(payload.noteId);
      return `Update ${note ? `the note "${note.title}"` : `note ${payload.noteId}`}`;
    }
    case "delete_note": {
      const payload = DeleteNotePayload.parse(action.payload);
      const note = await getOfficeNote(payload.noteId);
      return `Delete ${note ? `the note "${note.title}"` : `note ${payload.noteId}`}`;
    }
    case "update_notification_state": {
      const payload = UpdateNotificationStatePayload.parse(action.payload);
      return `Update notification ${payload.recipientId}'s state`;
    }
    case "bulk_update_notifications": {
      const payload = BulkUpdateNotificationsPayload.parse(action.payload);
      return `Mark ${payload.recipientIds.length} notification${payload.recipientIds.length === 1 ? "" : "s"} as ${payload.action}`;
    }
    case "update_notification_preferences":
      return "Replace your notification preferences";
  }
}

export const universalActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "create_note",
        description:
          "Propose creating a household Office note. When the user supplied an image or PDF attachment, use the attachment content already visible to you to draft the note; never invent unreadable details. Confirm the exact title and a concise summary of the body.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            backgroundColor: { type: ["string", "null"] },
          },
          required: ["title", "body"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_note",
        description:
          "Propose editing an existing household Office note. Get the numeric noteId from list_notes or get_note; never guess it. Include only changed fields.",
        parameters: {
          type: "object",
          properties: {
            noteId: { type: "integer" },
            title: { type: "string" },
            body: { type: "string" },
            backgroundColor: { type: ["string", "null"] },
          },
          required: ["noteId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_note",
        description:
          "Propose permanently deleting a household Office note. Get noteId from list_notes or get_note and identify the note in the visible confirmation.",
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
        name: "update_notification_state",
        description:
          "Propose changing one of the current user's notifications: read/unread, acknowledged, dismissed, or snoozed. Use a recipientId returned by list_notifications; never guess it.",
        parameters: {
          type: "object",
          properties: {
            recipientId: { type: "integer" },
            read: { type: "boolean" },
            acknowledged: { type: "boolean" },
            dismissed: { type: "boolean" },
            snoozedUntil: {
              type: ["string", "null"],
              description: "ISO-8601 date-time or null to remove a snooze",
            },
          },
          required: ["recipientId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bulk_update_notifications",
        description:
          "Propose marking selected notifications read, unread, dismissed, or acknowledged. Use only recipientIds returned by list_notifications in this conversation.",
        parameters: {
          type: "object",
          properties: {
            recipientIds: {
              type: "array",
              items: { type: "integer" },
              maxItems: 200,
            },
            action: {
              type: "string",
              enum: ["read", "unread", "dismissed", "acknowledged"],
            },
          },
          required: ["recipientIds", "action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_notification_preferences",
        description:
          "Propose replacing the current user's complete notification preference list. Always call get_notification_preferences first, preserve entries the user did not ask to change, and describe the effective changes before proposing this action.",
        parameters: {
          type: "object",
          properties: {
            entries: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                properties: {
                  scope: {
                    type: "string",
                    enum: ["global", "module", "event_type"],
                  },
                  scopeValue: { type: ["string", "null"] },
                  channelInApp: { type: "boolean" },
                  channelEmail: { type: "boolean" },
                  channelSms: { type: "boolean" },
                  channelPush: { type: "boolean" },
                  quietHoursEnabled: { type: "boolean" },
                  quietHoursTimezone: { type: "string" },
                  quietHoursStart: { type: "string" },
                  quietHoursEnd: { type: "string" },
                  criticalOverride: { type: "boolean" },
                },
                required: ["scope"],
              },
            },
          },
          required: ["entries"],
        },
      },
    },
  ];
