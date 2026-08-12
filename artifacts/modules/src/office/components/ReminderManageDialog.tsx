import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, MessageSquareText, Phone, Slack, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/travels/components/RichTextEditor";
import { LeadTimesEditor } from "@/travels/components/ReminderCalendarAndLeadTimes";
import {
  useListTravelsAppUsers,
  type TravelsAppUser,
} from "@workspace/api-client-react";
import {
  type Reminder,
  type ReminderLeadTime,
  type RecurrenceMode,
  recurrenceModeOf,
  WEEKDAY_LABELS,
} from "../lib/reminder-types";

// Full edit surface for issue #524's central Reminders page — the only place
// a reminder can be edited after it fires over a reply-less channel
// (SMS/voice/Slack/email). PATCH /api/reminders/:id backs every field here;
// mark-done/cancel is just a `status` value through the same call, so
// nothing is ever silently discarded (per the household's data-loss
// preference — see ReminderEditDialog.tsx for the same pattern in Travels).
//
// Calendar linking itself is intentionally NOT editable here — that stays a
// Travels-specific flow tied to a trip's own connected calendars. This
// dialog shows the linked event as a read-only link when present.

interface ReminderManageDialogProps {
  reminder: Reminder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function ReminderManageDialog({
  reminder,
  open,
  onOpenChange,
  onSaved,
}: ReminderManageDialogProps) {
  const { data: appUsers = [] } = useListTravelsAppUsers();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [leadTimes, setLeadTimes] = useState<ReminderLeadTime[]>([
    { value: 0, unit: "minutes" },
  ]);
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>("none");
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState("days");
  const [weekday, setWeekday] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [recurrenceMaxOccurrences, setRecurrenceMaxOccurrences] =
    useState("");
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [customEmail, setCustomEmail] = useState("");
  const [smsRecipients, setSmsRecipients] = useState<number[]>([]);
  const [callRecipients, setCallRecipients] = useState<number[]>([]);
  const [slackRecipients, setSlackRecipients] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (reminder && open) {
      setTitle(reminder.title);
      setDescription(reminder.description ?? "");
      setDueAt(toLocalInputValue(reminder.dueAt));
      setLeadTimes(
        reminder.leadTimes.length > 0
          ? reminder.leadTimes
          : [{ value: 0, unit: "minutes" }],
      );
      setRecurrenceMode(recurrenceModeOf(reminder));
      setIntervalValue(reminder.recurrenceIntervalValue ?? 1);
      setIntervalUnit(reminder.recurrenceIntervalUnit ?? "days");
      setWeekday(reminder.recurrenceWeekday ?? 0);
      setDayOfMonth(reminder.recurrenceDayOfMonth ?? 1);
      setRecurrenceEndDate(reminder.recurrenceEndDate ?? "");
      setRecurrenceMaxOccurrences(
        reminder.recurrenceMaxOccurrences != null
          ? String(reminder.recurrenceMaxOccurrences)
          : "",
      );
      setEmailRecipients(reminder.emailRecipients);
      setCustomEmail("");
      setSmsRecipients(reminder.smsRecipientUserIds);
      setCallRecipients(reminder.callRecipientUserIds);
      setSlackRecipients(reminder.slackRecipientUserIds);
      setConfirmingDelete(false);
    }
  }, [reminder, open]);

  function toggleIn(
    list: number[],
    setList: (next: number[]) => void,
    id: number,
  ) {
    setList(
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
  }

  function addCustomEmail() {
    const email = customEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (!emailRecipients.includes(email)) {
      setEmailRecipients((prev) => [...prev, email]);
    }
    setCustomEmail("");
  }

  async function handleSave() {
    if (!reminder) return;
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() ? description : null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        leadTimes,
        emailRecipients,
        smsRecipientUserIds: smsRecipients,
        callRecipientUserIds: callRecipients,
        slackRecipientUserIds: slackRecipients,
        recurrenceIntervalValue: null,
        recurrenceIntervalUnit: null,
        recurrenceWeekday: null,
        recurrenceDayOfMonth: null,
        recurrenceEndDate: null,
        recurrenceMaxOccurrences: recurrenceMaxOccurrences.trim()
          ? Number(recurrenceMaxOccurrences)
          : null,
      };
      if (recurrenceMode === "interval") {
        body.recurrenceIntervalValue = intervalValue;
        body.recurrenceIntervalUnit = intervalUnit;
      } else if (recurrenceMode === "weekday") {
        body.recurrenceWeekday = weekday;
      } else if (recurrenceMode === "monthly") {
        body.recurrenceDayOfMonth = dayOfMonth;
      } else {
        // No recurrence: end-condition fields are meaningless without a
        // rule, so don't send a stale max-occurrences count either.
        body.recurrenceMaxOccurrences = null;
      }
      if (recurrenceMode !== "none" && recurrenceEndDate.trim()) {
        body.recurrenceEndDate = recurrenceEndDate;
      }

      const res = await fetch(`/api/reminders/${reminder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      toast.success("Reminder updated");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't update the reminder",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!reminder) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reminders/${reminder.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      toast.success("Reminder deleted");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete the reminder",
      );
    } finally {
      setDeleting(false);
    }
  }

  const extraEmails = emailRecipients.filter(
    (e) => !appUsers.some((u: TravelsAppUser) => u.email === e),
  );

  if (!reminder) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit reminder</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-0.5">
          <div className="space-y-1.5">
            <Label htmlFor="rmd-title">Title</Label>
            <Input
              id="rmd-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Add details, notes, links…"
            />
          </div>

          {reminder.calendarConnectionId != null ? (
            <p className="text-xs text-muted-foreground">
              Due date follows a linked calendar event
              {reminder.googleEventHtmlLink && (
                <>
                  {" — "}
                  <a
                    href={reminder.googleEventHtmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    view event
                  </a>
                </>
              )}
              . Re-link it from the record it belongs to.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rmd-due">Due date &amp; time</Label>
              <Input
                id="rmd-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          )}

          <LeadTimesEditor leadTimes={leadTimes} onChange={setLeadTimes} />

          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">Repeats</Label>
            <Select
              value={recurrenceMode}
              onValueChange={(v) => setRecurrenceMode(v as RecurrenceMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Doesn&apos;t repeat</SelectItem>
                <SelectItem value="interval">Every…</SelectItem>
                <SelectItem value="weekday">Weekly on a day</SelectItem>
                <SelectItem value="monthly">Monthly on a date</SelectItem>
              </SelectContent>
            </Select>

            {recurrenceMode === "interval" && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="number"
                  min={1}
                  value={intervalValue}
                  onChange={(e) =>
                    setIntervalValue(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-20"
                />
                <Select value={intervalUnit} onValueChange={setIntervalUnit}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">minutes</SelectItem>
                    <SelectItem value="hours">hours</SelectItem>
                    <SelectItem value="days">days</SelectItem>
                    <SelectItem value="weeks">weeks</SelectItem>
                    <SelectItem value="months">months</SelectItem>
                    <SelectItem value="years">years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {recurrenceMode === "weekday" && (
              <Select
                value={String(weekday)}
                onValueChange={(v) => setWeekday(Number(v))}
              >
                <SelectTrigger className="pt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_LABELS.map((label, i) => (
                    <SelectItem key={label} value={String(i)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {recurrenceMode === "monthly" && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-sm text-muted-foreground">Day</span>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) =>
                    setDayOfMonth(
                      Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">
                  of each month
                </span>
              </div>
            )}

            {recurrenceMode !== "none" && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Ends on (optional)
                  </Label>
                  <Input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Max occurrences (optional)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={recurrenceMaxOccurrences}
                    onChange={(e) =>
                      setRecurrenceMaxOccurrences(e.target.value)
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Email alerts to
            </Label>
            {appUsers.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {appUsers.map((u: TravelsAppUser) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={emailRecipients.includes(u.email)}
                      onCheckedChange={() =>
                        setEmailRecipients((prev) =>
                          prev.includes(u.email)
                            ? prev.filter((e) => e !== u.email)
                            : [...prev, u.email],
                        )
                      }
                    />
                    {u.displayName ?? u.email}
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Input
                type="email"
                placeholder="Add another email address"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomEmail();
                  }
                }}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={addCustomEmail}
              >
                Add
              </Button>
            </div>
            {extraEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {extraEmails.map((e) => (
                  <span
                    key={e}
                    className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5"
                  >
                    {e}
                    <button
                      type="button"
                      onClick={() =>
                        setEmailRecipients((prev) =>
                          prev.filter((r) => r !== e),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5" /> Text alerts to
            </Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {appUsers.map((u: TravelsAppUser) => (
                <label
                  key={u.id}
                  className={`flex items-center gap-1.5 text-sm ${
                    u.phoneVerified
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <Checkbox
                    checked={smsRecipients.includes(u.id)}
                    disabled={!u.phoneVerified}
                    onCheckedChange={() =>
                      toggleIn(smsRecipients, setSmsRecipients, u.id)
                    }
                  />
                  {u.displayName ?? u.email}
                  {!u.phoneVerified && (
                    <span className="text-xs text-muted-foreground">
                      (no verified phone)
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Call alerts to
            </Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {appUsers.map((u: TravelsAppUser) => (
                <label
                  key={u.id}
                  className={`flex items-center gap-1.5 text-sm ${
                    u.phoneVerified
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <Checkbox
                    checked={callRecipients.includes(u.id)}
                    disabled={!u.phoneVerified}
                    onCheckedChange={() =>
                      toggleIn(callRecipients, setCallRecipients, u.id)
                    }
                  />
                  {u.displayName ?? u.email}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Slack className="w-3.5 h-3.5" /> Slack DM to
            </Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {appUsers.map((u: TravelsAppUser) => (
                <label
                  key={u.id}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={slackRecipients.includes(u.id)}
                    onCheckedChange={() =>
                      toggleIn(slackRecipients, setSlackRecipients, u.id)
                    }
                  />
                  {u.displayName ?? u.email}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Only delivers to a user once they&apos;ve DM&apos;d the Slack
              bot at least once.
            </p>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center sm:justify-between gap-2">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Delete?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
            </Button>
          )}
          {!confirmingDelete && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                Save
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
