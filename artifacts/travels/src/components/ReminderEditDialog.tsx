import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateReminder,
  useDeleteReminder,
  useListTravelsAppUsers,
  useGetCalendarStatus,
  getListRemindersQueryKey,
  getListAllRemindersQueryKey,
  type Reminder,
  type TravelsAppUser,
} from "@workspace/api-client-react";
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
import { Trash2, Save, X, Mail } from "lucide-react";
import { toast } from "sonner";
import { RichTextEditor } from "./RichTextEditor";

interface ReminderEditDialogProps {
  reminder: Reminder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReminderEditDialog({
  reminder,
  open,
  onOpenChange,
}: ReminderEditDialogProps) {
  const qc = useQueryClient();
  const { data: appUsers = [] } = useListTravelsAppUsers();
  const { data: calendarStatus } = useGetCalendarStatus();
  const travelCalendarConnected = !!calendarStatus?.connected;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [customEmail, setCustomEmail] = useState("");
  const [sync, setSync] = useState(true);
  const [alertDays, setAlertDays] = useState<number[]>([0]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (reminder && open) {
      setTitle(reminder.title);
      setDescription(reminder.description ?? "");
      setDueDate(reminder.dueDate ?? "");
      setRecipients(reminder.recipientEmails);
      setSync(reminder.syncToCalendar);
      setAlertDays(
        reminder.alertDaysBefore && reminder.alertDaysBefore.length > 0
          ? reminder.alertDaysBefore
          : [0],
      );
      setCustomEmail("");
      setConfirmingDelete(false);
    }
  }, [reminder, open]);

  const ALERT_DAY_OPTIONS = [0, 1, 3, 7];

  function toggleAlertDay(day: number) {
    setAlertDays((prev) => {
      const next = prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day];
      return next.length > 0 ? next : [0];
    });
  }

  function invalidateAll(tripId: number) {
    qc.invalidateQueries({ queryKey: getListRemindersQueryKey(tripId) });
    qc.invalidateQueries({ queryKey: getListAllRemindersQueryKey(true) });
    qc.invalidateQueries({ queryKey: getListAllRemindersQueryKey(false) });
  }

  const updateReminder = useUpdateReminder({
    mutation: {
      onSuccess: () => {
        if (reminder) invalidateAll(reminder.tripId);
        toast.success("Reminder updated");
        onOpenChange(false);
      },
      onError: () => toast.error("Failed to update reminder"),
    },
  });

  const deleteReminder = useDeleteReminder({
    mutation: {
      onSuccess: () => {
        if (reminder) invalidateAll(reminder.tripId);
        toast.success("Reminder deleted");
        onOpenChange(false);
      },
      onError: () => toast.error("Failed to delete reminder"),
    },
  });

  function toggleRecipient(email: string) {
    setRecipients((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  }

  function addCustomEmail() {
    const email = customEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (!recipients.includes(email)) setRecipients((prev) => [...prev, email]);
    setCustomEmail("");
  }

  function handleSave() {
    if (!reminder) return;
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    updateReminder.mutate({
      tripId: reminder.tripId,
      reminderId: reminder.id,
      body: {
        title: title.trim(),
        description: description.trim() ? description : null,
        dueDate: dueDate || null,
        recipientEmails: recipients,
        syncToCalendar: sync,
        alertDaysBefore: alertDays,
      },
    });
  }

  function handleDelete() {
    if (!reminder) return;
    deleteReminder.mutate({ tripId: reminder.tripId, reminderId: reminder.id });
  }

  const extraRecipients = recipients.filter(
    (e) => !appUsers.some((u: TravelsAppUser) => u.email === e),
  );

  if (!reminder) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reminder details</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-0.5">
          <div className="space-y-1.5">
            <Label htmlFor="reminder-edit-title">Title</Label>
            <Input
              id="reminder-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reminder-edit-due">Due date</Label>
            <Input
              id="reminder-edit-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
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

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Send alerts to
            </Label>
            {appUsers.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {appUsers.map((u: TravelsAppUser) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={recipients.includes(u.email)}
                      onCheckedChange={() => toggleRecipient(u.email)}
                    />
                    {u.displayName ? (
                      <span>
                        {u.displayName}{" "}
                        <span className="text-muted-foreground">
                          ({u.email})
                        </span>
                      </span>
                    ) : (
                      u.email
                    )}
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
            {extraRecipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {extraRecipients.map((e) => (
                  <span
                    key={e}
                    className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5"
                  >
                    <Mail className="w-3 h-3" /> {e}
                    <button
                      type="button"
                      onClick={() =>
                        setRecipients((prev) => prev.filter((r) => r !== e))
                      }
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {travelCalendarConnected && (
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={sync}
                  onCheckedChange={(v) => setSync(!!v)}
                />
                Sync to Travel Calendar
              </label>
              {sync && (
                <div className="pl-6 space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Remind me
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALERT_DAY_OPTIONS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleAlertDay(day)}
                        className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                          alertDays.includes(day)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-card-border hover:border-primary/50"
                        }`}
                      >
                        {day === 0
                          ? "On the day"
                          : `${day} day${day > 1 ? "s" : ""} before`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row items-center sm:justify-between gap-2">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Delete this reminder?
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteReminder.isPending}
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
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateReminder.isPending}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" /> Save
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
