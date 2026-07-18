import { useState } from "react";
import { Loader2, Search, ChevronDown, ChevronUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useListFabricIdentityResearch,
  useRunFabricIdentityResearch,
  useApplyFabricIdentityResearch,
  getListFabricIdentityResearchQueryKey,
  getGetFabricQueryKey,
  type QuiltingFabricIdentityResearch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type Candidate = {
  manufacturer: string | null;
  designer: string | null;
  collection: string | null;
  sku: string | null;
  confidence: number;
  notes: string | null;
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
      {pct}%
    </span>
  );
}

export function FabricIdentityResearchPanel({
  fabricId,
}: {
  fabricId: number;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: jobs } = useListFabricIdentityResearch(fabricId, {
    query: {
      queryKey: getListFabricIdentityResearchQueryKey(fabricId),
      enabled: expanded,
    },
  });

  const runResearch = useRunFabricIdentityResearch({
    mutation: {
      onSuccess: () => {
        setExpanded(true);
        void queryClient.invalidateQueries({
          queryKey: getListFabricIdentityResearchQueryKey(fabricId),
        });
        const poll = setInterval(() => {
          void queryClient.invalidateQueries({
            queryKey: getListFabricIdentityResearchQueryKey(fabricId),
          });
        }, 3000);
        setTimeout(() => clearInterval(poll), 60_000);
      },
      onError: () => toast.error("Failed to start identity research"),
    },
  });

  const applyResearch = useApplyFabricIdentityResearch({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabricId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListFabricIdentityResearchQueryKey(fabricId),
        });
        toast.success("Applied to fabric");
      },
      onError: () => toast.error("Failed to apply"),
    },
  });

  const jobsArr = Array.isArray(jobs)
    ? (jobs as QuiltingFabricIdentityResearch[])
    : [];
  const latestJob = jobsArr.length > 0 ? jobsArr[0] : null;
  const isRunning = latestJob?.status === "running" || runResearch.isPending;
  const candidates: Candidate[] =
    latestJob?.status === "done"
      ? ((latestJob.candidates ?? []) as Candidate[])
      : [];

  return (
    <section className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Identity Research
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runResearch.mutate({ id: fabricId })}
            disabled={isRunning}
            className="h-7 px-2.5 text-xs"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Search className="h-3.5 w-3.5 mr-1" />
            )}
            {isRunning ? "Researching…" : "Research"}
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

      {!latestJob && !isRunning && (
        <p className="mt-2 text-xs text-muted-foreground italic">
          Run AI research to identify manufacturer, designer, and collection.
        </p>
      )}

      {isRunning && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Researching fabric identity…
        </div>
      )}

      {expanded && latestJob?.status === "failed" && (
        <p className="mt-2 text-xs text-destructive">
          Research failed. Try again.
        </p>
      )}

      {expanded && candidates.length > 0 && latestJob && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {candidates.length} candidate
            {candidates.length !== 1 ? "s" : ""} — click to apply
          </p>
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() =>
                applyResearch.mutate({
                  id: fabricId,
                  researchId: latestJob.id,
                  data: { candidateIndex: i },
                })
              }
              disabled={applyResearch.isPending}
              className="w-full text-left rounded-lg border border-card-border bg-background p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {[c.manufacturer, c.collection]
                      .filter(Boolean)
                      .join(" · ") || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[c.designer, c.sku].filter(Boolean).join(" · ")}
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
          No candidates found. Try running again with more details filled in.
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
              View {candidates.length} result
              {candidates.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
