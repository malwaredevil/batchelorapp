import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  useUpdateReminder,
  useDeleteReminder,
  useListTravelsAppUsers,
  useGetCalendarStatus,
  useSendPhoneVerificationCode,
  useVerifyPhoneCode,
  useSendTestSms,
  getListRemindersQueryKey,
  getListAllRemindersQueryKey,
  getListTravelsAppUsersQueryKey,
  getGetCurrentUserQueryKey,
  type Reminder,
  type TravelsAppUser,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
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
  Trash2,
  Save,
  X,
  Mail,
  MessageSquareText,
  Pencil,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { RichTextEditor } from "./RichTextEditor";

function extractError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const data = (err as { response?: { data?: { error?: string } } }).response
      ?.data;
    if (data?.error) return data.error;
  }
  return fallback;
}

interface ReminderEditDialogProps {
  reminder: Reminder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: "view" | "edit";
}

export function ReminderEditDialog({
  reminder,
  open,
  onOpenChange,
  initialMode = "view",
}: ReminderEditDialogProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: appUsers = [] } = useListTravelsAppUsers();
  const { data: calendarStatus } = useGetCalendarStatus();
  const travelCalendarConnected = !!calendarStatus?.connected;

  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [customEmail, setCustomEmail] = useState("");
  const [smsRecipients, setSmsRecipients] = useState<number[]>([]);
  const [sync, setSync] = useState(true);
  const [alertDays, setAlertDays] = useState<number[]>([0]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [showPhoneSetup, setShowPhoneSetup] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  useEffect(() => {
    if (reminder && open) {
      setMode(initialMode);
      setTitle(reminder.title);
      setDescription(reminder.description ?? "");
      setDueDate(reminder.dueDate ?? "");
      setRecipients(reminder.recipientEmails);
      setSmsRecipients(reminder.smsRecipientUserIds ?? []);
      setSync(reminder.syncToCalendar);
      setAlertDays(
        reminder.alertDaysBefore && reminder.alertDaysBefore.length > 0
          ? reminder.alertDaysBefore
          : [0],
      );
      setCustomEmail("");
      setConfirmingDelete(false);
      setShowPhoneSetup(false);
      setPhoneNumber("");
      setPhoneCode("");
      setPhoneCodeSent(false);
      setSmsConsent(false);
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

  const sendPhoneCode = useSendPhoneVerificationCode({
    mutation: {
      onSuccess: () => {
        setPhoneCodeSent(true);
        toast.success(`Verification code sent to ${phoneNumber}.`);
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "Could not send the verification code.")),
    },
  });

  const verifyPhoneCode = useVerifyPhoneCode({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        await qc.invalidateQueries({
          queryKey: getListTravelsAppUsersQueryKey(),
        });
        toast.success("Phone verified — a test text has been sent.");
        if (user) {
          setSmsRecipients((prev) =>
            prev.includes(user.id) ? prev : [...prev, user.id],
          );
        }
        setShowPhoneSetup(false);
        setPhoneCodeSent(false);
        setPhoneNumber("");
        setPhoneCode("");
      },
      onError: (err: unknown) =>
        toast.error(extractError(err, "That code didn't work.")),
    },
  });

  const sendTestSms = useSendTestSms({
    mutation: {
      onError: (err: unknown) =>
        toast.error(
          extractError(
            err,
            "Phone verified, but the test text failed to send.",
          ),
        ),
    },
  });

  function handleSendPhoneCode() {
    const trimmed = phoneNumber.trim();
    if (!trimmed) return;
    if (!smsConsent) {
      toast.error("Please check the box to agree to receive SMS messages.");
      return;
    }
    sendPhoneCode.mutate({ data: { phoneNumber: trimmed, consent: true } });
  }

  function handleVerifyPhoneCode() {
    if (phoneCode.trim().length !== 6) {
      toast.error("Enter the 6-digit code.");
      return;
    }
    verifyPhoneCode.mutate(
      { data: { code: phoneCode.trim() } },
      { onSuccess: () => sendTestSms.mutate() },
    );
  }

  function toggleRecipient(email: string) {
    setRecipients((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  }

  function toggleSmsRecipient(userId: number) {
    setSmsRecipients((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
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
        smsRecipientUserIds: smsRecipients,
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

  const isOverdue =
    !!reminder.dueDate && new Date(reminder.dueDate) < new Date();

  const formattedDueDate = reminder.dueDate
    ? new Date(reminder.dueDate).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "view" ? "Reminder" : "Edit reminder"}
          </DialogTitle>
        </DialogHeader>

        {mode === "view" ? (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-0.5">
            <div>
              <h3 className="text-base font-semibold leading-snug">
                {reminder.title}
              </h3>
              {formattedDueDate && (
                <p
                  className={`text-sm mt-1 ${
                    isOverdue
                      ? "text-red-600 font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {isOverdue ? "Overdue · " : "Due "}
                  {formattedDueDate}
                </p>
              )}
            </div>

            {reminder.description ? (
              <div
                className="text-sm text-foreground prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(reminder.description),
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description
              </p>
            )}

            {reminder.recipientEmails.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Alerts sent to
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {reminder.recipientEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2.5 py-0.5"
                    >
                      <Mail className="w-3 h-3" /> {email}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(reminder.smsRecipientUserIds?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Texted to
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(reminder.smsRecipientUserIds ?? []).map((userId) => {
                    const u = appUsers.find(
                      (a: TravelsAppUser) => a.id === userId,
                    );
                    return (
                      <span
                        key={userId}
                        className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2.5 py-0.5"
                      >
                        <MessageSquareText className="w-3 h-3" />{" "}
                        {u?.displayName ?? u?.email ?? `User ${userId}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {reminder.syncToCalendar && (
              <p className="text-xs text-muted-foreground">
                Synced to Travel Calendar
              </p>
            )}
          </div>
        ) : (
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

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Text alerts to
              </Label>
              {appUsers.length > 0 && (
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
                        onCheckedChange={() => toggleSmsRecipient(u.id)}
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
              )}

              {user && !user.phoneVerified && (
                <div className="mt-2 rounded-lg border border-card-border bg-muted/40 p-3">
                  {!showPhoneSetup ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPhoneSetup(true)}
                    >
                      <MessageSquareText className="w-3.5 h-3.5 mr-1.5" />
                      Verify your phone to enable SMS
                    </Button>
                  ) : !phoneCodeSent ? (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Your phone number
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          type="tel"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="+12105551234"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            sendPhoneCode.isPending ||
                            !phoneNumber.trim() ||
                            !smsConsent
                          }
                          onClick={handleSendPhoneCode}
                        >
                          {sendPhoneCode.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Send code"
                          )}
                        </Button>
                      </div>
                      <div className="flex items-start gap-2 pt-1">
                        <Checkbox
                          id="reminder-sms-consent"
                          checked={smsConsent}
                          onCheckedChange={(checked) =>
                            setSmsConsent(checked === true)
                          }
                          className="mt-0.5"
                        />
                        <Label
                          htmlFor="reminder-sms-consent"
                          className="text-xs font-normal leading-relaxed text-muted-foreground"
                        >
                          I agree to receive SMS text messages from Batchelor
                          App at the phone number above, including verification
                          codes and Travels trip reminders. Message and data
                          rates may apply. Message frequency varies. Reply STOP
                          to opt out at any time, or HELP for help.
                        </Label>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Enter the 6-digit code sent to {phoneNumber}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          inputMode="numeric"
                          maxLength={6}
                          value={phoneCode}
                          onChange={(e) =>
                            setPhoneCode(e.target.value.replace(/\D/g, ""))
                          }
                          placeholder="123456"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            verifyPhoneCode.isPending ||
                            phoneCode.trim().length !== 6
                          }
                          onClick={handleVerifyPhoneCode}
                        >
                          {verifyPhoneCode.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Verify"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
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
        )}

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
              {mode === "view" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                  <Button size="sm" onClick={() => setMode("edit")}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                  </Button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
