import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivitySquare,
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type DeletedItem = {
  entityType: string;
  entityId: number;
  entityLabel: string | null;
  deletedAt: string;
};

type ActivityLogItem = {
  id: number;
  occurredAt: string;
  actorChannel: string;
  actionType: string;
  entityType: string;
  entityId: number | null;
  entityLabel: string | null;
  reversible: boolean;
  reversedAt: string | null;
};

type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

const ENTITY_LABELS: Record<string, string> = {
  pottery_item: "Pottery",
  fabric: "Fabric",
  pattern: "Pattern",
  quilt: "Quilt",
  trip: "Trip",
  reminder: "Reminder",
  trip_photo: "Trip Photo",
  trip_document: "Document",
  ornament: "Ornament",
};

const ENTITY_COLORS: Record<string, string> = {
  pottery_item:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  fabric:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  pattern:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  quilt:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  trip: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  reminder: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  trip_photo: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  trip_document: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  ornament: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function entityLabel(type: string): string {
  return ENTITY_LABELS[type] ?? type;
}

function entityColor(type: string): string {
  return ENTITY_COLORS[type] ?? "bg-muted text-muted-foreground";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function actionLabel(actionType: string): string {
  return actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    web: "Web",
    elaine: "Elaine",
    agentphone: "AgentPhone",
    email: "Email",
    slack: "Slack",
  };
  return map[channel] ?? channel;
}

const PAGE_SIZE = 20;

function useRecycleBin(entityType: string, page: number) {
  return useQuery<PaginatedResponse<DeletedItem>>({
    queryKey: ["recycle-bin", entityType, page],
    queryFn: async () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (entityType !== "all") p.set("entityType", entityType);
      // raw-fetch-ok — recycle-bin page; no generated hook for this cross-app endpoint
      const res = await fetch(`/api/recycle-bin?${p.toString()}`);
      if (!res.ok) throw new Error("Failed to load recycle bin");
      return res.json() as Promise<PaginatedResponse<DeletedItem>>;
    },
  });
}

function useRecycleBinCount() {
  return useQuery<{ total: number; byType: Record<string, number> }>({
    queryKey: ["recycle-bin-count"],
    queryFn: async () => {
      // raw-fetch-ok — recycle-bin page; no generated hook for this cross-app endpoint
      const res = await fetch("/api/recycle-bin/count");
      if (!res.ok) throw new Error("Failed to load count");
      return res.json() as Promise<{
        total: number;
        byType: Record<string, number>;
      }>;
    },
  });
}

function useActivityLog(page: number) {
  return useQuery<PaginatedResponse<ActivityLogItem>>({
    queryKey: ["activity-log", page],
    queryFn: async () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      // raw-fetch-ok — recycle-bin page; no generated hook for this cross-app endpoint
      const res = await fetch(`/api/recycle-bin/activity-log?${p.toString()}`);
      if (!res.ok) throw new Error("Failed to load activity log");
      return res.json() as Promise<PaginatedResponse<ActivityLogItem>>;
    },
  });
}

function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      id,
    }: {
      entityType: string;
      id: number;
    }) => {
      const res = await fetch(
        `/api/recycle-bin/${encodeURIComponent(entityType)}/${id}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Restore failed");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recycle-bin"] });
      void qc.invalidateQueries({ queryKey: ["recycle-bin-count"] });
      void qc.invalidateQueries({ queryKey: ["activity-log"] });
    },
  });
}

function Pager({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">
        {page} / {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pottery_item", label: "Pottery" },
  { value: "fabric", label: "Fabrics" },
  { value: "pattern", label: "Patterns" },
  { value: "quilt", label: "Quilts" },
  { value: "trip", label: "Trips" },
  { value: "reminder", label: "Reminders" },
  { value: "trip_photo", label: "Photos" },
  { value: "trip_document", label: "Documents" },
  { value: "ornament", label: "Ornaments" },
];

function RecycleBinTab() {
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useRecycleBin(entityType, page);
  const restore = useRestore();

  function handleFilter(v: string) {
    setEntityType(v);
    setPage(1);
  }

  async function handleRestore(item: DeletedItem) {
    try {
      await restore.mutateAsync({
        entityType: item.entityType,
        id: item.entityId,
      });
      toast.success(`"${item.entityLabel ?? item.entityType}" restored`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleFilter(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              entityType === opt.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}
      {error && (
        <div className="py-12 text-center text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16">
          <Archive className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Nothing in the recycle bin
            {entityType !== "all" ? ` for ${entityLabel(entityType)}` : ""}.
          </p>
        </div>
      )}
      {data && data.items.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.total} item{data.total !== 1 ? "s" : ""} — permanently deleted
            after 30 days
          </p>
          <ul className="space-y-2">
            {data.items.map((item) => (
              <li
                key={`${item.entityType}-${item.entityId}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${entityColor(item.entityType)}`}
                    >
                      {entityLabel(item.entityType)}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {item.entityLabel ?? `#${item.entityId}`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Deleted {fmtDate(item.deletedAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRestore(item)}
                  disabled={restore.isPending}
                  className="shrink-0"
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
          <Pager
            page={data.page}
            total={data.total}
            pageSize={data.pageSize}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function ActivityLogTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useActivityLog(page);

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}
      {error && (
        <div className="py-12 text-center text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16">
          <ActivitySquare className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        </div>
      )}
      {data && data.items.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.total} action{data.total !== 1 ? "s" : ""} logged
          </p>
          <ul className="space-y-2">
            {data.items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {actionLabel(item.actionType)}
                      </span>
                      {item.entityLabel && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="max-w-[200px] truncate text-sm text-muted-foreground">
                            {item.entityLabel}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        via {channelLabel(item.actorChannel)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {fmtDate(item.occurredAt)}
                      </span>
                      {item.entityType && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${entityColor(item.entityType)}`}
                        >
                          {entityLabel(item.entityType)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {item.reversible && !item.reversedAt && (
                      <Badge variant="outline" className="text-xs">
                        Reversible
                      </Badge>
                    )}
                    {item.reversedAt && (
                      <Badge variant="secondary" className="text-xs">
                        Restored
                      </Badge>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pager
            page={data.page}
            total={data.total}
            pageSize={data.pageSize}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

type TabId = "recycle-bin" | "activity-log";

export default function RecycleBin() {
  const [activeTab, setActiveTab] = useState<TabId>("recycle-bin");
  const count = useRecycleBinCount();

  const tabs: {
    id: TabId;
    label: string;
    icon: typeof Trash2;
    badge?: number;
  }[] = [
    {
      id: "recycle-bin",
      label: "Recycle Bin",
      icon: Trash2,
      badge: count.data?.total,
    },
    { id: "activity-log", label: "Activity Log", icon: Clock },
  ];

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
          <h1 className="text-2xl font-semibold tracking-tight">
            Recycle Bin &amp; Activity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Restore recently deleted items or review household activity.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {tabs.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {badge != null && badge > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0.5 text-xs font-medium leading-none text-destructive-foreground">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "recycle-bin" && <RecycleBinTab />}
        {activeTab === "activity-log" && <ActivityLogTab />}
      </main>
    </div>
  );
}
