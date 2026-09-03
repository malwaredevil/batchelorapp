import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2,
  Wrench,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  StopCircle,
  Camera,
  Pencil,
} from "lucide-react";
import {
  useGetOrnamentStragglers,
  useBulkReanalyzeOrnaments,
  useApplyExistingOrnamentCategories,
  getGetOrnamentStragglersQueryKey,
  useListOrnaments,
  getListOrnamentsQueryKey,
  getListOrnamentCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { OrnamentsOrnamentItem as OrnamentItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import {
  formatElaineContextEntity,
  formatElaineContextList,
  useAppConfigSummary,
} from "@workspace/elaine-ui";
import { generateInsurancePdf } from "@/ornaments/lib/pdf-export";
import { InsuranceExportCard } from "@/components/insurance-export-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  isAsyncActionBusy,
  useBulkReanalyzeRun,
} from "@workspace/collection-ui";
import { ornamentReanalyzeKey } from "@/ornaments/lib/reanalyze-status";
import {
  getOrnamentMaintenanceRepairHref,
  ornamentMaintenanceReasonLabels,
} from "@/ornaments/lib/maintenance-repair";

type ReanalysisOutcome = {
  status: "refreshed" | "needs_evidence" | "failed";
  unresolvedFields: string[];
  recommendation: string | null;
  error?: string;
};

export default function Maintenance() {
  const { data: stragglers, isLoading } = useGetOrnamentStragglers();
  const { data: listData } = useListOrnaments({ pageSize: 200 });
  const bulkReanalyze = useBulkReanalyzeOrnaments();
  const applyExistingCategories = useApplyExistingOrnamentCategories();
  const queryClient = useQueryClient();

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<string | null>(null);
  const [categorySummary, setCategorySummary] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, ReanalysisOutcome>>(
    {},
  );
  const processingRef = useRef(false);
  const stopRequestedRef = useRef(false);

  const items = stragglers?.items || [];

  const bulkRun = useBulkReanalyzeRun({
    mutateAsync: bulkReanalyze.mutateAsync,
    keyFor: ornamentReanalyzeKey,
    invalidate: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentStragglersQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getListOrnamentCategoriesQueryKey(),
        }),
      ]);
    },
    // This page presents one cumulative status for its sequential batches.
    onSettled: () => undefined,
    onFailed: () => undefined,
  });

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "ornaments-maintenance",
    `Maintenance page. Shows items missing a search embedding, series/collection, or release year. Currently ${items.length} items need attention.${
      items.length > 0
        ? ` ${formatElaineContextList(items, {
            label: "Items needing attention (itemId — reason)",
            limit: 30,
            formatItem: (item) =>
              formatElaineContextEntity({
                entity: "item",
                id: item.id,
                label: "Needs attention",
                details: [
                  `status: ${item.status}`,
                  `missing: ${item.reasons.join(", ")}`,
                  `next evidence: ${item.recommendation}`,
                ],
              }),
          })}.`
        : ""
    }${configSummary ? ` ${configSummary}` : ""}`,
  );

  async function handleBulkReanalyze() {
    if (processingRef.current || items.length === 0) return;

    const requestedIds = [...new Set(items.map((item) => item.id))];
    const ids = requestedIds.filter(
      (id) => !isAsyncActionBusy(ornamentReanalyzeKey(id)),
    );
    const skippedBusy = requestedIds.length - ids.length;
    if (ids.length === 0) {
      toast.message("Those ornaments are already being refreshed.");
      return;
    }

    processingRef.current = true;
    stopRequestedRef.current = false;
    setIsProcessing(true);
    setSummary(null);
    setProgress({ done: 0, total: ids.length });

    const BATCH_SIZE = 2;
    let done = 0;
    let succeeded = 0;
    let needsEvidence = 0;
    let failed = 0;
    try {
      for (let index = 0; index < ids.length; index += BATCH_SIZE) {
        if (stopRequestedRef.current) {
          break;
        }

        const batch = ids.slice(index, index + BATCH_SIZE);
        const result = await bulkRun.run(batch);
        if (result) {
          succeeded += result.succeeded.length;
          failed += result.failed.length;
          const nextOutcomes: Record<number, ReanalysisOutcome> = {};
          for (const outcome of result.outcomes) {
            nextOutcomes[outcome.id] = outcome;
            if (outcome.status === "needs_evidence") needsEvidence += 1;
          }
          setOutcomes((current) => ({ ...current, ...nextOutcomes }));
        } else {
          // A network failure is already represented as per-item error states
          // by the shared lifecycle; retain it in the cumulative summary too.
          failed += batch.length;
          setOutcomes((current) => ({
            ...current,
            ...Object.fromEntries(
              batch.map((id) => [
                id,
                {
                  status: "failed" as const,
                  unresolvedFields: [],
                  recommendation: null,
                  error:
                    "The refresh request failed before analysis completed.",
                },
              ]),
            ),
          }));
        }
        done += batch.length;
        setProgress({ done, total: ids.length });
      }
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentStragglersQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getListOrnamentCategoriesQueryKey(),
        }),
      ]);
      const skipped = ids.length - done;
      const pieces = succeeded === 1 ? "item" : "items";
      const stopped = stopRequestedRef.current;
      setSummary(
        stopped
          ? `Stopped — ${succeeded} ${pieces} completed, ${skipped} skipped${needsEvidence ? `, ${needsEvidence} still need evidence` : ""}${failed ? `, ${failed} failed` : ""}.`
          : `${succeeded} ${pieces} completed${needsEvidence ? `, ${needsEvidence} still need evidence` : ""}${failed ? `, ${failed} failed` : ""}${skippedBusy ? `, ${skippedBusy} already in progress` : ""}.`,
      );
    }
  }

  async function handleApplyExistingCategories() {
    setCategorySummary(null);
    try {
      const result = await applyExistingCategories.mutateAsync();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getListOrnamentCategoriesQueryKey(),
        }),
      ]);
      const base = `Checked ${result.total} active ornament${result.total === 1 ? "" : "s"}: ${result.assignmentsCreated} assignment${result.assignmentsCreated === 1 ? "" : "s"} added`;
      const message = result.failed
        ? `${base}; ${result.failed} could not be completed. Retry safely to finish the remaining items.`
        : `${base}. Existing manual categories were kept.`;
      setCategorySummary(message);
      if (result.failed) toast.error(message);
      else toast.success(message);
    } catch {
      const message =
        "Could not apply existing categories. No categories were removed; try again safely.";
      setCategorySummary(message);
      toast.error(message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Maintenance
        </h1>
        <p className="text-muted-foreground mt-1">
          Keep your collection data rich and searchable
        </p>
      </div>

      <InsuranceExportCard
        items={listData?.items}
        generatePdf={generateInsurancePdf}
        itemNounPlural="ornaments"
        description="Download a PDF with photos and details of every ornament."
        variant="card"
      />

      <Card className="border-card-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 font-serif text-xl">
                <Wrench className="h-5 w-5 text-primary" />
                AI Re-analysis
              </CardTitle>
              <CardDescription className="mt-1.5">
                Refresh missing search embeddings and identity details. This
                checks only the series/collection and release year needed for
                reliable identification.
              </CardDescription>
            </div>

            {items.length > 0 ? (
              <div className="flex items-center gap-2 text-amber-600 bg-amber-500/10 px-3 py-1.5 rounded-full text-sm font-medium">
                <AlertCircle className="h-4 w-4" />
                {items.length} need attention
              </div>
            ) : (
              <div className="flex items-center gap-2 text-green-600 bg-green-500/10 px-3 py-1.5 rounded-full text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                All up to date
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {items.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                These items are missing a search embedding, series/collection,
                or release year. Refresh attempts keep locked fields unchanged.
              </p>

              <Button
                onClick={handleBulkReanalyze}
                disabled={isProcessing || bulkRun.isPending}
                className="gap-2"
              >
                {isProcessing || bulkRun.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Analyze {items.length} items
              </Button>

              {(isProcessing || summary) && (
                <div className="space-y-2 mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {isProcessing
                        ? `Refreshing ${progress.done} of ${progress.total}…`
                        : summary}
                    </span>
                    {isProcessing && (
                      <button
                        type="button"
                        onClick={() => {
                          stopRequestedRef.current = true;
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 font-medium hover:bg-destructive/10 hover:text-destructive"
                      >
                        <StopCircle className="h-3.5 w-3.5" />
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-card-border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-xl">
            <Wrench className="h-5 w-5 text-primary" />
            Apply existing categories
          </CardTitle>
          <CardDescription>
            Match the categories you already have against every active ornament.
            This does not create categories, remove manual choices, or run AI
            analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={handleApplyExistingCategories}
            disabled={applyExistingCategories.isPending}
            className="gap-2"
          >
            {applyExistingCategories.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {applyExistingCategories.isPending
              ? "Applying existing categories…"
              : "Apply to all active ornaments"}
          </Button>
          {categorySummary && (
            <p
              className={
                categorySummary.includes("could not")
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {categorySummary}
            </p>
          )}
        </CardContent>
      </Card>

      {items.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-foreground">
            Items needing attention
          </h2>
          <div className="rounded-xl border border-card-border bg-card overflow-hidden divide-y divide-card-border shadow-sm">
            {items.map((item) => {
              const outcome = outcomes[item.id];
              const unresolved =
                outcome?.status === "needs_evidence"
                  ? outcome.unresolvedFields
                  : item.reasons;
              const statusText =
                outcome?.status === "failed"
                  ? `Refresh failed: ${outcome.error ?? "try again."}`
                  : outcome?.status === "needs_evidence"
                    ? "Analysis completed, but the remaining fields could not be verified."
                    : "Pending refresh";
              const recommendation =
                outcome?.status === "needs_evidence"
                  ? outcome.recommendation
                  : item.recommendation;
              return (
                <div
                  key={item.id}
                  className="space-y-3 p-4 transition-colors hover:bg-muted/40"
                >
                  <Link
                    href={`/ornaments/ornament/${item.id}`}
                    className="flex items-center justify-between group"
                  >
                    <p className="font-medium">Ornament #{item.id}</p>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </Link>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Missing:{" "}
                      {unresolved
                        .map(
                          (reason) =>
                            ornamentMaintenanceReasonLabels[
                              reason as keyof typeof ornamentMaintenanceReasonLabels
                            ] ?? reason,
                        )
                        .join(", ")}
                    </p>
                    <p
                      className={
                        outcome?.status === "failed"
                          ? "text-xs text-destructive"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {statusText}
                    </p>
                    {recommendation && (
                      <p className="text-xs text-muted-foreground">
                        What would help: {recommendation}
                      </p>
                    )}
                  </div>
                  {unresolved.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {unresolved.map((reason) => (
                        <Link
                          key={reason}
                          href={getOrnamentMaintenanceRepairHref(
                            item.id,
                            unresolved,
                            reason,
                          )}
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                          data-testid={`repair-${item.id}-${reason}`}
                        >
                          {reason === "embedding" ? (
                            <Camera className="h-3.5 w-3.5" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                          {reason === "embedding"
                            ? "Add evidence photo"
                            : `Enter ${
                                ornamentMaintenanceReasonLabels[
                                  reason as keyof typeof ornamentMaintenanceReasonLabels
                                ] ?? reason
                              }`}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
