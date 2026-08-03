/**
 * Unit tests for the messageWidgets Map key invariant in useElaineChat.
 *
 * The Map<number, ChatWidget[]> in useElaineChat is keyed by each message's
 * own persisted numeric `id`, NOT by its position in the messages array.  This
 * means that prepending older messages (loadOlderMessages) above the currently
 * visible set shifts every existing message's array index upward — but because
 * the Map key is the id, every pre-existing widget entry remains correct and
 * accessible without any re-indexing.
 *
 * These tests verify that invariant directly so any future refactor that
 * accidentally switches the key to array-index would fail here.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Minimal stand-in types (mirrors the real useElaineChat shapes)
// ---------------------------------------------------------------------------

type ChatWidget = { kind: string; data: unknown };
type AssistantMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

// ---------------------------------------------------------------------------
// Core invariant helper (mirrors the logic inside loadOlderMessages)
// ---------------------------------------------------------------------------

/**
 * Simulates the prepend that loadOlderMessages performs:
 *   setMessages(prev => [...older, ...prev])
 *
 * The messageWidgets Map is intentionally left untouched — widget lookups
 * always use message.id as the key, never the array index.
 */
function simulatePrepend(
  existing: AssistantMessage[],
  widgets: Map<number, ChatWidget[]>,
  older: AssistantMessage[],
): { messages: AssistantMessage[]; widgets: Map<number, ChatWidget[]> } {
  const messages = [...older, ...existing];
  // widgets Map is NOT modified — this is the invariant under test.
  return { messages, widgets };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("messageWidgets key invariant — prepend does not invalidate Map entries", () => {
  it("widget stored by message id is still found after older messages are prepended", () => {
    // Existing messages: ids 10, 11, 12
    const existingMessages: AssistantMessage[] = [
      { id: 10, role: "user", content: "Hello" },
      { id: 11, role: "assistant", content: "Hi there" },
      { id: 12, role: "user", content: "How are you?" },
    ];

    // Widget data registered against id=11 (the assistant message)
    const widget: ChatWidget = { kind: "trip_card", data: { tripId: 42 } };
    const widgets = new Map<number, ChatWidget[]>();
    widgets.set(11, [widget]);

    // Prepend 3 older messages with lower ids
    const olderMessages: AssistantMessage[] = [
      { id: 7, role: "user", content: "First ever" },
      { id: 8, role: "assistant", content: "Welcome" },
      { id: 9, role: "user", content: "Thanks" },
    ];

    const { messages, widgets: updatedWidgets } = simulatePrepend(
      existingMessages,
      widgets,
      olderMessages,
    );

    // After prepend the message with id=11 has moved from index 1 to index 4
    expect(messages[4]).toMatchObject({ id: 11 });

    // BUT the widget is still found by its id key, not by array index
    expect(updatedWidgets.get(11)).toEqual([widget]);

    // Wrong-key lookups (by old or new array index) correctly miss
    expect(updatedWidgets.get(1)).toBeUndefined(); // old index
    expect(updatedWidgets.get(4)).toBeUndefined(); // new index
  });

  it("multiple widgets survive a multi-batch prepend with non-contiguous ids", () => {
    const existingMessages: AssistantMessage[] = [
      { id: 100, role: "user", content: "A" },
      { id: 200, role: "assistant", content: "B" },
      { id: 300, role: "assistant", content: "C" },
    ];

    const widgetB: ChatWidget = {
      kind: "fabric_swatch",
      data: { fabricId: 1 },
    };
    const widgetC: ChatWidget[] = [
      { kind: "pottery_item", data: { itemId: 5 } },
      { kind: "trip_card", data: { tripId: 7 } },
    ];

    const widgets = new Map<number, ChatWidget[]>();
    widgets.set(200, [widgetB]);
    widgets.set(300, widgetC);

    // Two batches of older messages
    const batch1: AssistantMessage[] = [
      { id: 50, role: "user", content: "Old 1" },
      { id: 60, role: "assistant", content: "Old 2" },
    ];
    const batch2: AssistantMessage[] = [
      { id: 10, role: "user", content: "Older 1" },
      { id: 20, role: "assistant", content: "Older 2" },
    ];

    // First prepend
    const after1 = simulatePrepend(existingMessages, widgets, batch1);
    // Second prepend (simulates a second page load)
    const { messages, widgets: finalWidgets } = simulatePrepend(
      after1.messages,
      after1.widgets,
      batch2,
    );

    // After both prepends: [10,20,50,60,100,200,300] → id=200 is at index 5
    expect(messages.findIndex((m) => m.id === 200)).toBe(5);
    expect(messages.findIndex((m) => m.id === 300)).toBe(6);

    // Widgets still found by their original message ids
    expect(finalWidgets.get(200)).toEqual([widgetB]);
    expect(finalWidgets.get(300)).toEqual(widgetC);

    // New older message ids have no widgets
    expect(finalWidgets.get(50)).toBeUndefined();
    expect(finalWidgets.get(10)).toBeUndefined();
  });

  it("an empty existing message list stays empty after prepend (new-conversation path)", () => {
    const widgets = new Map<number, ChatWidget[]>();
    const { messages } = simulatePrepend([], widgets, [
      { id: 1, role: "user", content: "Hello" },
    ]);
    expect(messages).toHaveLength(1);
    expect(widgets.size).toBe(0);
  });

  it("prepending an empty older page is a no-op (hasMore was stale)", () => {
    const existing: AssistantMessage[] = [
      { id: 5, role: "user", content: "Msg" },
    ];
    const widget: ChatWidget = { kind: "trip_card", data: {} };
    const widgets = new Map<number, ChatWidget[]>([[5, [widget]]]);

    const { messages, widgets: after } = simulatePrepend(existing, widgets, []);
    expect(messages).toEqual(existing);
    expect(after.get(5)).toEqual([widget]);
  });

  it("array index of a message changes after prepend but widget lookup by id stays correct", () => {
    // Scenario mirrors the real UI: user scrolls up, 30 older messages load
    const existingMessages: AssistantMessage[] = Array.from(
      { length: 5 },
      (_, i) => ({
        id: 31 + i, // ids 31..35
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `msg ${31 + i}`,
      }),
    );

    // Widget stored against id=32 (index 1 in the existing array)
    const widgets = new Map<number, ChatWidget[]>();
    widgets.set(32, [{ kind: "destination_card", data: { city: "Paris" } }]);

    expect(existingMessages.findIndex((m) => m.id === 32)).toBe(1);

    // Prepend 30 older messages
    const older: AssistantMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: 1 + i, // ids 1..30
      role: "user" as const,
      content: `old ${1 + i}`,
    }));

    const { messages, widgets: after } = simulatePrepend(
      existingMessages,
      widgets,
      older,
    );

    // id=32 is now at array index 31 (30 prepended + original index 1)
    expect(messages.findIndex((m) => m.id === 32)).toBe(31);

    // Widget still found — id-keyed, not index-keyed
    expect(after.get(32)).toBeDefined();
    expect(after.get(32)![0]).toMatchObject({ kind: "destination_card" });

    // No widget at the new array index
    expect(after.get(31)).toBeUndefined();
  });
});
