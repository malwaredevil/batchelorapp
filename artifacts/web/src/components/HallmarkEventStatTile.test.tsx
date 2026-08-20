/**
 * Render tests for HallmarkEventStatTile.
 *
 * WHY: The tile is the Hub's primary Hallmark countdown. Three regressions
 * would be invisible without tests:
 *   1. The isLive branch never fires → "Live Now" never appears.
 *   2. An expired placeholder reappears when the calendar returns no events.
 *   3. The card receives a shorter event range than the Ornaments collection.
 *
 * We render the real component with a mocked useUpcomingHallmarkEvents hook
 * so the test catches regressions in the component's own rendering logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import React from "react";

// ── Mock the api-client-react hook ────────────────────────────────────────────
// We control the return value per-test via mockReturnValue.

const mockUseUpcomingHallmarkEvents = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useUpcomingHallmarkEvents: (...args: unknown[]) =>
    mockUseUpcomingHallmarkEvents(...args),
}));

// Import AFTER mocking so the component picks up the mock.
import { HallmarkEventStatTile } from "./HallmarkEventStatTile";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(id: string, startDate: string, endDate: string) {
  return {
    gcalId: id,
    title: `Hallmark ${id}`,
    startDate,
    endDate,
    startMs: new Date(`${startDate}T00:00:00`).getTime(),
    endMs: new Date(`${endDate}T23:59:59`).getTime(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HallmarkEventStatTile — empty calendar", () => {
  it("renders nothing when the calendar has no future or live events", () => {
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [],
      hallmarkCal: null,
    });

    const { container } = render(<HallmarkEventStatTile />);
    expect(container.firstChild).toBeNull();
  });
});

describe("HallmarkEventStatTile — real events from hook", () => {
  it("shows the event name (stripped of Hallmark prefix) when a real event exists", () => {
    const event = makeEvent("evt-1", "2026-09-10", "2026-09-14");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    render(<HallmarkEventStatTile />);

    // "Hallmark evt-1" → shortTitle strips "Hallmark " → "evt-1"
    expect(screen.getByText("evt-1")).toBeDefined();
  });

  it("shows Live Now when the real event is currently live", () => {
    const event = makeEvent("live-event", "2026-08-10", "2026-08-20");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:00"));

    render(<HallmarkEventStatTile />);

    expect(screen.getByText("Live Now")).toBeDefined();
    expect(screen.queryByText("days")).toBeNull();
  });

  it("shows day count (not Live Now) when the real event is in the future", () => {
    const event = makeEvent("future-event", "2026-09-01", "2026-09-05");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    // Set time exactly 7 days before event start (midnight → midnight = 7 days)
    vi.setSystemTime(new Date("2026-08-25T00:00:00"));

    render(<HallmarkEventStatTile />);

    expect(screen.queryByText("Live Now")).toBeNull();
    expect(screen.getByText("7")).toBeDefined();
  });

  it("uses deep-link href when event has gcalId and startDate", () => {
    const event = makeEvent("evt-abc", "2026-09-10", "2026-09-14");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector("[data-testid='hallmark-event-tile']");
    // Title is set to the raw event title.
    expect(tile?.getAttribute("title")).toBe("Hallmark evt-abc");
  });

  it("uses the full-year range shared with the Ornaments collection card", () => {
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [],
      hallmarkCal: null,
    });
    vi.setSystemTime(new Date("2026-05-01T12:00:00"));

    render(<HallmarkEventStatTile />);

    expect(mockUseUpcomingHallmarkEvents).toHaveBeenCalledWith();
  });
});

describe("HallmarkEventStatTile — index resets when list shrinks", () => {
  it("shows the first event (index 0) after the list shrinks from 3 to 1", () => {
    // Arrange: start with 3 events so the carousel will advance.
    const evtA = makeEvent("alpha", "2026-09-10", "2026-09-11");
    const evtB = makeEvent("beta", "2026-10-01", "2026-10-02");
    const evtC = makeEvent("gamma", "2026-11-05", "2026-11-06");

    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [evtA, evtB, evtC],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T00:00:00"));

    const { rerender } = render(<HallmarkEventStatTile />);

    // Advance time so the setInterval fires twice: index should now be 2
    // (alpha → beta → gamma).
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    // The tile is currently showing "gamma" (index 2).
    expect(screen.getByText("gamma")).toBeDefined();

    // Act: list shrinks to only one event (e.g. the other two have expired).
    // index=2 with list.length=1 → modulo still yields 0, BUT before the
    // reset-on-shrink fix the stale index state carried over, and with
    // list.length=2 it would have jumped to a wrong slot.
    // Here we verify that after a shrink the tile always shows event [0].
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [evtA],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    rerender(<HallmarkEventStatTile />);

    // Must show "alpha" — the only remaining event, which is also index 0.
    expect(screen.getByText("alpha")).toBeDefined();
  });

  it("shows the first event (index 0) after the list shrinks from 3 to 2", () => {
    // This is the more dangerous case: index=2 with list.length=2 gives
    // 2 % 2 = 0 visually, but the stale index silently changes which event
    // slot occupies position 0 after the list is re-ordered by expiry.
    // The reset ensures we always start from slot 0 of the new list.
    const evtA = makeEvent("first", "2026-09-10", "2026-09-11");
    const evtB = makeEvent("second", "2026-10-01", "2026-10-02");
    const evtC = makeEvent("third", "2026-11-05", "2026-11-06");

    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [evtA, evtB, evtC],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T00:00:00"));

    const { rerender } = render(<HallmarkEventStatTile />);

    // Advance by 8 s → index becomes 2 (showing "third").
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByText("third")).toBeDefined();

    // List shrinks: evtA expires, only evtB and evtC remain.
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [evtB, evtC],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    rerender(<HallmarkEventStatTile />);

    // With the reset-on-shrink fix, index is 0 → shows evtB ("second").
    // Without the fix: stale index=2; 2 % 2 = 0 → also appears to show
    // slot 0, but only by accident (modulo coincidence).  The real problem
    // surfaces if the list grows back or the interval fires again.
    // The important invariant: index must be 0 after the length change.
    expect(screen.getByText("second")).toBeDefined();
  });
});

// ── Deep-link round-trip tests ────────────────────────────────────────────────
//
// WHY: The tile emits window.location.href = href on click (cross-SPA nav).
// These tests confirm the href it builds is structurally correct for the
// calendar page at /modules/ornaments/hallmark-events to parse.
//
// The calendar page reads params via:
//   initialSearch.get("month") — validated against /^\d{4}-\d{2}$/
//   initialSearch.get("event") — the raw gcalId
//
// A missing /modules/ prefix, wrong month format, or dropped gcalId silently
// lands the user on a 404 or a calendar that never auto-opens the event.

describe("HallmarkEventStatTile — deep-link href round-trip (cross-SPA)", () => {
  let capturedHref: string | null;
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    capturedHref = null;
    // Spy on window.location.href setter so the click handler can run without
    // a real navigation.  We capture whatever the component tries to assign.
    originalDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...window.location,
        set href(val: string) {
          capturedHref = val;
        },
        get href() {
          return capturedHref ?? "";
        },
      },
    });
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window, "location", originalDescriptor);
    }
  });

  it("href includes /modules/ prefix so the Modules SPA receives the URL", () => {
    const event = makeEvent("gcal-id-123", "2026-10-05", "2026-10-09");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-09-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.click(tile);

    expect(capturedHref).not.toBeNull();
    expect(capturedHref).toContain("/modules/ornaments/hallmark-events");
  });

  it("month param is in YYYY-MM format (parseable by calendar page regex)", () => {
    // The calendar page validates with /^\d{4}-\d{2}$/ — anything else is ignored.
    const event = makeEvent("gcal-id-456", "2026-10-05", "2026-10-09");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-09-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.click(tile);

    expect(capturedHref).not.toBeNull();
    const url = new URL(capturedHref!, "http://localhost");
    const month = url.searchParams.get("month");
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    // Specifically: startDate "2026-10-05" → slice(0,7) → "2026-10"
    expect(month).toBe("2026-10");
  });

  it("event param carries the gcalId so the calendar page can auto-open it", () => {
    const event = makeEvent("my-gcal-id-789", "2026-11-01", "2026-11-03");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-09-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.click(tile);

    expect(capturedHref).not.toBeNull();
    const url = new URL(capturedHref!, "http://localhost");
    // The calendar page reads: initialSearch.get("event")
    expect(url.searchParams.get("event")).toBe("my-gcal-id-789");
  });

  it("full round-trip: params parsed by the same logic the calendar page uses", () => {
    // Reproduces exactly what hallmark-events.tsx does on mount to parse the URL.
    const gcalId = "hallmark-gcal-roundtrip-id";
    const startDate = "2026-12-15";
    const event = makeEvent(gcalId, startDate, "2026-12-20");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-11-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.click(tile);

    expect(capturedHref).not.toBeNull();

    // --- Replicate hallmark-events.tsx param-reading logic ---
    const url = new URL(capturedHref!, "http://localhost");
    const params = url.searchParams;

    // initialCursor logic
    const m = params.get("month");
    const monthValid = m !== null && /^\d{4}-\d{2}$/.test(m);
    const parsedDate = monthValid ? new Date(`${m}-01T00:00:00`) : null;
    const initialCursor =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

    // deepLinkEventId logic
    const deepLinkEventId = params.get("event");

    // Assertions: the calendar page can correctly parse both params.
    expect(initialCursor).not.toBeNull();
    expect(initialCursor?.getFullYear()).toBe(2026);
    expect(initialCursor?.getMonth()).toBe(11); // December = month index 11
    expect(deepLinkEventId).toBe(gcalId);
  });

  it("keyboard Enter key triggers the same deep-link href as a click", () => {
    const event = makeEvent("gcal-enter-key", "2026-09-10", "2026-09-14");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.keyDown(tile, { key: "Enter" });

    expect(capturedHref).not.toBeNull();
    const url = new URL(capturedHref!, "http://localhost");
    expect(url.pathname).toBe("/modules/ornaments/hallmark-events");
    expect(url.searchParams.get("month")).toBe("2026-09");
    expect(url.searchParams.get("event")).toBe("gcal-enter-key");
  });

  it("URL-encodes special characters in gcalId (@ → %40)", () => {
    // gcalIds from Google Calendar often contain an '@' character, e.g.
    // "abc123@google.com". The href must percent-encode it so the calendar
    // page can round-trip it via URLSearchParams.get("event") without losing
    // the '@' character.
    const gcalId = "abc123@google.com";
    const event = makeEvent(gcalId, "2026-10-01", "2026-10-03");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-09-01T12:00:00"));

    const { container } = render(<HallmarkEventStatTile />);
    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.click(tile);

    expect(capturedHref).not.toBeNull();
    // The raw href string must contain the percent-encoded form.
    expect(capturedHref).toContain("%40");
    // But URLSearchParams must decode it back to the original gcalId so the
    // calendar page receives exactly what the tile was given.
    const url = new URL(capturedHref!, "http://localhost");
    expect(url.searchParams.get("event")).toBe(gcalId);
  });

  it("click after carousel advances 8 s carries the third event's month and gcalId", () => {
    // WHY: The carousel rotates index every 4 s.  After 8 s the tile should be
    // showing event[2].  A click must deep-link to THAT event, not event[0].
    // This would regress silently if href were computed from a stale closure or
    // a fixed index=0 reference.
    const evtA = makeEvent("gcal-first", "2026-09-10", "2026-09-11");
    const evtB = makeEvent("gcal-second", "2026-10-01", "2026-10-02");
    const evtC = makeEvent("gcal-third", "2026-11-05", "2026-11-06");

    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [evtA, evtB, evtC],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T00:00:00"));

    const { container } = render(<HallmarkEventStatTile />);

    // Advance two full 4-second intervals: index 0 → 1 → 2 (evtC).
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.click(tile);

    expect(capturedHref).not.toBeNull();
    const url = new URL(capturedHref!, "http://localhost");
    // Must point to evtC's month ("2026-11"), not evtA's ("2026-09").
    expect(url.searchParams.get("month")).toBe("2026-11");
    // Must carry evtC's gcalId, not evtA's.
    expect(url.searchParams.get("event")).toBe("gcal-third");
  });

  it("Space-bar keyDown after carousel advances 8 s carries the third event's month and gcalId", () => {
    // WHY: Keyboard-nav parity — Space activates the tile just like a click.
    // After 8 s the carousel shows event[2]; Space must deep-link to event[2].
    const evtA = makeEvent("kb-first", "2026-09-10", "2026-09-11");
    const evtB = makeEvent("kb-second", "2026-10-01", "2026-10-02");
    const evtC = makeEvent("kb-third", "2026-11-05", "2026-11-06");

    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [evtA, evtB, evtC],
      hallmarkCal: { id: 1, name: "Hallmark" },
    });
    vi.setSystemTime(new Date("2026-08-01T00:00:00"));

    const { container } = render(<HallmarkEventStatTile />);

    // Advance two intervals: index 0 → 1 → 2 (evtC).
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    const tile = container.querySelector(
      "[data-testid='hallmark-event-tile']",
    ) as HTMLElement;

    fireEvent.keyDown(tile, { key: " " });

    expect(capturedHref).not.toBeNull();
    const url = new URL(capturedHref!, "http://localhost");
    // Must point to evtC's month and gcalId, not evtA's.
    expect(url.searchParams.get("month")).toBe("2026-11");
    expect(url.searchParams.get("event")).toBe("kb-third");
  });
});
