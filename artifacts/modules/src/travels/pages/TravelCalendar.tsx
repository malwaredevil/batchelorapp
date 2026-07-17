import { useMemo, useState } from "react";
import { Link } from "wouter";
import { isSameMonth, isToday } from "date-fns";
import {
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  AlertTriangle,
  MapPin,
  Pencil,
  Plane,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useGetTravelCalendarStatus,
  useListTravelCalendarEvents,
  useCreateTravelCalendarEvent,
  useUpdateTravelCalendarEvent,
  useDeleteTravelCalendarEvent,
  useListCalendarTripSuggestions,
  useScanCalendarTripSuggestions,
  useDismissCalendarTripSuggestion,
  useAcceptCalendarTripSuggestion,
  useListGoogleEventColors,
  useListConnectedCalendars,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  getListTravelCalendarEventsQueryKey,
  getListCalendarTripSuggestionsQueryKey,
  getListGoogleEventColorsQueryKey,
  type TravelCalendarEvent,
  type TravelCalendarEventInput,
  type CalendarTripSuggestion,
  type GoogleEventColor,
  type ConnectedCalendar,
} from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/travels/lib/assistant-context";
import {
  CalendarCore,
  dateKey,
  chunk,
  tintColor,
  rangeForView,
  type ViewMode,
  type CalendarCoreContext,
} from "@/components/CalendarCore";

// ─── Local helpers (not shared with other calendars) ─────────────────────────

function displayEventStartKey(item: { event: TravelCalendarEvent }): string {
  if (item.event.allDay) return item.event.start;
  return dateKey(new Date(item.event.start));
}

function displayEventEndKey(item: { event: TravelCalendarEvent }): string {
  if (item.event.allDay) return item.event.end;
  return dateKey(new Date(item.event.end));
}

interface DisplayEvent {
  event: TravelCalendarEvent;
  kind: "travel" | "overlay";
  calendar?: ConnectedCalendar;
}

function eventDayKey(event: TravelCalendarEvent): string {
  if (event.allDay) return event.start;
  return dateKey(new Date(event.start));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: dateKey(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

interface EventFormState {
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  colorId: string | null;
}

function emptyForm(defaultDate?: string): EventFormState {
  const today = defaultDate ?? dateKey(new Date());
  return {
    title: "",
    description: "",
    location: "",
    allDay: true,
    startDate: today,
    startTime: "09:00",
    endDate: today,
    endTime: "10:00",
    colorId: null,
  };
}

function eventToForm(event: TravelCalendarEvent): EventFormState {
  if (event.allDay) {
    return {
      title: event.title,
      description: event.description ?? "",
      location: event.location ?? "",
      allDay: true,
      startDate: event.start,
      startTime: "09:00",
      endDate: event.end,
      endTime: "10:00",
      colorId: event.colorId ?? null,
    };
  }
  const start = isoToLocalParts(event.start);
  const end = isoToLocalParts(event.end);
  return {
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    allDay: false,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    colorId: event.colorId ?? null,
  };
}

function formToInput(form: EventFormState): TravelCalendarEventInput {
  if (form.allDay) {
    return {
      title: form.title,
      description: form.description || null,
      location: form.location || null,
      allDay: true,
      start: form.startDate,
      end: form.endDate || form.startDate,
      colorId: form.colorId,
    };
  }
  const start = new Date(
    `${form.startDate}T${form.startTime || "09:00"}:00`,
  ).toISOString();
  const end = new Date(
    `${form.endDate || form.startDate}T${form.endTime || form.startTime || "10:00"}:00`,
  ).toISOString();
  return {
    title: form.title,
    description: form.description || null,
    location: form.location || null,
    allDay: false,
    start,
    end,
    colorId: form.colorId,
  };
}

// Loads one overlay calendar's events for the visible range and reports them
// up to the parent. Kept as its own component so each connected calendar can
// independently call the events hook (hooks can't be called in a loop).
function OverlayCalendarEvents({
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function TravelCalendar() {
  const qc = useQueryClient();
  const { data: status, isLoading: statusLoading } =
    useGetTravelCalendarStatus();

  // Mirror CalendarCore's internal view/cursor so we can derive API query keys
  // and the assistant page context outside the children render prop.
  const [calView, setCalView] = useState<ViewMode>("month");
  const [calCursor, setCalCursor] = useState(() => new Date());

  const { start, end } = useMemo(
    () => rangeForView(calView, calCursor),
    [calView, calCursor],
  );
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const { data: events = [], isLoading: eventsLoading } =
    useListTravelCalendarEvents(startISO, endISO, {
      query: {
        enabled: Boolean(status?.configured),
        queryKey: getListTravelCalendarEventsQueryKey(startISO, endISO),
      },
    });

  const createEvent = useCreateTravelCalendarEvent();
  const updateEvent = useUpdateTravelCalendarEvent();
  const deleteEvent = useDeleteTravelCalendarEvent();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TravelCalendarEvent | null>(
    null,
  );
  const [form, setForm] = useState<EventFormState>(emptyForm());
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const { data: googleColors = [] } = useListGoogleEventColors({
    query: {
      enabled: Boolean(status?.configured),
      queryKey: getListGoogleEventColorsQueryKey(),
    },
  });
  const colorHexById = useMemo(() => {
    const map = new Map<string, GoogleEventColor>();
    for (const c of googleColors) map.set(c.id, c);
    return map;
  }, [googleColors]);

  const { data: connectedCalendars = [] } = useListConnectedCalendars();
  const overlayCalendars = useMemo(
    () => connectedCalendars.filter((c) => !c.isTravelCalendar),
    [connectedCalendars],
  );
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<number>>(
    new Set(),
  );
  const [overlayEventsByCalendar, setOverlayEventsByCalendar] = useState<
    Record<number, TravelCalendarEvent[]>
  >({});

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

  function handleOverlayError(calendarId: number, hasError: boolean) {
    setErrorCalendarIds((prev) => {
      if (prev.has(calendarId) === hasError) return prev;
      const next = new Set(prev);
      if (hasError) next.add(calendarId);
      else next.delete(calendarId);
      return next;
    });
  }

  const hasTokenError = errorCalendarIds.size > 0;

  function handleOverlayEvents(
    calendarId: number,
    calEvents: TravelCalendarEvent[],
  ) {
    setOverlayEventsByCalendar((prev) => ({
      ...prev,
      [calendarId]: calEvents,
    }));
  }

  const displayEvents = useMemo<DisplayEvent[]>(() => {
    const travel: DisplayEvent[] = events.map((event) => ({
      event,
      kind: "travel",
    }));
    const overlay: DisplayEvent[] = overlayCalendars
      .filter((cal) => !hiddenCalendarIds.has(cal.id))
      .flatMap((cal) =>
        (overlayEventsByCalendar[cal.id] ?? []).map((event) => ({
          event,
          kind: "overlay" as const,
          calendar: cal,
        })),
      );
    return [...travel, ...overlay];
  }, [events, overlayCalendars, hiddenCalendarIds, overlayEventsByCalendar]);

  function eventStyle(item: DisplayEvent): {
    className: string;
    style?: React.CSSProperties;
  } {
    if (item.kind === "travel") {
      return {
        className:
          "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60",
      };
    }
    const cal = item.calendar!;
    const labelColor = item.event.colorId
      ? colorHexById.get(item.event.colorId)
      : undefined;
    const fill = labelColor
      ? labelColor.hex
      : tintColor(cal.primaryColor, 0.18);
    return {
      className: labelColor
        ? "text-white hover:brightness-110"
        : "hover:brightness-95",
      style: {
        backgroundColor: fill,
        border: `1.5px solid ${cal.primaryColor}`,
        color: labelColor ? undefined : undefined,
      },
    };
  }

  const { data: suggestions = [] } = useListCalendarTripSuggestions({
    query: {
      enabled: Boolean(status?.configured),
      queryKey: getListCalendarTripSuggestionsQueryKey(),
    },
  });
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => s.status === "pending"),
    [suggestions],
  );
  const scanSuggestions = useScanCalendarTripSuggestions();
  const dismissSuggestion = useDismissCalendarTripSuggestion();
  const acceptSuggestion = useAcceptCalendarTripSuggestion();

  function handleScan() {
    scanSuggestions.mutate(undefined, {
      onSuccess: (result) => {
        qc.invalidateQueries({
          queryKey: getListCalendarTripSuggestionsQueryKey(),
        });
        toast.success(
          result.created > 0
            ? `Found ${result.created} new trip suggestion${result.created === 1 ? "" : "s"}`
            : "No new trips found across your connected calendars",
        );
      },
      onError: () =>
        toast.error("Could not scan your calendars. Please try again."),
    });
  }

  function handleDismissSuggestion(id: number) {
    dismissSuggestion.mutate(id, {
      onSuccess: () =>
        qc.invalidateQueries({
          queryKey: getListCalendarTripSuggestionsQueryKey(),
        }),
      onError: () =>
        toast.error("Could not dismiss suggestion. Please try again."),
    });
  }

  function handleAcceptSuggestion(suggestion: CalendarTripSuggestion) {
    acceptSuggestion.mutate(
      { id: suggestion.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({
            queryKey: getListCalendarTripSuggestionsQueryKey(),
          });
          toast.success(`"${suggestion.suggestedTitle}" added as a trip`);
        },
        onError: () =>
          toast.error("Could not create the trip. Please try again."),
      },
    );
  }

  const eventsQueryKey = getListTravelCalendarEventsQueryKey(startISO, endISO);

  const context = useMemo(() => {
    if (statusLoading) return undefined;
    if (!status?.configured) {
      return "Travel Calendar page: no shared Travel calendar is configured yet. The app owner needs to connect Google Calendar in Settings and assign a calendar as the shared Travel calendar.";
    }
    const monthLabel = calCursor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const summary = displayEvents
      .slice(0, 15)
      .map(
        (d) =>
          `"${d.event.title}"${d.kind === "overlay" ? ` (${d.calendar?.summary})` : ""}`,
      )
      .join("; ");
    const suggestionSummary = pendingSuggestions
      .slice(0, 5)
      .map(
        (s) =>
          `"${s.suggestedTitle}"${s.destination ? ` to ${s.destination}` : ""}`,
      )
      .join("; ");
    return (
      `Travel Calendar page: viewing ${monthLabel} in ${calView} view. Shared Travel calendar is "${status.calendarSummary}". ` +
      `${overlayCalendars.length} other connected calendar(s) available as overlays. ` +
      (summary
        ? `Events in range: ${summary}.`
        : "No events found in this range.") +
      (pendingSuggestions.length > 0
        ? ` There are ${pendingSuggestions.length} AI-detected trip suggestion(s) awaiting review: ${suggestionSummary}.`
        : "")
    );
  }, [
    statusLoading,
    status,
    calCursor,
    displayEvents,
    calView,
    overlayCalendars,
    pendingSuggestions,
  ]);
  usePageAssistantContext("travel-calendar", context);

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

  function openCreate() {
    setEditingEvent(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openCreateForDay(day: string) {
    setEditingEvent(null);
    setForm(emptyForm(day));
    setDialogOpen(true);
  }

  function openEdit(item: DisplayEvent) {
    if (item.kind === "overlay") {
      toast.info(
        `"${item.event.title}" is on ${item.calendar?.summary} — connect it as the shared Travel calendar to edit it here.`,
      );
      return;
    }
    setEditingEvent(item.event);
    setForm(eventToForm(item.event));
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const input = formToInput(form);

    if (editingEvent) {
      updateEvent.mutate(
        { eventId: editingEvent.id, body: input },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: eventsQueryKey });
            toast.success("Event updated");
            setDialogOpen(false);
          },
          onError: () =>
            toast.error("Could not update event. Please try again."),
        },
      );
    } else {
      createEvent.mutate(input, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: eventsQueryKey });
          toast.success("Event added to the Travel Calendar");
          setDialogOpen(false);
        },
        onError: () => toast.error("Could not add event. Please try again."),
      });
    }
  }

  function handleDelete(eventId: string) {
    deleteEvent.mutate(eventId, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: eventsQueryKey });
        toast.success("Event deleted");
        setConfirmingDeleteId(null);
      },
      onError: () => toast.error("Could not delete event. Please try again."),
    });
  }

  if (!statusLoading && !status?.configured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="font-serif text-2xl text-foreground">
          No shared Travel Calendar yet
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect a Google account in Settings and assign one of your calendars
          as the shared "Travel" calendar so everyone can view, add, edit, and
          delete events here.
        </p>
        <a href="/account">
          <Button className="mt-5">Go to Settings</Button>
        </a>
      </div>
    );
  }

  // ── belowToolbar: overlay calendar toggles + trip suggestions ───────────────
  const belowToolbar = (
    <>
      {overlayCalendars.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Plane className="h-3.5 w-3.5" />
            {status?.calendarSummary ?? "Travel"}
          </span>
          {overlayCalendars.map((cal) => {
            const hidden = hiddenCalendarIds.has(cal.id);
            return (
              <button
                key={cal.id}
                type="button"
                onClick={() => toggleCalendarVisibility(cal.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  hidden
                    ? "text-muted-foreground border-card-border"
                    : "text-foreground"
                }`}
                style={
                  !hidden
                    ? {
                        borderColor: cal.primaryColor,
                        backgroundColor: tintColor(cal.primaryColor, 0.12),
                      }
                    : undefined
                }
              >
                {hidden ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: cal.primaryColor }}
                />
                {cal.summary}
              </button>
            );
          })}
        </div>
      )}

      {status?.configured &&
        (pendingSuggestions.length > 0 || scanSuggestions.isPending) && (
          <div className="space-y-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold text-foreground">
                  Trip suggestions
                </h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleScan}
                disabled={scanSuggestions.isPending}
              >
                {scanSuggestions.isPending ? "Scanning…" : "Scan calendars"}
              </Button>
            </div>
            {pendingSuggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Scanning your connected calendars for possible trips…
              </p>
            ) : (
              <ul className="space-y-2">
                {pendingSuggestions.map((suggestion) => (
                  <li
                    key={suggestion.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border/60 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {suggestion.suggestedTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          suggestion.destination,
                          suggestion.startDate && suggestion.endDate
                            ? `${suggestion.startDate} – ${suggestion.endDate}`
                            : suggestion.startDate,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDismissSuggestion(suggestion.id)}
                        disabled={dismissSuggestion.isPending}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleAcceptSuggestion(suggestion)}
                        disabled={acceptSuggestion.isPending}
                      >
                        Add as trip
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
    </>
  );

  return (
    <div className="space-y-6">
      {/* Overlay calendar data loaders (null-rendering; use mirror-state range) */}
      {overlayCalendars.map((cal) => (
        <OverlayCalendarEvents
          key={cal.id}
          calendar={cal}
          start={startISO}
          end={endISO}
          onEvents={handleOverlayEvents}
          onError={handleOverlayError}
        />
      ))}

      {hasTokenError && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            One or more connected calendars couldn&apos;t load — your Google
            Calendar connection may have expired.{" "}
            <a
              href="/api/travels/google-calendar/connect?returnTo=/modules/travels/travel-calendar"
              className="font-medium underline"
            >
              Reconnect Google Calendar
            </a>{" "}
            to restore event display.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-foreground">
            Travel Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            {status?.calendarSummary
              ? `Shared calendar: "${status.calendarSummary}"`
              : "Shared Travel calendar"}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add event
        </Button>
      </div>

      <CalendarCore
        onViewChange={setCalView}
        onCursorChange={setCalCursor}
        belowToolbar={belowToolbar}
      >
        {({ view, cursor, gridDays }: CalendarCoreContext) => {
          if (eventsLoading) {
            return (
              <p className="text-sm text-muted-foreground">Loading events…</p>
            );
          }

          /* ── Month view ──────────────────────────────────────────────── */
          if (view === "month") {
            return (
              <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                <div className="grid grid-cols-7 border-b border-card-border bg-muted/40 text-center text-xs font-medium text-muted-foreground">
                  {gridDays.slice(0, 7).map((d) => (
                    <div key={d.toISOString()} className="py-2">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </div>
                  ))}
                </div>
                {chunk(gridDays, 7).map((week, wi) => {
                  const weekStartKey = dateKey(week[0]);
                  const weekEndKey = dateKey(week[6]);
                  const weekEvents = displayEvents
                    .filter(
                      (item) =>
                        displayEventEndKey(item) >= weekStartKey &&
                        displayEventStartKey(item) <= weekEndKey,
                    )
                    .sort((a, b) =>
                      displayEventStartKey(a).localeCompare(
                        displayEventStartKey(b),
                      ),
                    );
                  const isLastWeek = wi === chunk(gridDays, 7).length - 1;
                  return (
                    <div
                      key={wi}
                      className={
                        isLastWeek ? "" : "border-b border-card-border/60"
                      }
                    >
                      <div className="grid grid-cols-7">
                        {week.map((day) => {
                          const key = dateKey(day);
                          const inMonth = isSameMonth(day, cursor);
                          const today = isToday(day);
                          return (
                            <div
                              key={key}
                              role="button"
                              tabIndex={0}
                              onClick={() => openCreateForDay(key)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ")
                                  openCreateForDay(key);
                              }}
                              className={`min-h-[48px] cursor-pointer border-r border-card-border/60 p-1.5 last:border-r-0 hover:bg-muted/40 ${
                                inMonth ? "bg-card" : "bg-muted/20"
                              }`}
                            >
                              <span
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                                  today
                                    ? "bg-primary text-primary-foreground font-semibold"
                                    : inMonth
                                      ? "text-foreground"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {day.getDate()}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-7 gap-y-0.5 pb-1.5 pt-0.5 min-h-[28px]">
                        {weekEvents.map((item) => {
                          const startKey = displayEventStartKey(item);
                          const endKey = displayEventEndKey(item);
                          const isStart = startKey >= weekStartKey;
                          const isEnd = endKey <= weekEndKey;
                          const colStart = isStart
                            ? week.findIndex((d) => dateKey(d) === startKey) + 1
                            : 1;
                          const endIdx = week.findIndex(
                            (d) => dateKey(d) === endKey,
                          );
                          const colEnd = isEnd && endIdx >= 0 ? endIdx + 2 : 8;
                          const st = eventStyle(item);
                          return (
                            <button
                              key={`${item.kind}-${item.calendar?.id ?? "t"}-${item.event.id}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(item);
                              }}
                              style={{
                                gridColumn: `${colStart} / ${colEnd}`,
                                marginLeft: isStart ? 2 : 0,
                                marginRight: isEnd ? 2 : 0,
                                ...st.style,
                              }}
                              className={`h-5 flex items-center gap-1 truncate px-1.5 text-left text-[11px] ${st.className} ${isStart ? "rounded-l" : ""} ${isEnd ? "rounded-r" : ""}`}
                              title={item.event.title}
                            >
                              {isStart && item.kind === "travel" && (
                                <Plane className="h-2.5 w-2.5 shrink-0" />
                              )}
                              {isStart && (
                                <span className="truncate">
                                  {item.event.title}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }

          /* ── Week view ───────────────────────────────────────────────── */
          if (view === "week") {
            return (
              <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                <div className="grid grid-cols-7 divide-x divide-card-border/60 border-b border-card-border/60">
                  {gridDays.map((day) => {
                    const today = isToday(day);
                    return (
                      <div
                        key={dateKey(day)}
                        className={`flex flex-col items-center py-2 ${
                          today ? "bg-primary/10" : "bg-muted/30"
                        }`}
                      >
                        <span className="text-[11px] text-muted-foreground">
                          {day.toLocaleDateString(undefined, {
                            weekday: "short",
                          })}
                        </span>
                        <span
                          className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                            today
                              ? "bg-primary text-primary-foreground font-semibold"
                              : "text-foreground"
                          }`}
                        >
                          {day.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const wStartKey = dateKey(gridDays[0]);
                  const wEndKey = dateKey(gridDays[6]);
                  const wEvents = displayEvents
                    .filter(
                      (item) =>
                        displayEventEndKey(item) >= wStartKey &&
                        displayEventStartKey(item) <= wEndKey,
                    )
                    .sort((a, b) =>
                      displayEventStartKey(a).localeCompare(
                        displayEventStartKey(b),
                      ),
                    );
                  if (wEvents.length === 0) return null;
                  return (
                    <div className="grid grid-cols-7 gap-y-0.5 border-b border-card-border/60 py-1.5">
                      {wEvents.map((item) => {
                        const startKey = displayEventStartKey(item);
                        const endKey = displayEventEndKey(item);
                        const isStart = startKey >= wStartKey;
                        const isEnd = endKey <= wEndKey;
                        const colStart = isStart
                          ? gridDays.findIndex((d) => dateKey(d) === startKey) +
                            1
                          : 1;
                        const endIdx = gridDays.findIndex(
                          (d) => dateKey(d) === endKey,
                        );
                        const colEnd = isEnd && endIdx >= 0 ? endIdx + 2 : 8;
                        const st = eventStyle(item);
                        return (
                          <button
                            key={`${item.kind}-${item.calendar?.id ?? "t"}-${item.event.id}`}
                            type="button"
                            onClick={() => openEdit(item)}
                            style={{
                              gridColumn: `${colStart} / ${colEnd}`,
                              marginLeft: isStart ? 2 : 0,
                              marginRight: isEnd ? 2 : 0,
                              ...st.style,
                            }}
                            className={`h-5 flex items-center gap-1 truncate px-1.5 text-left text-[11px] ${st.className} ${isStart ? "rounded-l" : ""} ${isEnd ? "rounded-r" : ""}`}
                            title={item.event.title}
                          >
                            {item.kind === "travel" && (
                              <Plane className="h-2.5 w-2.5 shrink-0" />
                            )}
                            <span className="truncate">{item.event.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-7 divide-x divide-card-border/60">
                  {gridDays.map((day) => {
                    const key = dateKey(day);
                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() => openCreateForDay(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            openCreateForDay(key);
                        }}
                        className="min-h-[160px] cursor-pointer hover:bg-muted/20"
                      />
                    );
                  })}
                </div>
              </div>
            );
          }

          /* ── List view ───────────────────────────────────────────────── */
          if (groups.length === 0) {
            return (
              <p className="rounded-xl border border-dashed border-card-border p-8 text-center text-sm text-muted-foreground">
                No events this month yet.
              </p>
            );
          }
          return (
            <div className="space-y-4">
              {groups.map(([key, dayEvents]) => (
                <div
                  key={key}
                  className="rounded-xl border border-card-border bg-card p-4"
                >
                  <h2 className="mb-2 text-sm font-semibold text-foreground">
                    {new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </h2>
                  <ul className="space-y-2">
                    {dayEvents.map((item) => {
                      const style = eventStyle(item);
                      return (
                        <li
                          key={`${item.kind}-${item.event.id}`}
                          className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                            item.kind === "travel"
                              ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
                              : "border-card-border/60"
                          }`}
                          style={
                            item.kind === "overlay"
                              ? {
                                  borderLeft: `4px solid ${item.calendar?.primaryColor}`,
                                }
                              : undefined
                          }
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="flex items-center gap-1.5 font-medium text-foreground">
                              {item.kind === "travel" ? (
                                <Plane className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                              ) : (
                                <span
                                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: style.style
                                      ?.backgroundColor as string | undefined,
                                  }}
                                />
                              )}
                              {item.event.title}
                              {item.kind === "overlay" && (
                                <span className="text-xs font-normal text-muted-foreground">
                                  · {item.calendar?.summary}
                                </span>
                              )}
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
                                  {new Date(item.event.end).toLocaleTimeString(
                                    undefined,
                                    {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    },
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
                            {item.event.description && (
                              <p className="text-xs text-muted-foreground">
                                {item.event.description}
                              </p>
                            )}
                          </div>
                          {item.kind === "travel" && (
                            <div className="flex shrink-0 items-center gap-1">
                              {confirmingDeleteId === item.event.id ? (
                                <>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleDelete(item.event.id)}
                                    disabled={deleteEvent.isPending}
                                  >
                                    Delete
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmingDeleteId(null)}
                                    disabled={deleteEvent.isPending}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => openEdit(item)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() =>
                                      setConfirmingDeleteId(item.event.id)
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        }}
      </CalendarCore>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {editingEvent ? "Edit event" : "New event"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                required
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-card-border p-3">
              <Label htmlFor="event-all-day">All-day event</Label>
              <Switch
                id="event-all-day"
                checked={form.allDay}
                onCheckedChange={(v) => setForm((f) => ({ ...f, allDay: v }))}
              />
            </div>

            {googleColors.length > 0 && (
              <div className="space-y-2 rounded-lg border border-card-border p-3">
                <Label>Event label</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, colorId: null }))}
                    title="Default"
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 bg-muted text-[10px] text-muted-foreground ${
                      form.colorId === null
                        ? "border-foreground"
                        : "border-transparent"
                    }`}
                  >
                    —
                  </button>
                  {googleColors.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, colorId: color.id }))
                      }
                      title={color.name}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                        form.colorId === color.id
                          ? "border-foreground"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: color.hex }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="event-start-date">Start date</Label>
                <Input
                  id="event-start-date"
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                />
              </div>
              {!form.allDay && (
                <div className="space-y-2">
                  <Label htmlFor="event-start-time">Start time</Label>
                  <Input
                    id="event-start-time"
                    type="time"
                    required
                    value={form.startTime}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startTime: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="event-end-date">End date</Label>
                <Input
                  id="event-end-date"
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                />
              </div>
              {!form.allDay && (
                <div className="space-y-2">
                  <Label htmlFor="event-end-time">End time</Label>
                  <Input
                    id="event-end-time"
                    type="time"
                    value={form.endTime}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endTime: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-location">Location (optional)</Label>
              <Input
                id="event-location"
                value={form.location}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-description">Notes (optional)</Label>
              <Textarea
                id="event-description"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createEvent.isPending || updateEvent.isPending}
              >
                {editingEvent ? "Save changes" : "Add event"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
