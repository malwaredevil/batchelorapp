import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
  Loader2,
  Plus,
  CalendarHeart,
  Pencil,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useListOrnamentsHallmarkEvents,
  useCreateOrnamentsHallmarkEvent,
  useUpdateOrnamentsHallmarkEvent,
  useDeleteOrnamentsHallmarkEvent,
  type OrnamentsHallmarkEvent,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const eventSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(1000).optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

type EventFormValues = z.infer<typeof eventSchema>;

const HALLMARK_CALENDAR_ID =
  "0faf14204f8ea1b90c6df3acda964358070d92197cb405179516c71ad5f1fc5f@group.calendar.google.com";
const HALLMARK_CALENDAR_URL = `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(
  HALLMARK_CALENDAR_ID,
)}`;

type ViewMode = "month" | "week" | "list";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

function rangeForView(
  view: ViewMode,
  cursor: Date,
): { start: Date; end: Date } {
  if (view === "week") return weekRange(cursor);
  return monthGridRange(cursor);
}

function shiftCursor(view: ViewMode, cursor: Date, direction: 1 | -1): Date {
  if (view === "week") return addDays(cursor, 7 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );
}

function EventFormDialog({
  open,
  onOpenChange,
  event,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: OrnamentsHallmarkEvent;
  defaultDate?: string;
}) {
  const createEvent = useCreateOrnamentsHallmarkEvent();
  const updateEvent = useUpdateOrnamentsHallmarkEvent();
  const isEditing = !!event;

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: event?.title ?? "",
      description: event?.description ?? "",
      startDate: event?.startDate ?? defaultDate ?? "",
      endDate: event?.endDate ?? defaultDate ?? "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: event?.title ?? "",
      description: event?.description ?? "",
      startDate: event?.startDate ?? defaultDate ?? "",
      endDate: event?.endDate ?? defaultDate ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event, defaultDate]);

  const onSubmit = async (values: EventFormValues) => {
    try {
      if (isEditing && event) {
        await updateEvent.mutateAsync({ id: event.id, data: values });
        toast.success("Event updated");
      } else {
        await createEvent.mutateAsync(values);
        toast.success("Event added");
      }
      onOpenChange(false);
      form.reset();
    } catch {
      toast.error(isEditing ? "Failed to update event" : "Failed to add event");
    }
  };

  const isSaving = createEvent.isPending || updateEvent.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Edit event" : "Add Hallmark event"}
          </DialogTitle>
          <DialogDescription>
            Household-shared dates for Hallmark Keepsake events (Open House,
            etc.). Best-effort synced to the shared Hallmark Google Calendar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              {...form.register("title")}
              placeholder="Hallmark Open House"
            />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                {...form.register("startDate")}
              />
              {form.formState.errors.startDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End date</Label>
              <Input id="endDate" type="date" {...form.register("endDate")} />
              {form.formState.errors.endDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.endDate.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Notes (optional)</Label>
            <Textarea
              id="description"
              {...form.register("description")}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? "Save changes" : "Add event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventViewDialog({
  open,
  event,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  open: boolean;
  event: OrnamentsHallmarkEvent | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (event: OrnamentsHallmarkEvent) => void;
  onDelete: (event: OrnamentsHallmarkEvent) => void;
}) {
  if (!event) return null;
  const now = Date.now();
  const start = new Date(`${event.startDate}T00:00:00`);
  const end = new Date(`${event.endDate}T23:59:59`);
  const isLive = now >= start.getTime() && now <= end.getTime();
  const daysAway = isLive
    ? null
    : Math.max(0, Math.ceil((start.getTime() - now) / 86_400_000));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="font-serif text-xl leading-tight">
              {event.title}
            </DialogTitle>
            <div className="flex gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Edit event"
                onClick={() => onEdit(event)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label="Delete event"
                onClick={() => onDelete(event)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogDescription>
            {formatRange(event.startDate, event.endDate)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              isLive
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
            }`}
          >
            {isLive ? (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Live now
              </>
            ) : (
              <>
                <CalendarHeart className="h-4 w-4" />
                {daysAway === 0 ? "Starting today" : `${daysAway} days away`}
              </>
            )}
          </div>
          {event.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatRange(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString(
    "en-US",
    {
      ...opts,
      year: "numeric",
    },
  )}`;
}

export default function HallmarkEvents() {
  const { data: events, isLoading } = useListOrnamentsHallmarkEvents();
  const deleteEvent = useDeleteOrnamentsHallmarkEvent();

  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => new Date());

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<
    OrnamentsHallmarkEvent | undefined
  >(undefined);
  const [defaultDate, setDefaultDate] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] =
    useState<OrnamentsHallmarkEvent | null>(null);
  const [viewingEvent, setViewingEvent] =
    useState<OrnamentsHallmarkEvent | null>(null);

  const hasHandledInitialParams = useRef(false);

  const todayKey = useMemo(() => dateKey(new Date()), []);

  const upcoming = useMemo(
    () =>
      (events ?? [])
        .filter((e) => e.endDate >= todayKey)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [events, todayKey],
  );

  usePageAssistantContext(
    "ornaments-hallmark-events",
    `Hallmark events page: manage household-shared dates for Hallmark Keepsake events (Open House, etc.), best-effort synced to the shared Hallmark Google Calendar. Currently tracking ${
      events?.length ?? 0
    } event(s), ${upcoming.length} upcoming.`,
  );

  useEffect(() => {
    if (hasHandledInitialParams.current || !events) return;
    hasHandledInitialParams.current = true;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view") as ViewMode | null;
    const eventId = params.get("eventId");
    if (viewParam === "month" || viewParam === "week" || viewParam === "list") {
      setView(viewParam);
    }
    if (eventId) {
      const found = events.find((e) => String(e.id) === eventId);
      if (found) setViewingEvent(found);
    }
  }, [events]);

  const { start, end } = useMemo(
    () => rangeForView(view, cursor),
    [view, cursor],
  );

  const gridDays = useMemo(() => {
    if (view === "list") return [];
    const lastDayInclusive = addDays(end, -1);
    return eachDayOfInterval({ start, end: lastDayInclusive });
  }, [view, start, end]);

  const openCreate = (date?: string) => {
    setEditingEvent(undefined);
    setDefaultDate(date);
    setFormOpen(true);
  };

  const openEdit = (event: OrnamentsHallmarkEvent) => {
    setEditingEvent(event);
    setDefaultDate(undefined);
    setFormOpen(true);
  };

  const openView = (event: OrnamentsHallmarkEvent) => {
    setViewingEvent(event);
  };

  const openEditFromView = (event: OrnamentsHallmarkEvent) => {
    setViewingEvent(null);
    setEditingEvent(event);
    setDefaultDate(undefined);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEvent.mutateAsync(deleteTarget.id);
      toast.success("Event removed");
    } catch {
      toast.error("Failed to remove event");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-foreground">
            Hallmark Events
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Track Open House and other Hallmark Keepsake dates for the whole
            household
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" asChild className="gap-2">
            <a
              href={HALLMARK_CALENDAR_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              Open calendar
            </a>
          </Button>
          <Button onClick={() => openCreate()} className="gap-2">
            <Plus className="h-4 w-4" />
            Add event
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor((c) => shiftCursor(view, c, -1))}
            disabled={view === "list"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium text-foreground">
            {view === "week"
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
              : view === "month"
                ? cursor.toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })
                : "Upcoming events"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date())}
            disabled={view === "list"}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor((c) => shiftCursor(view, c, 1))}
            disabled={view === "list"}
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

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === "month" ? (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 border-b border-card-border bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {gridDays.slice(0, 7).map((d) => (
              <div key={d.toISOString()} className="py-2">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
            ))}
          </div>
          {/* Week rows with spanning event bars */}
          {chunk(gridDays, 7).map((week, wi) => {
            const weekStartKey = dateKey(week[0]);
            const weekEndKey = dateKey(week[6]);
            const weekEvents = (events ?? [])
              .filter(
                (e) =>
                  e.endDate >= weekStartKey && e.startDate <= weekEndKey,
              )
              .sort((a, b) => a.startDate.localeCompare(b.startDate));
            const isLastWeek = wi === chunk(gridDays, 7).length - 1;
            return (
              <div
                key={wi}
                className={isLastWeek ? "" : "border-b border-card-border/60"}
              >
                {/* Day number cells */}
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
                        onClick={() => openCreate(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            openCreate(key);
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
                {/* Spanning event bars */}
                {weekEvents.length > 0 && (
                  <div className="grid grid-cols-7 gap-y-0.5 pb-1.5 pt-0.5">
                    {weekEvents.map((event) => {
                      const isStart = event.startDate >= weekStartKey;
                      const isEnd = event.endDate <= weekEndKey;
                      const colStart = isStart
                        ? week.findIndex(
                            (d) => dateKey(d) === event.startDate,
                          ) + 1
                        : 1;
                      const endIdx = week.findIndex(
                        (d) => dateKey(d) === event.endDate,
                      );
                      const colEnd = isEnd && endIdx >= 0 ? endIdx + 2 : 8;
                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openView(event);
                          }}
                          style={{
                            gridColumn: `${colStart} / ${colEnd}`,
                            marginLeft: isStart ? 2 : 0,
                            marginRight: isEnd ? 2 : 0,
                          }}
                          className={`h-5 px-1.5 text-left text-[11px] truncate flex items-center gap-1 bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60 ${
                            isStart ? "rounded-l" : ""
                          } ${isEnd ? "rounded-r" : ""}`}
                          title={event.title}
                        >
                          {isStart && (
                            <CalendarHeart className="h-2.5 w-2.5 shrink-0" />
                          )}
                          {isStart && (
                            <span className="truncate">{event.title}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : view === "week" ? (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          {/* Day headers */}
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
                    {day.toLocaleDateString(undefined, { weekday: "short" })}
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
          {/* Spanning event bars */}
          {(() => {
            const wStartKey = dateKey(gridDays[0]);
            const wEndKey = dateKey(gridDays[6]);
            const wEvents = (events ?? [])
              .filter(
                (e) => e.endDate >= wStartKey && e.startDate <= wEndKey,
              )
              .sort((a, b) => a.startDate.localeCompare(b.startDate));
            if (wEvents.length === 0) return null;
            return (
              <div className="grid grid-cols-7 gap-y-0.5 py-1.5 border-b border-card-border/60">
                {wEvents.map((event) => {
                  const isStart = event.startDate >= wStartKey;
                  const isEnd = event.endDate <= wEndKey;
                  const colStart = isStart
                    ? gridDays.findIndex(
                        (d) => dateKey(d) === event.startDate,
                      ) + 1
                    : 1;
                  const endIdx = gridDays.findIndex(
                    (d) => dateKey(d) === event.endDate,
                  );
                  const colEnd = isEnd && endIdx >= 0 ? endIdx + 2 : 8;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => openView(event)}
                      style={{
                        gridColumn: `${colStart} / ${colEnd}`,
                        marginLeft: isStart ? 2 : 0,
                        marginRight: isEnd ? 2 : 0,
                      }}
                      className={`h-5 px-1.5 text-left text-[11px] truncate flex items-center gap-1 bg-rose-100 text-rose-800 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60 ${
                        isStart ? "rounded-l" : ""
                      } ${isEnd ? "rounded-r" : ""}`}
                      title={event.title}
                    >
                      <CalendarHeart className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{event.title}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {/* Day bodies — click to create */}
          <div className="grid grid-cols-7 divide-x divide-card-border/60">
            {gridDays.map((day) => {
              const key = dateKey(day);
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => openCreate(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") openCreate(key);
                  }}
                  className="min-h-[160px] cursor-pointer hover:bg-muted/20"
                />
              );
            })}
          </div>
        </div>
      ) : upcoming.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border p-10 text-center text-muted-foreground">
          <CalendarHeart className="h-8 w-8 mx-auto mb-3 opacity-50" />
          No upcoming Hallmark events. Add one to see it countdown on the app
          launcher.
        </div>
      ) : (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {upcoming.map((event) => (
            <li
              key={event.id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                <CalendarHeart className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium font-serif tracking-wide truncate">
                  {event.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatRange(event.startDate, event.endDate)}
                  {event.googleEventId ? "" : " · calendar sync pending"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openEdit(event)}
                aria-label="Edit event"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteTarget(event)}
                aria-label="Delete event"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <EventViewDialog
        open={!!viewingEvent}
        event={viewingEvent}
        onOpenChange={(o) => !o && setViewingEvent(null)}
        onEdit={openEditFromView}
        onDelete={(e) => {
          setViewingEvent(null);
          setDeleteTarget(e);
        }}
      />

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editingEvent}
        defaultDate={defaultDate}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be removed for the whole household.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
