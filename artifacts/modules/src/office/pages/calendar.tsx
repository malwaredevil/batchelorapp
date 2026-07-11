import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useGetCalendarStatus,
  useListConnectedCalendars,
  getListConnectedCalendarsQueryKey,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  type TravelCalendarEvent,
  type ConnectedCalendar,
} from "@workspace/api-client-react";

type ViewMode = "month" | "week" | "list";

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

function weekRange(cursor: Date): { start: Date; end: Date } {
  const start = startOfWeek(cursor);
  return { start, end: addDays(start, 7) };
}

function monthRange(cursor: Date): { start: Date; end: Date } {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { start, end };
}

function rangeForView(
  view: ViewMode,
  cursor: Date,
): { start: Date; end: Date } {
  if (view === "week") return weekRange(cursor);
  if (view === "month") return monthGridRange(cursor);
  return monthRange(cursor);
}

function shiftCursor(view: ViewMode, cursor: Date, direction: 1 | -1): Date {
  if (view === "week") return addDays(cursor, 7 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

function tintColor(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface DisplayEvent {
  event: TravelCalendarEvent;
  calendar: ConnectedCalendar;
}

function CalendarEventsLoader({
  calendar,
  start,
  end,
  onEvents,
  onError,
}: {
  calendar: ConnectedCalendar;
  start: string;
  end: string;
  onEvents: (calendarId: number, events: TravelCalendarEvent[]) => void;
  onError: (calendarId: number, hasError: boolean) => void;
}) {
  const { data = [], isError } = useListConnectedCalendarEvents(
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
  useEffect(() => {
    onError(calendar.id, isError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.id, isError]);
  return null;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function OfficeCalendar() {
  const { data: status, isLoading: statusLoading } = useGetCalendarStatus();
  const { data: calendars = [] } = useListConnectedCalendars({
    query: {
      enabled: Boolean(status?.connected),
      queryKey: getListConnectedCalendarsQueryKey(),
    },
  });

  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("month");
  const { start, end } = useMemo(
    () => rangeForView(view, cursor),
    [view, cursor],
  );
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

  const [errorCalendarIds, setErrorCalendarIds] = useState<Set<number>>(
    new Set(),
  );
  function handleError(calendarId: number, hasError: boolean) {
    setErrorCalendarIds((prev) => {
      const next = new Set(prev);
      if (hasError) next.add(calendarId);
      else next.delete(calendarId);
      return next;
    });
  }
  const hasTokenError = errorCalendarIds.size > 0;

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

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DisplayEvent[]>();
    for (const item of displayEvents) {
      const key = eventDayKey(item.event);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [displayEvents]);

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

  const gridDays = useMemo(() => {
    if (view === "list") return [];
    const lastDayInclusive = addDays(end, -1);
    return eachDayOfInterval({ start, end: lastDayInclusive });
  }, [view, start, end]);

  const cursorLabel =
    view === "week"
      ? (() => {
          const weekEnd = addDays(start, 6);
          const sameMonth = start.getMonth() === weekEnd.getMonth();
          const startLabel = start.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          const endLabel = weekEnd.toLocaleDateString(
            undefined,
            sameMonth
              ? { day: "numeric", year: "numeric" }
              : { month: "short", day: "numeric", year: "numeric" },
          );
          return `${startLabel} – ${endLabel}`;
        })()
      : cursor.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        });

  if (!statusLoading && !status?.connected) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="font-serif text-2xl text-foreground">
          No Google Calendar connected
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your Google account in Travels Settings to browse events from
          all your calendars here. This uses the same connection as Travels — no
          separate sign-in required.
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
    <div className="space-y-4">
      {calendars.map((cal) => (
        <CalendarEventsLoader
          key={cal.id}
          calendar={cal}
          start={startISO}
          end={endISO}
          onEvents={handleEvents}
          onError={handleError}
        />
      ))}

      <div>
        <h1 className="font-serif text-2xl text-foreground">All Calendars</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view across every calendar you've connected.
        </p>
      </div>

      {hasTokenError && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Google Calendar connection expired.{" "}
            <a
              href="/modules/travels/settings"
              className="font-medium underline"
            >
              Reconnect in Travels Settings
            </a>{" "}
            to load events.
          </p>
        </div>
      )}

      {/* Toolbar: navigation + view switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor((c) => shiftCursor(view, c, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium text-foreground min-w-[160px] text-center">
            {cursorLabel}
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
            onClick={() => setCursor((c) => shiftCursor(view, c, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as ViewMode)}
          className="justify-start"
        >
          <ToggleGroupItem value="month" size="sm" aria-label="Month view">
            Month
          </ToggleGroupItem>
          <ToggleGroupItem value="week" size="sm" aria-label="Week view">
            Week
          </ToggleGroupItem>
          <ToggleGroupItem value="list" size="sm" aria-label="List view">
            List
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Calendar filter chips */}
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
                    ? "opacity-40 border-card-border"
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

      {/* Empty connected state */}
      {calendars.length === 0 && (
        <p className="text-sm text-muted-foreground px-1">
          Your Google account is connected, but no calendars have been added
          yet. Add calendars from Travels Settings to see them here.
        </p>
      )}

      {/* ── Month / Week grid ─────────────────────────────────────────── */}
      {(view === "month" || view === "week") && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 border-b border-card-border">
            {DAY_LABELS.map((label) => (
              <div
                key={label}
                className="py-2 text-center text-xs font-semibold text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>

          {/* Grid cells */}
          <div
            className={`grid grid-cols-7 ${
              view === "month"
                ? "auto-rows-[minmax(90px,1fr)]"
                : "auto-rows-[minmax(120px,1fr)]"
            }`}
          >
            {gridDays.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const outsideMonth =
                view === "month" && !isSameMonth(day, cursor);
              const today = isToday(day);

              return (
                <div
                  key={key}
                  className={`border-b border-r border-card-border p-1 ${
                    outsideMonth ? "bg-muted/30" : ""
                  } last:border-r-0`}
                >
                  <div className="flex items-center justify-end mb-1">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                        today
                          ? "bg-primary text-primary-foreground"
                          : outsideMonth
                            ? "text-muted-foreground/50"
                            : "text-foreground"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-0.5 overflow-hidden">
                    {dayEvents
                      .slice(0, view === "month" ? 2 : 4)
                      .map((item) => (
                        <div
                          key={`${item.calendar.id}-${item.event.id}`}
                          className="truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight"
                          style={{
                            backgroundColor: tintColor(
                              item.calendar.primaryColor,
                              0.2,
                            ),
                            color: item.calendar.primaryColor,
                            border: `1px solid ${tintColor(item.calendar.primaryColor, 0.4)}`,
                          }}
                          title={item.event.title}
                        >
                          {!item.event.allDay && (
                            <span className="opacity-70 mr-0.5">
                              {new Date(item.event.start).toLocaleTimeString(
                                undefined,
                                { hour: "numeric", minute: "2-digit" },
                              )}
                            </span>
                          )}
                          {item.event.title}
                        </div>
                      ))}
                    {dayEvents.length > (view === "month" ? 2 : 4) && (
                      <div className="px-1 text-[10px] text-muted-foreground">
                        +{dayEvents.length - (view === "month" ? 2 : 4)} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── List view ─────────────────────────────────────────────────── */}
      {view === "list" && (
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
      )}
    </div>
  );
}
