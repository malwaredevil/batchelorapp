import { useState } from "react";
import { Loader2, ChevronDown, ChevronUp, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useGetOrnamentIdentityResearch,
  useRunOrnamentIdentityResearch,
  useApplyOrnamentIdentityResearch,
  getGetOrnamentIdentityResearchQueryKey,
  getGetOrnamentQueryKey,
  type OrnamentsOrnamentIdentityResearch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type Candidate = {
  seriesName: string | null;
  year: number | null;
  brand: string | null;
  confidence: number;
  notes: string | null;
  catalogNumber: string | null;
};

function ConfidenceDot({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80
      ? "bg-green-500"
      : pct >= 50
        ? "bg-yellow-500"
        : "bg-muted-foreground/40";
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full inline-block ${color}`} />
      {pct}% confidence
    </span>
  );
}

export function IdentityResearchPanel({ itemId }: { itemId: number }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: jobs } = useGetOrnamentIdentityResearch(itemId, {
    query: {
      queryKey: getGetOrnamentIdentityResearchQueryKey(itemId),
      enabled: expanded,
    },
  });

  const runResearch = useRunOrnamentIdentityResearch({
    mutation: {
      onSuccess: () => {
        setExpanded(true);
        void queryClient.invalidateQueries({
          queryKey: getGetOrnamentIdentityResearchQueryKey(itemId),
        });
        const poll = setInterval(() => {
          void queryClient.invalidateQueries({
            queryKey: getGetOrnamentIdentityResearchQueryKey(itemId),
          });
        }, 3000);
        setTimeout(() => clearInterval(poll), 60_000);
      },
      onError: () => toast.error("Failed to start catalog research"),
    },
  });

  const applyResearch = useApplyOrnamentIdentityResearch({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetOrnamentQueryKey(itemId),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetOrnamentIdentityResearchQueryKey(itemId),
        });
        toast.success("Fields updated from catalog research");
      },
      onError: () => toast.error("Failed to apply"),
    },
  });

  const jobsArr = Array.isArray(jobs)
    ? (jobs as OrnamentsOrnamentIdentityResearch[])
    : [];
  const latestJob = jobsArr.length > 0 ? jobsArr[0] : null;
  const isRunning = latestJob?.status === "running" || runResearch.isPending;
  const candidates: Candidate[] =
    latestJob?.status === "done"
      ? ((latestJob.candidates ?? []) as Candidate[])
      : [];

  return (
    <section className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI Catalog Research
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Find official catalog numbers and confirm series details — applying
            a result updates the fields above.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runResearch.mutate({ id: itemId })}
            disabled={isRunning}
            className="h-7 px-2.5 text-xs"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            {isRunning ? "Researching…" : latestJob ? "Re-run" : "Run"}
          </Button>
          {latestJob && (
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

      {isRunning && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Searching Hallmark catalogs… up to 30 seconds.
        </div>
      )}

      {expanded && latestJob?.status === "failed" && (
        <p className="mt-2 text-xs text-destructive">
          Research failed. Try running again.
        </p>
      )}

      {expanded && candidates.length > 0 && latestJob && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {candidates.length} match
            {candidates.length !== 1 ? "es" : ""} found — tap one to update the
            fields above
          </p>
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() =>
                applyResearch.mutate({
                  id: itemId,
                  researchId: latestJob.id,
                  data: { candidateIndex: i },
                })
              }
              disabled={applyResearch.isPending}
              className="w-full text-left rounded-lg border border-border bg-background p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {c.seriesName ?? "Standalone"}
                    {c.year ? ` (${c.year})` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[c.brand, c.catalogNumber].filter(Boolean).join(" · ")}
                  </p>
                  {c.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-2">
                      {c.notes}
                    </p>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <ConfidenceDot confidence={c.confidence} />
                  <Check className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {latestJob?.status === "done" && candidates.length === 0 && expanded && (
        <p className="mt-2 text-xs text-muted-foreground italic">
          No catalog matches found. Try running again or edit the fields
          manually.
        </p>
      )}

      {latestJob?.status === "done" && (
        <div className="mt-2 flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px] h-5">
            Last run{" "}
            {new Date(latestJob.createdAt as string).toLocaleDateString()}
          </Badge>
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              View {candidates.length} match
              {candidates.length !== 1 ? "es" : ""}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
