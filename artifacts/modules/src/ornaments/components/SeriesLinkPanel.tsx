import { useState } from "react";
import {
  Link2,
  Link2Off,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useListOrnamentCanonicalSeries,
  useGetOrnamentCanonicalSeries,
  useGetOrnamentSeriesLink,
  useLinkOrnamentToSeries,
  useUnlinkOrnamentFromSeries,
  getGetOrnamentSeriesLinkQueryKey,
  getListOrnamentCanonicalSeriesQueryKey,
  getGetOrnamentCanonicalSeriesQueryKey,
  type OrnamentsOrnamentSeries,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

type SeriesEntry = {
  id: number;
  seriesId: number;
  catalogNumber: string | null;
  year: number | null;
  name: string | null;
};

type LinkData = {
  seriesName?: string;
  seriesId?: number;
  catalogNumber?: string | null;
  year?: number | null;
  seriesEntryId?: number;
};

export function SeriesLinkPanel({ itemId }: { itemId: number }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);

  const { data: seriesList, isLoading: loadingSeries } =
    useListOrnamentCanonicalSeries({
      query: {
        queryKey: getListOrnamentCanonicalSeriesQueryKey(),
        enabled: expanded,
      },
    });

  const { data: link, isLoading: loadingLink } = useGetOrnamentSeriesLink(
    itemId,
    {
      query: { queryKey: getGetOrnamentSeriesLinkQueryKey(itemId) },
    },
  );

  const linkMutation = useLinkOrnamentToSeries({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetOrnamentSeriesLinkQueryKey(itemId),
        });
        toast.success("Linked to series");
        setExpanded(false);
        setSelectedSeriesId(null);
        setSearchTerm("");
      },
      onError: () => toast.error("Failed to link"),
    },
  });

  const unlinkMutation = useUnlinkOrnamentFromSeries({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetOrnamentSeriesLinkQueryKey(itemId),
        });
        toast.success("Unlinked from series");
      },
      onError: () => toast.error("Failed to unlink"),
    },
  });

  const isLinked =
    link != null &&
    typeof link === "object" &&
    "seriesEntryId" in (link as object);
  const linkData = isLinked ? (link as LinkData) : null;

  const filtered = (
    seriesList as OrnamentsOrnamentSeries[] | undefined
  )?.filter(
    (s) =>
      !searchTerm ||
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ((s.brand ?? "") as string)
        .toLowerCase()
        .includes(searchTerm.toLowerCase()),
  );

  return (
    <section className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Series Link
        </p>
        <div className="flex items-center gap-2">
          {isLinked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => unlinkMutation.mutate({ id: itemId })}
              disabled={unlinkMutation.isPending}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            >
              {unlinkMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2Off className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
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
        </div>
      </div>

      {loadingLink ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : isLinked && linkData ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">
              {linkData.seriesName ?? "Series"}
            </p>
            <p className="text-xs text-muted-foreground">
              {[linkData.catalogNumber, linkData.year]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {linkData.seriesId && (
            <button
              onClick={() =>
                navigate(`/ornaments/canonical-series/${linkData.seriesId}`)
              }
              className="text-primary hover:text-primary/80 transition-colors"
              title="View series"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground italic">
          Not linked to a canonical series.
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            placeholder="Search series…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {loadingSeries ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
              {(filtered ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2 text-center">
                  No series found
                </p>
              ) : (
                (filtered ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      setSelectedSeriesId(
                        selectedSeriesId === s.id ? null : s.id,
                      )
                    }
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors border ${
                      selectedSeriesId === s.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <span className="font-medium">{s.name}</span>
                    {s.brand && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.brand as string}
                      </span>
                    )}
                    {s.entryCount != null && (
                      <Badge
                        variant="secondary"
                        className="ml-2 text-[10px] h-4 px-1"
                      >
                        {s.entryCount} entries
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
          {selectedSeriesId != null && (
            <SeriesEntryPicker
              seriesId={selectedSeriesId}
              onPick={(entryId) =>
                linkMutation.mutate({
                  id: itemId,
                  data: { seriesEntryId: entryId },
                })
              }
              isPending={linkMutation.isPending}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SeriesEntryPicker({
  seriesId,
  onPick,
  isPending,
}: {
  seriesId: number;
  onPick: (entryId: number) => void;
  isPending: boolean;
}) {
  const { data: detail, isLoading: loadingDetail } =
    useGetOrnamentCanonicalSeries(seriesId, {
      query: { queryKey: getGetOrnamentCanonicalSeriesQueryKey(seriesId) },
    });

  const entries: SeriesEntry[] =
    (detail as { entries?: SeriesEntry[] } | undefined)?.entries ?? [];

  if (loadingDetail) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading entries…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No entries in this series yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium">
        Select entry to link:
      </p>
      <div className="max-h-36 overflow-y-auto space-y-1">
        {entries.map((e) => (
          <button
            key={e.id}
            onClick={() => onPick(e.id)}
            disabled={isPending}
            className="w-full text-left rounded-lg border border-transparent hover:border-primary/50 hover:bg-primary/5 px-3 py-1.5 text-sm transition-colors flex items-center gap-2"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
            ) : (
              <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
            )}
            <span>
              {e.name ?? e.catalogNumber ?? `Entry #${e.id}`}
              {e.year && (
                <span className="text-muted-foreground"> ({e.year})</span>
              )}
              {e.catalogNumber && (
                <span className="text-muted-foreground text-xs">
                  {" "}
                  · {e.catalogNumber}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
