import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGetCalendarStatus,
  useListConnectedCalendars,
  getListConnectedCalendarsQueryKey,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  type TravelCalendarEvent,
  type ConnectedCalendar,
} from "@workspace/api-client-react";

// Office's general-purpose "all connected calendars" view. This is
// intentionally read-only and distinct from Travels' single designated
// shared "Travel calendar" (see threat_model.md's Designated shared Google
// Calendar pattern) — Office does not designate a shared calendar, does not
// generate trip suggestions, and never writes events. It reuses the exact
// same per-user Google Calendar OAuth connection and connected-calendars
// list that Travels' Settings page manages; a user's Office calendar view
// only ever shows their own connected calendars, matching the existing
// single-owner boundary.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function eventDayKey(event: TravelCalendarEvent): string {
  if (event.allDay) return event.start;
  return dateKey(new Date(event.start));
}

function monthGridRange(cursor: Date): { start: Date; end: Date } {
  const gridStart = startOfWeek(startOfMonth(cursor));
  const lastRowStart = startOfWeek(endOfWeek(endOfMonth(cursor)));
  return { start: gridStart, end: addDays(lastRowStart, 7) };
}

interface DisplayEvent {
  event: TravelCalendarEvent;
  calendar: ConnectedCalendar;
}

function tintColor(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Loads one connected calendar's events for the visible range and reports
// them up to the parent. Kept as its own component so each calendar can
// independently call the events hook (hooks can't be called in a loop).
function CalendarEventsLoader({
  calendar,
  start,
  end,
  onEvents,
}: {
  calendar: ConnectedCalendar;
  start: string;
  end: string;
  onEvents: (calendarId: number, events: TravelCalendarEvent[]) => void;
}) {
  const { data = [] } = useListConnectedCalendarEvents(
    calendar.id,
    start,
    end,
    {
      query: {
        enabled: Boolean(start && end),
        queryKey: getListConnectedCalendarEventsQueryKey(
          calendar.id,
          start,
          end,
        ),
      },
    },
  );
  useEffect(() => {
    onEvents(calendar.id, data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.id, JSON.stringify(data)]);
  return null;
}

export default function OfficeCalendar() {
  const { data: status, isLoading: statusLoading } = useGetCalendarStatus();
  const { data: calendars = [] } = useListConnectedCalendars({
    query: {
      enabled: Boolean(status?.connected),
      queryKey: getListConnectedCalendarsQueryKey(),
    },
  });

  const [cursor, setCursor] = useState(() => new Date());
  const { start, end } = useMemo(() => monthGridRange(cursor), [cursor]);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const [eventsByCalendar, setEventsByCalendar] = useState<
    Record<number, TravelCalendarEvent[]>
  >({});

  function handleEvents(calendarId: number, events: TravelCalendarEvent[]) {
    setEventsByCalendar((prev) => ({ ...prev, [calendarId]: events }));
  }

  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<number>>(
    new Set(),
  );
  function toggleCalendarVisibility(id: number) {
    setHiddenCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const displayEvents = useMemo<DisplayEvent[]>(() => {
    return calendars
      .filter((cal) => !hiddenCalendarIds.has(cal.id))
      .flatMap((cal) =>
        (eventsByCalendar[cal.id] ?? []).map((event) => ({
          event,
          calendar: cal,
        })),
      );
  }, [calendars, hiddenCalendarIds, eventsByCalendar]);

  const groups = useMemo(() => {
    const map = new Map<string, DisplayEvent[]>();
    for (const item of displayEvents) {
      const key = eventDayKey(item.event);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [displayEvents]);

  if (!statusLoading && !status?.connected) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="font-serif text-2xl text-foreground">
          No Google Calendar connected
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your Google account in Travels Settings to browse events
          from all your calendars here. This uses the same connection as
          Travels — no separate sign-in required.
        </p>
        <Button asChild className="mt-5">
          <a
            href={`${import.meta.env.BASE_URL}api/travels/google-calendar/connect?returnTo=${encodeURIComponent(`${import.meta.env.BASE_URL}office/calendar`)}`}
          >
            Connect Google Calendar
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {calendars.map((cal) => (
        <CalendarEventsLoader
          key={cal.id}
          calendar={cal}
          start={startISO}
          end={endISO}
          onEvents={handleEvents}
        />
      ))}

      <div>
        <h1 className="font-serif text-2xl text-foreground">
          All Calendars
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only view across every calendar you've connected.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setCursor(
                (c) => new Date(c.getFullYear(), c.getMonth() - 1, 1),
              )
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium text-foreground">
            {cursor.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date())}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setCursor(
                (c) => new Date(c.getFullYear(), c.getMonth() + 1, 1),
              )
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {calendars.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Your Google account is connected, but no calendars have been added
          yet. Add calendars from Travels Settings to see them here.
        </p>
      )}

      {calendars.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3">
          {calendars.map((cal) => {
            const hidden = hiddenCalendarIds.has(cal.id);
            return (
              <button
                key={cal.id}
                type="button"
                onClick={() => toggleCalendarVisibility(cal.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  hidden
                    ? "opacity-50 border-card-border"
                    : "border-transparent"
                }`}
                style={
                  hidden
                    ? undefined
                    : {
                        backgroundColor: tintColor(cal.primaryColor, 0.15),
                        borderColor: cal.primaryColor,
                        color: cal.primaryColor,
                      }
                }
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: cal.primaryColor }}
                />
                {cal.summary}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No events found in this range.
          </p>
        )}
        {groups.map(([day, items]) => (
          <div key={day} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h2>
            <div className="space-y-1.5">
              {items.map((item) => (
                <div
                  key={`${item.calendar.id}-${item.event.id}`}
                  className="flex items-start gap-3 rounded-lg border border-card-border bg-card px-3 py-2"
                  style={{
                    borderLeft: `3px solid ${item.calendar.primaryColor}`,
                  }}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.event.title}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        · {item.calendar.summary}
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {!item.event.allDay && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(item.event.start).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                          {" – "}
                          {new Date(item.event.end).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                        </span>
                      )}
                      {item.event.allDay && <span>All day</span>}
                      {item.event.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {item.event.location}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
