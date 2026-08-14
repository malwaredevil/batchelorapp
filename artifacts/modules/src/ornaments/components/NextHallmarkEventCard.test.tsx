/**
 * Render tests for NextHallmarkEventCard.
 *
 * WHY: NextHallmarkEventCard is the Ornaments collection page's primary
 * upcoming-event banner.  Three regressions are invisible without tests:
 *   1. The null early-return guard is removed → crash when events is empty.
 *   2. The "Live" / days-countdown branch fires incorrectly.
 *   3. The date range label drops the year from the end date (or adds it to
 *      the start date), breaking the "Oct 8 – Oct 10, 2026" format.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ── Mock wouter (avoid router context requirement) ────────────────────────────

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) =>
    React.createElement("a", { href }, children),
}));

// ── Mock the api-client-react hook ────────────────────────────────────────────

const mockUseUpcomingHallmarkEvents = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useUpcomingHallmarkEvents: (...args: unknown[]) =>
    mockUseUpcomingHallmarkEvents(...args),
}));

// Import AFTER mocking.
import { NextHallmarkEventCard } from "./NextHallmarkEventCard";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(id: string, startDate: string, endDate: string) {
  return {
    gcalId: id,
    title: `Open House ${id}`,
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

describe("NextHallmarkEventCard — null guard", () => {
  it("renders nothing (null) when upcoming events list is empty", () => {
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [],
      hallmarkCal: null,
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:00"));

    const { container } = render(<NextHallmarkEventCard />);

    expect(container.firstChild).toBeNull();
  });

  it("renders the card when at least one upcoming event exists", () => {
    const event = makeEvent("evt-1", "2026-09-10", "2026-09-12");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:00"));

    const { container } = render(<NextHallmarkEventCard />);

    expect(container.firstChild).not.toBeNull();
  });
});

describe("NextHallmarkEventCard — Live / countdown rendering", () => {
  it("shows 'Live' when the event is currently live", () => {
    const event = makeEvent("live-1", "2026-08-10", "2026-08-20");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:00"));

    render(<NextHallmarkEventCard />);

    expect(screen.getByTestId("hallmark-countdown-value").textContent).toBe(
      "Live",
    );
    // "days away" label must NOT appear when live
    expect(screen.queryByText("days away")).toBeNull();
  });

  it("shows 'Live' at exactly startMs (left boundary, inclusive)", () => {
    const event = makeEvent("bound-left", "2026-08-13", "2026-08-15");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    // Exactly midnight on the start date (= startMs)
    vi.setSystemTime(new Date("2026-08-13T00:00:00"));

    render(<NextHallmarkEventCard />);

    expect(screen.getByTestId("hallmark-countdown-value").textContent).toBe(
      "Live",
    );
  });

  it("shows 'Live' at exactly endMs (right boundary, inclusive)", () => {
    const event = makeEvent("bound-right", "2026-08-10", "2026-08-13");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    // Exactly 23:59:59 on the end date (= endMs)
    vi.setSystemTime(new Date("2026-08-13T23:59:59"));

    render(<NextHallmarkEventCard />);

    expect(screen.getByTestId("hallmark-countdown-value").textContent).toBe(
      "Live",
    );
  });

  it("shows a day count (not Live) when event is in the future", () => {
    const event = makeEvent("future", "2026-09-01", "2026-09-05");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    // Exactly 7 days before event start midnight
    vi.setSystemTime(new Date("2026-08-25T00:00:00"));

    render(<NextHallmarkEventCard />);

    const value = screen.getByTestId("hallmark-countdown-value");
    expect(value.textContent).toBe("7");
    expect(screen.getByText("days away")).toBeDefined();
  });

  it("shows the event title", () => {
    const event = makeEvent("open-house", "2026-09-10", "2026-09-14");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    expect(screen.getByText("Open House open-house")).toBeDefined();
  });
});

describe("NextHallmarkEventCard — date range label format", () => {
  it("includes year only on the end date ('Oct 8 – Oct 10, 2026' format)", () => {
    const event = makeEvent("fmt", "2026-10-08", "2026-10-10");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    // The date range label must be present
    const label = screen.getByText(/Oct 8/);
    expect(label.textContent).toMatch(/Oct 8\s*–\s*Oct 10, 2026/);
  });

  it("start date does NOT contain a year inline", () => {
    const event = makeEvent("fmt2", "2026-07-11", "2026-07-19");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-05-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    const label = screen.getByText(/Jul 11/);
    // "Jul 11 – Jul 19, 2026" — year appears only once, after the end date
    expect(label.textContent).toMatch(/^Jul 11\s*–\s*Jul 19, 2026$/);
  });
});

describe("NextHallmarkEventCard — href construction", () => {
  it("builds a deep-link with the correct view, month, and URL-encoded gcalId", () => {
    const event = makeEvent("evt-abc", "2026-10-08", "2026-10-10");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.href).toContain("view=month");
    expect(link.href).toContain("month=2026-10");
    expect(link.href).toContain(`event=${encodeURIComponent("evt-abc")}`);
  });

  it("uses gcalId (not the internal numeric id) in the event param", () => {
    // Regression guard: the href must carry the gcalId string, not an internal
    // row id.  The calendar page matches events by gcalId, so sending a numeric
    // id silently fails to auto-open any event detail.
    const event = makeEvent(
      "hallmark-gcal-string-id",
      "2026-11-05",
      "2026-11-07",
    );
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 42 }, // internal numeric id must NOT appear in the href
    });
    vi.setSystemTime(new Date("2026-09-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    const link = screen.getByRole("link") as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.searchParams.get("event")).toBe("hallmark-gcal-string-id");
    // The internal hallmarkCal.id (42) must not appear anywhere in the params.
    expect(url.searchParams.get("event")).not.toBe("42");
  });

  it("URL-encodes special characters in gcalId (@ → %40)", () => {
    // Google Calendar IDs commonly contain '@' (e.g. "abc@google.com").
    // encodeURIComponent converts '@' to '%40', which URLSearchParams.get()
    // then decodes back to '@' — so the round-trip is lossless.
    const gcalId = "abc123@google.com";
    const event = makeEvent(gcalId, "2026-10-08", "2026-10-10");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-08-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    const link = screen.getByRole("link") as HTMLAnchorElement;
    // The raw href must contain the percent-encoded '@'.
    expect(link.href).toContain("%40");
    // URLSearchParams must decode it back to the original gcalId string.
    const url = new URL(link.href);
    expect(url.searchParams.get("event")).toBe(gcalId);
  });

  it("full href structure: correct pathname, ?view=month, ?month=, and ?event= all present", () => {
    // Regression guard: a future refactor might drop one param (e.g. remove
    // ?view= or ?event= or change the path).  This test checks the whole URL
    // in one shot so none of the three params can be silently omitted.
    const event = makeEvent("evt-full", "2026-12-01", "2026-12-03");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-10-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    const link = screen.getByRole("link") as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.pathname).toBe("/ornaments/hallmark-events");
    expect(url.searchParams.get("view")).toBe("month");
    expect(url.searchParams.get("month")).toBe("2026-12");
    expect(url.searchParams.get("event")).toBe("evt-full");
  });

  it("full round-trip: params parsed by the same logic the calendar page uses", () => {
    // Reproduces exactly what hallmark-events.tsx does on mount:
    //   initialSearch.get("month") → validated against /^\d{4}-\d{2}$/
    //   initialSearch.get("event") → used as deepLinkEventId
    // A mismatch here means the card navigates to a URL the page can't parse.
    const gcalId = "hallmark-roundtrip-gcal-id";
    const startDate = "2026-11-08";
    const event = makeEvent(gcalId, startDate, "2026-11-10");
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [event],
      hallmarkCal: { id: 1 },
    });
    vi.setSystemTime(new Date("2026-09-01T12:00:00"));

    render(<NextHallmarkEventCard />);

    const link = screen.getByRole("link") as HTMLAnchorElement;
    const params = new URL(link.href).searchParams;

    // --- Replicate hallmark-events.tsx param-reading logic ---
    const m = params.get("month");
    const monthValid = m !== null && /^\d{4}-\d{2}$/.test(m);
    const parsedDate = monthValid ? new Date(`${m}-01T00:00:00`) : null;
    const initialCursor =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
    const deepLinkEventId = params.get("event");

    // The calendar page must be able to parse both params correctly.
    expect(initialCursor).not.toBeNull();
    expect(initialCursor?.getFullYear()).toBe(2026);
    expect(initialCursor?.getMonth()).toBe(10); // November = month index 10
    expect(deepLinkEventId).toBe(gcalId);
  });
});

describe("NextHallmarkEventCard — hook call options", () => {
  it("calls useUpcomingHallmarkEvents with no lookaheadDays (defaults to 1 year)", () => {
    mockUseUpcomingHallmarkEvents.mockReturnValue({
      events: [],
      hallmarkCal: null,
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:00"));

    render(<NextHallmarkEventCard />);

    // Called with no options (undefined) — the default 1-year window
    expect(mockUseUpcomingHallmarkEvents).toHaveBeenCalledWith();
  });
});
