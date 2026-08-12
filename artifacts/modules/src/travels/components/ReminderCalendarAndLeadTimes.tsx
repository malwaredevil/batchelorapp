import { useMemo, useState } from "react";
import {
  useListConnectedCalendars,
  useListConnectedCalendarEvents,
  getListConnectedCalendarEventsQueryKey,
  type ReminderLeadTime,
  type ReminderLeadTimeUnit,
} from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays, X } from "lucide-react";

// Shared between the Travels reminder create form (TripDetail.tsx) and
// ReminderEditDialog.tsx (issue #518). Two independent concerns bundled in
// one file since they're always shown together:
//  - CalendarLinkPicker: attach a reminder to an event on one of the user's
//    OWN already-connected Google calendars (never creates a new event or
//    connection — that remains a manual, UI-only flow).
//  - LeadTimesEditor: an arbitrary-count, arbitrary-unit list of lead times
//    (minutes/hours/days/weeks before), generalizing the old fixed
//    day-offset chips.

const QUICK_LEAD_TIMES: { label: string; leadTime: ReminderLeadTime }[] = [
  { label: "On the day", leadTime: { value: 0, unit: "days" } },
  { label: "1 day before", leadTime: { value: 1, unit: "days" } },
  { label: "3 days before", leadTime: { value: 3, unit: "days" } },
  { label: "1 week before", leadTime: { value: 1, unit: "weeks" } },
];

function leadTimeKey(lt: ReminderLeadTime): string {
  return `${lt.value}-${lt.unit}`;
}

function formatLeadTime(lt: ReminderLeadTime): string {
  if (lt.value === 0) return "On the day";
  const singular = lt.unit.slice(0, -1);
  return `${lt.value} ${lt.value === 1 ? singular : lt.unit} before`;
}

export function LeadTimesEditor({
  leadTimes,
  onChange,
}: {
  leadTimes: ReminderLeadTime[];
  onChange: (next: ReminderLeadTime[]) => void;
}) {
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<ReminderLeadTimeUnit>("days");

  function toggleQuick(lt: ReminderLeadTime) {
    const key = leadTimeKey(lt);
    const exists = leadTimes.some((l) => leadTimeKey(l) === key);
    const next = exists
      ? leadTimes.filter((l) => leadTimeKey(l) !== key)
      : [...leadTimes, lt];
    onChange(next.length > 0 ? next : [{ value: 0, unit: "days" }]);
  }

  function removeLeadTime(lt: ReminderLeadTime) {
    const next = leadTimes.filter((l) => leadTimeKey(l) !== leadTimeKey(lt));
    onChange(next.length > 0 ? next : [{ value: 0, unit: "days" }]);
  }

  function addCustom() {
    const value = parseInt(customValue, 10);
    if (isNaN(value) || value < 0) return;
    const lt: ReminderLeadTime = { value, unit: customUnit };
    if (leadTimes.some((l) => leadTimeKey(l) === leadTimeKey(lt))) {
      setCustomValue("");
      return;
    }
    onChange([...leadTimes, lt]);
    setCustomValue("");
  }

  const extraLeadTimes = leadTimes.filter(
    (l) => !QUICK_LEAD_TIMES.some((q) => leadTimeKey(q.leadTime) === leadTimeKey(l)),
  );

  return (
    <div className="space-y-1.5 pt-1">
      <Label className="text-xs text-muted-foreground">Remind me</Label>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_LEAD_TIMES.map(({ label, leadTime }) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleQuick(leadTime)}
            className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
              leadTimes.some((l) => leadTimeKey(l) === leadTimeKey(leadTime))
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-card-border hover:border-primary/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {extraLeadTimes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {extraLeadTimes.map((lt) => (
            <Badge key={leadTimeKey(lt)} variant="secondary" className="gap-1">
              {formatLeadTime(lt)}
              <button
                type="button"
                onClick={() => removeLeadTime(lt)}
                aria-label={`Remove ${formatLeadTime(lt)}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Input
          type="number"
          min={0}
          placeholder="Custom"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          className="w-20"
        />
        <Select
          value={customUnit}
          onValueChange={(v) => setCustomUnit(v as ReminderLeadTimeUnit)}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">minutes</SelectItem>
            <SelectItem value="hours">hours</SelectItem>
            <SelectItem value="days">days</SelectItem>
            <SelectItem value="weeks">weeks</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">before</span>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={addCustom}
          disabled={!customValue.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

export function CalendarLinkPicker({
  calendarConnectionId,
  googleEventId,
  onChange,
}: {
  calendarConnectionId: number | null;
  googleEventId: string | null;
  onChange: (
    calendarConnectionId: number | null,
    googleEventId: string | null,
  ) => void;
}) {
  const { data: calendars = [] } = useListConnectedCalendars();
  const [selectedCalendarId, setSelectedCalendarId] = useState<number | null>(
    calendarConnectionId,
  );
  const enabled = calendarConnectionId != null && googleEventId != null;

  // A generous forward-looking window — reminders are usually attached to an
  // upcoming event, not a past one. 18 months covers most trip-planning
  // horizons without requiring the picker to compute its own bounds.
  const { start, end } = useMemo(() => {
    const now = new Date();
    return {
      start: now.toISOString(),
      end: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 548).toISOString(),
    };
  }, []);

  const { data: events = [], isLoading: eventsLoading } =
    useListConnectedCalendarEvents(selectedCalendarId ?? 0, start, end, {
      query: {
        queryKey: getListConnectedCalendarEventsQueryKey(
          selectedCalendarId ?? 0,
          start,
          end,
        ),
        enabled: selectedCalendarId != null,
      },
    });

  if (calendars.length === 0) return null;

  function handleToggle(checked: boolean) {
    if (!checked) {
      setSelectedCalendarId(null);
      onChange(null, null);
    } else {
      const firstId = calendars[0]?.id ?? null;
      setSelectedCalendarId(firstId);
      onChange(null, null);
    }
  }

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5" /> Attach to a calendar event
        </Label>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {enabled && (
        <div className="space-y-2 pt-1">
          <Select
            value={selectedCalendarId != null ? String(selectedCalendarId) : undefined}
            onValueChange={(v) => {
              const id = Number(v);
              setSelectedCalendarId(id);
              onChange(null, null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a calendar" />
            </SelectTrigger>
            <SelectContent>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.summary}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={googleEventId ?? undefined}
            onValueChange={(v) => onChange(selectedCalendarId, v)}
            disabled={selectedCalendarId == null || eventsLoading}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  eventsLoading ? "Loading events…" : "Choose an event"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {events.length === 0 && !eventsLoading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No upcoming events on this calendar.
                </div>
              ) : (
                events.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {ev.title} —{" "}
                    {new Date(ev.start).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The due date follows this event&apos;s start time automatically.
          </p>
        </div>
      )}
    </div>
  );
}
