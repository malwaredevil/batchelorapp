import { useState, useRef, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Code2,
  Globe,
  Map,
  Settings2,
  Puzzle,
  FlaskConical,
  Microscope,
  AlertTriangle,
  Database,
  CheckCircle2,
  Circle,
  Wifi,
  WifiOff,
  TriangleAlert,
  ShieldAlert,
  Server,
  Mail,
  MessageSquare,
  Slack,
  RefreshCw,
  Play,
  Users,
  Phone,
  BadgeCheck,
  Trash2,
  Pencil,
  X,
  Activity,
  ChevronDown,
  ChevronRight,
  Clock,
  Zap,
} from "lucide-react";
import { GlobalConfigCard } from "@workspace/elaine-ui";
import {
  appendScreenshotToken,
  useUpdateAppConfigValue,
} from "@workspace/api-client-react";
import {
  ReminderEmailCard,
  TimezoneCard,
  GmailSyncCard,
  CalendarSyncCard,
} from "@workspace/travels-settings-ui";
import { ApplicationHeader } from "@workspace/app-shell";
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
  | "ai-evidence"
  | "ai-lab"
  | "infrastructure"
  | "users"
  | "integrations";

type TabDef = { id: Tab; label: string; icon: typeof Globe };
type TabGroup = {
  key: string;
  label: string;
  icon: typeof Globe;
  tabs: TabDef[];
};

const DATA_ACCESS_TABS: TabDef[] = [
  { id: "infrastructure", label: "Infrastructure", icon: Database },
  { id: "integrations", label: "Integrations", icon: Activity },
  { id: "users", label: "Users", icon: Users },
];

const CONFIG_TABS: TabDef[] = [
  { id: "travels", label: "Travels", icon: Globe },
  { id: "global-config", label: "Global Config", icon: Settings2 },
];

/** Collapsed into the "Dev Tools" dropdown */
const DEV_TABS: TabDef[] = [
  { id: "control-panel", label: "Control Panel", icon: Code2 },
  { id: "google-apis", label: "Google APIs", icon: Map },
  { id: "services", label: "Services", icon: Puzzle },
  { id: "ai-evidence", label: "AI Evidence", icon: Microscope },
  { id: "ai-lab", label: "Lab", icon: FlaskConical },
];

/**
 * The owner nav bar has too many destinations (10 tabs) to fit as flat
 * buttons at any reasonable header width without either overflowing or
 * bleeding into the global header icons. Grouped into 3 dropdown menus
 * instead of a horizontal-scroll row, so every tab stays visible and
 * clickable without discovering a hidden scroll affordance (#toolbar-jumble).
 */
const TAB_GROUPS: TabGroup[] = [
  {
    key: "data-access",
    label: "Data & Access",
    icon: Database,
    tabs: DATA_ACCESS_TABS,
  },
  {
    key: "config",
    label: "Configuration",
    icon: Settings2,
    tabs: CONFIG_TABS,
  },
  { key: "dev-tools", label: "Dev Tools", icon: Code2, tabs: DEV_TABS },
];

const ALL_TABS: TabDef[] = TAB_GROUPS.flatMap((g) => g.tabs);

/**
 * Sanitize the ?from= query-parameter into a safe same-origin href.
 * Uses the URL constructor to normalize the value and compares origins,
 * which prevents javascript: URIs, protocol-relative paths (//evil.com),
 * and any other absolute-URL tricks. (#239/#240)
 */
function sanitizeFromHref(raw: string): string {
  if (!raw) return "/account";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin) {
      // Return only the pathname — discarding search/hash eliminates tainted
      // components from the href while preserving same-origin navigation. (#239/#240)
      return url.pathname;
    }
  } catch {
    // Invalid URL — fall through to default
  }
  return "/account";
}

function useFromParam() {
  const raw = new URLSearchParams(window.location.search).get("from") ?? "";
  const from = sanitizeFromHref(raw);
  let label = "Back to account";
  if (raw && raw !== "/account") {
    if (raw.startsWith("/modules/")) {
      label = "Back to app";
    } else {
      label = "Back";
    }
  }
  return { from, label };
}

// ---------------------------------------------------------------------------
// Environment status — fetched once at OwnerPanel mount and shared with all
// tabs so we never double-fetch and the banner renders immediately.
// ---------------------------------------------------------------------------

interface DbTierStatus {
  url: string | null;
  reachable: boolean;
  configured?: boolean;
}
interface DbStatus {
  isDeployed: boolean;
  activeTier: "prod" | "dev";
  activeSupabaseUrl: string | null;
  prod: DbTierStatus;
  dev: DbTierStatus & { configured: boolean };
}

function EnvironmentBanner({
  status,
  loading,
}: {
  status: DbStatus | null;
  loading: boolean;
}) {
  if (loading || !status) return null;

  const { isDeployed, activeTier } = status;

  if (isDeployed || activeTier === "prod") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/8 px-4 py-3">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-400">
            Production Environment
          </p>
          <p className="text-xs text-red-600/80 dark:text-red-400/70">
            You are viewing the live app. All changes take effect immediately
            and affect real data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-500/40 bg-blue-500/8 px-4 py-3">
      <Server className="h-5 w-5 shrink-0 text-blue-500" />
      <div className="min-w-0">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400">
          Development Environment
        </p>
        <p className="text-xs text-blue-600/80 dark:text-blue-400/70">
          Running in the Replit editor. Changes here do not affect the live
          production site.
        </p>
      </div>
    </div>
  );
}

export default function OwnerPanel() {
  const { user } = useAuth();
  const isOwner = !!user?.isOwner;
  const { from: backHref, label: backLabel } = useFromParam();
  const search = useSearch();
  const [, navigate] = useLocation();

  const [envStatus, setEnvStatus] = useState<DbStatus | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);

  const reloadEnvStatus = useCallback(() => {
    setEnvLoading(true);
    // raw-fetch-ok — owner-only admin endpoint, no Orval hook
    fetch("/api/hub/db-status")
      .then((r) => (r.ok ? (r.json() as Promise<DbStatus>) : null))
      .then((d) => {
        setEnvStatus(d);
        setEnvLoading(false);
      })
      .catch(() => setEnvLoading(false));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (isOwner) reloadEnvStatus();
    else setEnvLoading(false);
  }, [isOwner, reloadEnvStatus]);

  // Close whichever nav group dropdown is open when clicking outside the nav bar
  useEffect(() => {
    if (!openGroupKey) return;
    function handleClick(e: MouseEvent) {
      if (
        groupMenuRef.current &&
        !groupMenuRef.current.contains(e.target as Node)
      ) {
        setOpenGroupKey(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openGroupKey]);

  const visibleTabs = isOwner
    ? ALL_TABS
    : ALL_TABS.filter((t) => t.id === "travels");

  const tabParam = new URLSearchParams(search).get("tab") as Tab | null;
  const safeTab: Tab =
    tabParam && visibleTabs.some((t) => t.id === tabParam)
      ? tabParam
      : isOwner
        ? "infrastructure"
        : "travels";

  const navigateTab = (id: Tab) => {
    const params = new URLSearchParams(search);
    params.set("tab", id);
    navigate(`/owner-panel?${params.toString()}`, { replace: true });
  };

  usePageAssistantContext(
    "hub-owner-panel",
    `On the Owner Panel page (Travels app settings, Global Configuration, Control Panel, and Google APIs demo). Signed in as ${user?.email ?? "unknown"}${isOwner ? " (owner)" : ""}.`,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ApplicationHeader
        currentAppId="hub"
        navigationVisibility="always"
        navigation={
          <div className="flex items-stretch w-full min-w-0">
            {/* Left: back arrow + title */}
            <div className="flex items-center gap-2 pr-3 shrink-0 border-r border-border/40">
              <a
                href={backHref}
                aria-label={backLabel}
                title={backLabel}
                className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </a>
              <span className="font-semibold text-sm tracking-tight whitespace-nowrap">
                Owner Panel
              </span>
            </div>

            {/* Center: tab navigation — grouped into dropdown menus so every
                destination stays reachable without a hidden horizontal scroll. */}
            <div className="flex-1 min-w-0 flex justify-center">
              {isOwner ? (
                <div
                  ref={groupMenuRef}
                  className="flex items-stretch h-full gap-1 px-1"
                >
                  {TAB_GROUPS.map((group) => {
                    const activeTab = group.tabs.find(
                      (t) => t.id === safeTab,
                    );
                    const GroupIcon = activeTab?.icon ?? group.icon;
                    const isGroupActive = !!activeTab;
                    const isOpen = openGroupKey === group.key;
                    return (
                      <div
                        key={group.key}
                        className="relative flex shrink-0 items-stretch"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenGroupKey(isOpen ? null : group.key)
                          }
                          aria-haspopup="menu"
                          aria-expanded={isOpen}
                          className={`relative flex items-center gap-1.5 px-3 h-full text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none ${
                            isGroupActive
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                          {activeTab?.label ?? group.label}
                          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                          {isGroupActive && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-primary" />
                          )}
                        </button>

                        {isOpen && (
                          <div className="absolute top-full left-0 z-30 mt-1 w-48 rounded-md border border-border bg-background shadow-md py-1">
                            {group.tabs.map((tab) => {
                              const Icon = tab.icon;
                              const active = safeTab === tab.id;
                              return (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() => {
                                    navigateTab(tab.id);
                                    setOpenGroupKey(null);
                                  }}
                                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                                    active
                                      ? "text-foreground bg-muted"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                  }`}
                                >
                                  <Icon className="h-3.5 w-3.5 shrink-0" />
                                  {tab.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-stretch h-full px-1">
                  {ALL_TABS.filter((t) => t.id === "travels").map((tab) => {
                    const Icon = tab.icon;
                    const active = safeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => navigateTab(tab.id)}
                        className={`relative flex shrink-0 items-center gap-1.5 px-3 h-full text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none ${
                          active
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {tab.label}
                        {active && (
                          <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        }
      />

      {/* Environment banner — shown just below the top bar */}
      {isOwner && (envStatus || envLoading) && (
        <div className="border-b border-border py-3">
          <div className="mx-auto max-w-6xl px-4">
            <EnvironmentBanner status={envStatus} loading={envLoading} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
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

        {safeTab === "services" && isOwner && (
          <ServicesCatalogContent
            onNavigateToIntegrations={() => navigateTab("integrations")}
          />
        )}

        {safeTab === "integrations" && isOwner && <IntegrationsContent />}

        {safeTab === "ai-evidence" && isOwner && <AiEvidenceContent />}

        {safeTab === "ai-lab" && isOwner && <AiLabContent />}
        {safeTab === "users" && isOwner && <UserManagementContent />}
        {safeTab === "infrastructure" && isOwner && (
          <InfrastructureContent
            status={envStatus}
            loading={envLoading}
            onReload={reloadEnvStatus}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Management — owner-only "god mode" tab for editing every account field.
// ---------------------------------------------------------------------------

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  themePreference: string | null;
  timezone: string | null;
  travelsReminderEmail: string | null;
  birthday: string | null;
  isOwner: boolean;
  phoneNumber: string | null;
  phoneVerified: boolean;
  phoneVerifiedAt: string | null;
  smsConsentAt: string | null;
  smsOptedOutAt: string | null;
  smsFirstOutboundSentAt: string | null;
  slackUserId: string | null;
  createdAt: string;
}

function UserManagementContent() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Form state mirrors AdminUser editable fields
  const [form, setForm] = useState<{
    displayName: string;
    email: string;
    birthday: string;
    themePreference: string;
    timezone: string;
    travelsReminderEmail: string;
    isOwner: boolean;
    phoneNumber: string;
    phoneVerified: boolean;
    smsConsentNow: boolean;
    smsOptedOut: boolean;
    slackUserId: string;
  }>({
    displayName: "",
    email: "",
    birthday: "",
    themePreference: "",
    timezone: "",
    travelsReminderEmail: "",
    isOwner: false,
    phoneNumber: "",
    phoneVerified: false,
    smsConsentNow: false,
    smsOptedOut: false,
    slackUserId: "",
  });

  const loadUsers = useCallback(() => {
    setLoading(true);
    setError(null);
    // raw-fetch-ok — owner-only admin endpoint
    fetch("/api/admin/users")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ users: AdminUser[] }>)
          : Promise.reject(r.status),
      )
      .then((d) => {
        setUsers(d.users);
        setLoading(false);
      })
      .catch((e) => {
        setError(`Failed to load users: ${String(e)}`);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openEdit = (u: AdminUser) => {
    setEditingUser(u);
    setForm({
      displayName: u.displayName ?? "",
      email: u.email,
      birthday: u.birthday ?? "",
      themePreference: u.themePreference ?? "",
      timezone: u.timezone ?? "",
      travelsReminderEmail: u.travelsReminderEmail ?? "",
      isOwner: u.isOwner,
      phoneNumber: u.phoneNumber ?? "",
      phoneVerified: u.phoneVerified,
      smsConsentNow: !!u.smsConsentAt,
      smsOptedOut: !!u.smsOptedOutAt,
      slackUserId: u.slackUserId ?? "",
    });
  };

  const handleSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        displayName: form.displayName.trim() || null,
        email: form.email.trim(),
        birthday: form.birthday.trim() || null,
        themePreference: form.themePreference.trim() || null,
        timezone: form.timezone.trim() || null,
        travelsReminderEmail: form.travelsReminderEmail.trim() || null,
        isOwner: form.isOwner,
        phoneNumber: form.phoneNumber.trim() || null,
        phoneVerified: form.phoneVerified,
        smsConsentNow: form.smsConsentNow,
        smsOptedOut: form.smsOptedOut,
        slackUserId: form.slackUserId.trim() || null,
      };
      const resp = await fetch(`/api/admin/users/${editingUser.id}`, {
        // raw-fetch-ok
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { user?: AdminUser; error?: unknown };
      if (!resp.ok) {
        toast({
          title: "Save failed",
          description: String(data.error ?? "Unknown error"),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Saved",
          description: `${data.user?.displayName ?? data.user?.email} updated.`,
        });
        setEditingUser(null);
        loadUsers();
      }
    } catch (e) {
      toast({
        title: "Save failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const expectedName = (
      deleteTarget.displayName ?? deleteTarget.email
    ).trim();
    if (deleteConfirmName.trim() !== expectedName) {
      toast({
        title: "Name doesn't match",
        description: "Type the exact name/email shown to confirm.",
        variant: "destructive",
      });
      return;
    }
    setDeleting(true);
    try {
      const resp = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        // raw-fetch-ok
        method: "DELETE",
      });
      const data = (await resp.json()) as {
        deleted?: boolean;
        error?: unknown;
      };
      if (!resp.ok) {
        toast({
          title: "Delete failed",
          description: String(data.error ?? "Unknown error"),
          variant: "destructive",
        });
      } else {
        toast({ title: "User deleted" });
        setDeleteTarget(null);
        setDeleteConfirmName("");
        loadUsers();
      }
    } catch (e) {
      toast({
        title: "Delete failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const smsStatus = (u: AdminUser) => {
    if (u.smsOptedOutAt) return { label: "Opted Out", color: "text-red-500" };
    if (u.smsConsentAt) return { label: "Consented", color: "text-green-600" };
    return { label: "None", color: "text-muted-foreground" };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Loading users…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Household members — edit identity, preferences, permissions,
          phone/SMS, and Slack. Hub widget preferences are excluded (managed by
          each user).
        </p>
      </div>

      {/* User table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left font-medium">Member</th>
              <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">
                Phone
              </th>
              <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">
                SMS
              </th>
              <th className="px-4 py-2.5 text-left font-medium hidden lg:table-cell">
                Slack
              </th>
              <th className="px-4 py-2.5 text-left font-medium hidden lg:table-cell">
                Joined
              </th>
              <th className="px-4 py-2.5 text-right font-medium">Edit</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u, i) => {
              const name = (u.displayName ?? "").trim() || u.email;
              const initials = name
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0].toUpperCase())
                .join("");
              const sms = smsStatus(u);
              const isSelf = u.id === me?.id;
              return (
                <tr
                  key={u.id}
                  className={`border-t border-border transition-colors ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          background: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                        }}
                      >
                        {initials || "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate max-w-[160px]">
                          {name}
                          {u.isOwner && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              owner
                            </span>
                          )}
                          {isSelf && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              you
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[160px]">
                          {u.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {u.phoneNumber ? (
                      <div className="flex items-center gap-1 text-xs">
                        <span className="font-mono">{u.phoneNumber}</span>
                        {u.phoneVerified && (
                          <BadgeCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`text-xs font-medium ${sms.color}`}>
                      {sms.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {u.slackUserId ? (
                      <div className="flex items-center gap-1 text-xs">
                        <Slack className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-muted-foreground">
                          {u.slackUserId}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground border border-border hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit dialog */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingUser(null);
          }}
        >
          <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10">
              <div>
                <h3 className="font-semibold text-base">
                  Edit{" "}
                  {(editingUser.displayName ?? "").trim() || editingUser.email}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ID: {editingUser.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Identity */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Identity
                </h4>
                <div className="space-y-2">
                  <label className="block">
                    <span className="text-xs text-muted-foreground">
                      Display name
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.displayName}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, displayName: e.target.value }))
                      }
                      placeholder="Jane Smith"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Email</span>
                    <input
                      type="email"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.email}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">
                      Birthday (MM-DD)
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.birthday}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, birthday: e.target.value }))
                      }
                      placeholder="07-04"
                      maxLength={5}
                    />
                  </label>
                </div>
              </section>

              {/* Preferences */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Preferences
                </h4>
                <div className="space-y-2">
                  <label className="block">
                    <span className="text-xs text-muted-foreground">
                      Theme preference
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.themePreference}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          themePreference: e.target.value,
                        }))
                      }
                      placeholder="light / dark / system"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">
                      Timezone (IANA)
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.timezone}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, timezone: e.target.value }))
                      }
                      placeholder="America/Denver"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">
                      Travels reminder email
                    </span>
                    <input
                      type="email"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.travelsReminderEmail}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          travelsReminderEmail: e.target.value,
                        }))
                      }
                      placeholder="jane@example.com"
                    />
                  </label>
                </div>
              </section>

              {/* Permissions */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Permissions
                </h4>
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium">Owner</div>
                    <div className="text-xs text-muted-foreground">
                      {editingUser.id === me?.id
                        ? "You cannot remove your own owner status."
                        : "Full admin access to Owner Panel."}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={editingUser.id === me?.id}
                    onClick={() =>
                      setForm((f) => ({ ...f, isOwner: !f.isOwner }))
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${form.isOwner ? "bg-primary" : "bg-input"}`}
                    role="switch"
                    aria-checked={form.isOwner}
                  >
                    <span
                      className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${form.isOwner ? "translate-x-4" : "translate-x-0"}`}
                    />
                  </button>
                </div>
              </section>

              {/* Phone & SMS — God Mode */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  Phone &amp; SMS — God Mode
                </h4>
                <div className="space-y-2">
                  <label className="block">
                    <span className="text-xs text-muted-foreground">
                      Phone number (E.164)
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.phoneNumber}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, phoneNumber: e.target.value }))
                      }
                      placeholder="+12105551234"
                    />
                  </label>
                  {(
                    [
                      {
                        key: "phoneVerified",
                        label: "Phone verified",
                        description:
                          "Mark this number as verified without the OTP flow.",
                      },
                      {
                        key: "smsConsentNow",
                        label: "Has SMS consent",
                        description: "Sets / clears smsConsentAt timestamp.",
                      },
                      {
                        key: "smsOptedOut",
                        label: "SMS opted out",
                        description: "Sets / clears smsOptedOutAt timestamp.",
                      },
                    ] as const
                  ).map(({ key, label, description }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
                    >
                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">
                          {description}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, [key]: !f[key] }))
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${form[key] ? "bg-primary" : "bg-input"}`}
                        role="switch"
                        aria-checked={form[key]}
                      >
                        <span
                          className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${form[key] ? "translate-x-4" : "translate-x-0"}`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Slack */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Slack className="h-3.5 w-3.5" />
                  Slack
                </h4>
                <label className="block">
                  <span className="text-xs text-muted-foreground">
                    Slack user ID
                  </span>
                  <input
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.slackUserId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, slackUserId: e.target.value }))
                    }
                    placeholder="U1234567890"
                  />
                </label>
              </section>

              {/* Account (read-only) */}
              <section className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Account (read-only)
                </h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono">{editingUser.id}</span>
                  <span className="text-muted-foreground">Created</span>
                  <span>
                    {new Date(editingUser.createdAt).toLocaleString()}
                  </span>
                </div>
              </section>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20 sticky bottom-0">
              {editingUser.id !== me?.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget(editingUser);
                    setDeleteConfirmName("");
                    setEditingUser(null);
                  }}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-destructive border border-destructive/40 hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete user
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDeleteTarget(null);
              setDeleteConfirmName("");
            }
          }}
        >
          <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-destructive/10 p-2 shrink-0 mt-0.5">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <h3 className="font-semibold text-base">Delete user?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This permanently deletes{" "}
                    <strong>
                      {(deleteTarget.displayName ?? "").trim() ||
                        deleteTarget.email}
                    </strong>{" "}
                    and all their data. This cannot be undone.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Type{" "}
                  <strong className="text-foreground font-mono">
                    {(deleteTarget.displayName ?? "").trim() ||
                      deleteTarget.email}
                  </strong>{" "}
                  to confirm
                </label>
                <input
                  autoFocus
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/50"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleDelete();
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmName("");
                }}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md px-4 py-1.5 text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
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

// ---------------------------------------------------------------------------
// AI Lab — owner-only tab for testing fabric crease / fold removal.
// Lets the owner test OpenAI gpt-image-2 inpainting on a
// fabric photo side-by-side before rolling either technique into the quilting
// module. Only visible when isOwner === true.
// ---------------------------------------------------------------------------

interface LabFabric {
  id: number;
  name: string;
}

interface InpaintResult {
  dataUrl?: string;
  error?: string;
}

interface BatchFabricResult {
  fabric: LabFabric;
  status: "queued" | "detecting" | "running" | "done" | "skipped" | "error";
  detectMsg?: string;
  openaiResult: InpaintResult | null;
  sourceImageUrl: string;
  saveStatus: Record<string, string>;
  error?: string;
}

const CANVAS_MAX_PX = 520;

type LabStatus = { openai: boolean } | null;

function AiLabContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Provider status (checked on mount) ────────────────────────────────
  const [labStatus, setLabStatus] = useState<LabStatus>(null);

  useEffect(() => {
    // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
    fetch("/api/quilting/lab/status")
      .then((r) => r.json())
      .then((d: { openai?: boolean }) => {
        setLabStatus({ openai: !!d.openai });
      })
      .catch(() => {
        setLabStatus({ openai: false });
      });
  }, []);

  const missingProviders: string[] = [];
  if (labStatus !== null) {
    if (!labStatus.openai) missingProviders.push("OPENAI_API_KEY");
  }
  const providersReady = labStatus !== null && missingProviders.length === 0;

  // ── Mode toggle ────────────────────────────────────────────────────────
  const [batchMode, setBatchMode] = useState(false);

  // ── Fabric picker ──────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [fabricList, setFabricList] = useState<LabFabric[]>([]);
  const [selectedFabric, setSelectedFabric] = useState<LabFabric | null>(null);

  // ── Test photo (optional override for the source image) ────────────────
  const [testPhotoDataUrl, setTestPhotoDataUrl] = useState<string | null>(null);
  const [testPhotoName, setTestPhotoName] = useState<string | null>(null);

  // ── Canvas state ───────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [canvasW, setCanvasW] = useState(CANVAS_MAX_PX);
  const [canvasH, setCanvasH] = useState(CANVAS_MAX_PX);
  const [brushSize, setBrushSize] = useState(24);
  const [drawMode, setDrawMode] = useState<"paint" | "erase">("paint");
  const isDrawingRef = useRef(false);

  // ── Zoom lightbox ───────────────────────────────────────────────────────
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [zoomLabel, setZoomLabel] = useState("");
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPan, setZoomPan] = useState({ x: 0, y: 0 });
  const zoomPanning = useRef(false);
  const zoomPanStart = useRef({ x: 0, y: 0 });

  const openZoom = (src: string, label: string) => {
    setZoomSrc(src);
    setZoomLabel(label);
    setZoomScale(1);
    setZoomPan({ x: 0, y: 0 });
  };
  const closeZoom = () => setZoomSrc(null);

  // ── Detection / removal ────────────────────────────────────────────────
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [openaiRemoving, setOpenaiRemoving] = useState(false);
  const [openaiResult, setOpenaiResult] = useState<InpaintResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  // ── Load fabrics on mount + when query changes ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    const url = `/api/quilting/fabrics?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((d: { items?: LabFabric[] }) => {
        if (!cancelled) setFabricList(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [query]);

  // ── Handle fresh test photo upload ────────────────────────────────────
  const handleTestPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setTestPhotoDataUrl(dataUrl);
      setTestPhotoName(file.name);
      setOpenaiResult(null);
      setDetectMsg(null);
      setSaveStatus({});
    };
    reader.readAsDataURL(file);
  };

  // ── Resize canvas when image loads ────────────────────────────────────
  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth || CANVAS_MAX_PX;
    const nh = img.naturalHeight || CANVAS_MAX_PX;
    const scale = Math.min(1, CANVAS_MAX_PX / Math.max(nw, nh));
    const w = Math.round(nw * scale);
    const h = Math.round(nh * scale);
    setCanvasW(w);
    setCanvasH(h);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, w, h);
    setDetectMsg(null);
    setOpenaiResult(null);
    setSaveStatus({});
  }, []);

  // ── Canvas drawing ────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      if (!t) return { x: 0, y: 0 };
      return {
        x: (t.clientX - rect.left) * scaleX,
        y: (t.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const paintAt = (pos: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (drawMode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(139, 92, 246, 0.65)";
    }
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  };

  const onMouseDown = (e: React.MouseEvent) => {
    isDrawingRef.current = true;
    paintAt(getCanvasPos(e));
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (isDrawingRef.current) paintAt(getCanvasPos(e));
  };
  const onMouseUp = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasW, canvasH);
    setDetectMsg(null);
  };

  // Build white-on-transparent mask for the server
  const getMaskDataUrl = (): string => {
    const src = canvasRef.current;
    if (!src) return "";
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const imgd = ctx.getImageData(0, 0, off.width, off.height);
    const d = imgd.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 10) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(imgd, 0, 0);
    return off.toDataURL("image/png");
  };

  // ── Detect creases ────────────────────────────────────────────────────
  const detectCreases = async () => {
    if (!selectedFabric && !testPhotoDataUrl) return;
    setDetecting(true);
    setDetectMsg(null);
    try {
      const body = testPhotoDataUrl
        ? { sourceDataUrl: testPhotoDataUrl }
        : { fabricId: selectedFabric!.id };
      // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
      const resp = await fetch("/api/quilting/lab/detect-creases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as {
        description?: string;
        maskDataUrl?: string;
        creasesFound?: number;
        error?: string;
      };
      if (!resp.ok || data.error) {
        setDetectMsg(`Detection failed: ${data.error ?? "unknown error"}`);
        return;
      }
      const found = data.creasesFound ?? 0;
      setDetectMsg(
        found === 0
          ? "No creases detected — paint the mask manually if needed."
          : `Detected ${found} crease${found === 1 ? "" : "s"}: ${data.description ?? ""}`,
      );
      if (data.maskDataUrl) {
        const maskImg = new Image();
        maskImg.onload = () => {
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, canvasW, canvasH);
          // Draw mask scaled to canvas, then re-colour to purple
          const tmp = document.createElement("canvas");
          tmp.width = canvasW;
          tmp.height = canvasH;
          const tc = tmp.getContext("2d")!;
          tc.drawImage(maskImg, 0, 0, canvasW, canvasH);
          const id = tc.getImageData(0, 0, canvasW, canvasH);
          const pd = id.data;
          for (let i = 0; i < pd.length; i += 4) {
            if (pd[i + 3] > 10) {
              pd[i] = 139;
              pd[i + 1] = 92;
              pd[i + 2] = 246;
              pd[i + 3] = 180;
            }
          }
          tc.putImageData(id, 0, 0);
          ctx.drawImage(tmp, 0, 0);
        };
        maskImg.src = data.maskDataUrl;
      }
    } catch {
      setDetectMsg("Detection request failed — check server logs.");
    } finally {
      setDetecting(false);
    }
  };

  const removeCreases = () => {
    if (!selectedFabric && !testPhotoDataUrl) return;
    const maskDataUrl = getMaskDataUrl();
    if (!maskDataUrl) return;

    setOpenaiResult(null);
    setSaveStatus({});

    const sourceBody = testPhotoDataUrl
      ? { sourceDataUrl: testPhotoDataUrl }
      : { fabricId: selectedFabric!.id };

    setOpenaiRemoving(true);
    // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
    fetch("/api/quilting/lab/remove-creases/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sourceBody, maskDataUrl }),
    })
      .then(async (resp) => {
        const data = (await resp.json()) as {
          dataUrl?: string;
          error?: string;
        };
        setOpenaiResult(
          resp.ok && data.dataUrl
            ? { dataUrl: data.dataUrl }
            : { error: data.error ?? "OpenAI returned no result." },
        );
      })
      .catch(() =>
        setOpenaiResult({
          error: "OpenAI request failed — check server logs.",
        }),
      )
      .finally(() => setOpenaiRemoving(false));
  };

  // ── Save result as fabric primary photo ───────────────────────────────
  const saveResult = async (dataUrl: string, key: string) => {
    if (!selectedFabric) return;
    setSaveStatus((s) => ({ ...s, [key]: "saving" }));
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const form = new FormData();
      form.append("image", blob, "inpainted.png");
      // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
      const resp = await fetch(
        `/api/quilting/fabrics/${selectedFabric.id}/image`,
        {
          method: "PUT",
          body: form,
        },
      );
      if (!resp.ok) throw new Error(`${resp.status}`);
      setSaveStatus((s) => ({ ...s, [key]: "saved" }));
      // Invalidate the fabric cache so detail pages pick up the new image
      await queryClient.invalidateQueries({
        queryKey: ["quilting", "fabrics", selectedFabric.id],
      });
      toast({
        title: "Photo saved",
        description: `${selectedFabric.name || `Fabric #${selectedFabric.id}`} primary photo updated.`,
      });
    } catch {
      setSaveStatus((s) => ({ ...s, [key]: "error" }));
      toast({
        title: "Save failed",
        description: "Could not update the fabric photo. Check server logs.",
        variant: "destructive",
      });
    }
  };

  // Source image: prefer the uploaded test photo, fall back to the saved fabric image
  const sourceImageUrl = testPhotoDataUrl
    ? testPhotoDataUrl
    : selectedFabric
      ? `/api/quilting/fabrics/${selectedFabric.id}/image`
      : null;

  return (
    <div className="space-y-6">
      {/* Zoom lightbox */}
      {zoomSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={closeZoom}
          onWheel={(e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.12 : 0.89;
            setZoomScale((s) => Math.min(Math.max(s * factor, 0.5), 10));
          }}
          onMouseDown={(e) => {
            if (zoomScale <= 1) return;
            e.preventDefault();
            zoomPanning.current = true;
            zoomPanStart.current = {
              x: e.clientX - zoomPan.x,
              y: e.clientY - zoomPan.y,
            };
          }}
          onMouseMove={(e) => {
            if (!zoomPanning.current) return;
            setZoomPan({
              x: e.clientX - zoomPanStart.current.x,
              y: e.clientY - zoomPanStart.current.y,
            });
          }}
          onMouseUp={() => {
            zoomPanning.current = false;
          }}
          style={{ cursor: zoomScale > 1 ? "grab" : "default" }}
        >
          <button
            type="button"
            onClick={closeZoom}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Close zoom"
          >
            ✕
          </button>
          <p className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-xs font-medium text-white/70 uppercase tracking-wide select-none">
            {zoomLabel} {zoomScale !== 1 && `· ${Math.round(zoomScale * 100)}%`}
          </p>
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-xs text-white/40 select-none">
            Scroll to zoom · drag to pan · click outside to close
          </p>
          <img
            src={zoomSrc}
            alt={zoomLabel}
            className="rounded-lg shadow-2xl select-none"
            style={{
              maxHeight: "85vh",
              maxWidth: "85vw",
              transform: `scale(${zoomScale}) translate(${zoomPan.x / zoomScale}px, ${zoomPan.y / zoomScale}px)`,
              transformOrigin: "center center",
              transition: zoomPanning.current ? "none" : "transform 0.1s ease",
            }}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            AI Lab — Crease Removal
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {batchMode
              ? "Select multiple fabrics and run crease removal on all in sequence. Review side-by-side results for each."
              : "Pick a fabric, auto-detect or paint over creases, then run both AI models in parallel. Save whichever result you prefer as the fabric's primary photo."}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setBatchMode(false)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              !batchMode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => setBatchMode(true)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              batchMode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Batch
          </button>
        </div>
      </div>

      {/* Missing-provider banner */}
      {!labStatus?.openai && labStatus !== null && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">OPENAI_API_KEY</span> is not set.
            Add it in the <strong>Secrets</strong> tab of your Replit workspace.
          </div>
        </div>
      )}

      {batchMode ? (
        <BatchLabContent
          providersReady={providersReady}
          missingProviders={missingProviders}
        />
      ) : (
        <>
          {/* Fabric picker + optional test photo upload */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Fabric (from collection)
              </label>
              <input
                type="search"
                placeholder="Search fabrics…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-background">
                {fabricList.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No fabrics found.
                  </p>
                )}
                {fabricList.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setSelectedFabric(f);
                      setTestPhotoDataUrl(null);
                      setTestPhotoName(null);
                      setOpenaiResult(null);
                      setDetectMsg(null);
                      setSaveStatus({});
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                      selectedFabric?.id === f.id && !testPhotoDataUrl
                        ? "bg-primary/10 font-medium"
                        : ""
                    }`}
                  >
                    {f.name || `Fabric #${f.id}`}
                  </button>
                ))}
              </div>
            </div>

            {/* OR: upload a fresh test photo that isn't yet in the collection */}
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Or upload a test photo{" "}
                <span className="font-normal text-muted-foreground">
                  (not saved to collection)
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleTestPhotoUpload}
                />
                {testPhotoName ? (
                  <span className="truncate text-foreground">
                    {testPhotoName}
                  </span>
                ) : (
                  <span>Choose image…</span>
                )}
              </label>
              {testPhotoDataUrl && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Using uploaded test photo. Detect/Remove will use this image.{" "}
                  {!selectedFabric && (
                    <span>Select a fabric above to enable Save.</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {(selectedFabric || testPhotoDataUrl) && sourceImageUrl && (
            <>
              {/* Canvas editor */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {selectedFabric
                      ? selectedFabric.name || `Fabric #${selectedFabric.id}`
                      : (testPhotoName ?? "Test photo")}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Paint / Erase mode toggle */}
                    <div className="flex overflow-hidden rounded-md border border-border text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => setDrawMode("paint")}
                        className={`px-2.5 py-1 transition-colors ${drawMode === "paint" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        Paint
                      </button>
                      <button
                        type="button"
                        onClick={() => setDrawMode("erase")}
                        className={`border-l border-border px-2.5 py-1 transition-colors ${drawMode === "erase" ? "bg-destructive text-white" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        Erase
                      </button>
                    </div>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      Brush
                      <input
                        type="range"
                        min={8}
                        max={80}
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-20"
                      />
                      <span className="tabular-nums">{brushSize}px</span>
                    </label>
                    <button
                      type="button"
                      onClick={clearCanvas}
                      className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
                <div
                  className="relative select-none overflow-hidden rounded-md border border-border bg-muted"
                  style={{ width: canvasW, height: canvasH, maxWidth: "100%" }}
                >
                  <img
                    ref={imgRef}
                    src={sourceImageUrl}
                    alt={selectedFabric?.name ?? "Test photo"}
                    onLoad={handleImageLoad}
                    className="absolute inset-0 h-full w-full object-contain"
                    draggable={false}
                  />
                  <canvas
                    ref={canvasRef}
                    width={canvasW}
                    height={canvasH}
                    style={{
                      cursor: drawMode === "erase" ? "cell" : "crosshair",
                    }}
                    className="absolute inset-0"
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Purple highlights = areas to inpaint. Paint over creases, or
                  use <strong>Auto-detect</strong> first.
                </p>
                {detectMsg && (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm">
                    {detectMsg}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={detectCreases}
                  disabled={!providersReady || detecting || openaiRemoving}
                  title={
                    !providersReady
                      ? `Missing keys: ${missingProviders.join(", ")}`
                      : undefined
                  }
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {detecting ? "Detecting…" : "Auto-detect creases"}
                </button>
                <button
                  type="button"
                  onClick={removeCreases}
                  disabled={!providersReady || openaiRemoving || detecting}
                  title={
                    !providersReady
                      ? `Missing keys: ${missingProviders.join(", ")}`
                      : undefined
                  }
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {openaiRemoving ? "Running AI (30–60 s)…" : "Remove creases"}
                </button>
              </div>

              {/* Results */}
              {(openaiRemoving || openaiResult) && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Original */}
                    <div className="space-y-1">
                      <p className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Original
                      </p>
                      <div
                        className="group relative h-72 cursor-zoom-in overflow-hidden rounded-md border border-border bg-muted"
                        onClick={() => {
                          if (sourceImageUrl)
                            openZoom(sourceImageUrl, "Original");
                        }}
                      >
                        <img
                          src={sourceImageUrl}
                          alt="Original"
                          className="h-full w-full object-contain"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
                            Click to zoom
                          </span>
                        </div>
                      </div>
                    </div>

                    <LabResultPanel
                      label="OpenAI gpt-image-2"
                      loading={openaiRemoving}
                      result={openaiResult}
                      saveDisabled={!selectedFabric}
                      saveStatus={saveStatus["openai"]}
                      onSave={() => {
                        if (openaiResult?.dataUrl)
                          saveResult(openaiResult.dataUrl, "openai");
                      }}
                      onZoom={() => {
                        if (openaiResult?.dataUrl)
                          openZoom(openaiResult.dataUrl, "OpenAI gpt-image-2");
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BatchLabContent — multi-select fabric batch crease removal.
// Processes each fabric sequentially (detect → OpenAI + Replicate in parallel)
// so the owner can compare both outputs across the whole queue.
// ---------------------------------------------------------------------------

function BatchLabContent({
  providersReady,
  missingProviders,
}: {
  providersReady: boolean;
  missingProviders: string[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [fabricList, setFabricList] = useState<LabFabric[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [results, setResults] = useState<BatchFabricResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/quilting/fabrics?pageSize=100${query ? `&q=${encodeURIComponent(query)}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((d: { items?: LabFabric[] }) => {
        if (!cancelled) setFabricList(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [query]);

  const toggleFabric = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(fabricList.map((f) => f.id)));
  const clearAll = () => setSelected(new Set());

  const updateResult = (
    fabricId: number,
    patch: Partial<BatchFabricResult>,
  ) => {
    setResults((prev) =>
      prev.map((r) => (r.fabric.id === fabricId ? { ...r, ...patch } : r)),
    );
  };

  const runBatch = async () => {
    const queue = fabricList.filter((f) => selected.has(f.id));
    if (queue.length === 0) return;

    setRunning(true);
    setProgress({ done: 0, total: queue.length });
    setResults(
      queue.map((f) => ({
        fabric: f,
        status: "queued" as const,
        openaiResult: null,
        sourceImageUrl: `/api/quilting/fabrics/${f.id}/image`,
        saveStatus: {},
      })),
    );

    for (let i = 0; i < queue.length; i++) {
      const fabric = queue[i]!;

      // ── 1. Auto-detect creases ──────────────────────────────────────────
      updateResult(fabric.id, { status: "detecting" });

      let maskDataUrl: string | null = null;
      let detectMsg = "";
      try {
        // raw-fetch-ok — owner-only AI lab; no generated hook
        const resp = await fetch("/api/quilting/lab/detect-creases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fabricId: fabric.id }),
        });
        const data = (await resp.json()) as {
          description?: string;
          maskDataUrl?: string;
          creasesFound?: number;
          error?: string;
        };

        if (!resp.ok || data.error) {
          updateResult(fabric.id, {
            status: "error",
            error: data.error ?? "Detection failed",
          });
          setProgress((prev) =>
            prev ? { ...prev, done: prev.done + 1 } : null,
          );
          continue;
        }

        const found = data.creasesFound ?? 0;
        detectMsg =
          found === 0
            ? "No creases detected — skipping AI removal."
            : `Detected ${found} crease${found === 1 ? "" : "s"}: ${data.description ?? ""}`;

        if (found === 0 || !data.maskDataUrl) {
          updateResult(fabric.id, { status: "skipped", detectMsg });
          setProgress((prev) =>
            prev ? { ...prev, done: prev.done + 1 } : null,
          );
          continue;
        }

        maskDataUrl = data.maskDataUrl;
      } catch {
        updateResult(fabric.id, {
          status: "error",
          error: "Detection request failed — check server logs.",
        });
        setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
        continue;
      }

      // ── 2. Run OpenAI ──────────────────────────────────────────────────
      updateResult(fabric.id, { status: "running", detectMsg });

      let openaiResult: InpaintResult;
      try {
        // raw-fetch-ok — owner-only AI lab; no generated hook
        const r = await fetch("/api/quilting/lab/remove-creases/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fabricId: fabric.id, maskDataUrl }),
        });
        const d = (await r.json()) as { dataUrl?: string; error?: string };
        openaiResult =
          r.ok && d.dataUrl
            ? { dataUrl: d.dataUrl }
            : { error: d.error ?? "OpenAI returned no result." };
      } catch {
        openaiResult = { error: "OpenAI request failed." };
      }

      updateResult(fabric.id, { status: "done", openaiResult });
      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
    }

    setRunning(false);
  };

  const saveResult = async (
    fabric: LabFabric,
    dataUrl: string,
    key: string,
  ) => {
    updateResult(fabric.id, {
      saveStatus: { [key]: "saving" },
    });
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const form = new FormData();
      form.append("image", blob, "inpainted.png");
      // raw-fetch-ok — owner-only AI lab; no generated hook
      const resp = await fetch(`/api/quilting/fabrics/${fabric.id}/image`, {
        method: "PUT",
        body: form,
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      updateResult(fabric.id, { saveStatus: { [key]: "saved" } });
      await queryClient.invalidateQueries({
        queryKey: ["quilting", "fabrics", fabric.id],
      });
      toast({
        title: "Photo saved",
        description: `${fabric.name || `Fabric #${fabric.id}`} primary photo updated.`,
      });
    } catch {
      updateResult(fabric.id, { saveStatus: { [key]: "error" } });
      toast({
        title: "Save failed",
        description: "Could not update the fabric photo. Check server logs.",
        variant: "destructive",
      });
    }
  };

  const selectedCount = selected.size;

  return (
    <div className="space-y-5">
      {/* Fabric multi-select */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium">
            Select fabrics to process
          </label>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              disabled={running}
              className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              All
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={running}
              className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              None
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search fabrics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={running}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background">
          {fabricList.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No fabrics found.
            </p>
          )}
          {fabricList.map((f) => {
            const checked = selected.has(f.id);
            return (
              <label
                key={f.id}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted ${
                  checked ? "bg-primary/8 font-medium" : ""
                } ${running ? "pointer-events-none opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFabric(f.id)}
                  className="h-4 w-4 accent-primary"
                />
                {f.name || `Fabric #${f.id}`}
              </label>
            );
          })}
        </div>
      </div>

      {/* Run button + progress */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runBatch}
          disabled={!providersReady || running || selectedCount === 0}
          title={
            !providersReady
              ? `Missing keys: ${missingProviders.join(", ")}`
              : undefined
          }
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running
            ? "Running…"
            : selectedCount === 0
              ? "Select fabrics above"
              : `Run on ${selectedCount} fabric${selectedCount === 1 ? "" : "s"}`}
        </button>
        {progress && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                }}
              />
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {progress.done} of {progress.total} done
            </span>
          </div>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-6">
          <h3 className="text-sm font-semibold">Batch results</h3>
          {results.map((r) => (
            <div
              key={r.fabric.id}
              className="rounded-lg border border-border bg-muted/20 p-4 space-y-3"
            >
              {/* Card header */}
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {r.fabric.name || `Fabric #${r.fabric.id}`}
                </span>
                <BatchStatusBadge status={r.status} />
              </div>

              {r.detectMsg && (
                <p className="text-xs text-muted-foreground">{r.detectMsg}</p>
              )}
              {r.error && <p className="text-xs text-destructive">{r.error}</p>}

              {/* Side-by-side comparison (when running or done) */}
              {(r.status === "running" || r.status === "done") && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {/* Original */}
                  <div className="space-y-1">
                    <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Original
                    </p>
                    <img
                      src={r.sourceImageUrl}
                      alt={r.fabric.name || `Fabric #${r.fabric.id}`}
                      className="w-full rounded-md border border-border object-cover"
                    />
                  </div>

                  <LabResultPanel
                    label="OpenAI gpt-image-2"
                    loading={r.status === "running" && !r.openaiResult}
                    result={r.openaiResult}
                    saveStatus={r.saveStatus["openai"]}
                    onSave={() => {
                      if (r.openaiResult?.dataUrl)
                        saveResult(r.fabric, r.openaiResult.dataUrl, "openai");
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchStatusBadge({ status }: { status: BatchFabricResult["status"] }) {
  const map: Record<
    BatchFabricResult["status"],
    { label: string; className: string }
  > = {
    queued: {
      label: "Queued",
      className: "bg-muted text-muted-foreground",
    },
    detecting: {
      label: "Detecting…",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    },
    running: {
      label: "Running…",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    },
    done: {
      label: "Done",
      className:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    },
    skipped: {
      label: "No creases",
      className: "bg-muted text-muted-foreground",
    },
    error: {
      label: "Error",
      className: "bg-destructive/10 text-destructive",
    },
  };
  const { label, className } = map[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function LabResultPanel({
  label,
  loading,
  result,
  saveStatus,
  saveDisabled,
  onSave,
  onZoom,
}: {
  label: string;
  loading: boolean;
  result: InpaintResult | null;
  saveStatus?: string;
  saveDisabled?: boolean;
  onSave: () => void;
  onZoom?: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading && (
        <div className="flex h-72 items-center justify-center rounded-md border border-border bg-muted">
          <p className="animate-pulse text-xs text-muted-foreground">
            Running…
          </p>
        </div>
      )}
      {!loading && !result && (
        <div className="h-72 rounded-md border border-dashed border-border bg-muted/50" />
      )}
      {result?.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {result.error}
        </div>
      )}
      {result?.dataUrl && (
        <>
          <div
            className="group relative h-72 cursor-zoom-in overflow-hidden rounded-md border border-border bg-muted"
            onClick={onZoom}
          >
            <img
              src={result.dataUrl}
              alt={label}
              className="h-full w-full object-contain"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
                Click to zoom
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={!!saveStatus || saveDisabled}
            title={saveDisabled ? "Select a fabric above to save" : undefined}
            className="w-full rounded-md bg-green-600 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "✓ Saved as primary photo"
                : saveStatus === "error"
                  ? "Save failed — try again"
                  : saveDisabled
                    ? "Select a fabric to save"
                    : "Save as primary photo"}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Infrastructure tab — owner-only view of DB connections and schema tools.
// ---------------------------------------------------------------------------

function DbRow({
  label,
  url,
  reachable,
  configured,
  isActive,
}: {
  label: string;
  url: string | null;
  reachable: boolean;
  configured: boolean;
  isActive: boolean;
}) {
  function projectRef(u: string | null): string {
    if (!u) return "";
    const m = u.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
    return m ? `${m[1]}.supabase.co` : u;
  }

  const ref = projectRef(url);

  if (!configured) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-4 py-3">
        <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground/60">Not configured</p>
        </div>
      </div>
    );
  }

  if (reachable) {
    return (
      <div className="flex items-center justify-between rounded-md border border-green-500/40 bg-green-500/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <Wifi className="h-4 w-4 text-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground font-mono">{ref}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="text-xs font-semibold text-blue-600 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-400/30">
              In use
            </span>
          )}
          <span className="text-xs font-medium text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
            Connected
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <WifiOff className="h-4 w-4 text-amber-500 shrink-0" />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {ref || "—"}
          </p>
        </div>
      </div>
      <span className="text-xs font-medium text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">
        Unreachable
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Comms Check card — shows today's email/SMS/Slack send+verify status.
// ---------------------------------------------------------------------------

type CommStatus = "pending" | "sent" | "error" | "verified";

interface CommCheckRow {
  id: number;
  checkDate: string;
  emailStatus: CommStatus;
  emailSentAt: string | null;
  emailVerifiedAt: string | null;
  emailError: string | null;
  smsStatus: CommStatus;
  smsSentAt: string | null;
  smsVerifiedAt: string | null;
  smsError: string | null;
  slackStatus: CommStatus;
  slackSentAt: string | null;
  slackVerifiedAt: string | null;
  slackError: string | null;
  // Phone: no verified_at — sent = success (call placed = test passed)
  phoneStatus: CommStatus;
  phoneSentAt: string | null;
  phoneError: string | null;
  createdAt: string;
}

// treatSentAsVerified: phone channel — placing the call = success, no reply needed
function statusBadge(
  status: CommStatus,
  error?: string | null,
  treatSentAsVerified = false,
) {
  if (status === "verified" || (treatSentAsVerified && status === "sent")) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        Verified
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Circle className="h-3 w-3" />
        Sent — awaiting reply
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
        title={error ?? undefined}
      >
        <AlertTriangle className="h-3 w-3" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Circle className="h-3 w-3" />
      Pending
    </span>
  );
}

function CommCheckCard() {
  const [rows, setRows] = useState<CommCheckRow[]>([]);
  const [today, setToday] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [channelRunning, setChannelRunning] = useState<
    "email" | "sms" | "slack" | "phone" | null
  >(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    setRunMsg(null);
    // raw-fetch-ok — owner-only admin endpoint, no Orval hook
    fetch("/api/hub/comm-checks")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ today: string; rows: CommCheckRow[] }>)
          : Promise.reject(r.status),
      )
      .then((d) => {
        setToday(d.today);
        setRows(d.rows);
      })
      .catch(() =>
        toast({ title: "Could not load comm checks", variant: "destructive" }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const runAll = async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      // raw-fetch-ok — owner-only admin endpoint, no Orval hook
      const r = await fetch("/api/hub/comm-checks/run", { method: "POST" });
      const d = (await r.json()) as {
        ok: boolean;
        alreadyRan?: boolean;
        email?: string;
        sms?: string;
        slack?: string;
        phone?: string;
        error?: string;
      };
      if (d.alreadyRan) {
        setRunMsg(
          "Already ran today — use the per-channel Send buttons to resend individual channels.",
        );
      } else if (d.ok) {
        setRunMsg(
          `Sent — email: ${d.email}, SMS: ${d.sms}, Slack: ${d.slack}, Phone: ${d.phone}`,
        );
        toast({ title: "All comms checks sent" });
      } else {
        setRunMsg(d.error ?? "Run failed.");
        toast({
          title: "Comms check failed",
          description: d.error,
          variant: "destructive",
        });
      }
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error.";
      setRunMsg(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const runChannel = async (channel: "email" | "sms" | "slack" | "phone") => {
    setChannelRunning(channel);
    setRunMsg(null);
    try {
      // raw-fetch-ok — owner-only admin endpoint, no Orval hook
      const r = await fetch(`/api/hub/comm-checks/run/${channel}`, {
        method: "POST",
      });
      const d = (await r.json()) as {
        ok: boolean;
        result?: string;
        error?: string;
      };
      if (d.ok) {
        toast({ title: `${channel} check sent` });
        setRunMsg(`${channel}: ${d.result ?? "sent"}`);
      } else {
        const err = d.error ?? "Failed";
        setRunMsg(`${channel}: ${err}`);
        toast({
          title: `${channel} failed`,
          description: err,
          variant: "destructive",
        });
      }
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error.";
      setRunMsg(`${channel}: ${msg}`);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setChannelRunning(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const todayRow = rows.find((r) => r.checkDate === today);
  const anyRunning = running || channelRunning !== null;

  const channelRow = (
    channel: "email" | "sms" | "slack" | "phone",
    icon: React.ReactNode,
    label: string,
    status: CommStatus,
    error: string | null,
    // For email/SMS/Slack: the verified_at timestamp. For phone: sent_at.
    timestampAt: string | null,
    // Phone: treat "sent" as verified (call placed = success, no reply needed).
    treatSentAsVerified = false,
  ) => (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(status, error, treatSentAsVerified)}
          {timestampAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(timestampAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void runChannel(channel)}
            disabled={anyRunning}
            title={`Send ${label} check now`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground border border-border hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {channelRunning === channel ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Send
          </button>
        </div>
      </div>
      {status === "error" && error && (
        <p className="mt-1.5 text-xs text-red-700 dark:text-red-400 break-words">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Daily Comms Check</h3>
          {today && (
            <span className="text-xs text-muted-foreground">{today}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={() => void runAll()}
            disabled={anyRunning || loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="h-3 w-3" />
            {running ? "Running…" : "Send All"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-10 rounded-md border border-border bg-muted/20 animate-pulse" />
          <div className="h-10 rounded-md border border-border bg-muted/20 animate-pulse" />
          <div className="h-10 rounded-md border border-border bg-muted/20 animate-pulse" />
          <div className="h-10 rounded-md border border-border bg-muted/20 animate-pulse" />
        </div>
      ) : !todayRow ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No check has run for today yet. Use <strong>Send All</strong> or the
            individual <strong>Send</strong> buttons below.
          </p>
          {channelRow(
            "email",
            <Mail className="h-4 w-4 text-muted-foreground" />,
            "Email",
            "pending",
            null,
            null,
          )}
          {channelRow(
            "sms",
            <MessageSquare className="h-4 w-4 text-muted-foreground" />,
            "SMS",
            "pending",
            null,
            null,
          )}
          {channelRow(
            "slack",
            <Slack className="h-4 w-4 text-muted-foreground" />,
            "Slack",
            "pending",
            null,
            null,
          )}
          {channelRow(
            "phone",
            <Phone className="h-4 w-4 text-muted-foreground" />,
            "Phone Call",
            "pending",
            null,
            null,
            true,
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {channelRow(
            "email",
            <Mail className="h-4 w-4 text-muted-foreground" />,
            "Email",
            todayRow.emailStatus,
            todayRow.emailError,
            todayRow.emailVerifiedAt,
          )}
          {channelRow(
            "sms",
            <MessageSquare className="h-4 w-4 text-muted-foreground" />,
            "SMS",
            todayRow.smsStatus,
            todayRow.smsError,
            todayRow.smsVerifiedAt,
          )}
          {channelRow(
            "slack",
            <Slack className="h-4 w-4 text-muted-foreground" />,
            "Slack",
            todayRow.slackStatus,
            todayRow.slackError,
            todayRow.slackVerifiedAt,
          )}
          {channelRow(
            "phone",
            <Phone className="h-4 w-4 text-muted-foreground" />,
            "Phone Call",
            todayRow.phoneStatus,
            todayRow.phoneError,
            // Show sent_at for phone (no verified_at); call placed = success
            todayRow.phoneSentAt,
            true,
          )}
        </div>
      )}

      {runMsg && (
        <p className="text-xs text-muted-foreground border-t border-border pt-2">
          {runMsg}
        </p>
      )}

      {/* Last 7 days history */}
      {rows.length > 1 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            History (last {rows.length} days)
          </summary>
          <div className="mt-2 overflow-x-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">
                    Email
                  </th>
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">
                    SMS
                  </th>
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">
                    Slack
                  </th>
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">
                    Phone
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-2 py-1.5 font-mono text-muted-foreground">
                      {row.checkDate}
                    </td>
                    <td className="px-2 py-1.5">
                      {statusBadge(row.emailStatus)}
                    </td>
                    <td className="px-2 py-1.5">
                      {statusBadge(row.smsStatus)}
                    </td>
                    <td className="px-2 py-1.5">
                      {statusBadge(row.slackStatus)}
                    </td>
                    <td className="px-2 py-1.5">
                      {statusBadge(row.phoneStatus, row.phoneError, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

const SCHEDULE_DAY_OPTIONS: { code: string; label: string }[] = [
  { code: "sun", label: "Sun" },
  { code: "mon", label: "Mon" },
  { code: "tue", label: "Tue" },
  { code: "wed", label: "Wed" },
  { code: "thu", label: "Thu" },
  { code: "fri", label: "Fri" },
  { code: "sat", label: "Sat" },
];

interface CommCheckScheduleState {
  daily_time: string;
  daily_days: string;
  phone_time: string;
  phone_days: string;
}

function CommCheckScheduleCard() {
  const [schedule, setSchedule] = useState<CommCheckScheduleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const { toast } = useToast();
  const updateConfigValue = useUpdateAppConfigValue();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      // raw-fetch-ok — generic owner config endpoint, no Orval hook
      fetch(appendScreenshotToken("/api/config/comm_check")).then((r) =>
        r.ok
          ? (r.json() as Promise<{
              config: Array<{ key: string; value: string }>;
            }>)
          : Promise.reject(r.status),
      ),
      // raw-fetch-ok — owner-only admin endpoint, no Orval hook
      fetch(appendScreenshotToken("/api/hub/comm-checks")).then((r) =>
        r.ok
          ? (r.json() as Promise<{ effectiveTimezone?: string }>)
          : Promise.reject(r.status),
      ),
    ])
      .then(([configRes, hubRes]) => {
        const byKey = Object.fromEntries(
          configRes.config.map((c) => [c.key, c.value]),
        );
        setSchedule({
          daily_time: byKey.daily_time ?? "00:01",
          daily_days: byKey.daily_days ?? "sun,mon,tue,wed,thu,fri,sat",
          phone_time: byKey.phone_time ?? "19:00",
          phone_days: byKey.phone_days ?? "sun,mon,tue,wed,thu,fri,sat",
        });
        setTimezone(hubRes.effectiveTimezone ?? null);
      })
      .catch(() =>
        toast({
          title: "Could not load comms check schedule",
          variant: "destructive",
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveField = useCallback(
    async (key: keyof CommCheckScheduleState, value: string) => {
      setSchedule((s) => (s ? { ...s, [key]: value } : s));
      setSaving(key);
      try {
        await updateConfigValue.mutateAsync({
          module: "comm_check",
          key,
          data: { value },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Network error.";
        toast({
          title: "Could not save schedule",
          description: msg,
          variant: "destructive",
        });
        load();
      } finally {
        setSaving(null);
      }
    },
    [toast, load, updateConfigValue],
  );

  const toggleDay = (daysKey: "daily_days" | "phone_days", code: string) => {
    if (!schedule) return;
    const current = new Set(schedule[daysKey].split(",").filter(Boolean));
    if (current.has(code)) {
      if (current.size === 1) {
        toast({
          title: "At least one day must be selected",
          variant: "destructive",
        });
        return;
      }
      current.delete(code);
    } else {
      current.add(code);
    }
    const ordered = SCHEDULE_DAY_OPTIONS.map((d) => d.code).filter((c) =>
      current.has(c),
    );
    void saveField(daysKey, ordered.join(","));
  };

  const laneEditor = (
    label: string,
    icon: React.ReactNode,
    timeKey: "daily_time" | "phone_time",
    daysKey: "daily_days" | "phone_days",
  ) => {
    if (!schedule) return null;
    const selectedDays = new Set(schedule[daysKey].split(",").filter(Boolean));
    return (
      <div className="rounded-md border border-border px-3 py-3 space-y-2.5">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {SCHEDULE_DAY_OPTIONS.map((d) => (
            <button
              key={d.code}
              type="button"
              onClick={() => toggleDay(daysKey, d.code)}
              disabled={saving === daysKey}
              className={`h-7 w-10 rounded text-xs font-medium border transition-colors disabled:opacity-50 ${
                selectedDays.has(d.code)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="time"
            value={schedule[timeKey]}
            onChange={(e) => void saveField(timeKey, e.target.value)}
            disabled={saving === timeKey}
            className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Comms Check Schedule</h3>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {loading || !schedule ? (
        <div className="space-y-2">
          <div className="h-20 rounded-md border border-border bg-muted/20 animate-pulse" />
          <div className="h-20 rounded-md border border-border bg-muted/20 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-3">
          {laneEditor(
            "Email / SMS / Slack",
            <Mail className="h-4 w-4 text-muted-foreground" />,
            "daily_time",
            "daily_days",
          )}
          {laneEditor(
            "Phone Call",
            <Phone className="h-4 w-4 text-muted-foreground" />,
            "phone_time",
            "phone_days",
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t border-border pt-2">
        Times run in{" "}
        <span className="font-medium text-foreground">{timezone ?? "…"}</span> —
        the owner account's timezone, editable from the{" "}
        <Link
          href="/owner-panel?tab=users"
          className="underline hover:text-foreground"
        >
          Users tab
        </Link>
        . The Send / Send All buttons above always run immediately, regardless
        of this schedule.
      </p>
    </div>
  );
}

function InfrastructureContent({
  status,
  loading,
  onReload,
}: {
  status: DbStatus | null;
  loading: boolean;
  onReload: () => void;
}) {
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const { toast } = useToast();

  async function handleBootstrap() {
    setShowConfirm(false);
    setBootstrapping(true);
    setBootstrapResult(null);
    try {
      // raw-fetch-ok — no Orval hook for owner-only admin endpoints
      const r = await fetch("/api/hub/bootstrap-schema", { method: "POST" });
      const d = (await r.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (d.ok) {
        setBootstrapResult({ ok: true, msg: d.message ?? "Done." });
        toast({ title: "Bootstrap succeeded", description: d.message });
      } else {
        setBootstrapResult({ ok: false, msg: d.error ?? "Failed." });
        toast({
          title: "Bootstrap failed",
          description: d.error,
          variant: "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error.";
      setBootstrapResult({ ok: false, msg });
      toast({
        title: "Bootstrap error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setBootstrapping(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Infrastructure</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live connectivity check for each database. Green means reachable right
          now — independent of which one the server is actively using.
        </p>
      </div>

      {/* DB connectivity card */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Supabase Connectivity</h3>
          </div>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {loading ? "Checking…" : "Re-check"}
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="h-14 rounded-md border border-border bg-muted/20 animate-pulse" />
            <div className="h-14 rounded-md border border-border bg-muted/20 animate-pulse" />
          </div>
        ) : !status ? (
          <p className="text-sm text-destructive">Could not fetch DB status.</p>
        ) : (
          <div className="space-y-2">
            <DbRow
              label="Production"
              url={status.prod.url}
              reachable={status.prod.reachable}
              configured={!!status.prod.url}
              isActive={status.activeTier === "prod"}
            />
            <DbRow
              label="Development"
              url={status.dev.url}
              reachable={status.dev.reachable}
              configured={status.dev.configured}
              isActive={status.activeTier === "dev"}
            />
            {!status.dev.configured && (
              <p className="text-xs text-muted-foreground pt-1">
                Set <code className="font-mono">DEV_SUPABASE_URL</code> and{" "}
                <code className="font-mono">DEV_SUPABASE_SERVICE_ROLE_KEY</code>{" "}
                in Replit Secrets to enable dev connectivity checks.
              </p>
            )}
            <p className="text-xs text-muted-foreground pt-1">
              {status.isDeployed
                ? "Running in deployed production environment."
                : "Running in Replit editor (development)."}
            </p>
          </div>
        )}
      </div>

      {/* Daily comms check card */}
      <CommCheckCard />

      {/* Comms check schedule */}
      <CommCheckScheduleCard />

      {/* Bootstrap card */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            Bootstrap Schema &amp; Buckets
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Runs <code className="font-mono">CREATE TABLE IF NOT EXISTS</code>{" "}
            and provisions all storage buckets on the{" "}
            <strong>currently-connected database</strong>. Safe to run multiple
            times — never drops or modifies existing data.
          </p>
        </div>

        {/* Confirmation prompt */}
        {showConfirm ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <TriangleAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {status?.isDeployed ? (
                  <>
                    <strong>This modifies the production database.</strong> It
                    runs additive-only migrations (
                    <code className="font-mono">
                      CREATE TABLE IF NOT EXISTS
                    </code>
                    ) — no existing data is touched — but you are about to
                    change the live Supabase schema. Confirm before proceeding.
                  </>
                ) : (
                  <>
                    This will run schema migrations on the connected database.
                    It is safe (additive-only), but confirm before proceeding.
                  </>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBootstrap}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Yes, run bootstrap
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={bootstrapping}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bootstrapping ? "Bootstrapping…" : "Bootstrap Schema & Buckets"}
          </button>
        )}

        {bootstrapResult && (
          <p
            className={`text-xs ${bootstrapResult.ok ? "text-green-600" : "text-destructive"}`}
          >
            {bootstrapResult.msg}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrations Health — live status checks for every connected external API.
// ---------------------------------------------------------------------------

type ServiceCheckStatus = "ok" | "missing_key" | "error";

interface ServiceCheckResult {
  service: string;
  status: ServiceCheckStatus;
  latencyMs?: number;
  detail?: string;
}

interface IntegrationsHealthResponse {
  checks: ServiceCheckResult[];
  cachedAt: string;
  fromCache: boolean;
}

const STATUS_META: Record<
  ServiceCheckStatus,
  {
    label: string;
    dotClass: string;
    badgeClass: string;
    icon: typeof CheckCircle2;
  }
> = {
  ok: {
    label: "Operational",
    dotClass: "bg-green-500",
    badgeClass: "bg-green-500/10 text-green-700 dark:text-green-400",
    icon: CheckCircle2,
  },
  missing_key: {
    label: "Not configured",
    dotClass: "bg-amber-400",
    badgeClass: "bg-amber-400/10 text-amber-700 dark:text-amber-400",
    icon: AlertTriangle,
  },
  error: {
    label: "Error",
    dotClass: "bg-destructive",
    badgeClass: "bg-destructive/10 text-destructive",
    icon: TriangleAlert,
  },
};

function IntegrationCard({ check }: { check: ServiceCheckResult }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[check.status];
  const StatusIcon = meta.icon;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`}
          />
          <span className="text-sm font-medium text-foreground truncate">
            {check.service}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {check.latencyMs !== undefined && check.status === "ok" && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              {check.latencyMs}ms
            </span>
          )}
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badgeClass}`}
          >
            <StatusIcon className="h-3 w-3" />
            {meta.label}
          </span>
        </div>
      </div>

      {check.status !== "ok" && check.detail && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {expanded ? "Hide detail" : "Show detail"}
          </button>
          {expanded && (
            <p className="mt-1.5 rounded bg-muted px-2 py-1.5 text-xs font-mono text-muted-foreground break-all">
              {check.detail}
            </p>
          )}
        </div>
      )}

      {check.status === "missing_key" && !check.detail && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Required environment variable / secret not set.
        </p>
      )}
    </div>
  );
}

function IntegrationsContent() {
  const [data, setData] = useState<IntegrationsHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const runChecks = useCallback(
    async (bust = false) => {
      setLoading(true);
      setError(null);
      try {
        if (bust) {
          // Clear cache first
          await fetch("/api/admin/integrations/health/bust", {
            // raw-fetch-ok
            method: "POST",
          });
        }
        const resp = await fetch("/api/admin/integrations/health"); // raw-fetch-ok
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
        const d = (await resp.json()) as IntegrationsHealthResponse;
        setData(d);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        toast({
          title: "Health check failed",
          description: msg,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const checks = data?.checks ?? [];
  const okCount = checks.filter((c) => c.status === "ok").length;
  const missingCount = checks.filter((c) => c.status === "missing_key").length;
  const errorCount = checks.filter((c) => c.status === "error").length;

  // Sort: errors first, then missing_key, then ok
  const sorted = [...checks].sort((a, b) => {
    const order = { error: 0, missing_key: 1, ok: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Integrations Health
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live connectivity check for every connected external API. Results are
          cached for 5 minutes — click{" "}
          <span className="font-medium text-foreground">Re-check</span> to force
          a fresh run.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {data && !loading && (
            <>
              {errorCount > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                  <TriangleAlert className="h-3 w-3" />
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </span>
              )}
              {missingCount > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {missingCount} not configured
                </span>
              )}
              {errorCount === 0 && missingCount === 0 && (
                <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  All {okCount} services operational
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {data?.cachedAt && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {data.fromCache ? "Cached" : "Checked"}{" "}
              {new Date(data.cachedAt).toLocaleTimeString()}
            </span>
          )}
          {!data ? (
            <button
              type="button"
              onClick={() => void runChecks(false)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Run checks
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runChecks(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Re-check
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-lg border border-border bg-muted/20 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Results grid */}
      {!loading && sorted.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((check) => (
            <IntegrationCard key={check.service} check={check} />
          ))}
        </div>
      )}

      {/* Empty / not-yet-run state */}
      {!loading && !data && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Activity className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">
            No results yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Click <span className="font-medium">Run checks</span> to ping all
            connected services.
          </p>
        </div>
      )}
    </div>
  );
}
