// Hand-written hooks for Hallmark calendar events. Google Calendar is the
// sole source of truth — the ornaments_hallmark_events DB table has been
// removed. Events are read via useListConnectedCalendarEvents (travels.ts)
// and written via these mutation hooks that proxy through
// POST/PATCH/DELETE /api/ornaments/hallmark-events.
import { useMemo } from "react";
import {
  useMutation,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {
  useListConnectedCalendars,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  type ConnectedCalendar,
  type TravelCalendarEvent,
} from "./travels";

// ── Exported pure helpers (used by the hook and testable in isolation) ────────

/**
 * Normalize a raw calendar event returned by the server into the display shape.
 *
 * The server's fromGoogleEvent() already converts Google's exclusive all-day
 * end date back to an inclusive one, so e.end is correct — do not subtract
 * another day.  startDate/endDate are swapped defensively in case an event was
 * ever entered backwards.
 */
export function normalizeHallmarkEvent(
  e: Pick<TravelCalendarEvent, "id" | "title" | "start" | "end">,
): NormalizedHallmarkEvent {
  const rawStart = e.start.slice(0, 10);
  const rawEnd = e.end.slice(0, 10);
  const startDate = rawStart <= rawEnd ? rawStart : rawEnd;
  const endDate = rawStart <= rawEnd ? rawEnd : rawStart;
  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = new Date(`${endDate}T23:59:59`).getTime();
  return {
    gcalId: e.id,
    title: e.title,
    startDate,
    endDate,
    startMs,
    endMs,
  } satisfies NormalizedHallmarkEvent;
}

/**
 * Filter out events that have already ended and sort the rest ascending by
 * start date.  Uses a caller-supplied `nowMs` so that callers can pass a
 * fresh `Date.now()` on every render without re-running the normalization
 * step (which is memoized inside the hook).
 */
export function filterAndSortHallmarkEvents(
  events: NormalizedHallmarkEvent[],
  nowMs: number,
): NormalizedHallmarkEvent[] {
  return events
    .filter((e) => e.endMs >= nowMs)
    .sort((a, b) => a.startMs - b.startMs);
}

// ── Shared hook: upcoming Hallmark events ─────────────────────────────────────

/**
 * A Hallmark calendar event normalized for display in countdown widgets.
 *
 * Only immutable date values are included — time-sensitive derived values
 * such as `isLive` and `daysAway` must be computed by callers at render
 * time using `Date.now()`, so they remain fresh across re-renders (e.g.
 * the Hub tile's 4-second rotation interval).
 */
export interface NormalizedHallmarkEvent {
  gcalId: string;
  title: string;
  /** "YYYY-MM-DD" inclusive start date */
  startDate: string;
  /** "YYYY-MM-DD" inclusive end date */
  endDate: string;
  /** ms since epoch for `${startDate}T00:00:00` */
  startMs: number;
  /** ms since epoch for `${endDate}T23:59:59` */
  endMs: number;
}

/**
 * Fetches upcoming Hallmark events from the designated Hallmark Google
 * Calendar and normalizes them. Returns an empty array — never null — so
 * callers can apply their own fallback (e.g. a hardcoded placeholder event).
 *
 * The returned list is filtered (events still ongoing as of the current render)
 * and sorted ascending by start date. Because filtering uses `Date.now()`
 * evaluated fresh on every render, an event that ends while the page is open
 * will be removed on the next re-render without waiting for a query refetch.
 *
 * @param lookaheadDays  How far ahead to look. When omitted, defaults to
 *   exactly one calendar year ahead using `setFullYear` (correct for leap
 *   years). Pass an explicit value (e.g. 90) for shorter windows.
 */
export function useUpcomingHallmarkEvents(options?: {
  lookaheadDays?: number;
}): {
  events: NormalizedHallmarkEvent[];
  hallmarkCal: ConnectedCalendar | null;
} {
  // Stable range per mount — computed once so the query key doesn't change
  // on every render, matching the module-level constant approach in the
  // original HallmarkEventStatTile and the useMemo([], []) in
  // NextHallmarkEventCard.
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let end: Date;
    if (options?.lookaheadDays !== undefined) {
      // Explicit day count (e.g. 90 days for the Hub tile).
      end = new Date(today.getTime() + options.lookaheadDays * 86_400_000);
    } else {
      // Default: exactly one calendar year — setFullYear handles leap years
      // correctly (Feb 29 → Feb 28 on non-leap years), matching the original
      // NextHallmarkEventCard useMemo behavior.
      end = new Date(today);
      end.setFullYear(end.getFullYear() + 1);
    }
    return { rangeStart: today.toISOString(), rangeEnd: end.toISOString() };
    // options.lookaheadDays is intentionally not reactive — changing it after
    // mount is not a supported use case and would change the query key mid-session.
  }, []);

  const { data: connectedCalsRaw } = useListConnectedCalendars();
  // Guard against non-array responses (e.g. a dev proxy returning HTML).
  const connectedCals = Array.isArray(connectedCalsRaw) ? connectedCalsRaw : [];
  const hallmarkCal = connectedCals.find((c) => c.isHallmarkCalendar) ?? null;

  const { data: gcalEventsRaw } = useListConnectedCalendarEvents(
    hallmarkCal?.id ?? 0,
    rangeStart,
    rangeEnd,
    {
      query: {
        enabled: !!hallmarkCal,
        queryKey: getListConnectedCalendarEventsQueryKey(
          hallmarkCal?.id ?? 0,
          rangeStart,
          rangeEnd,
        ),
      },
    },
  );

  // Guard against non-array responses (same rationale as connectedCalsRaw).
  const gcalEvents: TravelCalendarEvent[] = Array.isArray(gcalEventsRaw)
    ? gcalEventsRaw
    : [];

  // Normalize immutable date fields. Keyed only on gcalEvents so date-string
  // parsing (new Date(...)) doesn't run on every render — only when the
  // calendar data changes.
  const normalizedEvents = useMemo(
    () => gcalEvents.map(normalizeHallmarkEvent),
    [gcalEvents],
  );

  // Filter and sort outside the memo with a fresh nowMs on every render.
  // This ensures that an event which ends while the page is open (e.g. during
  // the Hub tile's 4-second carousel) is removed immediately on the next
  // re-render rather than waiting for the next query refetch.
  const events = filterAndSortHallmarkEvents(normalizedEvents, Date.now());

  return { events, hallmarkCal };
}

export interface HallmarkGCalEventInput {
  title: string;
  description?: string | null;
  startDate: string;
  endDate: string;
}

export interface HallmarkCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string | null;
}

const BASE = "/api/ornaments/hallmark-events";

export function useCreateHallmarkGCalEvent(
  options?: Partial<
    UseMutationOptions<HallmarkCalendarEvent, unknown, HallmarkGCalEventInput>
  >,
) {
  return useMutation({
    mutationFn: (data: HallmarkGCalEventInput) =>
      customFetch<HallmarkCalendarEvent>(BASE, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options,
  });
}

export function useUpdateHallmarkGCalEvent(
  options?: Partial<
    UseMutationOptions<
      HallmarkCalendarEvent,
      unknown,
      { gcalId: string; data: HallmarkGCalEventInput }
    >
  >,
) {
  return useMutation({
    mutationFn: ({ gcalId, data }) =>
      customFetch<HallmarkCalendarEvent>(`${BASE}/${gcalId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    ...options,
  });
}

export function useDeleteHallmarkGCalEvent(
  options?: Partial<UseMutationOptions<void, unknown, string>>,
) {
  return useMutation({
    mutationFn: (gcalId: string) =>
      customFetch<void>(`${BASE}/${gcalId}`, { method: "DELETE" }),
    ...options,
  });
}
