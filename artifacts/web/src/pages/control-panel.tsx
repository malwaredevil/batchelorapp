import { useState } from "react";
import { Link, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAppConfig,
  useUpdateAppConfigValue,
  getGetAppConfigQueryKey,
  type ConfigAppConfigRow,
  type ConfigAppConfigListResponse,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  DatabaseZap,
  Loader2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppLogo } from "@/components/app-logo";
import { useAuth } from "@/lib/auth";
import { usePageAssistantContext } from "@/lib/assistant-context";

const MODULE_LABELS: Record<string, string> = {
  web_search: "Web Search",
  openrouter: "OpenRouter",
  ornaments: "Ornaments",
  quilting: "Quilting",
  travels: "Travels",
};

function moduleLabel(mod: string): string {
  return (
    MODULE_LABELS[mod] ??
    mod.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function validateValue(row: ConfigAppConfigRow, raw: string): string | null {
  if (raw.trim() === "") return "Value cannot be empty.";
  if (row.type === "integer") {
    const n = parseInt(raw, 10);
    if (isNaN(n) || String(n) !== raw.trim()) return "Must be a whole number.";
    if (n < 0) return "Must be ≥ 0.";
  } else if (row.type === "float") {
    const n = parseFloat(raw);
    if (isNaN(n)) return "Must be a number.";
    if (n < 0) return "Must be ≥ 0.";
  } else if (row.type === "boolean") {
    if (raw !== "true" && raw !== "false") return 'Must be "true" or "false".';
  }
  return null;
}

function isCustomised(row: ConfigAppConfigRow): boolean {
  return row.customisedAt !== null && row.customisedAt !== undefined;
}

function isEffectivelyCustomised(row: ConfigAppConfigRow): boolean {
  return isCustomised(row) && row.value !== row.defaultValue;
}

function ConfigRow({ row }: { row: ConfigAppConfigRow }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.value);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const customised = isCustomised(row);
  const valueMatchesDefault = row.value === row.defaultValue;

  const update = useUpdateAppConfigValue({
    mutation: {
      onSuccess: (result, variables) => {
        const updatedRow = result.config;
        const isReset = variables.data.value === row.defaultValue;
        queryClient.setQueryData<ConfigAppConfigListResponse>(
          getGetAppConfigQueryKey(),
          (old) => {
            if (!old) return old;
            return {
              ...old,
              config: old.config.map((r) =>
                r.module === updatedRow.module && r.key === updatedRow.key
                  ? isReset
                    ? { ...updatedRow, customisedAt: null }
                    : updatedRow
                  : r,
              ),
            };
          },
        );
        void queryClient.invalidateQueries({
          queryKey: getGetAppConfigQueryKey(),
        });
        toast.success(`"${row.label}" updated.`);
        setEditing(false);
        setValidationError(null);
      },
      onError: () => {
        toast.error(`Could not update "${row.label}".`);
      },
    },
  });

  function startEdit() {
    setDraft(row.value);
    setValidationError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(row.value);
    setValidationError(null);
    setEditing(false);
  }

  function handleSave() {
    const err = validateValue(row, draft);
    if (err) {
      setValidationError(err);
      return;
    }
    update.mutate({
      module: row.module,
      key: row.key,
      data: { value: draft.trim() },
    });
  }

  function handleResetClick() {
    if (!row.defaultValue) return;
    setConfirmingReset(true);
  }

  function handleResetConfirm() {
    if (!row.defaultValue) return;
    update.mutate({
      module: row.module,
      key: row.key,
      data: { value: row.defaultValue },
    });
    setConfirmingReset(false);
  }

  function handleResetCancel() {
    setConfirmingReset(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") cancelEdit();
  }

  return (
    <div
      className={[
        "rounded-lg border bg-card px-4 py-4 transition-colors",
        row.orphaned
          ? "border-red-400/60 dark:border-red-500/50"
          : customised && !valueMatchesDefault
            ? "border-amber-400/60 dark:border-amber-500/50"
            : "border-border",
      ].join(" ")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{row.label}</span>
            <Badge variant="outline" className="text-[10px] font-mono">
              {row.type}
            </Badge>
            {customised && (
              <span
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  valueMatchesDefault
                    ? "bg-muted text-muted-foreground"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                ].join(" ")}
                title={
                  valueMatchesDefault
                    ? `Previously customised — value already matches the default (${row.defaultValue})`
                    : `Default: ${row.defaultValue}`
                }
              >
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    valueMatchesDefault
                      ? "bg-muted-foreground/50"
                      : "bg-amber-500",
                  ].join(" ")}
                />
                customised
              </span>
            )}
            {row.orphaned && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"
                title="This key has no matching default — it may be a stale orphaned row from a renamed or removed config entry."
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                orphaned
              </span>
            )}
          </div>
          {row.description && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              {row.description}
            </p>
          )}
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
            {row.module}.{row.key}
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 sm:items-end sm:min-w-[200px]">
          {editing ? (
            <>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 w-40 font-mono text-sm"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setValidationError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  aria-invalid={!!validationError}
                />
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 w-8 p-0"
                  onClick={handleSave}
                  disabled={update.isPending}
                  title="Save"
                >
                  {update.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={cancelEdit}
                  disabled={update.isPending}
                  title="Cancel"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
              {row.defaultValue !== null && (
                <p className="text-[11px] text-muted-foreground">
                  Default:{" "}
                  <span className="font-mono text-muted-foreground/80">
                    {row.defaultValue}
                  </span>
                </p>
              )}
              {validationError && (
                <p className="text-xs text-destructive">{validationError}</p>
              )}
            </>
          ) : confirmingReset ? (
            <div className="flex flex-col gap-1.5 items-end">
              <p className="text-xs text-muted-foreground">
                Reset to default?{" "}
                <span className="font-mono text-muted-foreground/80">
                  {row.defaultValue}
                </span>
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 px-2.5 text-xs gap-1"
                  onClick={handleResetConfirm}
                  disabled={update.isPending}
                >
                  {update.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Confirm reset
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs gap-1"
                  onClick={handleResetCancel}
                  disabled={update.isPending}
                >
                  <X className="h-3 w-3" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={startEdit}
                className={[
                  "rounded-md border bg-muted/40 px-3 py-1 font-mono text-sm transition-colors hover:bg-muted text-left",
                  customised
                    ? "border-amber-400/50 hover:border-amber-400/80 dark:border-amber-500/40 dark:hover:border-amber-500/70"
                    : "border-border hover:border-primary/40",
                ].join(" ")}
                title="Click to edit"
              >
                {row.value}
              </button>
              {customised && !valueMatchesDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-900/30"
                  onClick={handleResetClick}
                  disabled={update.isPending}
                  title={`Reset to default (${row.defaultValue})`}
                >
                  {update.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModuleSection({
  module,
  rows,
}: {
  module: string;
  rows: ConfigAppConfigRow[];
}) {
  const customisedCount = rows.filter(isEffectivelyCustomised).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {moduleLabel(module)}
        </h2>
        {customisedCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {customisedCount} customised
          </span>
        )}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <ConfigRow key={`${row.module}.${row.key}`} row={row} />
        ))}
      </div>
    </div>
  );
}

const POLL_INTERVAL_MS = 30_000;

function DbReconnectingBanner({
  bootstrapRetryAt,
  onDismiss,
}: {
  bootstrapRetryAt?: string | null;
  onDismiss: () => void;
}) {
  const retryTime = bootstrapRetryAt ? new Date(bootstrapRetryAt) : null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1 leading-relaxed">
        <span className="font-semibold">DB reconnecting…</span> The server
        started without database access and is running on hardcoded fallbacks.
        Config rows may not be seeded yet — values shown may not reflect your
        saved settings.
        {retryTime && (
          <>
            {" "}
            Automatic retry scheduled for{" "}
            <span className="font-mono" title={retryTime.toLocaleString()}>
              {retryTime.toLocaleTimeString()}
            </span>
            .
          </>
        )}{" "}
        This banner disappears automatically once the connection is restored.
      </div>
      <button
        onClick={onDismiss}
        className="ml-1 shrink-0 rounded p-0.5 text-amber-600 transition-colors hover:bg-amber-200/60 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-800/40 dark:hover:text-amber-200"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ControlPanelContent() {
  const { user } = useAuth();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { data, isLoading, isError, isFetching } = useGetAppConfig({
    query: {
      queryKey: getGetAppConfigQueryKey(),
      refetchInterval: POLL_INTERVAL_MS,
    },
  });

  const bootstrapStatus = data?.bootstrapStatus;
  const showReconnectBanner = !bannerDismissed && bootstrapStatus === "warn";

  const configContextText = isLoading
    ? "Configuration is still loading."
    : isError
      ? "Configuration failed to load."
      : (data?.config ?? []).length === 0
        ? "No configuration keys found."
        : (data?.config ?? [])
            .map((row) => {
              const effectively = isEffectivelyCustomised(row);
              const orphanedNote = row.orphaned
                ? " [ORPHANED — no matching default]"
                : "";
              return `[${row.module}] ${row.key} (${row.label}, ${row.type}): value=${row.value}${effectively ? ` [customised; default: ${row.defaultValue}]` : " [at default]"}${orphanedNote}`;
            })
            .join("\n");

  usePageAssistantContext(
    "hub-control-panel",
    `On the Control Panel page (owner-only). To change any setting use the update_app_config action with the module and key shown below. Current app_config settings:\n${configContextText}`,
  );

  if (!isLoading && !user?.isOwner) {
    return <Redirect to="/" />;
  }

  const grouped = (data?.config ?? []).reduce<
    Record<string, ConfigAppConfigRow[]>
  >((acc, row) => {
    if (!acc[row.module]) acc[row.module] = [];
    acc[row.module].push(row);
    return acc;
  }, {});

  const modules = Object.keys(grouped).sort();
  const totalCustomised = (data?.config ?? []).filter(
    isEffectivelyCustomised,
  ).length;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-bold tracking-tight">Control Panel</h2>
          {totalCustomised > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {totalCustomised} customised
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tune AI timeouts, token limits, and other runtime settings without a
          code change. Click any value to edit it inline.{" "}
          {totalCustomised > 0
            ? "Amber rows have been changed from their defaults — use the reset button to restore."
            : "All values are at their defaults."}
        </p>
      </div>

      {showReconnectBanner && (
        <DbReconnectingBanner
          bootstrapRetryAt={data?.bootstrapRetryAt}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load configuration. Please try refreshing the page.
        </div>
      )}

      {!isLoading && !isError && modules.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No configuration keys found.
        </p>
      )}

      {modules.map((mod) => (
        <ModuleSection key={mod} module={mod} rows={grouped[mod]} />
      ))}

      <div className="border-t border-border pt-4 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw
            className={[
              "h-3 w-3",
              isFetching && !isLoading ? "animate-spin" : "",
            ].join(" ")}
          />
          {data?.bootstrappedAt ? (
            <span>
              Server last bootstrapped{" "}
              <span
                className="font-mono"
                title={new Date(data.bootstrappedAt).toLocaleString()}
              >
                {new Date(data.bootstrappedAt).toLocaleTimeString()}
              </span>{" "}
              — config refreshes every 30 s.
            </span>
          ) : (
            <span>Config refreshes every 30 s.</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Changes take effect within 30 seconds (server-side cache TTL).
          Security-critical limits (webhook body caps, rate limits) are
          hardcoded and cannot be changed here.
        </p>
      </div>
    </div>
  );
}

export default function ControlPanel() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur-md">
        <Link
          href="/owner-panel"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Owner Panel
        </Link>
        <div className="flex items-center gap-2">
          <AppLogo className="h-7 w-7" />
          <span className="font-semibold tracking-tight text-primary">
            Batchelor
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-6 md:p-8">
        <ControlPanelContent />
      </main>
    </div>
  );
}
