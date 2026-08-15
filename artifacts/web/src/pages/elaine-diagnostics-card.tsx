/**
 * ElaineDiagnosticsCard — inline trace-quality summary shown in the Global
 * Config tab of the owner panel.  Extracted into its own module so it can be
 * unit-tested in isolation from the full OwnerPanel page.
 */
import { useState, useEffect } from "react";

export interface ElaineTraceQuality {
  evaluatedTurns: number;
  healthyTurns: number;
  needsReviewTurns: number;
  failedTurns: number;
  turnsWithReplans: number;
  turnsWithMultiPathPlanning: number;
  turnsWithKnownPlanChoice: number;
  turnsWithNonDefaultPlanChosen: number;
  nonDefaultPlanChosenRate: number | null;
}

export interface ElaineDiagnosticsResponse {
  generatedAt: string;
  periodDays: number;
  traceQuality: ElaineTraceQuality;
}

export function ElaineDiagnosticsCard() {
  const [data, setData] = useState<ElaineDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    // raw-fetch-ok — owner-only admin panel; no generated hook for this endpoint
    fetch("/api/elaine/diagnostics")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<ElaineDiagnosticsResponse>;
      })
      .then((d) => setData(d))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tq = data?.traceQuality;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">
          Trace Quality{" "}
          {data && (
            <span className="ml-1 font-normal text-muted-foreground">
              (last {data.periodDays} days)
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={load}
          className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && tq && (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Evaluated turns</dt>
            <dd className="tabular-nums text-sm font-medium">
              {tq.evaluatedTurns}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">
              Healthy / needs review / failed
            </dt>
            <dd className="tabular-nums text-sm font-medium">
              <span className="text-green-600 dark:text-green-400">
                {tq.healthyTurns}
              </span>
              {" / "}
              <span className="text-yellow-600 dark:text-yellow-400">
                {tq.needsReviewTurns}
              </span>
              {" / "}
              <span className="text-destructive">{tq.failedTurns}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">
              Turns with replans
            </dt>
            <dd className="tabular-nums text-sm font-medium">
              {tq.turnsWithReplans}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              Multi-path planning
            </dt>
            <dd className="text-sm font-medium">
              {tq.turnsWithMultiPathPlanning === 0 ? (
                <span className="text-muted-foreground">
                  0 turns used it in this window
                </span>
              ) : (
                <>
                  {tq.turnsWithMultiPathPlanning} of {tq.evaluatedTurns} turns
                  used it
                  {" · "}
                  {tq.nonDefaultPlanChosenRate === null ? (
                    <span className="text-muted-foreground">
                      — (no multi-path turns in window)
                    </span>
                  ) : (
                    <span>
                      chose non-default{" "}
                      <span
                        className={
                          tq.nonDefaultPlanChosenRate >= 0.1
                            ? "text-green-600 dark:text-green-400"
                            : "text-muted-foreground"
                        }
                      >
                        {Math.round(tq.nonDefaultPlanChosenRate * 100)}%
                      </span>{" "}
                      of the time
                      {tq.turnsWithKnownPlanChoice <
                        tq.turnsWithMultiPathPlanning && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({tq.turnsWithKnownPlanChoice} of{" "}
                          {tq.turnsWithMultiPathPlanning} have a known choice)
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
