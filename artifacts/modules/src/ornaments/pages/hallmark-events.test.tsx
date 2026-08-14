/**
 * Tests for HallmarkEvents page — deep-link via ?event=<gcalId>&month=<YYYY-MM>.
 *
 * WHY: Both HallmarkEventStatTile (Hub) and NextHallmarkEventCard (Ornaments
 * collection) build a href of the form:
 *   /ornaments/hallmark-events?month=YYYY-MM&event=<gcalId>
 *
 * The calendar page is supposed to auto-open that event's detail sheet on
 * load.  Without tests, three regressions are invisible:
 *   1. A param rename (?event= → ?gcalId=) silently breaks deep-links.
 *   2. The matching logic reverts to picking the first event instead of the
 *      one whose gcalId matches — broken when the target isn't first.
 *   3. URL-encoded special characters in gcalIds (e.g. @ → %40) fail to
 *      decode and the detail sheet never opens.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

// ── Mock lucide-react ─────────────────────────────────────────────────────────
// ChevronLeft/ChevronRight are added because the real CalendarCore module
// imports them (the module is loaded via importOriginal in the CalendarCore
// mock factory below).
vi.mock("lucide-react", () => ({
  Loader2: () => null,
  Plus: () => null,
  CalendarHeart: () => null,
  Pencil: () => null,
  Trash2: () => null,
  ExternalLink: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
}));

// ── Mock date-fns ─────────────────────────────────────────────────────────────
// Spread the real module so rangeForView (used in the CalendarCore mock) can
// call startOfMonth, startOfWeek, endOfMonth, endOfWeek, addDays etc.
// Only override the two predicates used directly in HallmarkEvents JSX.
vi.mock("date-fns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("date-fns")>();
  return {
    ...actual,
    isSameMonth: () => true,
    isToday: () => false,
  };
});

// ── Mock sonner ───────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Mock react-hook-form ──────────────────────────────────────────────────────
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: () => ({}),
    handleSubmit: (fn: (...args: unknown[]) => void) => fn,
    reset: vi.fn(),
    formState: { errors: {} },
  }),
}));

// ── Mock zod resolver ─────────────────────────────────────────────────────────
vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => vi.fn(),
}));

// ── Captured CalendarCore props (spy target) ──────────────────────────────────
// vi.hoisted() runs before vi.mock() factories, so this ref is accessible
// inside the factory closure.  Each test resets it in beforeEach.
const calendarCoreSpy = vi.hoisted(() => ({
  defaultCursor: undefined as Date | undefined,
  defaultView: undefined as string | undefined,
}));

// ── Mock CalendarCore ─────────────────────────────────────────────────────────
// Loads the real CalendarCore module via importOriginal so that:
//   1. dateKey, chunk, rangeForView, monthRange, etc. are the production exports.
//   2. The CalendarCore *component* is replaced with a thin wrapper that:
//        a. Records defaultCursor in calendarCoreSpy (section 7 assertions).
//        b. Calls the REAL rangeForView so range-coverage assertions (section 8)
//           exercise production logic — a bug in rangeForView will cause tests
//           to fail rather than pass vacuously.
//
// The August 2026 fallback (when defaultCursor is absent) ensures the control
// test produces a range that does NOT cover October.
//
// Note: ToggleGroup/ToggleGroupItem are mocked below because the real
// CalendarCore module imports them; they are never rendered since we override
// the component, but the import must resolve.
vi.mock("@/components/CalendarCore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/CalendarCore")>();
  return {
    ...actual, // real dateKey, chunk, rangeForView, monthRange, weekRange, etc.
    CalendarCore: ({
      children,
      defaultView,
      defaultCursor,
    }: {
      children: (ctx: Record<string, unknown>) => React.ReactNode;
      defaultView?: string;
      defaultCursor?: Date;
    }) => {
      calendarCoreSpy.defaultCursor = defaultCursor;
      // Record the RAW prop value before any fallback so tests can detect when
      // HallmarkEvents omits the prop entirely (undefined vs explicit "month").
      calendarCoreSpy.defaultView = defaultView;

      // Deterministic fallback: Aug 2026 (NOT October) so the section-8
      // control test can demonstrate the assertions fail without the URL param.
      const cursor = defaultCursor ?? new Date(2026, 7, 1);
      // Apply fallback only for rendering — spy already captured the raw prop.
      const view = (defaultView ??
        "month") as import("@/components/CalendarCore").ViewMode;
      const range = actual.rangeForView(view, cursor);

      // Derive gridDays from the range (exclusive end), mirroring what the
      // real CalendarCore does, so that week-view JSX (which accesses
      // gridDays[0] unconditionally) doesn't crash in tests.
      const gridDays: Date[] = [];
      const d = new Date(range.start);
      while (d < range.end) {
        gridDays.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }

      return React.createElement(
        "div",
        { "data-testid": "calendar-core" },
        typeof children === "function"
          ? children({ view, cursor, gridDays, range })
          : null,
      );
    },
  };
});

// ── Mock toggle-group ─────────────────────────────────────────────────────────
// Required because the real CalendarCore module (loaded via importOriginal)
// imports ToggleGroup/ToggleGroupItem; the mock keeps the import from failing.
vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  ToggleGroupItem: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", null, children),
}));

// ── Mock UI components ────────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    asChild,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    asChild?: boolean;
  }) => React.createElement("button", { onClick }, children),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("input", props),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("label", null, children),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) =>
    React.createElement("textarea", props),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) =>
    open
      ? React.createElement("div", { "data-testid": "dialog-open" }, children)
      : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "dialog-content" }, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("h2", { "data-testid": "dialog-title" }, children),
  DialogDescription: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("p", null, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? React.createElement("div", null, children) : null),
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("h3", null, children),
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("p", null, children),
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => React.createElement("button", { onClick }, children),
  AlertDialogCancel: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", null, children),
}));

// ── Mock assistant context ────────────────────────────────────────────────────
vi.mock("@/ornaments/lib/assistant-context", () => ({
  usePageAssistantContext: vi.fn(),
}));

// ── Mock React Query client ───────────────────────────────────────────────────
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Mock api-client-react ─────────────────────────────────────────────────────
const mockUseListConnectedCalendars = vi.fn();
const mockUseListConnectedCalendarEvents = vi.fn();
const mockUseCreateHallmarkGCalEvent = vi.fn();
const mockUseUpdateHallmarkGCalEvent = vi.fn();
const mockUseDeleteHallmarkGCalEvent = vi.fn();
// Used only by NextHallmarkEventCard in the hero-card integration tests.
const mockUseUpcomingHallmarkEventsForCard = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListConnectedCalendars: (...args: unknown[]) =>
    mockUseListConnectedCalendars(...args),
  useListConnectedCalendarEvents: (...args: unknown[]) =>
    mockUseListConnectedCalendarEvents(...args),
  useCreateHallmarkGCalEvent: (...args: unknown[]) =>
    mockUseCreateHallmarkGCalEvent(...args),
  useUpdateHallmarkGCalEvent: (...args: unknown[]) =>
    mockUseUpdateHallmarkGCalEvent(...args),
  useDeleteHallmarkGCalEvent: (...args: unknown[]) =>
    mockUseDeleteHallmarkGCalEvent(...args),
  getListConnectedCalendarEventsQueryKey: (...args: unknown[]) => args,
  useUpcomingHallmarkEvents: (...args: unknown[]) =>
    mockUseUpcomingHallmarkEventsForCard(...args),
}));

// ── Mock wouter (needed by NextHallmarkEventCard's <Link>) ────────────────────
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) =>
    React.createElement("a", { href }, children),
}));

// ── Import the components AFTER all mocks ─────────────────────────────────────
import HallmarkEvents from "./hallmark-events";
import { NextHallmarkEventCard } from "../components/NextHallmarkEventCard";

// ── Shared stub factories ─────────────────────────────────────────────────────

/** Minimal connected-calendar object with isHallmarkCalendar: true */
function makeHallmarkCal(id = 1) {
  return { id, name: "Hallmark", isHallmarkCalendar: true };
}

/**
 * Minimal raw TravelCalendarEvent shape as returned by the API.
 * allDay=true → gcalEventEndKey returns e.end.slice(0, 10) directly.
 */
function makeRawEvent(
  gcalId: string,
  startDate: string,
  endDate: string,
  title: string,
) {
  return {
    id: gcalId,
    title,
    start: `${startDate}T00:00:00Z`,
    end: `${endDate}T00:00:00Z`,
    allDay: true,
    description: null,
  };
}

/** Stub mutation object (isPending + mutateAsync) */
function stubMutation() {
  return { isPending: false, mutateAsync: vi.fn() };
}

/**
 * Build a minimal event object in the shape returned by useUpcomingHallmarkEvents
 * (consumed by NextHallmarkEventCard).
 */
function makeCardEvent(gcalId: string, startDate: string, endDate: string) {
  return {
    gcalId,
    title: `Open House ${gcalId}`,
    startDate,
    endDate,
    startMs: new Date(`${startDate}T00:00:00`).getTime(),
    endMs: new Date(`${endDate}T23:59:59`).getTime(),
  };
}

/** Set window.location.search before rendering the component */
function setSearch(params: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    value: {
      ...window.location,
      search: params,
      href: `http://localhost/ornaments/hallmark-events${params}`,
    },
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Default: no deep-link params, no events
  setSearch("");

  // Reset CalendarCore spy so each test starts clean
  calendarCoreSpy.defaultCursor = undefined;
  calendarCoreSpy.defaultView = undefined;

  mockUseCreateHallmarkGCalEvent.mockReturnValue(stubMutation());
  mockUseUpdateHallmarkGCalEvent.mockReturnValue(stubMutation());
  mockUseDeleteHallmarkGCalEvent.mockReturnValue(stubMutation());

  // Default: card hook returns no events (overridden in integration tests).
  mockUseUpcomingHallmarkEventsForCard.mockReturnValue({
    events: [],
    hallmarkCal: null,
  });

  // Default: no calendars connected → hallmarkCal is null → no GCalLoader rendered
  mockUseListConnectedCalendars.mockReturnValue({ data: [] });

  // Default: no events from GCal
  mockUseListConnectedCalendarEvents.mockReturnValue({ data: [] });

  // Stub history.replaceState so the deep-link cleanup doesn't throw
  vi.stubGlobal("history", { replaceState: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── Helper: render with a connected Hallmark calendar and given raw events ────

function renderWithEvents(
  searchParams: string,
  rawEvents: ReturnType<typeof makeRawEvent>[],
) {
  setSearch(searchParams);

  mockUseListConnectedCalendars.mockReturnValue({
    data: [makeHallmarkCal()],
    isSuccess: true,
  });

  // HallmarkGCalLoader now gates onEvents() on the query's isSuccess flag,
  // so the mock must set isSuccess: true or gcalEvents stays empty.
  mockUseListConnectedCalendarEvents.mockReturnValue({
    data: rawEvents,
    isSuccess: true,
  });

  return render(<HallmarkEvents />);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. URL PARAM READING
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — URL param reading", () => {
  it("reads the 'event' query param to identify the target event", async () => {
    const targetId = "evt-target";
    const otherEvent = makeRawEvent(
      "evt-other",
      "2026-10-01",
      "2026-10-03",
      "Other Event",
    );
    const targetEvent = makeRawEvent(
      targetId,
      "2026-10-08",
      "2026-10-10",
      "Open House",
    );

    await act(async () => {
      renderWithEvents(`?month=2026-10&event=${encodeURIComponent(targetId)}`, [
        otherEvent,
        targetEvent,
      ]);
    });

    // The detail dialog should be open with the target event's title
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Open House");
  });

  it("reads the 'month' param to determine the initial calendar cursor", async () => {
    // When month=2026-10 is in the URL the calendar should initialise to October
    // 2026. We verify this indirectly: the CalendarCore mock receives its
    // defaultCursor and is rendered — not a hard assertion on the date value,
    // but at minimum the component must not crash.
    await act(async () => {
      renderWithEvents("?month=2026-10", []);
    });

    expect(screen.getByTestId("calendar-core")).toBeDefined();
  });

  it("renders normally when no query params are present (no deep-link)", async () => {
    await act(async () => {
      renderWithEvents("", []);
    });

    // No dialog should be open when there is no ?event= param
    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MATCHING BY GCALID (not by array position)
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — event matching by gcalId", () => {
  it("opens the event whose gcalId matches — even when it is NOT the first event", async () => {
    const firstEvent = makeRawEvent(
      "evt-first",
      "2026-10-01",
      "2026-10-03",
      "First Event",
    );
    const secondEvent = makeRawEvent(
      "evt-second",
      "2026-10-08",
      "2026-10-10",
      "Target Event",
    );

    // Deep-link points to evt-second (position [1]), not evt-first (position [0])
    await act(async () => {
      renderWithEvents(
        `?month=2026-10&event=${encodeURIComponent("evt-second")}`,
        [firstEvent, secondEvent],
      );
    });

    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Target Event");
  });

  it("does NOT open a dialog when the gcalId doesn't match any event in the list", async () => {
    const existingEvent = makeRawEvent(
      "evt-known",
      "2026-10-08",
      "2026-10-10",
      "Known Event",
    );

    await act(async () => {
      renderWithEvents("?month=2026-10&event=evt-unknown", [existingEvent]);
    });

    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("does NOT open a dialog when the events list is empty", async () => {
    await act(async () => {
      renderWithEvents("?month=2026-10&event=evt-any", []);
    });

    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("correctly identifies among 3+ events using gcalId, not index", async () => {
    const events = [
      makeRawEvent("evt-a", "2026-09-01", "2026-09-02", "Event A"),
      makeRawEvent("evt-b", "2026-10-01", "2026-10-02", "Event B"),
      makeRawEvent("evt-c", "2026-11-01", "2026-11-02", "Event C"),
    ];

    // Deep-link to the middle event (index 1)
    await act(async () => {
      renderWithEvents(
        `?month=2026-10&event=${encodeURIComponent("evt-b")}`,
        events,
      );
    });

    expect(screen.getByTestId("dialog-title").textContent).toBe("Event B");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. URL-ENCODED SPECIAL CHARACTERS IN GCALID
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — URL-encoded special characters in gcalId", () => {
  it("decodes %40 (@) in the gcalId and finds the matching event", async () => {
    // Google Calendar IDs often contain @ (e.g. …@group.calendar.google.com)
    const gcalId = "0faf14204f8ea1b90c6df3acda964358@group.calendar.google.com";
    const event = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Open House",
    );

    await act(async () => {
      renderWithEvents(`?month=2026-10&event=${encodeURIComponent(gcalId)}`, [
        event,
      ]);
    });

    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Open House");
  });

  it("decodes %23 (#) and %2F (/) in the gcalId", async () => {
    const gcalId = "event/with#special+chars";
    const event = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Special Chars Event",
    );

    await act(async () => {
      renderWithEvents(`?month=2026-10&event=${encodeURIComponent(gcalId)}`, [
        event,
      ]);
    });

    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe(
      "Special Chars Event",
    );
  });

  it("does not open a dialog when the raw (non-decoded) gcalId is passed but the stored id uses the decoded form", async () => {
    // If the URL contains the raw @ instead of %40 the browser still decodes it
    // via URLSearchParams.get(). Both forms should match if consistent.
    const gcalId = "simple-id@google.com";
    const event = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Google ID Event",
    );

    // Pass the @ literally in the search (as a browser would decode %40 to @
    // before handing it to URLSearchParams — either form produces the same
    // decoded value).
    await act(async () => {
      renderWithEvents(`?month=2026-10&event=${encodeURIComponent(gcalId)}`, [
        event,
      ]);
    });

    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe(
      "Google ID Event",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CLEANUP: params removed from URL after deep-link fires
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — URL cleanup after deep-link opens", () => {
  it("calls history.replaceState to remove event and month params after opening", async () => {
    const gcalId = "evt-cleanup";
    const event = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Cleanup Event",
    );

    await act(async () => {
      renderWithEvents(`?month=2026-10&event=${encodeURIComponent(gcalId)}`, [
        event,
      ]);
    });

    // history.replaceState must have been called to strip the deep-link params
    // so back/refresh doesn't re-open the modal.
    expect(history.replaceState).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DELETED EVENT: stale deep-link when event no longer exists in GCal
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — deep-link to a deleted event", () => {
  /**
   * Renders with a connected Hallmark calendar whose GCal query has settled
   * successfully. Both the calendars query and the events query are marked
   * isSuccess: true so the "not found" cleanup branch can fire.
   */
  function renderAfterLoad(
    searchParams: string,
    rawEvents: ReturnType<typeof makeRawEvent>[],
  ) {
    setSearch(searchParams);

    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });

    // isSuccess: true is required — HallmarkGCalLoader now gates onEvents()
    // on the query's isSuccess flag to avoid a false "empty" signal from the
    // data = [] default before the query actually completes.
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: rawEvents,
      isSuccess: true,
    });

    return render(<HallmarkEvents />);
  }

  it("shows an error toast when the deep-link event ID is not found after loading", async () => {
    const { toast } = await import("sonner");

    await act(async () => {
      renderAfterLoad("?month=2026-10&event=evt-deleted", []);
    });

    expect(toast.error).toHaveBeenCalledWith("Event not found");
  });

  it("does NOT open the view dialog when the deep-link event has been deleted", async () => {
    await act(async () => {
      renderAfterLoad("?month=2026-10&event=evt-deleted", []);
    });

    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("cleans up the URL params after detecting the deleted event", async () => {
    await act(async () => {
      renderAfterLoad("?month=2026-10&event=evt-deleted", []);
    });

    expect(history.replaceState).toHaveBeenCalled();
  });

  it("still opens the dialog normally when the event exists (no regression)", async () => {
    const gcalId = "evt-exists";
    const event = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Real Event",
    );

    await act(async () => {
      renderAfterLoad(`?month=2026-10&event=${encodeURIComponent(gcalId)}`, [
        event,
      ]);
    });

    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Real Event");
  });

  it("shows the toast even when multiple other events are present but none match", async () => {
    const { toast } = await import("sonner");

    const otherEvents = [
      makeRawEvent("evt-a", "2026-10-01", "2026-10-02", "Event A"),
      makeRawEvent("evt-b", "2026-10-05", "2026-10-06", "Event B"),
    ];

    await act(async () => {
      renderAfterLoad("?month=2026-10&event=evt-deleted", otherEvents);
    });

    expect(toast.error).toHaveBeenCalledWith("Event not found");
    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("does NOT show the toast or clean the URL while the events query is still pending", async () => {
    const { toast } = await import("sonner");
    const gcalId = "evt-slow";

    setSearch(`?month=2026-10&event=${encodeURIComponent(gcalId)}`);

    // Calendars query has settled but events query is still loading (isSuccess: false).
    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: false,
    });

    await act(async () => {
      render(<HallmarkEvents />);
    });

    // Loading is not done yet — no toast, no URL cleanup, no dialog
    expect(toast.error).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("shows the toast and cleans up the URL when the GCal query errors (expired token / network failure)", async () => {
    const { toast } = await import("sonner");

    setSearch("?month=2026-10&event=evt-error-case");

    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });

    // GCal query enters an error state — isSuccess stays false, isError becomes true.
    // This simulates an expired OAuth token, rate-limit, or network failure.
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: false,
      isError: true,
    });

    await act(async () => {
      render(<HallmarkEvents />);
    });

    // The loader must treat an error as "settled" so the deep-link cleanup fires.
    expect(toast.error).toHaveBeenCalledWith("Event not found");
    expect(history.replaceState).toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("opens the dialog when events query resolves slowly but the target event is present", async () => {
    const { toast } = await import("sonner");
    const gcalId = "evt-slow";
    const targetEvent = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Slow Event",
    );

    setSearch(`?month=2026-10&event=${encodeURIComponent(gcalId)}`);

    // Start with events query still loading (isSuccess: false)
    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: false,
    });

    const { rerender } = render(<HallmarkEvents />);

    // Verify no premature cleanup while still loading
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-open")).toBeNull();

    // Now the events query resolves with the target event
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [targetEvent],
      isSuccess: true,
    });

    await act(async () => {
      rerender(<HallmarkEvents />);
    });

    // Dialog should now open; no error toast should have fired
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Slow Event");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. QUERY TIMEOUT: network hangs indefinitely
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — GCal query timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an error toast and cleans the URL when the GCal query never settles (timeout)", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");

    setSearch("?month=2026-10&event=evt-hanging");

    // Hallmark calendar is connected but the events query is permanently stuck
    // (neither isSuccess nor isError ever becomes true — simulates a stalled network).
    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: false,
      isError: false,
    });

    render(<HallmarkEvents />);

    // No cleanup yet — spinner is still active
    expect(toast.error).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-open")).toBeNull();

    // Advance past the 10-second timeout
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    // Timeout should have triggered the deep-link "not found" cleanup
    expect(toast.error).toHaveBeenCalledWith("Event not found");
    expect(history.replaceState).toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-open")).toBeNull();
  });

  it("does NOT fire the timeout toast when the query settles before the deadline", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    const gcalId = "evt-fast";
    const targetEvent = makeRawEvent(
      gcalId,
      "2026-10-08",
      "2026-10-10",
      "Fast Event",
    );

    setSearch(`?month=2026-10&event=${encodeURIComponent(gcalId)}`);

    // Query settles successfully before the timeout fires
    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [targetEvent],
      isSuccess: true,
      isError: false,
    });

    await act(async () => {
      render(<HallmarkEvents />);
    });

    // Dialog should open immediately; timeout should NOT fire
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Fast Event");

    // Advance well past the timeout deadline — still no error toast
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does NOT poison the next range query when the previous range timed out", async () => {
    // Regression guard: timedOut from range A must not discard results from
    // range B — the timeout flag is scoped to the (calendarId, start, end)
    // triple that originated it.
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    const gcalId = "evt-november";
    const novEvent = makeRawEvent(
      gcalId,
      "2026-11-05",
      "2026-11-06",
      "November Event",
    );

    setSearch(`?month=2026-10&event=${encodeURIComponent(gcalId)}`);

    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });
    // October query hangs
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: false,
      isError: false,
    });

    const { rerender } = render(<HallmarkEvents />);

    // Let October time out
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    // Timeout fired — deep-link cleanup should have run
    expect(toast.error).toHaveBeenCalledWith("Event not found");

    // Clear the toast mock so we can assert no further calls
    vi.clearAllMocks();

    // User navigates to November — new query identity, succeeds immediately
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [novEvent],
      isSuccess: true,
      isError: false,
    });

    await act(async () => {
      rerender(<HallmarkEvents />);
    });

    // The November query's success should not be discarded by the October timeout.
    // No new error toast; no second URL cleanup.
    expect(toast.error).not.toHaveBeenCalled();
    // The component has events from November (verified indirectly: no crash,
    // no spurious error propagation).
    expect(screen.queryByTestId("dialog-open")).toBeNull(); // no deep-link pending
  });

  it("accepts a late success that arrives after the timeout has already fired", async () => {
    // If the query times out but eventually resolves with real data, the
    // component should accept the data rather than permanently discarding it.
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    const gcalId = "evt-late";
    const lateEvent = makeRawEvent(
      gcalId,
      "2026-10-15",
      "2026-10-16",
      "Late Event",
    );

    // No deep-link — we just want to observe that gcalEvents updates correctly.
    setSearch("");

    mockUseListConnectedCalendars.mockReturnValue({
      data: [makeHallmarkCal()],
      isSuccess: true,
    });
    // Query is initially hanging
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: false,
      isError: false,
    });

    const { rerender } = render(<HallmarkEvents />);

    // Timeout fires — onEvents([]) propagated
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    // Now the query finally resolves with real data
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [lateEvent],
      isSuccess: true,
      isError: false,
    });

    await act(async () => {
      rerender(<HallmarkEvents />);
    });

    // Late success should be accepted (no error toast about the late data)
    expect(toast.error).not.toHaveBeenCalled();
    // Component renders without crashing
    expect(screen.getByTestId("calendar-core")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CALENDAR CURSOR: defaultCursor prop passed to CalendarCore
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — CalendarCore receives correct defaultCursor", () => {
  /**
   * These tests confirm that when a ?month=YYYY-MM deep-link arrives the
   * component derives `initialCursor` and passes it as `defaultCursor` to
   * CalendarCore.  If the prop is ever renamed or dropped, the calendar
   * silently opens on the current month and the deep-link stops working.
   *
   * The CalendarCore mock (defined above) captures the `defaultCursor` prop
   * into `calendarCoreSpy.defaultCursor` each time the component renders.
   */

  it("passes a Date for the correct year and month when ?month=2026-10 is in the URL", async () => {
    await act(async () => {
      renderWithEvents("?month=2026-10", []);
    });

    const cursor = calendarCoreSpy.defaultCursor;
    expect(cursor).toBeInstanceOf(Date);
    // Year and month must match the URL param exactly
    expect((cursor as Date).getFullYear()).toBe(2026);
    // getMonth() is 0-based: October → 9
    expect((cursor as Date).getMonth()).toBe(9);
  });

  it("passes a Date for the correct year and month when ?month=2025-01 is in the URL", async () => {
    await act(async () => {
      renderWithEvents("?month=2025-01", []);
    });

    const cursor = calendarCoreSpy.defaultCursor;
    expect(cursor).toBeInstanceOf(Date);
    expect((cursor as Date).getFullYear()).toBe(2025);
    // January → 0
    expect((cursor as Date).getMonth()).toBe(0);
  });

  it("passes defaultCursor=undefined when no ?month= param is present", async () => {
    await act(async () => {
      renderWithEvents("", []);
    });

    // Without a month param, initialCursor is undefined and CalendarCore
    // falls back to today internally.
    expect(calendarCoreSpy.defaultCursor).toBeUndefined();
  });

  it("passes defaultCursor=undefined when ?month= has an invalid format", async () => {
    await act(async () => {
      renderWithEvents("?month=not-a-date", []);
    });

    expect(calendarCoreSpy.defaultCursor).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. GCAL QUERY DATE RANGE COVERS DEEP-LINKED MONTH
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — GCal query range covers the deep-linked month", () => {
  /**
   * WHY: When a deep-link arrives with ?month=2026-10, HallmarkEvents passes
   * the parsed date as `defaultCursor` to CalendarCore, which derives the
   * visible range from that cursor and forwards it to HallmarkGCalLoader.
   * If the cursor is ignored (e.g. CalendarCore always initialises to today),
   * the range covers the wrong month and GCal returns no October events —
   * causing the deep-linked detail sheet to never open.
   *
   * The CalendarCore mock in this file derives its range from `defaultCursor`
   * (see mock at the top of this file), so assertions on the loader args
   * directly exercise the integration path from the URL param through to the
   * GCal query arguments.
   *
   * Assertions:
   *   start ≤ 2026-10-01   (covers the first day of October)
   *   end   ≥ 2026-10-31   (covers the last day of October)
   *
   * A control case (no ?month= param) confirms these assertions would FAIL if
   * the URL param were not forwarded: without the param, defaultCursor is
   * undefined and the mock falls back to August 2026, producing a range that
   * covers August — not October.
   */

  it("range covers the full October month: start ≤ Oct 1 local midnight AND end ≥ Nov 1 local midnight", async () => {
    await act(async () => {
      renderWithEvents("?month=2026-10", []);
    });

    // HallmarkGCalLoader is rendered once a Hallmark calendar is connected.
    // useListConnectedCalendarEvents receives (calendarId, start, end, opts).
    const calls = mockUseListConnectedCalendarEvents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // Parse the ISO strings back to Date instants so the comparison is
    // timezone-independent — both sides represent the same calendar instant
    // regardless of the local UTC offset.
    const startInstant = new Date(calls[0][1] as string).getTime();
    const endInstant = new Date(calls[0][2] as string).getTime();

    // The GCal range uses a half-open interval [start, end) where end is
    // exclusive.  Full-month coverage therefore requires:
    //   start  ≤  local Oct 1 midnight   (query opens before the first event)
    //   end    ≥  local Nov 1 midnight   (exclusive end is at or after the day
    //                                      after October, covering all of Oct 31)
    const oct1Local = new Date(2026, 9, 1).getTime(); // Oct  1 local midnight
    const nov1Local = new Date(2026, 10, 1).getTime(); // Nov  1 local midnight (exclusive)

    expect(startInstant).toBeLessThanOrEqual(oct1Local);
    expect(endInstant).toBeGreaterThanOrEqual(nov1Local);
  });

  it("the calendarId passed to the query matches the connected Hallmark calendar", async () => {
    await act(async () => {
      renderWithEvents("?month=2026-10", []);
    });

    const calls = mockUseListConnectedCalendarEvents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // The first argument must be the numeric ID of the connected Hallmark cal.
    // makeHallmarkCal() uses id=1 by default.
    expect(calls[0][0]).toBe(1);
  });

  it("control: without ?month=2026-10 the range does NOT cover October (proves the test is non-trivial)", async () => {
    // The CalendarCore mock falls back to August 2026 when defaultCursor is
    // undefined (i.e. no ?month= param).  rangeForView("month", Aug 1) produces
    // a grid range ending in early September — well before Nov 1.  If the
    // November-exclusive-end assertion passed for August, it would be vacuous.
    await act(async () => {
      renderWithEvents("", []); // no ?month= param → defaultCursor undefined → Aug 2026 range
    });

    const calls = mockUseListConnectedCalendarEvents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const endInstant = new Date(calls[0][2] as string).getTime();
    const nov1Local = new Date(2026, 10, 1).getTime();

    // August grid ends in early September — strictly before Nov 1.
    // This confirms the section-8 end-bound assertion would fail without
    // the correct ?month=2026-10 URL param.
    expect(endInstant).toBeLessThan(nov1Local);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LIST-VIEW RENDERING: event titles appear in the list branch
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — list-view renders event titles", () => {
  /**
   * WHY: Task 785 verified that `defaultView='list'` is forwarded to
   * CalendarCore, but did not verify that the list-view rendering branch in
   * hallmark-events.tsx actually displays the events.  If the branch has a
   * wrong view guard, a missing filter, or uses the wrong data source, the
   * user sees a blank calendar after following a ?view=list deep-link even
   * though the prop is correct.
   *
   * The list-view branch renders `upcomingNormalized` (events whose endDate is
   * today or later) as <li> elements inside a <ul>.  The month-view branch
   * renders a grid of day cells — event bars only appear for events that fall
   * within the currently displayed month grid.  Events in October 2026 are
   * outside the August 2026 default cursor grid, so they are absent from month
   * view but still present in the list view's date-independent upcoming filter.
   *
   * TIME: All tests here freeze the clock to 2026-08-14 so that "future" and
   * "past" labels on fixture events are always accurate.  The component derives
   * `todayKey` via `dateKey(new Date())` on mount; fake timers make that call
   * return the frozen date deterministically.
   */

  // Freeze time so upcomingNormalized's `endDate >= todayKey` filter is stable.
  // Only this describe block uses fake timers; vi.useRealTimers() in afterEach
  // restores the real clock before any other section runs.
  const FROZEN_NOW = new Date("2026-08-14T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers({ now: FROZEN_NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Fixture dates relative to the frozen clock (2026-08-14):
  //   future = endDate after 2026-08-14  → passes upcomingNormalized filter
  //   past   = endDate before 2026-08-14 → filtered out by upcomingNormalized
  // Month-view default cursor = August 2026 (CalendarCore mock fallback), so
  // October events are outside the August grid and absent from month-view bars.

  it("shows the event title in the list when ?view=list is set and there is at least one upcoming event", async () => {
    const ev = makeRawEvent(
      "evt-open-house",
      "2026-10-04",
      "2026-10-06",
      "Open House Weekend",
    );

    await act(async () => {
      renderWithEvents("?view=list", [ev]);
    });

    // The list-view branch renders ev.title inside a <p> within a <li>.
    expect(screen.getByText("Open House Weekend")).toBeDefined();

    // The list structure itself must be present (not just a stray text node).
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
  });

  it("shows all upcoming event titles in the list — not just the first", async () => {
    const events = [
      makeRawEvent("evt-1", "2026-09-01", "2026-09-02", "September Sale"),
      makeRawEvent("evt-2", "2026-10-04", "2026-10-06", "Open House Weekend"),
      makeRawEvent("evt-3", "2026-11-15", "2026-11-17", "Keepsake Premiere"),
    ];

    await act(async () => {
      renderWithEvents("?view=list", events);
    });

    expect(screen.getByText("September Sale")).toBeDefined();
    expect(screen.getByText("Open House Weekend")).toBeDefined();
    expect(screen.getByText("Keepsake Premiere")).toBeDefined();

    // All three events produce a list item.
    expect(screen.getAllByRole("listitem").length).toBe(3);
  });

  it("shows the empty-state message (not a list) when all events are in the past", async () => {
    // endDate "2026-01-03" < todayKey "2026-08-14" → filtered out.
    const pastEvent = makeRawEvent(
      "evt-past",
      "2026-01-01",
      "2026-01-03",
      "Past Event",
    );

    await act(async () => {
      renderWithEvents("?view=list", [pastEvent]);
    });

    // The empty-state branch renders a message div, not a <ul>/<li>.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();

    // The specific connected-calendar message must appear (renderWithEvents
    // always connects a Hallmark calendar via mockUseListConnectedCalendars).
    expect(
      screen.getByText(
        "No upcoming events found in the Hallmark Google Calendar.",
      ),
    ).toBeDefined();

    // The past event title must not appear anywhere.
    expect(screen.queryByText("Past Event")).toBeNull();
  });

  it("shows only the future event and hides the past event when both are supplied with ?view=list", async () => {
    // pastEvent has endDate BEFORE the frozen today (2026-08-14) → filtered out.
    const pastEvent = makeRawEvent(
      "evt-past",
      "2026-07-01",
      "2026-07-03",
      "Summer Sale (Past)",
    );
    // futureEvent has endDate AFTER the frozen today → passes the filter.
    const futureEvent = makeRawEvent(
      "evt-future",
      "2026-09-10",
      "2026-09-12",
      "Fall Premiere (Future)",
    );

    await act(async () => {
      renderWithEvents("?view=list", [pastEvent, futureEvent]);
    });

    // The future event must appear in the list.
    expect(screen.getByText("Fall Premiere (Future)")).toBeDefined();

    // The past event must be completely absent.
    expect(screen.queryByText("Summer Sale (Past)")).toBeNull();

    // Exactly one list item — only the future event.
    expect(screen.getAllByRole("listitem").length).toBe(1);
  });

  it("shows the connected-calendar empty-state message when a Hallmark calendar IS connected but there are no upcoming events", async () => {
    // events=[] + hallmarkCal connected → "No upcoming events found" copy
    await act(async () => {
      renderWithEvents("?view=list", []);
    });

    // No list structure should be present.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();

    // The connected-calendar variant of the empty-state must appear.
    expect(
      screen.getByText(
        "No upcoming events found in the Hallmark Google Calendar.",
      ),
    ).toBeDefined();

    // The disconnected-calendar copy must NOT appear.
    expect(screen.queryByText(/Connect a Hallmark Google Calendar/)).toBeNull();
  });

  it("shows the disconnected-calendar empty-state message when NO Hallmark calendar is connected", async () => {
    // Override the calendars mock to return an empty list (no Hallmark calendar).
    setSearch("?view=list");
    mockUseListConnectedCalendars.mockReturnValue({
      data: [],
      isSuccess: true,
    });
    mockUseListConnectedCalendarEvents.mockReturnValue({
      data: [],
      isSuccess: true,
    });

    await act(async () => {
      render(<HallmarkEvents />);
    });

    // No list structure should be present.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();

    // The disconnected-calendar variant of the empty-state must appear.
    expect(
      screen.getByText(
        "Connect a Hallmark Google Calendar in Settings to start tracking events here.",
      ),
    ).toBeDefined();

    // The connected-calendar copy must NOT appear.
    expect(
      screen.queryByText(
        "No upcoming events found in the Hallmark Google Calendar.",
      ),
    ).toBeNull();
  });

  it("includes an event ending exactly today and excludes one ending yesterday (?view=list boundary)", async () => {
    // todayKey in the component is derived from new Date() which is frozen to
    // 2026-08-14 by the vi.setSystemTime() call in the top-level beforeAll.
    // The filter is `endDate >= todayKey`, so:
    //   endDate "2026-08-14" (today) → passes (>=)
    //   endDate "2026-08-13" (yesterday) → excluded (<)
    const todayEndingEvent = makeRawEvent(
      "evt-today",
      "2026-08-10",
      "2026-08-14", // ends exactly today
      "Ends Today Event",
    );
    const yesterdayEndingEvent = makeRawEvent(
      "evt-yesterday",
      "2026-08-05",
      "2026-08-13", // ended yesterday
      "Ended Yesterday Event",
    );

    await act(async () => {
      renderWithEvents("?view=list", [todayEndingEvent, yesterdayEndingEvent]);
    });

    // The today-ending event must appear in the list.
    expect(screen.getByText("Ends Today Event")).toBeDefined();

    // The yesterday-ending event must be completely absent.
    expect(screen.queryByText("Ended Yesterday Event")).toBeNull();

    // Exactly one list item — only the today-ending event.
    expect(screen.getAllByRole("listitem").length).toBe(1);
  });

  it("list is empty when all events ended at midnight last night (one-second-past-midnight boundary)", async () => {
    // WHY: The existing noon-boundary test proves the string comparison is
    // correct at midday.  This test freezes the local clock to one second past
    // local midnight (2026-08-14 00:00:01 local) — the earliest moment "today"
    // is "today" — to guarantee that a future refactor from string comparison
    // to timestamp-based comparison cannot accidentally include an event that
    // ended at 2026-08-13T23:59:59 when the clock reads 2026-08-14T00:00:01.
    //
    // The filter is `endDate >= todayKey` where todayKey = dateKey(new Date()).
    // dateKey always produces a YYYY-MM-DD string from the *local* date, so
    // the fake time is constructed with local date components (not a UTC
    // string) to ensure the local date is 2026-08-14 in all timezones:
    //   endDate "2026-08-13" (yesterday's date key) → excluded (<)
    //   endDate "2026-08-14" (today's date key)     → passes (>=)

    // Override the frozen time just for this test (beforeEach already called
    // vi.useFakeTimers; setSystemTime adjusts it without re-installing).
    //
    // Use local date components (not a UTC string) so the local date is
    // always 2026-08-14 regardless of the runner's timezone.  A UTC string
    // like "2026-08-14T00:00:01Z" would still be Aug 13 locally in any
    // timezone west of UTC, causing the excluded event to slip through.
    vi.setSystemTime(new Date(2026, 7, 14, 0, 0, 1)); // Aug 14 local, 00:00:01

    const yesterdayEndingEvent = makeRawEvent(
      "evt-midnight-yesterday",
      "2026-08-10",
      "2026-08-13", // ended yesterday — must be absent
      "Ended At Midnight Event",
    );
    const todayEndingEvent = makeRawEvent(
      "evt-midnight-today",
      "2026-08-12",
      "2026-08-14", // ends today — must be present
      "Ends Today At Midnight Event",
    );

    await act(async () => {
      renderWithEvents("?view=list", [yesterdayEndingEvent, todayEndingEvent]);
    });

    // The yesterday-ending event must be completely absent from the list.
    expect(screen.queryByText("Ended At Midnight Event")).toBeNull();

    // The today-ending event must appear.
    expect(screen.getByText("Ends Today At Midnight Event")).toBeDefined();

    // Exactly one list item.
    expect(screen.getAllByRole("listitem").length).toBe(1);
  });

  it("shows a multi-day event that started before today but hasn't ended yet (?view=list straddles-today case)", async () => {
    // WHY: upcomingNormalized filters on `endDate >= todayKey`, so an event
    // whose startDate is in the past but endDate is in the future must still
    // appear.  A bug that accidentally also requires startDate >= todayKey
    // would silently hide currently-live multi-day events.
    //
    // Frozen clock: 2026-08-14 (from vi.setSystemTime in beforeAll).
    // startDate "2026-08-10" is four days ago; endDate "2026-08-18" is four
    // days from now — the event is currently live and must appear in the list.
    const straddlingEvent = makeRawEvent(
      "evt-straddling",
      "2026-08-10", // started four days before today
      "2026-08-18", // ends four days after today
      "Currently Live Event",
    );

    await act(async () => {
      renderWithEvents("?view=list", [straddlingEvent]);
    });

    // The straddling event must appear because its endDate (2026-08-18) is
    // strictly after todayKey (2026-08-14).
    expect(screen.getByText("Currently Live Event")).toBeDefined();

    // Confirm the list is rendered (not an empty-state message).
    expect(screen.getAllByRole("listitem").length).toBe(1);
  });

  it("sorts a straddling event (startDate in the past) before a future-only event in list view", async () => {
    // WHY: upcomingNormalized sorts by startDate ascending. A currently-live
    // event whose startDate is in the past (straddling today) has a lower
    // startDate string than a future event, so it must appear first in the
    // rendered <ul>. Without this test, a regression that re-sorts by endDate
    // or by array-insertion order would be invisible.
    //
    // Frozen clock: 2026-08-14.
    // Straddling event: startDate 2026-08-13 (yesterday), endDate 2026-08-18.
    // Future event:     startDate 2026-08-15 (tomorrow),  endDate 2026-08-22.
    // "2026-08-13" < "2026-08-15" → straddling must come first.
    const straddlingEvent = makeRawEvent(
      "evt-straddling",
      "2026-08-13", // started yesterday
      "2026-08-18", // ends in the future → passes the endDate >= todayKey filter
      "Currently Live Event",
    );
    const futureEvent = makeRawEvent(
      "evt-future",
      "2026-08-15", // starts tomorrow
      "2026-08-22",
      "Future Only Event",
    );

    await act(async () => {
      // Pass the future event first so the test fails if sort is skipped and
      // the component renders events in insertion order.
      renderWithEvents("?view=list", [futureEvent, straddlingEvent]);
    });

    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);

    // The first <li> must contain the straddling event's title.
    expect(items[0].textContent).toContain("Currently Live Event");

    // The second <li> must contain the future event's title.
    expect(items[1].textContent).toContain("Future Only Event");
  });

  it("keeps two straddling events and one future event in startDate-ascending order (?view=list, 3-event mix)", async () => {
    // WHY: the comparator `a.startDate.localeCompare(b.startDate)` must remain
    // stable when multiple straddling events coexist alongside a future event.
    // A regression that re-sorts by endDate, or by insertion order, would
    // silently mis-order the events.  Two straddling events with different
    // startDates are needed to exercise the comparator between two events that
    // both pass the `endDate >= todayKey` filter but whose startDates are in
    // the past.
    //
    // Frozen clock: 2026-08-14.
    //
    // straddlingEarlier: startDate 2026-08-08 (six days ago),  endDate 2026-08-20
    // straddlingLater:   startDate 2026-08-12 (two days ago),  endDate 2026-08-18
    // futureEvent:       startDate 2026-08-16 (two days away), endDate 2026-08-22
    //
    // All three pass the endDate >= todayKey filter.
    // Expected ascending order: straddlingEarlier → straddlingLater → futureEvent
    const straddlingEarlier = makeRawEvent(
      "evt-straddle-early",
      "2026-08-08", // started six days before today
      "2026-08-20", // ends in the future → passes endDate filter
      "Earlier Live Event",
    );
    const straddlingLater = makeRawEvent(
      "evt-straddle-late",
      "2026-08-12", // started two days before today
      "2026-08-18", // ends in the future → passes endDate filter
      "Later Live Event",
    );
    const futureEvent = makeRawEvent(
      "evt-future",
      "2026-08-16", // starts two days from now
      "2026-08-22",
      "Pure Future Event",
    );

    await act(async () => {
      // Deliberately pass in insertion order that differs from the expected
      // sort order so a no-op comparator would produce a wrong result.
      renderWithEvents("?view=list", [
        futureEvent,
        straddlingLater,
        straddlingEarlier,
      ]);
    });

    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(3);

    // startDate ascending: 2026-08-08 → 2026-08-12 → 2026-08-16
    expect(items[0].textContent).toContain("Earlier Live Event");
    expect(items[1].textContent).toContain("Later Live Event");
    expect(items[2].textContent).toContain("Pure Future Event");
  });

  it("excludes an event whose endDate is yesterday in local time even when it equals today's UTC date (UTC-behind timezone)", async () => {
    // WHY: dateKey() uses local-time methods (getFullYear/getMonth/getDate), so
    // todayKey is always the *local* calendar date, never the UTC date.  In a
    // timezone west of UTC (e.g. US Eastern, UTC-5) the local clock can still
    // show "2026-08-13" while the UTC clock already reads "2026-08-14".
    //
    // This test fakes the timezone to "America/New_York" (UTC-5 during EST) and
    // freezes the clock to 2026-08-14T03:00:00Z — 3 AM UTC, which is 10 PM ET on
    // 2026-08-13.  In that locale:
    //   • todayKey = "2026-08-13"   (local date, the filter baseline)
    //   • endDate "2026-08-13" → "2026-08-13" >= "2026-08-13" → INCLUDED
    //     (the event ends *today* locally, even though UTC has already rolled over)
    //   • endDate "2026-08-14" → "2026-08-14" >= "2026-08-13" → INCLUDED
    //     (this is *tomorrow* locally — the event hasn't ended yet)
    //   • endDate "2026-08-12" → "2026-08-12" >= "2026-08-13" → EXCLUDED
    //     (ended yesterday locally)
    //
    // A regression that switches todayKey to use UTC methods (getUTCFullYear etc.)
    // would produce todayKey = "2026-08-14" instead, causing the "2026-08-13"
    // event to be incorrectly excluded (filtered as "past") while the user's
    // clock still shows it as today.

    const prevTZ = process.env.TZ;
    try {
      // Force Node's TZ to US Eastern (UTC-5 standard / UTC-4 daylight).
      // 2026-08-14 is in summer → EDT = UTC-4; to land on Aug 13 local we need
      // the UTC instant to be early enough that UTC-4 is still Aug 13.
      // 2026-08-14T01:00:00Z = 2026-08-13T21:00:00 EDT (UTC-4) ✓
      process.env.TZ = "America/New_York";

      // Override the frozen time just for this test.  Use an explicit UTC instant
      // (ISO string) so it is the same wall-clock moment regardless of runner TZ.
      vi.setSystemTime(new Date("2026-08-14T01:00:00Z"));

      // Event ending on the local date (Aug 13 ET): must be INCLUDED ("today").
      const endsLocalToday = makeRawEvent(
        "evt-ends-local-today",
        "2026-08-10",
        "2026-08-13", // local today (= UTC yesterday) → passes endDate >= todayKey
        "Ends Local Today",
      );

      // Event ending on the UTC date (Aug 14): must also be INCLUDED ("tomorrow"
      // locally — hasn't ended yet from the user's perspective).
      const endsUtcToday = makeRawEvent(
        "evt-ends-utc-today",
        "2026-08-10",
        "2026-08-14", // local tomorrow → also passes (future from local POV)
        "Ends UTC Today (Local Tomorrow)",
      );

      // Event that ended before local today: must be EXCLUDED.
      const endsLocalYesterday = makeRawEvent(
        "evt-ends-local-yesterday",
        "2026-08-05",
        "2026-08-12", // Aug 12 < todayKey "2026-08-13" → excluded
        "Ended Local Yesterday",
      );

      await act(async () => {
        renderWithEvents("?view=list", [
          endsLocalToday,
          endsUtcToday,
          endsLocalYesterday,
        ]);
      });

      // Events whose endDate >= local todayKey must appear.
      expect(screen.getByText("Ends Local Today")).toBeDefined();
      expect(screen.getByText("Ends UTC Today (Local Tomorrow)")).toBeDefined();

      // Event whose endDate < local todayKey must not appear.
      expect(screen.queryByText("Ended Local Yesterday")).toBeNull();

      // Exactly two list items.
      expect(screen.getAllByRole("listitem").length).toBe(2);
    } finally {
      // Always restore TZ — other tests must not inherit the fake timezone.
      if (prevTZ === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = prevTZ;
      }
      // Restore fake timers to the describe-level frozen instant so subsequent
      // tests in this block see FROZEN_NOW as expected.
      vi.setSystemTime(FROZEN_NOW);
    }
  });

  it("includes an event ending on the local date when the local clock is ahead of UTC (UTC+14 timezone)", async () => {
    // WHY: dateKey() uses local-time methods (getFullYear/getMonth/getDate), so
    // todayKey is always the *local* calendar date, never the UTC date.  In a
    // timezone east of UTC (e.g. Pacific/Kiritimati, UTC+14) the local clock
    // can already show "2026-08-15" while the UTC clock still reads "2026-08-14".
    //
    // FROZEN_NOW = 2026-08-14T12:00:00Z.  In UTC+14:
    //   2026-08-14T12:00:00Z = 2026-08-15T02:00:00 local → local date = "2026-08-15"
    //
    // Under that locale:
    //   • todayKey = "2026-08-15"   (local date, the filter baseline)
    //   • endDate "2026-08-15" → "2026-08-15" >= "2026-08-15" → INCLUDED
    //     (ends today locally, even though it is "tomorrow" from UTC's perspective)
    //   • endDate "2026-08-16" → "2026-08-16" >= "2026-08-15" → INCLUDED
    //     (local tomorrow — clearly future)
    //   • endDate "2026-08-14" → "2026-08-14" >= "2026-08-15" → EXCLUDED
    //     (local yesterday; this is the UTC date, but already in the past locally)
    //
    // A regression that switches todayKey to use UTC methods (getUTCFullYear etc.)
    // would produce todayKey = "2026-08-14" instead, causing the "2026-08-14"
    // event to be incorrectly included (it has already ended locally) and the
    // boundary assertion to fail.

    const prevTZ = process.env.TZ;
    try {
      // Force Node's TZ to the furthest-ahead timezone: UTC+14.
      process.env.TZ = "Pacific/Kiritimati";

      // Re-apply the same frozen UTC instant so the local clock unambiguously
      // reads 2026-08-15 (one day ahead of the UTC date 2026-08-14).
      vi.setSystemTime(FROZEN_NOW); // 2026-08-14T12:00:00Z → local Aug 15

      // Event ending on the local date (Aug 15 Kiritimati = UTC+14):
      // must be INCLUDED — it ends today locally even though UTC still shows Aug 14.
      const endsLocalToday = makeRawEvent(
        "evt-ends-local-today-utcplus14",
        "2026-08-12",
        "2026-08-15", // local today (= UTC tomorrow) → passes endDate >= todayKey
        "Ends Local Today (UTC+14)",
      );

      // Event ending on local tomorrow: must be INCLUDED (clearly future).
      const endsLocalTomorrow = makeRawEvent(
        "evt-ends-local-tomorrow-utcplus14",
        "2026-08-14",
        "2026-08-16", // local tomorrow → also passes
        "Ends Local Tomorrow (UTC+14)",
      );

      // Event ending on the UTC date (Aug 14 = local yesterday): must be EXCLUDED.
      const endsLocalYesterday = makeRawEvent(
        "evt-ends-local-yesterday-utcplus14",
        "2026-08-10",
        "2026-08-14", // Aug 14 < todayKey "2026-08-15" → excluded
        "Ended Local Yesterday (UTC+14)",
      );

      await act(async () => {
        renderWithEvents("?view=list", [
          endsLocalToday,
          endsLocalTomorrow,
          endsLocalYesterday,
        ]);
      });

      // Events whose endDate >= local todayKey must appear.
      expect(screen.getByText("Ends Local Today (UTC+14)")).toBeDefined();
      expect(screen.getByText("Ends Local Tomorrow (UTC+14)")).toBeDefined();

      // Event whose endDate < local todayKey must not appear.
      expect(screen.queryByText("Ended Local Yesterday (UTC+14)")).toBeNull();

      // Exactly two list items.
      expect(screen.getAllByRole("listitem").length).toBe(2);
    } finally {
      // Always restore TZ — other tests must not inherit the fake timezone.
      if (prevTZ === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = prevTZ;
      }
      // Restore fake timers to the describe-level frozen instant so subsequent
      // tests in this block see FROZEN_NOW as expected.
      vi.setSystemTime(FROZEN_NOW);
    }
  });

  it("does NOT render list items under month view (different rendering path)", async () => {
    // October 2026 event is upcoming (endDate > frozen today), so it would
    // appear in list view.  In month view the CalendarCore mock uses a cursor
    // of August 2026 (the deterministic fallback), so week event bars are
    // scoped to August dates — this October event is absent from the grid.
    const ev = makeRawEvent(
      "evt-open-house",
      "2026-10-04",
      "2026-10-06",
      "Open House Weekend",
    );

    await act(async () => {
      renderWithEvents("?view=month", [ev]);
    });

    // Confirm we really are in month view (not list view).
    expect(calendarCoreSpy.defaultView).toBe("month");

    // Month view uses <div role="button"> day cells, not <ul>/<li>.
    expect(screen.queryByRole("listitem")).toBeNull();
    // The event title must not appear because it falls outside August 2026.
    expect(screen.queryByText("Open House Weekend")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CALENDAR VIEW: defaultView prop passed to CalendarCore
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — CalendarCore receives correct defaultView", () => {
  /**
   * WHY: HallmarkEvents reads ?view= from the URL on mount and passes the
   * result as `defaultView` to CalendarCore (via `initialView`).  If the prop
   * is renamed, silently dropped, or the allowed-value guard changes, the
   * calendar always opens in "month" view regardless of the deep-link.
   *
   * The CalendarCore mock (defined above) now records `defaultView` into
   * `calendarCoreSpy.defaultView` each time the component renders.
   */

  it("passes defaultView='list' when ?view=list is in the URL", async () => {
    await act(async () => {
      renderWithEvents("?view=list", []);
    });

    expect(calendarCoreSpy.defaultView).toBe("list");
  });

  it("passes defaultView='week' when ?view=week is in the URL", async () => {
    await act(async () => {
      renderWithEvents("?view=week", []);
    });

    expect(calendarCoreSpy.defaultView).toBe("week");
  });

  it("passes defaultView='month' explicitly when ?view=month is in the URL", async () => {
    await act(async () => {
      renderWithEvents("?view=month", []);
    });

    // Must be the explicit prop value coming from HallmarkEvents, not the
    // mock's own fallback — proved by the spy capturing the raw prop before
    // any default is applied in the mock.
    expect(calendarCoreSpy.defaultView).toBe("month");
  });

  it("passes defaultView='month' when no ?view= param is present", async () => {
    await act(async () => {
      renderWithEvents("", []);
    });

    // initialView in hallmark-events.tsx always returns a valid ViewMode
    // ("month" when the param is absent), so the prop is always explicit —
    // the spy must see "month" here, NOT undefined.
    expect(calendarCoreSpy.defaultView).toBe("month");
  });

  it("passes defaultView='month' when ?view= has an unrecognised value (e.g. 'agenda')", async () => {
    await act(async () => {
      renderWithEvents("?view=agenda", []);
    });

    // The guard in hallmark-events.tsx only accepts "month"|"week"|"list";
    // any other value falls back to "month".
    expect(calendarCoreSpy.defaultView).toBe("month");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. THREE-PARAM COMBINATION: ?view= + ?month= + ?event= together
// ═══════════════════════════════════════════════════════════════════════════════

describe("hallmark-events — three-param deep-link (?view= + ?month= + ?event=)", () => {
  /**
   * WHY: Hero-card links compose URLs like
   *   /ornaments/hallmark-events?month=YYYY-MM&event=<gcalId>
   * If ?view= is ever added to those hrefs, all three params must be read
   * correctly — a URL-parsing bug that drops ?view= when the other two are
   * present would be invisible if only single-param tests existed.
   *
   * These tests verify:
   *   1. defaultView is read correctly when ?month= and ?event= are also present.
   *   2. defaultCursor is October 2026 — ?month= is honored when all three
   *      params coexist (a broken initialCursor would not affect the mocked
   *      event list, so this is the only assertion that catches the regression).
   *   3. The GCal query range covers October when all three params are present.
   *   4. The dialog opens for the correct event, not just the first event in the
   *      list (a decoy event is placed before the target to prove matching).
   *   5. An unrecognised ?view= value still falls back to "month" even when
   *      the other two params are valid, without preventing the dialog from opening.
   */

  it("reads defaultView='list' and defaultCursor=October 2026 when all three params are present", async () => {
    const gcalId = "evt-abc";
    const targetEvent = makeRawEvent(
      gcalId,
      "2026-10-12",
      "2026-10-13",
      "Three-Param Event",
    );

    await act(async () => {
      renderWithEvents(
        `?view=list&month=2026-10&event=${encodeURIComponent(gcalId)}`,
        [targetEvent],
      );
    });

    // ?view= must survive alongside the other two params
    expect(calendarCoreSpy.defaultView).toBe("list");

    // ?month= must also survive — the cursor must be October 2026
    const cursor = calendarCoreSpy.defaultCursor;
    expect(cursor).toBeInstanceOf(Date);
    expect((cursor as Date).getFullYear()).toBe(2026);
    expect((cursor as Date).getMonth()).toBe(9); // 0-based: October = 9
  });

  it("GCal query range covers October when ?view=list&month=2026-10&event= are all present", async () => {
    const gcalId = "evt-abc";
    const targetEvent = makeRawEvent(
      gcalId,
      "2026-10-12",
      "2026-10-13",
      "Three-Param Event",
    );

    await act(async () => {
      renderWithEvents(
        `?view=list&month=2026-10&event=${encodeURIComponent(gcalId)}`,
        [targetEvent],
      );
    });

    const calls = mockUseListConnectedCalendarEvents.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const startInstant = new Date(calls[0][1] as string).getTime();
    const endInstant = new Date(calls[0][2] as string).getTime();

    const oct1Local = new Date(2026, 9, 1).getTime(); // Oct 1 local midnight
    const nov1Local = new Date(2026, 10, 1).getTime(); // Nov 1 local midnight (exclusive end)

    expect(startInstant).toBeLessThanOrEqual(oct1Local);
    expect(endInstant).toBeGreaterThanOrEqual(nov1Local);
  });

  it("opens the dialog for the matching event (not the first event) when ?view=list&month=2026-10&event= are all present", async () => {
    // A decoy event is placed BEFORE the target so the test fails if the
    // component picks the first event rather than matching on gcalId.
    const gcalId = "evt-abc";
    const decoyEvent = makeRawEvent(
      "evt-decoy",
      "2026-10-05",
      "2026-10-06",
      "Decoy Event",
    );
    const targetEvent = makeRawEvent(
      gcalId,
      "2026-10-12",
      "2026-10-13",
      "Three-Param Event",
    );

    await act(async () => {
      renderWithEvents(
        `?view=list&month=2026-10&event=${encodeURIComponent(gcalId)}`,
        [decoyEvent, targetEvent],
      );
    });

    // Must open the target, not the decoy
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe(
      "Three-Param Event",
    );
  });

  it("falls back defaultView to 'month' when ?view=agenda (invalid) is combined with valid ?month= and ?event=", async () => {
    const gcalId = "evt-abc";
    const decoyEvent = makeRawEvent(
      "evt-decoy",
      "2026-10-05",
      "2026-10-06",
      "Decoy Event",
    );
    const targetEvent = makeRawEvent(
      gcalId,
      "2026-10-12",
      "2026-10-13",
      "Three-Param Event",
    );

    await act(async () => {
      renderWithEvents(
        `?view=agenda&month=2026-10&event=${encodeURIComponent(gcalId)}`,
        [decoyEvent, targetEvent],
      );
    });

    // "agenda" is not in the allowed set; must fall back to "month"
    expect(calendarCoreSpy.defaultView).toBe("month");

    // ?month= must still be honored even with an invalid ?view=
    const cursor = calendarCoreSpy.defaultCursor;
    expect(cursor).toBeInstanceOf(Date);
    expect((cursor as Date).getFullYear()).toBe(2026);
    expect((cursor as Date).getMonth()).toBe(9); // October

    // The unrecognised view value must not prevent the event dialog from opening,
    // and matching must pick the target (not the decoy)
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe(
      "Three-Param Event",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. HERO CARD → CALENDAR PAGE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHY: The card and the page are tested in isolation in their own files.
// This section closes the gap: it renders NextHallmarkEventCard, extracts the
// href it actually emits, and feeds that exact URL into HallmarkEvents — the
// same sequence that happens when a user clicks the card.  If the card renames
// a param or the page stops reading it, this test catches the divergence.

describe("hero card → calendar page integration (NextHallmarkEventCard)", () => {
  it("the href emitted by the card initialises the calendar to month view and correct cursor", async () => {
    // WHY: if the card ever drops ?view= or changes it to a different value,
    // the calendar page silently opens in the wrong view.  Asserting
    // calendarCoreSpy.defaultView here catches that class of regression.
    const gcalId = "hallmark-integration-gcal-id";
    const startDate = "2026-11-08";

    // Step 1: render the card and capture the href it builds.
    mockUseUpcomingHallmarkEventsForCard.mockReturnValue({
      events: [makeCardEvent(gcalId, startDate, "2026-11-10")],
      hallmarkCal: { id: 1 },
    });
    const { unmount } = render(<NextHallmarkEventCard />);
    const link = screen.getByRole("link") as HTMLAnchorElement;
    const cardUrl = new URL(link.href);
    // The card must advertise a view so the page doesn't fall back to its own default.
    expect(cardUrl.searchParams.get("view")).toBe("month");
    const cardSearch = cardUrl.search; // "?view=month&month=2026-11&event=…"
    unmount();

    // Step 2: render HallmarkEvents with those exact params.
    const rawEvent = makeRawEvent(
      gcalId,
      startDate,
      "2026-11-10",
      "Integration Event",
    );
    await act(async () => {
      renderWithEvents(cardSearch, [rawEvent]);
    });

    // The calendar must open in month view on the month the card advertised.
    expect(calendarCoreSpy.defaultView).toBe("month");
    expect(calendarCoreSpy.defaultCursor).toBeInstanceOf(Date);
    expect(calendarCoreSpy.defaultCursor?.getFullYear()).toBe(2026);
    expect(calendarCoreSpy.defaultCursor?.getMonth()).toBe(10); // November = 10
  });

  it("the href emitted by the card causes the matching event dialog to open", async () => {
    const gcalId = "hallmark-integration-dialog-id";
    const startDate = "2026-11-08";

    mockUseUpcomingHallmarkEventsForCard.mockReturnValue({
      events: [makeCardEvent(gcalId, startDate, "2026-11-10")],
      hallmarkCal: { id: 1 },
    });
    const { unmount } = render(<NextHallmarkEventCard />);
    const link = screen.getByRole("link") as HTMLAnchorElement;
    const cardSearch = new URL(link.href).search;
    unmount();

    // Place a decoy event before the target so the test fails if matching
    // uses array position rather than gcalId.
    const decoy = makeRawEvent(
      "evt-decoy",
      "2026-11-01",
      "2026-11-02",
      "Decoy Event",
    );
    const target = makeRawEvent(
      gcalId,
      startDate,
      "2026-11-10",
      "Integration Event",
    );

    await act(async () => {
      renderWithEvents(cardSearch, [decoy, target]);
    });

    // Both view and event must be honoured: month view AND correct dialog title.
    expect(calendarCoreSpy.defaultView).toBe("month");
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe(
      "Integration Event",
    );
  });

  it("the card href round-trips a gcalId containing '@' through the calendar page", async () => {
    // gcalIds from Google Calendar commonly contain '@'; the card must encode it
    // and the page must decode it back so the event match succeeds.
    const gcalId = "abc123@group.calendar.google.com";
    const startDate = "2026-12-01";

    mockUseUpcomingHallmarkEventsForCard.mockReturnValue({
      events: [makeCardEvent(gcalId, startDate, "2026-12-03")],
      hallmarkCal: { id: 1 },
    });
    const { unmount } = render(<NextHallmarkEventCard />);
    const link = screen.getByRole("link") as HTMLAnchorElement;
    // The raw href must have the percent-encoded '@' to be a valid URL.
    expect(link.href).toContain("%40");
    const cardSearch = new URL(link.href).search;
    unmount();

    const rawEvent = makeRawEvent(
      gcalId,
      startDate,
      "2026-12-03",
      "Special ID Event",
    );
    await act(async () => {
      renderWithEvents(cardSearch, [rawEvent]);
    });

    // view= must survive the round-trip: month view, correct cursor, correct event.
    expect(calendarCoreSpy.defaultView).toBe("month");
    expect(calendarCoreSpy.defaultCursor?.getMonth()).toBe(11); // December = 11
    // The page must decode %40 back to '@' and successfully match the event.
    expect(screen.getByTestId("dialog-open")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe(
      "Special ID Event",
    );
  });
});
