import { Link, Redirect } from "wouter";
import {
  useGetOperationsSummary,
  useListOperationBudgets,
  useListOperationEvents,
} from "@workspace/api-client-react";
import { Activity, ArrowLeft, DollarSign } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

function value(row: Record<string, unknown>, key: string): string {
  const raw = row[key];
  return raw === null || raw === undefined ? "—" : String(raw);
}

export default function OperationsDashboard() {
  const { user } = useAuth();
  const summary = useGetOperationsSummary();
  const events = useListOperationEvents({ limit: 25 });
  const budgets = useListOperationBudgets();

  if (!user?.isOwner) return <Redirect to="/" />;

  const providers = (summary.data?.providers ?? []) as Record<
    string,
    unknown
  >[];
  const eventRows = (events.data?.events ?? []) as Record<string, unknown>[];
  const budgetRows = (budgets.data?.budgets ?? []) as Record<string, unknown>[];

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AppLogo className="h-10 w-10" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Provider operations
              </h1>
              <p className="text-sm text-muted-foreground">
                Cost, latency, cache, reliability, and budget telemetry.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/control-panel">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Control Panel
            </Link>
          </Button>
        </div>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <DollarSign className="h-4 w-4" />
              Spend and latency by provider
            </h2>
            <div className="space-y-2">
              {providers.map((provider) => (
                <div
                  key={value(provider, "provider")}
                  className="rounded-md border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {value(provider, "provider")}
                    </span>
                    <Badge variant="outline">
                      ${value(provider, "spend_usd")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    p95 {value(provider, "p95_latency_ms")} ms ·{" "}
                    {value(provider, "non_success_events")} non-success events
                  </p>
                </div>
              ))}
              {providers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No provider telemetry recorded yet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 font-semibold">Budget policies</h2>
            <div className="space-y-2">
              {budgetRows.map((budget) => (
                <div
                  key={value(budget, "id")}
                  className="rounded-md border p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {value(budget, "scope")} {value(budget, "scope_value")}
                    </span>
                    <Badge>{value(budget, "period")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Soft ${value(budget, "soft_threshold_usd")} · Hard $
                    {value(budget, "hard_threshold_usd")} ·{" "}
                    {value(budget, "degradation_action")}
                  </p>
                </div>
              ))}
              {budgetRows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No budget policies configured.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <Activity className="h-4 w-4" />
              Recent sanitized events
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Operation</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Cache</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {eventRows.map((event) => (
                  <tr key={value(event, "id")} className="border-t">
                    <td className="px-4 py-2">{value(event, "provider")}</td>
                    <td className="px-4 py-2">{value(event, "operation")}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{value(event, "status")}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      {value(event, "cache_status")}
                    </td>
                    <td className="px-4 py-2">
                      {value(event, "duration_ms")} ms
                    </td>
                    <td className="px-4 py-2">{value(event, "created_at")}</td>
                  </tr>
                ))}
                {eventRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                      No external operation events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
