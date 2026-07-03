import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useGetFamilyCalendarStatus,
  useListFamilyCalendarEvents,
  useCreateFamilyCalendarEvent,
  useUpdateFamilyCalendarEvent,
  useDeleteFamilyCalendarEvent,
  getListFamilyCalendarEventsQueryKey,
  type FamilyCalendarEvent,
  type FamilyCalendarEventInput,
} from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/lib/assistant-context";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ViewMode = "month" | "week" | "list";

function monthRange(cursor: Date): { start: Date; end: Date } {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { start, end };
}

function weekRange(cursor: Date): { start: Date; end: Date } {
  const start = startOfWeek(cursor);
  return { start, end: addDays(start, 7) };
}

function monthGridRange(cursor: Date): { start: Date; end: Date } {
  const gridStart = startOfWeek(startOfMonth(cursor));
  const lastRowStart = startOfWeek(endOfWeek(endOfMonth(cursor)));
  return { start: gridStart, end: addDays(lastRowStart, 7) };
}

function rangeForView(view: ViewMode, cursor: Date): { start: Date; end: Date } {
  if (view === "week") return weekRange(cursor);
  if (view === "month") return monthGridRange(cursor);
  return monthRange(cursor);
}

function shiftCursor(view: ViewMode, cursor: Date, direction: 1 | -1): Date {
  if (view === "week") return addDays(cursor, 7 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

function eventDayKey(event: FamilyCalendarEvent): string {
  if (event.allDay) return event.start;
  const d = new Date(event.start);
  return dateKey(d);
}

function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: dateKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
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
  };
}

function eventToForm(event: FamilyCalendarEvent): EventFormState {
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
  };
}

function formToInput(form: EventFormState): FamilyCalendarEventInput {
  if (form.allDay) {
    return {
      title: form.title,
      description: form.description || null,
      location: form.location || null,
      allDay: true,
      start: form.startDate,
      end: form.endDate || form.startDate,
    };
  }
  const start = new Date(`${form.startDate}T${form.startTime || "09:00"}:00`).toISOString();
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
  };
}

export default function FamilyCalendar() {
  const qc = useQueryClient();
  const { data: status, isLoading: statusLoading } = useGetFamilyCalendarStatus();
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("month");
  const { start, end } = useMemo(() => rangeForView(view, cursor), [view, cursor]);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const { data: events = [], isLoading: eventsLoading } = useListFamilyCalendarEvents(
    startISO,
    endISO,
    {
      query: {
        enabled: Boolean(status?.configured),
        queryKey: getListFamilyCalendarEventsQueryKey(startISO, endISO),
      },
    },
  );

  const createEvent = useCreateFamilyCalendarEvent();
  const updateEvent = useUpdateFamilyCalendarEvent();
  const deleteEvent = useDeleteFamilyCalendarEvent();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<FamilyCalendarEvent | null>(null);
  const [form, setForm] = useState<EventFormState>(emptyForm());
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const eventsQueryKey = getListFamilyCalendarEventsQueryKey(startISO, endISO);

  const context = useMemo(() => {
    if (statusLoading) return undefined;
    if (!status?.configured) {
      return "Family Calendar page: no shared household calendar is configured yet. The owner needs to connect Google Calendar in Settings and turn on 'Share as household Family Calendar'.";
    }
    const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const summary = events
      .slice(0, 15)
      .map((e) => `"${e.title}" (${e.allDay ? e.start : e.start})`)
      .join("; ");
    return (
      `Family Calendar page: viewing ${monthLabel} in ${view} view on the shared calendar "${status.calendarSummary}". ` +
      (summary ? `Events in range: ${summary}.` : "No events found in this range.")
    );
  }, [statusLoading, status, cursor, events, view]);
  usePageAssistantContext("family-calendar", context);

  const groups = useMemo(() => {
    const map = new Map<string, FamilyCalendarEvent[]>();
    for (const event of events) {
      const key = eventDayKey(event);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, FamilyCalendarEvent[]>();
    for (const event of events) {
      const key = eventDayKey(event);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const gridDays = useMemo(() => {
    if (view === "list") return [];
    const lastDayInclusive = addDays(end, -1);
    return eachDayOfInterval({ start, end: lastDayInclusive });
  }, [view, start, end]);

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

  function openEdit(event: FamilyCalendarEvent) {
    setEditingEvent(event);
    setForm(eventToForm(event));
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
          onError: () => toast.error("Could not update event. Please try again."),
        },
      );
    } else {
      createEvent.mutate(input, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: eventsQueryKey });
          toast.success("Event added to the Family Calendar");
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
        <h1 className="font-serif text-2xl text-foreground">No shared Family Calendar yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect a Google account in Settings and turn on "Share as household Family Calendar" so
          everyone can view, add, edit, and delete events here.
        </p>
        <Link href="/settings">
          <Button className="mt-5">Go to Settings</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-foreground">Family Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {status?.calendarSummary ? `Shared calendar: "${status.calendarSummary}"` : "Shared household calendar"}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add event
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setCursor((c) => shiftCursor(view, c, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium text-foreground">
            {view === "week"
              ? (() => {
                  const weekEnd = addDays(start, 6);
                  const sameMonth = start.getMonth() === weekEnd.getMonth();
                  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  const endLabel = weekEnd.toLocaleDateString(
                    undefined,
                    sameMonth
                      ? { day: "numeric", year: "numeric" }
                      : { month: "short", day: "numeric", year: "numeric" },
                  );
                  return `${startLabel} – ${endLabel}`;
                })()
              : cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setCursor((c) => shiftCursor(view, c, 1))}>
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

      {eventsLoading ? (
        <p className="text-sm text-muted-foreground">Loading events…</p>
      ) : view === "month" ? (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="grid grid-cols-7 border-b border-card-border bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {gridDays.slice(0, 7).map((d) => (
              <div key={d.toISOString()} className="py-2">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const inMonth = isSameMonth(day, cursor);
              const today = isToday(day);
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => openCreateForDay(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") openCreateForDay(key);
                  }}
                  className={`min-h-[92px] cursor-pointer border-b border-r border-card-border/60 p-1.5 text-left align-top last:border-r-0 hover:bg-muted/40 ${
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
                  <div className="mt-1 space-y-0.5">
                    {dayEvents.slice(0, 3).map((event) => (
                      <div
                        key={event.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(event);
                        }}
                        className="truncate rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary hover:bg-primary/20"
                        title={event.title}
                      >
                        {event.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="px-1 text-[10px] text-muted-foreground">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="grid grid-cols-7 divide-x divide-card-border/60">
            {gridDays.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const today = isToday(day);
              return (
                <div key={key} className="min-h-[220px]">
                  <div
                    className={`flex flex-col items-center border-b border-card-border/60 py-2 ${
                      today ? "bg-primary/10" : "bg-muted/30"
                    }`}
                  >
                    <span className="text-[11px] text-muted-foreground">
                      {day.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span
                      className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        today ? "bg-primary text-primary-foreground font-semibold" : "text-foreground"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1 p-1.5">
                    {dayEvents.length === 0 ? (
                      <p className="px-1 text-center text-[11px] text-muted-foreground">—</p>
                    ) : (
                      dayEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => openEdit(event)}
                          className="block w-full truncate rounded bg-primary/10 px-1.5 py-1 text-left text-[11px] text-primary hover:bg-primary/20"
                          title={event.title}
                        >
                          {!event.allDay && (
                            <span className="mr-1 text-muted-foreground">
                              {new Date(event.start).toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                          {event.title}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-card-border p-8 text-center text-sm text-muted-foreground">
          No events this month yet.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([key, dayEvents]) => (
            <div key={key} className="rounded-xl border border-card-border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                {new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h2>
              <ul className="space-y-2">
                {dayEvents.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-card-border/60 p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-foreground">{event.title}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {!event.allDay && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(event.start).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            {" – "}
                            {new Date(event.end).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        {event.allDay && <span>All day</span>}
                        {event.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {event.location}
                          </span>
                        )}
                      </div>
                      {event.description && (
                        <p className="text-xs text-muted-foreground">{event.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {confirmingDeleteId === event.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(event.id)}
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
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(event)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmingDeleteId(event.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

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
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="event-start-date">Start date</Label>
                <Input
                  id="event-start-date"
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
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
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
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
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              {!form.allDay && (
                <div className="space-y-2">
                  <Label htmlFor="event-end-time">End time</Label>
                  <Input
                    id="event-end-time"
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-location">Location (optional)</Label>
              <Input
                id="event-location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-description">Notes (optional)</Label>
              <Textarea
                id="event-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createEvent.isPending || updateEvent.isPending}>
                {editingEvent ? "Save changes" : "Add event"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
