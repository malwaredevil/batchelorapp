import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Code2,
  Globe,
  Map,
  Settings2,
  Puzzle,
  FlaskConical,
} from "lucide-react";
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
import { ControlPanelContent } from "@/pages/control-panel";
import { GoogleApisDemoContent } from "@/pages/google-apis-demo";
import { ServicesCatalogContent } from "@/pages/services-catalog";

type Tab =
  | "travels"
  | "global-config"
  | "control-panel"
  | "google-apis"
  | "services"
  | "ai-evidence";

const ALL_TABS: { id: Tab; label: string; icon: typeof Globe }[] = [
  { id: "travels", label: "Travels", icon: Globe },
  { id: "global-config", label: "Global Config", icon: Settings2 },
  { id: "control-panel", label: "Control Panel", icon: Code2 },
  { id: "google-apis", label: "Google APIs", icon: Map },
  { id: "services", label: "Services", icon: Puzzle },
  { id: "ai-evidence", label: "AI Evidence", icon: FlaskConical },
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
    `On the Owner Panel page (Travels app settings, Global Configuration, Control Panel, and Google APIs demo). Signed in as ${user?.email ?? "unknown"}${isOwner ? " (owner)" : ""}.`,
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
              ? "App settings, AI configuration, runtime tuning, and developer tools."
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
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
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

        {safeTab === "control-panel" && isOwner && <ControlPanelContent />}

        {safeTab === "google-apis" && isOwner && <GoogleApisDemoContent />}

        {safeTab === "services" && isOwner && <ServicesCatalogContent />}

        {safeTab === "ai-evidence" && isOwner && <AiEvidenceContent />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Evidence — owner-only tab showing AI generation run statistics.
// Helps the owner diagnose why AI picked certain field values and track
// model quality over time. Never shown in regular user UI.
// ---------------------------------------------------------------------------

interface AiEvidenceSummaryRow {
  module: string;
  feature: string;
  model: string;
  run_count: number;
  success_count: number;
  avg_duration_ms: number | null;
  total_candidates: number;
  accepted_candidates: number;
  rejected_candidates: number;
}

function AiEvidenceContent() {
  const [summary, setSummary] = useState<AiEvidenceSummaryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    // raw-fetch-ok — owner-only admin panel; no generated hook for this endpoint
    fetch("/api/ai-evidence/summary")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<{ summary: AiEvidenceSummaryRow[] }>;
      })
      .then((d) => setSummary(d.summary))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  };

  useState(() => {
    load();
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">AI Evidence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generation run statistics by module and feature. Use this to
            diagnose wrong AI values and track model quality over time.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && summary !== null && summary.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No generation runs recorded yet. AI runs will appear here after items
          are analysed.
        </p>
      )}

      {!loading && !error && summary && summary.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  Module
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  Feature
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  Model
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Runs
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Success %
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Avg ms
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Candidates
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Accepted
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Rejected
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => {
                const successPct =
                  row.run_count > 0
                    ? Math.round((row.success_count / row.run_count) * 100)
                    : 0;
                return (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 font-medium capitalize">
                      {row.module}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.feature}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.model.split("/").pop()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.run_count}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${successPct < 80 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}
                    >
                      {successPct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {row.avg_duration_ms != null
                        ? row.avg_duration_ms.toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.total_candidates}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">
                      {row.accepted_candidates}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">
                      {row.rejected_candidates}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
