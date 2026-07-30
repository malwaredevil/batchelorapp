import { describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  createOfficeNote: vi.fn(async (input: unknown, userId: number) => ({
    id: 7,
    input,
    userId,
  })),
  deleteOfficeNote: vi.fn(async () => true),
  getOfficeNote: vi.fn(async () => null),
  listOfficeNotes: vi.fn(async () => []),
  updateOfficeNote: vi.fn(async () => null),
  bulkUpdateNotificationState: vi.fn(async () => 2),
  getUnreadCounts: vi.fn(async () => ({ total: 0, byModule: {} })),
  getUserNotifications: vi.fn(async () => ({ items: [], total: 0 })),
  getUserPreferences: vi.fn(async () => []),
  replaceUserPreferences: vi.fn(async () => []),
  updateNotificationState: vi.fn(async () => ({
    recipientId: 9,
    isRead: true,
  })),
}));

vi.mock("../lib/office-notes", () => ({
  createOfficeNote: serviceMocks.createOfficeNote,
  deleteOfficeNote: serviceMocks.deleteOfficeNote,
  getOfficeNote: serviceMocks.getOfficeNote,
  listOfficeNotes: serviceMocks.listOfficeNotes,
  updateOfficeNote: serviceMocks.updateOfficeNote,
}));

vi.mock("../lib/notifications", () => ({
  bulkUpdateNotificationState: serviceMocks.bulkUpdateNotificationState,
  getUnreadCounts: serviceMocks.getUnreadCounts,
  getUserNotifications: serviceMocks.getUserNotifications,
  getUserPreferences: serviceMocks.getUserPreferences,
  replaceUserPreferences: serviceMocks.replaceUserPreferences,
  updateNotificationState: serviceMocks.updateNotificationState,
}));
import {
  UNIVERSAL_ACTION_TYPES,
  universalActionExecutors,
  universalActionSchemas,
  universalActionTools,
} from "./universal-actions";
import {
  GET_NOTE_TOOL_NAME,
  GET_NOTIFICATION_COUNTS_TOOL_NAME,
  GET_NOTIFICATION_PREFERENCES_TOOL_NAME,
  LIST_NOTES_TOOL_NAME,
  LIST_NOTIFICATIONS_TOOL_NAME,
  executeUniversalReadTool,
  universalReadTools,
} from "./universal-read-tools";

describe("Elaine universal app-control definitions", () => {
  it("keeps every validated action connected to a tool and executor", () => {
    const toolNames = new Set(
      universalActionTools.map((tool) =>
        tool.type === "function" ? tool.function.name : "",
      ),
    );
    const executorNames = new Set(Object.keys(universalActionExecutors));
    for (const type of UNIVERSAL_ACTION_TYPES) {
      expect(toolNames.has(type)).toBe(true);
      expect(executorNames.has(type)).toBe(true);
    }
  });

  it("exposes notes and per-user notification reads", () => {
    const names = universalReadTools.map((tool) =>
      tool.type === "function" ? tool.function.name : "",
    );
    expect(names).toEqual([
      LIST_NOTES_TOOL_NAME,
      GET_NOTE_TOOL_NAME,
      LIST_NOTIFICATIONS_TOOL_NAME,
      GET_NOTIFICATION_COUNTS_TOOL_NAME,
      GET_NOTIFICATION_PREFERENCES_TOOL_NAME,
    ]);
  });

  it("requires an actual note change and an actual notification state change", () => {
    const updateNote = universalActionSchemas[1];
    const updateNotification = universalActionSchemas[3];
    expect(
      updateNote.safeParse({ type: "update_note", payload: { noteId: 1 } })
        .success,
    ).toBe(false);
    expect(
      updateNotification.safeParse({
        type: "update_notification_state",
        payload: { recipientId: 1 },
      }).success,
    ).toBe(false);
  });

  it("passes the authenticated user to shared note and notification services", async () => {
    const noteResult = await universalActionExecutors.create_note(
      {
        title: "Attachment summary",
        body: "Facts extracted from the supplied attachment.",
      } as never,
      42,
    );
    expect(serviceMocks.createOfficeNote).toHaveBeenCalledWith(
      {
        title: "Attachment summary",
        body: "Facts extracted from the supplied attachment.",
      },
      42,
    );
    expect(noteResult.status).toBe(201);

    await universalActionExecutors.update_notification_state(
      { recipientId: 9, read: true } as never,
      42,
    );
    expect(serviceMocks.updateNotificationState).toHaveBeenCalledWith(
      42,
      9,
      expect.objectContaining({ read: true }),
    );

    await executeUniversalReadTool(
      LIST_NOTIFICATIONS_TOOL_NAME,
      '{"unread":true}',
      42,
    );
    expect(serviceMocks.getUserNotifications).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ unread: true }),
    );
  });
});
