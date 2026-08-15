import { describe, it, expect, beforeEach } from "vitest";
import {
  registerElaineTurn,
  publishElaineTurnEvent,
  completeElaineTurn,
  getElaineTurn,
  markElaineTurnHandoff,
  attachElaineTurnListener,
  detachElaineTurnListener,
  __resetElaineTurnRegistryForTests,
  type ElaineTurnEvent,
} from "./turn-registry";

describe("elaine turn registry", () => {
  beforeEach(() => {
    __resetElaineTurnRegistryForTests();
  });

  it("registers a turn retrievable only by its owner", () => {
    const turn = registerElaineTurn({ userId: 1, conversationId: 42 });
    expect(getElaineTurn(turn.turnId, 1)).toBe(turn);
    // Another user must never be able to attach to someone else's turn.
    expect(getElaineTurn(turn.turnId, 2)).toBeNull();
    expect(getElaineTurn("nonexistent", 1)).toBeNull();
  });

  it("buffers events in order and fans them out to attached listeners", () => {
    const turn = registerElaineTurn({ userId: 1, conversationId: null });
    publishElaineTurnEvent(turn, "status", { message: "Planning…" });

    const received: ElaineTurnEvent[] = [];
    const listener = (e: ElaineTurnEvent) => received.push(e);
    attachElaineTurnListener(turn, listener);

    publishElaineTurnEvent(turn, "delta", { text: "Hello" });
    publishElaineTurnEvent(turn, "delta", { text: " world" });

    // Buffer holds everything (for replay on attach)…
    expect(turn.events.map((e) => e.event)).toEqual([
      "status",
      "delta",
      "delta",
    ]);
    // …while the live listener only saw events after it attached.
    expect(received.map((e) => e.event)).toEqual(["delta", "delta"]);

    detachElaineTurnListener(turn, listener);
    publishElaineTurnEvent(turn, "delta", { text: "!" });
    expect(received).toHaveLength(2);
  });

  it("a throwing listener is dropped without affecting others", () => {
    const turn = registerElaineTurn({ userId: 1, conversationId: null });
    const received: ElaineTurnEvent[] = [];
    attachElaineTurnListener(turn, () => {
      throw new Error("boom");
    });
    attachElaineTurnListener(turn, (e) => received.push(e));

    publishElaineTurnEvent(turn, "delta", { text: "a" });
    publishElaineTurnEvent(turn, "delta", { text: "b" });
    expect(received).toHaveLength(2);
    // The broken listener was evicted after its first throw.
    expect(turn.listeners.size).toBe(1);
  });

  it("handoff flag flips only for the owning user and is idempotent", () => {
    const turn = registerElaineTurn({ userId: 7, conversationId: 3 });
    expect(markElaineTurnHandoff(turn.turnId, 8)).toBe(false);
    expect(turn.handoff).toBe(false);
    expect(markElaineTurnHandoff(turn.turnId, 7)).toBe(true);
    expect(markElaineTurnHandoff(turn.turnId, 7)).toBe(true);
    expect(turn.handoff).toBe(true);
  });

  it("completing a turn marks it done and clears listeners", () => {
    const turn = registerElaineTurn({ userId: 1, conversationId: null });
    attachElaineTurnListener(turn, () => {});
    publishElaineTurnEvent(turn, "done", { content: "final" });
    completeElaineTurn(turn);
    expect(turn.done).toBe(true);
    expect(turn.completedAt).not.toBeNull();
    expect(turn.listeners.size).toBe(0);
    // Still attachable (replay) within the retention window.
    expect(getElaineTurn(turn.turnId, 1)).toBe(turn);
    expect(turn.events.at(-1)?.event).toBe("done");
  });
});
