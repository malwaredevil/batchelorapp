import { useState, useEffect, useMemo, useRef } from "react";
import { Mail, Bell, Save, X, Send, CalendarDays, CheckCircle2, XCircle, LogIn, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useGetTravelsSettings,
  useUpdateTravelsSettings,
  useSendTestReminderEmail,
  useGetCalendarStatus,
  useListCalendars,
  useSelectCalendar,
  useDisconnectCalendar,
  useShareCalendar,
  useListGoogleEventColors,
  useSetTravelColor,
  useGetAssistantSettings,
  useUpdateAssistantSettings,
  useListHouseholdMemory,
  useDeleteHouseholdMemory,
  getGetTravelsSettingsQueryKey,
  getGetCalendarStatusQueryKey,
  getListCalendarsQueryKey,
  getListGoogleEventColorsQueryKey,
  getGetAssistantSettingsQueryKey,
  getListHouseholdMemoryQueryKey,
  type CalendarListItem,
  type GoogleEventColor,
  type ActionConfirmationMode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ElaineAvatar, ElaineWordmark } from "@/components/assistant/ElaineAvatar";
import { usePageAssistantContext } from "@/lib/assistant-context";

export default function Settings() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetTravelsSettings();
  const update = useUpdateTravelsSettings();
  const sendTest = useSendTestReminderEmail();

  const [email, setEmail] = useState("");
  const [dirty, setDirty] = useState(false);

  const calendarToastShown = useRef(false);
  useEffect(() => {
    if (calendarToastShown.current) return;
    const params = new URLSearchParams(window.location.search);
    const calendarResult = params.get("calendar");
    if (!calendarResult) return;
    calendarToastShown.current = true;

    if (calendarResult === "connected") {
      toast.success("Google Calendar connected");
    } else if (calendarResult === "error") {
      toast.error("Could not connect Google Calendar. Please try again.");
    }

    params.delete("calendar");
    const newSearch = params.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}`;
    window.history.replaceState({}, "", newUrl);
  }, []);

  useEffect(() => {
    if (data !== undefined) {
      setEmail(data.reminderEmail ?? "");
      setDirty(false);
    }
  }, [data]);

  function handleChange(val: string) {
    setEmail(val);
    setDirty(val !== (data?.reminderEmail ?? ""));
  }

  function handleClear() {
    setEmail("");
    setDirty(true);
  }

  function handleSave() {
    const value = email.trim() || null;
    update.mutate(
      { reminderEmail: value },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetTravelsSettingsQueryKey(), result);
          setDirty(false);
          toast.success(
            value
              ? `Reminder alerts will be sent to ${value}`
              : "Reminder email cleared",
          );
        },
        onError: () => toast.error("Could not save settings. Please try again."),
      },
    );
  }

  function handleSendTest() {
    sendTest.mutate(undefined, {
      onSuccess: (result) => toast.success(`Test email sent to ${result.to}`),
      onError: (err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : "Could not send test email. Please try again.",
        ),
    });
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your travel notification preferences.</p>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400">
            <Bell className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-semibold text-foreground">Reminder alerts</h2>
            <p className="text-sm text-muted-foreground">
              Receive emails when a reminder is 14 days, 7 days, and 3 days away.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reminder-email" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            Alert email address
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="reminder-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => handleChange(e.target.value)}
                disabled={isLoading}
                className="pr-8"
              />
              {email && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear email"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={!dirty || update.isPending}
              size="default"
            >
              <Save className="h-4 w-4 mr-1.5" />
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave blank to disable email alerts. Only reminders with a due date set will trigger emails.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-card-border p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Test email delivery</p>
            <p className="text-xs text-muted-foreground">
              Sends a sample reminder email to your own account address right now.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendTest}
            disabled={sendTest.isPending}
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {sendTest.isPending ? "Sending…" : "Send test email"}
          </Button>
        </div>

        <div className="rounded-lg bg-muted/50 p-4 space-y-1.5">
          <p className="text-xs font-medium text-foreground">When you'll receive alerts</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {[
              { label: "2 weeks before", detail: "14 days" },
              { label: "1 week before",  detail: "7 days"  },
              { label: "3 days before",  detail: "3 days"  },
            ].map(({ label, detail }) => (
              <li key={detail} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />
                <span>{label} the reminder due date</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            Each alert fires once per reminder. Marking a reminder as done stops further alerts.
          </p>
        </div>
      </div>

      <CalendarSyncCard />
      <ElaineSettingsCard />
    </div>
  );
}

function ElaineSettingsCard() {
  const qc = useQueryClient();
  const { data: assistantSettings, isLoading: settingsLoading } = useGetAssistantSettings();
  const updateAssistantSettings = useUpdateAssistantSettings();
  const { data: memory = [], isLoading: memoryLoading } = useListHouseholdMemory();
  const deleteMemory = useDeleteHouseholdMemory();

  function handleToggle(enabled: boolean) {
    updateAssistantSettings.mutate(
      { enabled },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetAssistantSettingsQueryKey(), result);
          toast.success(enabled ? "elAIne is back!" : "elAIne is turned off");
        },
        onError: () => toast.error("Failed to update elAIne settings"),
      },
    );
  }

  function handleModeChange(actionConfirmationMode: ActionConfirmationMode) {
    updateAssistantSettings.mutate(
      { actionConfirmationMode },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetAssistantSettingsQueryKey(), result);
          toast.success("Updated how elAIne confirms actions");
        },
        onError: () => toast.error("Failed to update elAIne settings"),
      },
    );
  }

  function handleDeleteMemory(id: number) {
    deleteMemory.mutate(id, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListHouseholdMemoryQueryKey() }),
      onError: () => toast.error("Failed to remove memory"),
    });
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <ElaineAvatar size={40} />
        <div>
          <h2 className="font-serif text-lg text-foreground flex items-center gap-1.5">
            <ElaineWordmark />
          </h2>
          <p className="text-xs text-muted-foreground">Your household's travel assistant</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-card-border p-4">
        <div>
          <p className="text-sm font-medium text-foreground">Enable elAIne</p>
          <p className="text-xs text-muted-foreground">
            Shows the floating assistant bubble across every page.
          </p>
        </div>
        <Switch
          checked={assistantSettings?.enabled ?? true}
          onCheckedChange={handleToggle}
          disabled={settingsLoading || updateAssistantSettings.isPending}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-card-border p-4">
        <p className="text-sm font-medium text-foreground">How elAIne confirms actions</p>
        <p className="text-xs text-muted-foreground pb-1">
          When elAIne proposes a change (like adding a reminder or trip), choose how you want to
          approve it. You can also just tell her in chat to switch modes.
        </p>
        <Select
          value={assistantSettings?.actionConfirmationMode ?? "one_by_one"}
          onValueChange={(value) => handleModeChange(value as ActionConfirmationMode)}
          disabled={settingsLoading || updateAssistantSettings.isPending}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one_by_one">One at a time (safest, default)</SelectItem>
            <SelectItem value="all_at_once">All together</SelectItem>
            <SelectItem value="auto_run">Run automatically, no confirmation</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">What elAIne remembers</p>
        <p className="text-xs text-muted-foreground pb-1">
          Shared facts elAIne has picked up about your household's travel preferences.
        </p>
        {memoryLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!memoryLoading && memory.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nothing remembered yet.</p>
        )}
        {memory.length > 0 && (
          <ul className="space-y-1.5">
            {memory.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="text-foreground">{m.content}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteMemory(m.id)}
                  disabled={deleteMemory.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CalendarSyncCard() {
  const qc = useQueryClient();
  const { data: status, isLoading: statusLoading } = useGetCalendarStatus();
  const { data: calendars = [], isLoading: calendarsLoading } = useListCalendars<CalendarListItem[]>({
    query: { enabled: !!status?.connected, queryKey: getListCalendarsQueryKey() },
  });
  const selectCalendar = useSelectCalendar();
  const disconnectCalendar = useDisconnectCalendar();
  const shareCalendar = useShareCalendar();
  const { data: eventColors = [] } = useListGoogleEventColors<GoogleEventColor[]>({
    query: { enabled: !!status?.isHouseholdShared, queryKey: getListGoogleEventColorsQueryKey() },
  });
  const setTravelColor = useSetTravelColor();

  const [selectedId, setSelectedId] = useState<string>("");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  useEffect(() => {
    if (status?.calendarId) setSelectedId(status.calendarId);
  }, [status?.calendarId]);

  const calendarContext = useMemo(() => {
    if (statusLoading) return undefined;
    if (!status?.connected) {
      return "Settings page: Google Calendar is NOT connected for this user. Connecting requires clicking the Connect button (an OAuth redirect elAIne cannot trigger herself) — offer to take them to Settings if they're elsewhere.";
    }
    const calendarList = calendars
      .map((c: CalendarListItem) => `"${c.summary}" (calendarId: ${c.id}${c.primary ? ", primary" : ""})`)
      .join("; ");
    return (
      `Settings page: Google Calendar is connected${status.googleEmail ? ` as ${status.googleEmail}` : ""}. ` +
      `Currently syncing reminders to ${status.calendarSummary ? `"${status.calendarSummary}"` : "no calendar selected yet"}. ` +
      (calendarList
        ? `Calendars available to choose from: ${calendarList}.`
        : "No calendars loaded yet.")
    );
  }, [statusLoading, status, calendars]);
  usePageAssistantContext("settings-calendar", calendarContext);

  function handleSelect(calendarId: string) {
    const cal = calendars.find((c: CalendarListItem) => c.id === calendarId);
    if (!cal) return;
    setSelectedId(calendarId);
    selectCalendar.mutate(
      { calendarId: cal.id, calendarSummary: cal.summary },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
          toast.success(`Reminders will sync to "${cal.summary}"`);
        },
        onError: () => toast.error("Could not save calendar. Please try again."),
      },
    );
  }

  function handleConnect() {
    window.location.href = "/api/travels/google-calendar/connect";
  }

  function handleDisconnect() {
    disconnectCalendar.mutate(undefined, {
      onSuccess: () => {
        setConfirmingDisconnect(false);
        setSelectedId("");
        qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
        toast.success("Google Calendar disconnected");
      },
      onError: () => toast.error("Could not disconnect. Please try again."),
    });
  }

  function handleSetTravelColor(colorId: string) {
    const nextId = colorId === "none" ? null : colorId;
    setTravelColor.mutate(
      { travelColorId: nextId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
          toast.success(
            nextId ? "Travel color saved" : "Travel color cleared",
          );
        },
        onError: () => toast.error("Could not save travel color. Please try again."),
      },
    );
  }

  function handleToggleShare(shared: boolean) {
    shareCalendar.mutate(
      { shared },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
          toast.success(
            shared
              ? `"${status?.calendarSummary}" is now the shared Family Calendar for everyone`
              : "This calendar is no longer shared with the household",
          );
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : "";
          toast.error(
            message.includes("409") || !status?.calendarId
              ? "Pick a calendar above first."
              : "Could not update sharing. Please try again.",
          );
        },
      },
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          <CalendarDays className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Your Google Calendar</h2>
          <p className="text-sm text-muted-foreground">
            Connect your own Google account and choose which of your calendars reminders should
            sync to. Each family member connects independently — your connection and calendar
            choice never affect anyone else's.
          </p>
        </div>
      </div>

      {statusLoading ? (
        <p className="text-sm text-muted-foreground">Checking connection…</p>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected{status.googleEmail ? ` as ${status.googleEmail}` : ""}
            </p>
            {confirmingDisconnect ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Disconnect?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnectCalendar.isPending}
                >
                  Yes, disconnect
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={disconnectCalendar.isPending}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDisconnect(true)}
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Disconnect
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="family-calendar">Calendar to sync reminders to</Label>
            <Select
              value={selectedId}
              onValueChange={handleSelect}
              disabled={calendarsLoading || selectCalendar.isPending}
            >
              <SelectTrigger id="family-calendar">
                <SelectValue placeholder="Choose a calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((cal: CalendarListItem) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    {cal.summary}
                    {cal.primary ? " (primary)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {status.calendarSummary && (
              <p className="text-xs text-muted-foreground">
                Currently syncing to <span className="text-foreground">{status.calendarSummary}</span>.
              </p>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-card-border bg-muted/30 p-4">
            <div className="space-y-1">
              <Label htmlFor="household-share">Share as household Family Calendar</Label>
              <p className="text-xs text-muted-foreground">
                When on, everyone in the household — even without their own Google account — can
                view, add, edit, and delete events on{" "}
                {status.calendarSummary ? `"${status.calendarSummary}"` : "this calendar"} from the
                Family Calendar page. The app acts on your behalf using your connection.
              </p>
            </div>
            <Switch
              id="household-share"
              checked={status.isHouseholdShared}
              onCheckedChange={handleToggleShare}
              disabled={shareCalendar.isPending || !status.calendarId}
            />
          </div>

          {status.isHouseholdShared && (
            <div className="space-y-2 rounded-lg border border-card-border bg-muted/30 p-4">
              <Label htmlFor="travel-color">Travel event color</Label>
              <p className="text-xs text-muted-foreground">
                Pick a Google Calendar event color to mean "Travel". Trips and itinerary items
                synced to the Family Calendar will use this color, and the Family Calendar page
                can highlight or filter to travel-colored events.
              </p>
              <Select
                value={status.travelColorId ?? "none"}
                onValueChange={handleSetTravelColor}
                disabled={setTravelColor.isPending}
              >
                <SelectTrigger id="travel-color">
                  <SelectValue placeholder="Choose a color" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {eventColors.map((color: GoogleEventColor) => (
                    <SelectItem key={color.id} value={color.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-black/10"
                          style={{ backgroundColor: color.hex }}
                        />
                        {color.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <XCircle className="h-3.5 w-3.5" />
            Google Calendar isn't connected yet.
          </p>
          <Button size="sm" onClick={handleConnect}>
            <LogIn className="h-3.5 w-3.5 mr-1.5" />
            Connect my Google Calendar
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground pt-1">
        Reminders with a due date sync automatically to your selected calendar. If you're listed
        as a recipient on someone else's reminder, it will also appear on your own calendar, as
        long as you're connected here.
      </p>
    </div>
  );
}
