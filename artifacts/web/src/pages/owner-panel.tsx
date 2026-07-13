import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Code2, Globe, Settings2 } from "lucide-react";
import { GlobalConfigCard } from "@workspace/elaine-ui";
import {
  ReminderEmailCard,
  TimezoneCard,
  GmailSyncCard,
  CalendarSyncCard,
} from "@workspace/travels-settings-ui";
import { AppLogo } from "@/components/app-logo";
import { useAuth } from "@/lib/auth";
import { usePageAssistantContext } from "@/lib/assistant-context";

type Tab = "travels" | "global-config" | "developer";

const ALL_TABS: { id: Tab; label: string; icon: typeof Globe }[] = [
  { id: "travels", label: "Travels", icon: Globe },
  { id: "global-config", label: "Global Config", icon: Settings2 },
  { id: "developer", label: "Developer", icon: Code2 },
];

export default function OwnerPanel() {
  const { user } = useAuth();
  const isOwner = !!user?.isOwner;

  const visibleTabs = isOwner
    ? ALL_TABS
    : ALL_TABS.filter((t) => t.id === "travels");

  const [activeTab, setActiveTab] = useState<Tab>("travels");
  const safeTab: Tab = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : "travels";

  usePageAssistantContext(
    "hub-owner-panel",
    `On the Owner Panel page (Travels app settings, Global Configuration, and Developer tools). Signed in as ${user?.email ?? "unknown"}${isOwner ? " (owner)" : ""}.`,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur-md">
        <Link
          href="/account"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to account
        </Link>
        <div className="flex items-center gap-2">
          <AppLogo className="h-7 w-7" />
          <span className="font-semibold tracking-tight text-primary">
            Batchelor
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Owner Panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? "App settings, AI configuration, and developer tools."
              : "App settings for the Travels module."}
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = safeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {safeTab === "travels" && (
          <div className="mx-auto w-full max-w-xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Travels</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reminder emails, timezone, Gmail scanning, and Google Calendar
                connections for the Travels app.
              </p>
            </div>
            <div className="space-y-6">
              <ReminderEmailCard />
              <TimezoneCard />
              <GmailSyncCard usePageContext={usePageAssistantContext} />
              <CalendarSyncCard usePageContext={usePageAssistantContext} />
            </div>
          </div>
        )}

        {safeTab === "global-config" && isOwner && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Global Configuration
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                AI models, timeouts, feature toggles, and thresholds.
              </p>
            </div>
            <GlobalConfigCard />
          </div>
        )}

        {safeTab === "developer" && isOwner && (
          <div className="mx-auto w-full max-w-xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Developer
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Owner-only tools.
              </p>
            </div>
            <Link
              href="/control-panel"
              className="flex w-full items-center justify-between rounded-lg border border-card-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Control Panel
              <span className="text-xs text-muted-foreground">
                AI timeouts &amp; token limits
              </span>
            </Link>
            <Link
              href="/google-apis-demo"
              className="flex w-full items-center justify-between rounded-lg border border-card-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
            >
              Google APIs demo
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
