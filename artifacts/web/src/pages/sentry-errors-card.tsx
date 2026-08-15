/**
 * SentryErrorsCard — Owner Panel (Infrastructure tab) card listing current
 * unresolved Sentry issues, with a Production/Development environment toggle
 * and per-issue links out to sentry.io. Shows a friendly "not configured"
 * state when the Sentry API credentials are missing server-side.
 */
import { useState, useEffect, useCallback } from "react";

export interface SentryIssueRow {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  status: string;
}

export interface SentryIssuesResponse {
  configured: boolean;
  environment: "production" | "development";
  issues: SentryIssueRow[];
}

const LEVEL_CLASSES: Record<string, string> = {
  fatal: "bg-destructive/15 text-destructive",
  error: "bg-destructive/10 text-destructive",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  info: "bg-muted text-muted-foreground",
};

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function SentryErrorsCard() {
  const [environment, setEnvironment] = useState<"production" | "development">(
    "production",
  );
  const [data, setData] = useState<SentryIssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((env: "production" | "development") => {
    setLoading(true);
    setError(null);
    // raw-fetch-ok — owner-only admin panel; no generated hook for this endpoint
    fetch(`/api/admin/sentry/issues?environment=${env}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<SentryIssuesResponse>;
      })
      .then((d) => setData(d))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(environment);
  }, [environment, load]);

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Sentry Errors</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["production", "development"] as const).map((env) => (
              <button
                key={env}
                type="button"
                onClick={() => setEnvironment(env)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  environment === env
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {env === "production" ? "Production" : "Development"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => load(environment)}
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          Could not load Sentry issues: {error}
        </div>
      )}

      {loading && !error && (
        <div className="space-y-2">
          <div className="h-12 rounded-md border border-border bg-muted/20 animate-pulse" />
          <div className="h-12 rounded-md border border-border bg-muted/20 animate-pulse" />
        </div>
      )}

      {!loading && !error && data && !data.configured && (
        <p className="text-sm text-muted-foreground">
          Sentry issue monitoring isn&apos;t configured. Set{" "}
          <code className="font-mono text-xs">SENTRY_AUTH_TOKEN</code>,{" "}
          <code className="font-mono text-xs">SENTRY_ORG_SLUG</code>, and{" "}
          <code className="font-mono text-xs">SENTRY_PROJECT_SLUG</code> in
          Replit Secrets to enable it.
        </p>
      )}

      {!loading &&
        !error &&
        data?.configured &&
        (data.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No unresolved {data.environment} issues. 🎉
          </p>
        ) : (
          <ul className="space-y-2">
            {data.issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-md border border-border p-3 space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">
                      {issue.title}
                    </p>
                    {issue.culprit && (
                      <p className="text-xs text-muted-foreground font-mono break-all">
                        {issue.culprit}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      LEVEL_CLASSES[issue.level] ??
                      "bg-muted text-muted-foreground"
                    }`}
                  >
                    {issue.level}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {issue.count} event{issue.count === 1 ? "" : "s"}
                  </span>
                  <span>First seen {formatWhen(issue.firstSeen)}</span>
                  <span>Last seen {formatWhen(issue.lastSeen)}</span>
                  {issue.permalink && (
                    <a
                      href={issue.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      View on sentry.io →
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
