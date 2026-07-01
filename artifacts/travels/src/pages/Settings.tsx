import { useState, useEffect } from "react";
import { Mail, Bell, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useGetTravelsSettings,
  useUpdateTravelsSettings,
  getGetTravelsSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetTravelsSettings();
  const update = useUpdateTravelsSettings();

  const [email, setEmail] = useState("");
  const [dirty, setDirty] = useState(false);

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
    </div>
  );
}
