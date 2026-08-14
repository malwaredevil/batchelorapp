/**
 * Unit tests for the exported pure helpers in ornaments-hallmark.ts.
 *
 * WHY: These helpers encapsulate the shared normalization (inclusive end date,
 * defensive date swap, startMs/endMs) and filter+sort logic used by
 * useUpcomingHallmarkEvents. A silent regression here would produce wrong
 * countdowns in both the Hub tile and the Ornaments collection card without
 * any type or console error.
 *
 * We import the real production-exported functions directly so that renaming,
 * removing, or breaking them makes these tests fail.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeHallmarkEvent,
  filterAndSortHallmarkEvents,
} from "./ornaments-hallmark";

// ── normalizeHallmarkEvent ────────────────────────────────────────────────────

describe("normalizeHallmarkEvent — date normalization", () => {
  it("preserves correctly forward-ordered dates", () => {
    const e = normalizeHallmarkEvent({
      id: "abc",
      title: "Open House",
      start: "2026-07-11T00:00:00",
      end: "2026-07-19T00:00:00",
    });
    expect(e.startDate).toBe("2026-07-11");
    expect(e.endDate).toBe("2026-07-19");
    expect(e.gcalId).toBe("abc");
    expect(e.title).toBe("Open House");
  });

  it("swaps start/end when event was entered backwards", () => {
    const e = normalizeHallmarkEvent({
      id: "backwards",
      title: "Backwards Event",
      start: "2026-08-20T00:00:00",
      end: "2026-08-10T00:00:00",
    });
    expect(e.startDate).toBe("2026-08-10");
    expect(e.endDate).toBe("2026-08-20");
  });

  it("handles single-day events (start === end)", () => {
    const e = normalizeHallmarkEvent({
      id: "single",
      title: "One Day",
      start: "2026-09-01T00:00:00",
      end: "2026-09-01T00:00:00",
    });
    expect(e.startDate).toBe("2026-09-01");
    expect(e.endDate).toBe("2026-09-01");
    // startMs < endMs because 00:00:00 < 23:59:59
    expect(e.startMs).toBeLessThan(e.endMs);
  });

  it("sets startMs to midnight (00:00:00) of the start date", () => {
    const e = normalizeHallmarkEvent({
      id: "t",
      title: "T",
      start: "2026-10-08T12:00:00",
      end: "2026-10-10T12:00:00",
    });
    expect(e.startMs).toBe(new Date("2026-10-08T00:00:00").getTime());
  });

  it("sets endMs to end-of-day (23:59:59) of the end date", () => {
    const e = normalizeHallmarkEvent({
      id: "t",
      title: "T",
      start: "2026-10-08T12:00:00",
      end: "2026-10-10T12:00:00",
    });
    expect(e.endMs).toBe(new Date("2026-10-10T23:59:59").getTime());
  });

  it("maps e.id to gcalId (not stored as 'id')", () => {
    const e = normalizeHallmarkEvent({
      id: "gcal-xyz",
      title: "T",
      start: "2026-10-01T00:00:00",
      end: "2026-10-02T00:00:00",
    });
    expect(e.gcalId).toBe("gcal-xyz");
  });
});

// ── filterAndSortHallmarkEvents ───────────────────────────────────────────────

describe("filterAndSortHallmarkEvents — filtering and ordering", () => {
  // Fixed nowMs: noon on 2026-08-13
  const NOW = new Date("2026-08-13T12:00:00").getTime();

  function make(
    id: string,
    startDate: string,
    endDate: string,
  ) {
    return normalizeHallmarkEvent({
      id,
      title: id,
      start: `${startDate}T00:00:00`,
      end: `${endDate}T00:00:00`,
    });
  }

  it("removes events whose end date is in the past", () => {
    const past = make("past", "2026-08-01", "2026-08-10");
    expect(filterAndSortHallmarkEvents([past], NOW)).toHaveLength(0);
  });

  it("keeps events that are currently live (endMs >= nowMs)", () => {
    const live = make("live", "2026-08-10", "2026-08-20");
    expect(filterAndSortHallmarkEvents([live], NOW)).toHaveLength(1);
  });

  it("keeps events that start in the future", () => {
    const future = make("future", "2026-09-01", "2026-09-05");
    expect(filterAndSortHallmarkEvents([future], NOW)).toHaveLength(1);
  });

  it("includes an event whose endMs is exactly nowMs (boundary: endMs === nowMs)", () => {
    // An event ending exactly at nowMs should still be included (>= not >)
    const boundary = make("boundary", "2026-08-13", "2026-08-13");
    // endMs = 23:59:59 today, which is > NOW (noon) → still included
    const result = filterAndSortHallmarkEvents([boundary], NOW);
    expect(result).toHaveLength(1);
  });

  it("sorts multiple upcoming events ascending by startMs", () => {
    const sep = make("sep", "2026-09-15", "2026-09-16");
    const aug = make("aug", "2026-08-20", "2026-08-21");
    const oct = make("oct", "2026-10-01", "2026-10-02");
    const sorted = filterAndSortHallmarkEvents([sep, oct, aug], NOW);
    expect(sorted.map((e) => e.gcalId)).toEqual(["aug", "sep", "oct"]);
  });

  it("returns empty array when all events are past", () => {
    const a = make("a", "2026-01-01", "2026-01-02");
    const b = make("b", "2026-05-01", "2026-05-03");
    expect(filterAndSortHallmarkEvents([a, b], NOW)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterAndSortHallmarkEvents([], NOW)).toHaveLength(0);
  });

  it("does not mutate the original array's order", () => {
    const events = [
      make("z", "2026-10-01", "2026-10-02"),
      make("a", "2026-08-20", "2026-08-21"),
    ];
    const original = events.map((e) => e.gcalId);
    filterAndSortHallmarkEvents(events, NOW);
    expect(events.map((e) => e.gcalId)).toEqual(original);
  });
});
