import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import {
  Mail,
  Bell,
  Save,
  X,
  Send,
  CalendarDays,
  CheckCircle2,
  XCircle,
  LogIn,
  LogOut,
  Trash2,
  Plane,
  Pencil,
  Plus,
  Clock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGetTravelsSettings,
  useUpdateTravelsSettings,
  useUpdateTravelsTimezone,
  useSendTestReminderEmail,
  useGetCalendarStatus,
  useListCalendars,
  useDisconnectCalendar,
  useListConnectedCalendars,
  useAddConnectedCalendar,
  useUpdateConnectedCalendar,
  useDeleteConnectedCalendar,
  useSetTravelCalendar,
  useGetTravelCalendarStatus,
  useGetGmailStatus,
  useDisconnectGmail,
  getGetTravelsSettingsQueryKey,
  getGetCalendarStatusQueryKey,
  getListCalendarsQueryKey,
  getListConnectedCalendarsQueryKey,
  getGetTravelCalendarStatusQueryKey,
  getGetGmailStatusQueryKey,
  type CalendarListItem,
  type ConnectedCalendar,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ElaineSettingsCard } from "@workspace/elaine-ui";
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
        onError: () =>
          toast.error("Could not save settings. Please try again."),
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
        <p className="text-muted-foreground mt-1">
          Manage your travel notification preferences.
        </p>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400">
            <Bell className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-semibold text-foreground">Reminder alerts</h2>
            <p className="text-sm text-muted-foreground">
              Receive emails when a reminder is 14 days, 7 days, and 3 days
              away.
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
            Leave blank to disable email alerts. Only reminders with a due date
            set will trigger emails.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-card-border p-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Test email delivery
            </p>
            <p className="text-xs text-muted-foreground">
              Sends a sample reminder email to your own account address right
              now.
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
          <p className="text-xs font-medium text-foreground">
            When you'll receive alerts
          </p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {[
              { label: "2 weeks before", detail: "14 days" },
              { label: "1 week before", detail: "7 days" },
              { label: "3 days before", detail: "3 days" },
            ].map(({ label, detail }) => (
              <li key={detail} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />
                <span>{label} the reminder due date</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            Each alert fires once per reminder. Marking a reminder as done stops
            further alerts.
          </p>
        </div>
      </div>

      <TimezoneCard />
      <GmailSyncCard />
      <CalendarSyncCard />
      <ElaineSettingsCard subtitle="Your household's travel assistant" />
    </div>
  );
}

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

function TimezoneCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetTravelsSettings();
  const updateTimezone = useUpdateTravelsTimezone();
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  const timezoneOptions = useMemo(() => {
    const set = new Set(COMMON_TIMEZONES);
    if (browserTz) set.add(browserTz);
    if (data?.timezone) set.add(data.timezone);
    return Array.from(set).sort();
  }, [browserTz, data?.timezone]);

  function handleChange(tz: string) {
    updateTimezone.mutate(
      { timezone: tz },
      {
        onSuccess: () => {
          qc.setQueryData(getGetTravelsSettingsQueryKey(), (prev: any) =>
            prev ? { ...prev, timezone: tz } : prev,
          );
          toast.success("Timezone updated");
        },
        onError: () =>
          toast.error("Could not update timezone. Please try again."),
      },
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
          <Clock className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Your timezone</h2>
          <p className="text-sm text-muted-foreground">
            Used to show flight, train, and hotel times consistently across your
            trips.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="timezone-select">Timezone</Label>
        <Select
          value={data?.timezone ?? undefined}
          onValueChange={handleChange}
          disabled={isLoading || updateTimezone.isPending}
        >
          <SelectTrigger id="timezone-select" className="w-full sm:w-72">
            <SelectValue
              placeholder={
                browserTz ? `Not set (detected: ${browserTz})` : "Not set"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {timezoneOptions.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!data?.timezone && browserTz && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChange(browserTz)}
            disabled={updateTimezone.isPending}
          >
            Use detected timezone ({browserTz})
          </Button>
        )}
      </div>
    </div>
  );
}

function GmailSyncCard() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useGetGmailStatus();
  const disconnect = useDisconnectGmail();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const gmailContext = useMemo(() => {
    if (isLoading) return undefined;
    if (!status?.connected) {
      return "Settings page: Gmail scanning is NOT connected for this user. Connecting requires clicking the Connect button (an OAuth redirect Elaine cannot trigger herself) — offer to take them to Settings if they're elsewhere.";
    }
    return `Settings page: Gmail is connected as ${status.googleEmail}. Travel email suggestions can be reviewed on the Gmail page.`;
  }, [isLoading, status]);
  usePageAssistantContext("settings-gmail", gmailContext);

  function handleConnect() {
    window.location.href = "/api/travels/gmail/connect";
  }

  function handleDisconnect() {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setConfirmingDisconnect(false);
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        toast.success("Gmail disconnected");
      },
      onError: () => toast.error("Could not disconnect. Please try again."),
    });
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
          <RefreshCw className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">Gmail scanning</h2>
          <p className="text-sm text-muted-foreground">
            Automatically find flight, train, and hotel confirmations in your
            inbox and suggest them as trip documents. Read-only access — see our{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>{" "}
            for details.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Checking connection…</p>
      ) : status?.connected ? (
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
                disabled={disconnect.isPending}
              >
                Yes, disconnect
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDisconnect(false)}
                disabled={disconnect.isPending}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/gmail">Review suggestions</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDisconnect(true)}
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Disconnect
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button onClick={handleConnect}>
          <LogIn className="h-3.5 w-3.5 mr-1.5" />
          Connect Gmail
        </Button>
      )}
    </div>
  );
}

const CALENDAR_COLOR_PRESETS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#db2777", // pink
  "#9333ea", // purple
  "#0891b2", // cyan
  "#ea580c", // orange
  "#4f46e5", // indigo
  "#65a30d", // lime
  "#dc2626", // red
  "#0d9488", // teal
];

function ColorSwatchPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CALENDAR_COLOR_PRESETS.map((hex) => (
        <button
          key={hex}
          type="button"
          disabled={disabled}
          onClick={() => onChange(hex)}
          className={`h-6 w-6 rounded-full border-2 ${value === hex ? "border-foreground" : "border-transparent"}`}
          style={{ backgroundColor: hex }}
          aria-label={hex}
        />
      ))}
    </div>
  );
}

function CalendarSyncCard() {
  const qc = useQueryClient();
  const { data: status, isLoading: statusLoading } = useGetCalendarStatus();
  const { data: calendars = [], isLoading: calendarsLoading } =
    useListCalendars<CalendarListItem[]>({
      query: {
        enabled: !!status?.connected,
        queryKey: getListCalendarsQueryKey(),
      },
    });
  const { data: connectedCalendars = [] } = useListConnectedCalendars({
    query: {
      enabled: !!status?.connected,
      queryKey: getListConnectedCalendarsQueryKey(),
    },
  });
  const { data: travelStatus } = useGetTravelCalendarStatus();
  const disconnectCalendar = useDisconnectCalendar();
  const addCalendar = useAddConnectedCalendar();
  const updateCalendar = useUpdateConnectedCalendar();
  const deleteCalendar = useDeleteConnectedCalendar();
  const setTravelCalendar = useSetTravelCalendar();

  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(
    null,
  );
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [addingCalendarId, setAddingCalendarId] = useState<string>("");
  const [newCalendarColor, setNewCalendarColor] = useState(
    CALENDAR_COLOR_PRESETS[0],
  );
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualCalendarId, setManualCalendarId] = useState("");
  const [manualCalendarSummary, setManualCalendarSummary] = useState("");

  const connectedGoogleIds = useMemo(
    () => new Set(connectedCalendars.map((c) => c.googleCalendarId)),
    [connectedCalendars],
  );
  const addableCalendars = useMemo(
    () => calendars.filter((c) => !connectedGoogleIds.has(c.id)),
    [calendars, connectedGoogleIds],
  );

  const calendarContext = useMemo(() => {
    if (statusLoading) return undefined;
    if (!status?.connected) {
      return "Settings page: Google Calendar is NOT connected for this user. Connecting requires clicking the Connect button (an OAuth redirect Elaine cannot trigger herself) — offer to take them to Settings if they're elsewhere.";
    }
    const connectedList = connectedCalendars
      .map(
        (c) =>
          `"${c.summary}"${c.isTravelCalendar ? " (Travel calendar)" : ""}`,
      )
      .join("; ");
    return (
      `Settings page: Google Calendar is connected${status.googleEmail ? ` as ${status.googleEmail}` : ""}. ` +
      (connectedList
        ? `Connected calendars: ${connectedList}.`
        : "No calendars connected yet — add one from the list of Google calendars.") +
      (travelStatus?.isOwner
        ? " This user is the app owner and can assign any of their connected calendars as the shared Travel calendar."
        : " This user is not the app owner and cannot change which calendar is the shared Travel calendar.")
    );
  }, [statusLoading, status, connectedCalendars, travelStatus]);
  usePageAssistantContext("settings-calendar", calendarContext);

  function handleConnect() {
    window.location.href = "/api/travels/google-calendar/connect";
  }

  function handleDisconnect() {
    disconnectCalendar.mutate(undefined, {
      onSuccess: () => {
        setConfirmingDisconnect(false);
        qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
        qc.invalidateQueries({ queryKey: getListConnectedCalendarsQueryKey() });
        qc.invalidateQueries({
          queryKey: getGetTravelCalendarStatusQueryKey(),
        });
        toast.success("Google Calendar disconnected");
      },
      onError: () => toast.error("Could not disconnect. Please try again."),
    });
  }

  function handleAddCalendar() {
    const cal = addableCalendars.find((c) => c.id === addingCalendarId);
    if (!cal) return;
    addCalendar.mutate(
      {
        googleCalendarId: cal.id,
        summary: cal.summary,
        primaryColor: newCalendarColor,
        source: "picked",
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({
            queryKey: getListConnectedCalendarsQueryKey(),
          });
          toast.success(`Added "${cal.summary}"`);
          setAddingCalendarId("");
          setNewCalendarColor(CALENDAR_COLOR_PRESETS[0]);
        },
        onError: () => toast.error("Could not add calendar. Please try again."),
      },
    );
  }

  function handleAddManualCalendar() {
    const id = manualCalendarId.trim();
    const summary = manualCalendarSummary.trim() || id;
    if (!id) return;
    addCalendar.mutate(
      {
        googleCalendarId: id,
        summary,
        primaryColor: newCalendarColor,
        source: "manual",
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({
            queryKey: getListConnectedCalendarsQueryKey(),
          });
          toast.success(`Added "${summary}"`);
          setManualCalendarId("");
          setManualCalendarSummary("");
          setNewCalendarColor(CALENDAR_COLOR_PRESETS[0]);
          setManualEntryOpen(false);
        },
        onError: () =>
          toast.error(
            "Could not add calendar. Check the calendar ID and try again.",
          ),
      },
    );
  }

  function handleUpdateColor(cal: ConnectedCalendar, hex: string) {
    updateCalendar.mutate(
      { id: cal.id, body: { primaryColor: hex } },
      {
        onSuccess: () => {
          qc.invalidateQueries({
            queryKey: getListConnectedCalendarsQueryKey(),
          });
          setEditingColorId(null);
        },
        onError: () => toast.error("Could not update color. Please try again."),
      },
    );
  }

  function handleDeleteCalendar(id: number) {
    deleteCalendar.mutate(id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListConnectedCalendarsQueryKey() });
        qc.invalidateQueries({
          queryKey: getGetTravelCalendarStatusQueryKey(),
        });
        setConfirmingDeleteId(null);
        toast.success("Calendar removed");
      },
      onError: () =>
        toast.error("Could not remove calendar. Please try again."),
    });
  }

  function handleSetTravel(cal: ConnectedCalendar) {
    setTravelCalendar.mutate(cal.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListConnectedCalendarsQueryKey() });
        qc.invalidateQueries({
          queryKey: getGetTravelCalendarStatusQueryKey(),
        });
        toast.success(
          `"${cal.summary}" is now the shared Travel calendar for everyone`,
        );
      },
      onError: () =>
        toast.error("Could not set the Travel calendar. Please try again."),
    });
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          <CalendarDays className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">
            Your Google Calendars
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect your Google account, then add as many of your calendars as
            you like. Each gets its own overlay color on the Travel Calendar
            page.{" "}
            {travelStatus?.isOwner
              ? "As the app owner, you can also assign one connected calendar as the shared Travel calendar."
              : "Only the app owner can assign the shared Travel calendar."}
          </p>
        </div>
      </div>

      {statusLoading ? (
        <p className="text-sm text-muted-foreground">Checking connection…</p>
      ) : status?.connected ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected{status.googleEmail ? ` as ${status.googleEmail}` : ""}
            </p>
            {confirmingDisconnect ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Disconnect?
                </span>
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

          {connectedCalendars.length > 0 && (
            <ul className="space-y-2">
              {connectedCalendars.map((cal) => (
                <li
                  key={cal.id}
                  className="rounded-lg border border-card-border p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.primaryColor }}
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {cal.summary}
                      </span>
                      {cal.isTravelCalendar && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                          <Plane className="h-2.5 w-2.5" /> Travel
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setEditingColorId(
                            editingColorId === cal.id ? null : cal.id,
                          )
                        }
                        aria-label="Edit color"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {travelStatus?.isOwner && !cal.isTravelCalendar && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleSetTravel(cal)}
                          disabled={setTravelCalendar.isPending}
                        >
                          Set as Travel
                        </Button>
                      )}
                      {confirmingDeleteId === cal.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleDeleteCalendar(cal.id)}
                            disabled={deleteCalendar.isPending}
                          >
                            Remove
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmingDeleteId(cal.id)}
                          aria-label="Remove calendar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {editingColorId === cal.id && (
                    <ColorSwatchPicker
                      value={cal.primaryColor}
                      onChange={(hex) => handleUpdateColor(cal, hex)}
                      disabled={updateCalendar.isPending}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-lg border border-dashed border-card-border p-3">
            <Label htmlFor="add-calendar">Add a calendar</Label>
            {calendarsLoading ? (
              <p className="text-xs text-muted-foreground">
                Loading your Google calendars…
              </p>
            ) : addableCalendars.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All of your Google calendars are already connected.
              </p>
            ) : (
              <>
                <Select
                  value={addingCalendarId}
                  onValueChange={setAddingCalendarId}
                >
                  <SelectTrigger id="add-calendar">
                    <SelectValue placeholder="Choose a calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableCalendars.map((cal) => (
                      <SelectItem key={cal.id} value={cal.id}>
                        {cal.summary}
                        {cal.primary ? " (primary)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {addingCalendarId && (
                  <div className="space-y-2 pt-1">
                    <Label className="text-xs">Overlay color</Label>
                    <ColorSwatchPicker
                      value={newCalendarColor}
                      onChange={setNewCalendarColor}
                    />
                    <Button
                      size="sm"
                      onClick={handleAddCalendar}
                      disabled={addCalendar.isPending}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add calendar
                    </Button>
                  </div>
                )}
              </>
            )}

            {manualEntryOpen ? (
              <div className="space-y-2 pt-2 border-t border-card-border/60 mt-1">
                <Label htmlFor="manual-calendar-id" className="text-xs">
                  Calendar ID (from Google Calendar settings)
                </Label>
                <Input
                  id="manual-calendar-id"
                  placeholder="e.g. abcd1234@group.calendar.google.com"
                  value={manualCalendarId}
                  onChange={(e) => setManualCalendarId(e.target.value)}
                />
                <Input
                  placeholder="Display name (optional)"
                  value={manualCalendarSummary}
                  onChange={(e) => setManualCalendarSummary(e.target.value)}
                />
                <Label className="text-xs">Overlay color</Label>
                <ColorSwatchPicker
                  value={newCalendarColor}
                  onChange={setNewCalendarColor}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddManualCalendar}
                    disabled={!manualCalendarId.trim() || addCalendar.isPending}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add calendar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setManualEntryOpen(false);
                      setManualCalendarId("");
                      setManualCalendarSummary("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pt-1"
                onClick={() => setManualEntryOpen(true)}
              >
                Or add a calendar by ID instead
              </button>
            )}
          </div>
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
        Reminders with a due date sync automatically to your primary Google
        calendar. Events on the shared Travel calendar are visible and editable
        by everyone; events on your other connected calendars appear as
        read-only overlays on the Travel Calendar page.
      </p>
    </div>
  );
}
