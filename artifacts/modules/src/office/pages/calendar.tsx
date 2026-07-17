import { useEffect, useMemo, useState } from "react";
import { isSameMonth, isToday } from "date-fns";
import { AlertTriangle, CalendarDays, Clock, MapPin } from "lucide-react";
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
import {
  CalendarCore,
  dateKey,
  chunk,
  tintColor,
  type CalendarCoreContext,
} from "@/components/CalendarCore";

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

function eventDayKey(event: TravelCalendarEvent): string {
  if (event.allDay) return event.start;
  return dateKey(new Date(event.start));
}

function gcalEventEndKey(event: TravelCalendarEvent): string {
  if (event.allDay) {
    const d = new Date(event.end + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return dateKey(d);
  }
  return dateKey(new Date(event.end));
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

  const filterChips =
    calendars.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3">
        {calendars.map((cal) => {
          const hidden = hiddenCalendarIds.has(cal.id);
          return (
            <button
              key={cal.id}
              type="button"
              onClick={() => toggleCalendarVisibility(cal.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                hidden ? "opacity-40 border-card-border" : "border-transparent"
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
    ) : null;

  return (
    <div className="space-y-4">
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
              href="/api/travels/google-calendar/connect?returnTo=/modules/office/calendar"
              className="font-medium underline"
            >
              Reconnect Google Calendar
            </a>{" "}
            to load events.
          </p>
        </div>
      )}

      <CalendarCore belowToolbar={filterChips}>
        {({ view, cursor, gridDays, range }: CalendarCoreContext) => {
          const startISO = range.start.toISOString();
          const endISO = range.end.toISOString();

          return (
            <>
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

              {calendars.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">
                  Your Google account is connected, but no calendars have been
                  added yet. Add calendars from Travels Settings to see them
                  here.
                </p>
              )}

              {/* ── Month / Week grid ─────────────────────────────────── */}
              {(view === "month" || view === "week") &&
                (() => {
                  const weeks = chunk(gridDays, 7);
                  return (
                    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
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
                      {weeks.map((week, wi) => {
                        const weekStartKey = dateKey(week[0]);
                        const weekEndKey = dateKey(week[6]);
                        const isLastWeek = wi === weeks.length - 1;
                        const weekEvents = displayEvents
                          .filter((item) => {
                            const startKey = item.event.start.slice(0, 10);
                            const endKey = gcalEventEndKey(item.event);
                            return (
                              endKey >= weekStartKey && startKey <= weekEndKey
                            );
                          })
                          .sort((a, b) =>
                            a.event.start
                              .slice(0, 10)
                              .localeCompare(b.event.start.slice(0, 10)),
                          );
                        return (
                          <div
                            key={wi}
                            className={
                              isLastWeek ? "" : "border-b border-card-border"
                            }
                          >
                            {/* Day number cells */}
                            <div className="grid grid-cols-7">
                              {week.map((day) => {
                                const key = dateKey(day);
                                const outsideMonth =
                                  view === "month" && !isSameMonth(day, cursor);
                                const today = isToday(day);
                                return (
                                  <div
                                    key={key}
                                    className={`border-r border-card-border/60 p-1.5 last:border-r-0 min-h-[36px] ${
                                      outsideMonth ? "bg-muted/30" : ""
                                    }`}
                                  >
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
                                );
                              })}
                            </div>
                            {/* Spanning event bars */}
                            {weekEvents.length > 0 && (
                              <div className="grid grid-cols-7 gap-y-0.5 pb-1.5 pt-0.5">
                                {weekEvents.map((item) => {
                                  const startKey = item.event.start.slice(
                                    0,
                                    10,
                                  );
                                  const endKey = gcalEventEndKey(item.event);
                                  const isStart = startKey >= weekStartKey;
                                  const isEnd = endKey <= weekEndKey;
                                  const colStart = isStart
                                    ? week.findIndex(
                                        (d) => dateKey(d) === startKey,
                                      ) + 1
                                    : 1;
                                  const endIdx = week.findIndex(
                                    (d) => dateKey(d) === endKey,
                                  );
                                  const colEnd =
                                    isEnd && endIdx >= 0 ? endIdx + 2 : 8;
                                  return (
                                    <div
                                      key={`${item.calendar.id}-${item.event.id}`}
                                      style={{
                                        gridColumn: `${colStart} / ${colEnd}`,
                                        marginLeft: isStart ? 2 : 0,
                                        marginRight: isEnd ? 2 : 0,
                                        backgroundColor: tintColor(
                                          item.calendar.primaryColor,
                                          0.2,
                                        ),
                                        color: item.calendar.primaryColor,
                                        border: `1px solid ${tintColor(
                                          item.calendar.primaryColor,
                                          0.4,
                                        )}`,
                                      }}
                                      className={`h-5 px-1.5 text-[10px] font-medium leading-tight flex items-center gap-1 truncate ${
                                        isStart ? "rounded-l" : ""
                                      } ${isEnd ? "rounded-r" : ""}`}
                                      title={item.event.title}
                                    >
                                      {isStart && !item.event.allDay && (
                                        <span className="mr-0.5 opacity-70 shrink-0">
                                          {new Date(
                                            item.event.start,
                                          ).toLocaleTimeString(undefined, {
                                            hour: "numeric",
                                            minute: "2-digit",
                                          })}
                                        </span>
                                      )}
                                      {isStart && (
                                        <span className="truncate">
                                          {item.event.title}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

              {/* ── List view ─────────────────────────────────────────── */}
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
                        {new Date(`${day}T00:00:00`).toLocaleDateString(
                          undefined,
                          {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          },
                        )}
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
                                    {new Date(
                                      item.event.start,
                                    ).toLocaleTimeString(undefined, {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })}
                                    {" – "}
                                    {new Date(
                                      item.event.end,
                                    ).toLocaleTimeString(undefined, {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })}
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
            </>
          );
        }}
      </CalendarCore>
    </div>
  );
}
