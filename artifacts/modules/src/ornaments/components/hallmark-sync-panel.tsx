import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getHallmarkEventSyncStatusQueryKey,
  useGetHallmarkEventSyncStatus,
  useRunHallmarkEventSync,
  type HallmarkSyncAction,
  type HallmarkSyncCandidate,
  type HallmarkSyncRejected,
  type HallmarkSyncResult,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function fingerprintLabel(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return `${value.slice(0, 16)}…`;
}

function actionLabel(action: HallmarkSyncAction["action"]): string {
  return action === "unchanged"
    ? "Unchanged"
    : action.charAt(0).toUpperCase() + action.slice(1);
}

function actionClass(action: HallmarkSyncAction["action"]): string {
  switch (action) {
    case "create":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "update":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "delete":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function countActions(actions: HallmarkSyncAction[]) {
  return {
    create: actions.filter((action) => action.action === "create").length,
    update: actions.filter((action) => action.action === "update").length,
    delete: actions.filter((action) => action.action === "delete").length,
    unchanged: actions.filter((action) => action.action === "unchanged").length,
  };
}

function RejectedList({ rejected }: { rejected: HallmarkSyncRejected[] }) {
  if (rejected.length === 0) {
    return <p className="text-sm text-muted-foreground">None</p>;
  }

  return (
    <ul className="space-y-2">
      {rejected.map((item, index) => (
        <li
          key={`${item.sourceKey ?? item.title ?? "rejected"}-${index}`}
          className="rounded-lg border border-card-border/70 bg-muted/20 px-3 py-2 text-sm"
        >
          <p className="font-medium">
            {item.title ?? item.sourceKey ?? "Record"}
          </p>
          <p className="text-muted-foreground">{item.reason}</p>
        </li>
      ))}
    </ul>
  );
}

function CandidateList({
  candidates,
}: {
  candidates: HallmarkSyncCandidate[];
}) {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">None</p>;
  }

  return (
    <ul className="space-y-2">
      {candidates.map((candidate) => (
        <li
          key={candidate.sourceKey}
          className="rounded-lg border border-card-border/70 bg-muted/20 px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium">{candidate.title}</p>
            <span className="font-mono text-xs text-muted-foreground">
              {candidate.sourceKey}
            </span>
          </div>
          <p className="text-muted-foreground">
            {candidate.startDate} – {candidate.endDate}
          </p>
          {candidate.details && (
            <p className="mt-1 text-muted-foreground">{candidate.details}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function DryRunResult({ result }: { result: HallmarkSyncResult }) {
  const counts = useMemo(() => countActions(result.actions), [result.actions]);
  const plannedActions = result.actions.filter(
    (action) => action.action !== "unchanged",
  );

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div>
        <h3 className="font-medium">Dry-run result</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Fetched {formatTimestamp(result.fetchedAt)} · fingerprint{" "}
          {fingerprintLabel(result.sourceFingerprint)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(
          [
            ["Create", counts.create],
            ["Update", counts.update],
            ["Delete", counts.delete],
            ["Unchanged", counts.unchanged],
          ] as const
        ).map(([label, count]) => (
          <div key={label} className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">{count}</p>
          </div>
        ))}
      </div>
      {plannedActions.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Planned calendar changes</h4>
          <ul className="space-y-2">
            {plannedActions.map((action, index) => (
              <li
                key={`${action.action}-${action.sourceKey ?? action.eventId ?? index}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-card-border/60 bg-background px-3 py-2 text-sm"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${actionClass(action.action)}`}
                >
                  {actionLabel(action.action)}
                </span>
                <span className="font-medium">
                  {action.title ?? action.sourceKey ?? "Hallmark event"}
                </span>
                {action.startDate && action.endDate && (
                  <span className="text-muted-foreground">
                    {action.startDate} – {action.endDate}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No calendar changes are planned.
        </p>
      )}
      {result.rejected.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            Rejected records ({result.rejected.length})
          </h4>
          <RejectedList rejected={result.rejected} />
        </div>
      )}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">
          Candidates ({result.candidates.length})
        </h4>
        <CandidateList candidates={result.candidates} />
      </div>
    </div>
  );
}

export function HallmarkSyncPanel({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useGetHallmarkEventSyncStatus({
    query: {
      enabled: isOwner,
      retry: false,
      queryKey: getHallmarkEventSyncStatusQueryKey(),
    },
  });
  const runSync = useRunHallmarkEventSync();
  const [dryRunResult, setDryRunResult] = useState<HallmarkSyncResult | null>(
    null,
  );
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  if (!isOwner) return null;

  const counts = dryRunResult ? countActions(dryRunResult.actions) : null;

  const runDryRun = async () => {
    setDryRunResult(null);
    try {
      const result = await runSync.mutateAsync({ dryRun: true });
      setDryRunResult(result);
      await queryClient.invalidateQueries({
        queryKey: getHallmarkEventSyncStatusQueryKey(),
      });
      toast.success("Hallmark sync preview is ready");
    } catch {
      toast.error("Could not preview the Hallmark sync");
    }
  };

  const applySync = async () => {
    setConfirmApplyOpen(false);
    const reviewedFingerprint = dryRunResult?.sourceFingerprint;
    if (!reviewedFingerprint) {
      toast.error("Preview the Hallmark sync again before applying");
      return;
    }
    try {
      await runSync.mutateAsync({
        dryRun: false,
        sourceFingerprint: reviewedFingerprint,
      });
      setDryRunResult(null);
      await queryClient.invalidateQueries({
        queryKey: getHallmarkEventSyncStatusQueryKey(),
      });
      toast.success("Hallmark calendar sync applied");
    } catch (err) {
      const errorData = (err as { data?: unknown }).data;
      const stalePreview =
        err instanceof Error &&
        (err as { status?: number }).status === 409 &&
        typeof errorData === "object" &&
        errorData !== null &&
        (errorData as { code?: unknown }).code === "STALE_PREVIEW";
      if (stalePreview) {
        setDryRunResult(null);
        await queryClient.invalidateQueries({
          queryKey: getHallmarkEventSyncStatusQueryKey(),
        });
        toast.error(
          (errorData as { error?: string }).error ??
            "The Hallmark source changed. Preview the sync again before applying.",
        );
        return;
      }
      toast.error("Could not apply the Hallmark sync");
    }
  };

  const statusLabel =
    status?.lastStatus === "success"
      ? "Healthy"
      : status?.lastStatus === "error"
        ? "Needs attention"
        : status?.lastStatus === "dry_run"
          ? "Previewed"
          : "Not run yet";
  const statusClass =
    status?.lastStatus === "success"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
      : status?.lastStatus === "error"
        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
        : "bg-muted text-muted-foreground";

  return (
    <>
      <section className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Owner settings
            </p>
            <h2 className="mt-1 font-serif text-xl">Hallmark sync health</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Review the scanner before it changes the household calendar.
              Previewing is safe; applying changes creates, updates, or removes
              only scanner-owned events.
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>

        {isLoading ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sync health…
          </div>
        ) : isError ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
            Could not load Hallmark sync health.
          </div>
        ) : (
          <>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Last run</dt>
                <dd className="mt-0.5 font-medium">
                  {formatTimestamp(status?.lastRunAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last successful apply</dt>
                <dd className="mt-0.5 font-medium">
                  {formatTimestamp(status?.lastSuccessAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Source fingerprint</dt>
                <dd
                  className="mt-0.5 break-all font-mono text-xs"
                  title={status?.sourceFingerprint ?? undefined}
                >
                  {status?.sourceFingerprint ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Candidates</dt>
                <dd className="mt-0.5 font-medium">
                  {status?.candidateCount ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rejected records</dt>
                <dd className="mt-0.5 font-medium">
                  {status?.rejectedCount ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="mt-0.5 truncate" title={status?.sourceUrl}>
                  {status?.sourceUrl ?? "Not recorded"}
                </dd>
              </div>
            </dl>

            {status?.lastError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-900/20">
                <p className="font-medium text-red-800 dark:text-red-200">
                  Last error
                </p>
                <p className="mt-1 whitespace-pre-wrap text-red-700 dark:text-red-300">
                  {status.lastError}
                </p>
              </div>
            )}

            {status && status.rejected.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-medium">
                  Rejected records from the last run
                </h3>
                <RejectedList rejected={status.rejected} />
              </div>
            )}
            {status && (
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-medium">
                  Candidates from the last run ({status.candidates.length})
                </h3>
                <CandidateList candidates={status.candidates} />
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => void refetch()}
                disabled={runSync.isPending}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void runDryRun()}
                disabled={runSync.isPending}
              >
                {runSync.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Preview sync
              </Button>
              {dryRunResult && (
                <Button
                  type="button"
                  onClick={() => setConfirmApplyOpen(true)}
                  disabled={runSync.isPending}
                >
                  Apply preview
                </Button>
              )}
            </div>

            {dryRunResult && <DryRunResult result={dryRunResult} />}
          </>
        )}
      </section>

      <AlertDialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this Hallmark sync?</AlertDialogTitle>
            <AlertDialogDescription>
              This will apply the reviewed preview to the shared Hallmark
              calendar: {counts?.create ?? 0} create, {counts?.update ?? 0}{" "}
              update, and {counts?.delete ?? 0} delete action
              {(counts?.create ?? 0) +
                (counts?.update ?? 0) +
                (counts?.delete ?? 0) ===
              1
                ? ""
                : "s"}
              . Manual calendar events are not included.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep preview</AlertDialogCancel>
            <AlertDialogAction onClick={() => void applySync()}>
              Apply sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
