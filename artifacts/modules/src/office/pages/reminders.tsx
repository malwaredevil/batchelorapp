import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Bell,
  Mail,
  MessageSquareText,
  Phone,
  Slack,
  MessageCircle,
  Repeat,
  CalendarDays,
  ExternalLink,
  Pencil,
  Check,
  Undo2,
  Ban,
  Clock,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DOMPurify from "dompurify";
import { ReminderManageDialog } from "../components/ReminderManageDialog";
import type {
  Reminder,
  ReminderChannel,
  ReminderStatus,
} from "../lib/reminder-types";

// Central Reminders page (issue #524) — lists every reminder regardless of
// source (bell-icon on a record, Elaine-created, calendar-linked Travels)
// and is the only place to manage one after it has fired over a
// reply-less channel (SMS/voice/Slack/email). Talks directly to the generic
// GET/PATCH/snooze/DELETE endpoints in routes/reminders.ts — no orval hooks
// exist for this router yet (hand-rolled fetch, same as
// CreateReminderDialog in @workspace/collection-ui).

type StatusFilter = ReminderStatus | "all";
type WhenFilter = "all" | "upcoming" | "overdue";

const CHANNEL_ICON: Record<
  ReminderChannel,
  React.ComponentType<{ className?: string }>
> = {
  email: Mail,
  sms: MessageSquareText,
  call: Phone,
  slack: Slack,
  messenger: MessageCircle,
};

const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  email: "Email",
  sms: "Text",
  call: "Call",
  slack: "Slack",
  messenger: "In-app",
};

async function fetchReminders(
  status: StatusFilter,
  when: WhenFilter,
): Promise<Reminder[]> {
  const params = new URLSearchParams({ status, when });
  // raw-fetch-ok — generic reminders endpoint isn't in the OpenAPI spec yet, no Orval hook
  const res = await fetch(`/api/reminders?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load reminders (${res.status})`);
  const data = await res.json();
  return data.reminders as Reminder[];
}

function formatDue(reminder: Reminder): {
  text: string;
  overdue: boolean;
} | null {
  if (!reminder.dueAt) return null;
  const due = new Date(reminder.dueAt);
  const overdue = due.getTime() < Date.now() && reminder.status === "active";
  const text = due.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return { text, overdue };
}

function recurrenceSummary(r: Reminder): string | null {
  if (!r.isRecurring) return null;
  if (r.recurrenceIntervalValue != null && r.recurrenceIntervalUnit) {
    const unit =
      r.recurrenceIntervalValue === 1
        ? r.recurrenceIntervalUnit.slice(0, -1)
        : r.recurrenceIntervalUnit;
    return `Every ${r.recurrenceIntervalValue} ${unit}`;
  }
  if (r.recurrenceWeekday != null) {
    const labels = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return `Weekly on ${labels[r.recurrenceWeekday]}`;
  }
  if (r.recurrenceDayOfMonth != null) {
    return `Monthly on day ${r.recurrenceDayOfMonth}`;
  }
  return "Repeats";
}

const STATUS_BADGE: Record<
  ReminderStatus,
  { label: string; className: string }
> = {
  active: { label: "Active", className: "bg-primary/10 text-primary" },
  done: { label: "Done", className: "bg-green-500/10 text-green-700" },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground",
  },
};

export default function OfficeReminders() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [when, setWhen] = useState<WhenFilter>("all");
  const [editing, setEditing] = useState<Reminder | null>(null);

  const queryKey = ["office-reminders", status, when] as const;
  const { data: reminders = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchReminders(status, when),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["office-reminders"] });
  }

  async function setReminderStatus(id: number, next: ReminderStatus) {
    try {
      // raw-fetch-ok — generic reminders endpoint isn't in the OpenAPI spec yet, no Orval hook
      const res = await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      toast.success(
        next === "active"
          ? "Reminder reopened"
          : next === "done"
            ? "Marked done"
            : "Reminder cancelled",
      );
      invalidate();
    } catch {
      toast.error("Couldn't update the reminder");
    }
  }

  async function snoozeTo(id: number, dueAt: Date) {
    try {
      // raw-fetch-ok — generic reminders endpoint isn't in the OpenAPI spec yet, no Orval hook
      const res = await fetch(`/api/reminders/${id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dueAt: dueAt.toISOString() }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      toast.success("Reminder snoozed");
      invalidate();
    } catch {
      toast.error("Couldn't snooze the reminder");
    }
  }

  async function skipNext(id: number) {
    try {
      // raw-fetch-ok — generic reminders endpoint isn't in the OpenAPI spec yet, no Orval hook
      const res = await fetch(`/api/reminders/${id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ skipNext: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      toast.success("Skipped the next occurrence");
      invalidate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't skip that occurrence",
      );
    }
  }

  return (
    <div className="py-8 space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-2xl text-foreground">
          <Bell className="h-6 w-6" />
          Reminders
        </h1>
        <p className="text-sm text-muted-foreground">
          Every reminder across the household, however it was created — edit,
          snooze, or manage delivery here after it fires.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFilter)}
        >
          <SelectTrigger className="w-36" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
        <Select value={when} onValueChange={(v) => setWhen(v as WhenFilter)}>
          <SelectTrigger className="w-36" data-testid="select-when-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any time</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading reminders...</p>
      )}

      {!isLoading && reminders.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No reminders match these filters.
        </p>
      )}

      <div className="space-y-3">
        {reminders.map((r) => {
          const due = formatDue(r);
          const recurrence = recurrenceSummary(r);
          const statusBadge = STATUS_BADGE[r.status];
          return (
            <div
              key={r.id}
              className="rounded-xl border border-card-border bg-card p-4"
              data-testid={`card-reminder-${r.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium text-foreground truncate">
                      {r.title}
                    </h2>
                    <Badge className={statusBadge.className}>
                      {statusBadge.label}
                    </Badge>
                    {recurrence && (
                      <Badge
                        variant="outline"
                        className="gap-1 text-muted-foreground"
                      >
                        <Repeat className="w-3 h-3" /> {recurrence}
                      </Badge>
                    )}
                  </div>

                  {due ? (
                    <p
                      className={`text-sm mt-1 flex items-center gap-1.5 ${
                        due.overdue
                          ? "text-red-600 font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      <CalendarDays className="w-3.5 h-3.5" />
                      {due.overdue ? "Overdue · " : ""}
                      {due.text}
                      {r.googleEventHtmlLink && (
                        <a
                          href={r.googleEventHtmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
                        >
                          calendar event <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </p>
                  ) : (
                    <p className="text-sm mt-1 text-muted-foreground italic">
                      No due date set
                    </p>
                  )}

                  {r.description && (
                    <div
                      className="text-sm text-muted-foreground mt-1.5 prose prose-sm max-w-none [&_p]:my-0.5"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(r.description),
                      }}
                    />
                  )}

                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {r.entityLink && (
                      <Link
                        href={r.entityLink.url}
                        className="text-xs inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {r.entityLink.label}{" "}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                    {r.channels.length > 0 && (
                      <div className="flex items-center gap-2">
                        {r.channels.map((c) => {
                          const Icon = CHANNEL_ICON[c];
                          return (
                            <span
                              key={c}
                              title={CHANNEL_LABEL[c]}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing(r)}
                    title="Edit"
                    data-testid={`button-edit-reminder-${r.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>

                  {r.status === "active" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Snooze"
                          data-testid={`button-snooze-reminder-${r.id}`}
                        >
                          <Clock className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            snoozeTo(
                              r.id,
                              new Date(Date.now() + 24 * 60 * 60 * 1000),
                            )
                          }
                        >
                          Snooze 1 day
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            snoozeTo(
                              r.id,
                              new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                            )
                          }
                        >
                          Snooze 1 week
                        </DropdownMenuItem>
                        {r.isRecurring && (
                          <DropdownMenuItem onClick={() => skipNext(r.id)}>
                            <SkipForward className="w-3.5 h-3.5 mr-1.5" />
                            Skip next occurrence
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {r.status === "active" ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Mark done"
                        onClick={() => setReminderStatus(r.id, "done")}
                        data-testid={`button-done-reminder-${r.id}`}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Cancel"
                        onClick={() => setReminderStatus(r.id, "cancelled")}
                        data-testid={`button-cancel-reminder-${r.id}`}
                      >
                        <Ban className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Reopen"
                      onClick={() => setReminderStatus(r.id, "active")}
                      data-testid={`button-reopen-reminder-${r.id}`}
                    >
                      <Undo2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ReminderManageDialog
        reminder={editing}
        open={editing != null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={invalidate}
      />
    </div>
  );
}
