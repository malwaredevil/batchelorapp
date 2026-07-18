import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  ShoppingCart,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useListPatternAnalyses,
  useRunPatternAnalysis,
  useApplyPatternAnalysis,
  getListPatternAnalysesQueryKey,
  type QuiltingQuiltingAnalysis,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type ShoppingItem = {
  role: string;
  colorDescription: string | null;
  quantityYards: number | null;
  quantityFatQuarters: number | null;
  stashMatch: "full" | "partial" | "none" | null;
  matchedFabricIds: number[];
  suggestedSearchQuery: string | null;
};

function ReadinessBadge({
  readiness,
}: {
  readiness: QuiltingQuiltingAnalysis["readiness"];
}) {
  if (!readiness) return null;
  const map: Record<
    string,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    ready: {
      label: "Ready to make",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    partial: {
      label: "Partially ready",
      className:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    shopping_needed: {
      label: "Shopping needed",
      className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      icon: <ShoppingCart className="h-3 w-3" />,
    },
    unknown: {
      label: "Unknown",
      className: "bg-muted text-muted-foreground",
      icon: null,
    },
  };
  const m = map[readiness] ?? map["unknown"]!;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${m.className}`}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

function StashMatchDot({ match }: { match: ShoppingItem["stashMatch"] }) {
  if (match === "full")
    return (
      <span className="h-2 w-2 rounded-full bg-green-500 inline-block shrink-0 mt-1" />
    );
  if (match === "partial")
    return (
      <span className="h-2 w-2 rounded-full bg-yellow-500 inline-block shrink-0 mt-1" />
    );
  return (
    <span className="h-2 w-2 rounded-full bg-red-400 inline-block shrink-0 mt-1" />
  );
}

export function PatternAnalysisPanel({ patternId }: { patternId: number }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: analyses } = useListPatternAnalyses(patternId, {
    query: {
      queryKey: getListPatternAnalysesQueryKey(patternId),
    },
  });

  const runAnalysis = useRunPatternAnalysis({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getListPatternAnalysesQueryKey(patternId),
        });
        setExpanded(true);
        const poll = setInterval(() => {
          void queryClient.invalidateQueries({
            queryKey: getListPatternAnalysesQueryKey(patternId),
          });
        }, 3000);
        setTimeout(() => clearInterval(poll), 90_000);
      },
      onError: () => toast.error("Failed to start analysis"),
    },
  });

  const applyAnalysis = useApplyPatternAnalysis({
    mutation: {
      onSuccess: (data: unknown) => {
        const d = data as { added?: number } | undefined;
        toast.success(`Added ${d?.added ?? 0} items to shopping list`);
      },
      onError: () => toast.error("Failed to add items"),
    },
  });

  const analysesArr = Array.isArray(analyses)
    ? (analyses as QuiltingQuiltingAnalysis[])
    : [];
  const latest = analysesArr.length > 0 ? analysesArr[0] : null;
  const isRunning = latest?.status === "running" || runAnalysis.isPending;
  const shoppingItems: ShoppingItem[] =
    latest?.status === "done"
      ? ((latest.shoppingProposal ?? []) as ShoppingItem[])
      : [];
  const needsShopping = shoppingItems.some((i) => i.stashMatch !== "full");

  return (
    <section className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Can I Make This?
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runAnalysis.mutate({ id: patternId, data: {} })}
            disabled={isRunning}
            className="h-7 px-2.5 text-xs"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            {isRunning ? "Analysing…" : "Analyse"}
          </Button>
          {latest && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {!latest && !isRunning && (
        <p className="mt-2 text-xs text-muted-foreground italic">
          Check your stash against this pattern's fabric requirements.
        </p>
      )}

      {isRunning && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Checking your stash… this may take a moment.
        </div>
      )}

      {latest?.status === "done" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ReadinessBadge readiness={latest.readiness} />
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              {shoppingItems.length} fabric
              {shoppingItems.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {latest?.stashMatchSummary && !expanded && (
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
          {latest.stashMatchSummary}
        </p>
      )}

      {expanded && latest?.status === "done" && (
        <div className="mt-3 space-y-3">
          {latest.stashMatchSummary && (
            <p className="text-sm text-muted-foreground">
              {latest.stashMatchSummary}
            </p>
          )}

          {shoppingItems.length > 0 && (
            <div className="space-y-1.5">
              {shoppingItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg bg-background p-2.5 border border-card-border"
                >
                  <StashMatchDot match={item.stashMatch} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium capitalize">
                      {item.role}
                      {item.colorDescription && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          ({item.colorDescription})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantityYards != null &&
                        `${item.quantityYards} yds`}
                      {item.quantityYards != null &&
                        item.quantityFatQuarters != null &&
                        " · "}
                      {item.quantityFatQuarters != null &&
                        `${item.quantityFatQuarters} FQs`}
                    </p>
                  </div>
                  {item.stashMatch !== "full" && (
                    <span className="text-[10px] bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 shrink-0">
                      {item.stashMatch === "partial" ? "partial" : "needed"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {needsShopping && latest && (
            <Button
              variant="default"
              size="sm"
              className="w-full h-8 text-xs"
              disabled={applyAnalysis.isPending}
              onClick={() =>
                applyAnalysis.mutate({
                  id: patternId,
                  analysisId: latest.id,
                  data: {},
                })
              }
            >
              {applyAnalysis.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1" />
              )}
              Add missing fabrics to shopping list
            </Button>
          )}

          <p className="text-[10px] text-muted-foreground">
            Analysed{" "}
            {new Date(latest.createdAt as string).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        </div>
      )}

      {expanded && latest?.status === "failed" && (
        <p className="mt-2 text-xs text-destructive">
          Analysis failed. Try again.
        </p>
      )}
    </section>
  );
}
