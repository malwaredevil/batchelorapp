import { Link, Redirect } from "wouter";
import { useGetJobsHealth, useListJobs } from "@workspace/api-client-react";
import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

function value(row: Record<string, unknown>, key: string): string {
  const raw = row[key];
  return raw === null || raw === undefined ? "—" : String(raw);
}

export default function JobsDashboard() {
  const { user } = useAuth();
  const jobs = useListJobs({ limit: 50 });
  const health = useGetJobsHealth();

  if (!user?.isOwner) return <Redirect to="/" />;

  const jobRows = (jobs.data?.jobs ?? []) as Record<string, unknown>[];
  const healthRow = (health.data ?? {}) as Record<string, unknown>;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AppLogo className="h-10 w-10" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Durable jobs
              </h1>
              <p className="text-sm text-muted-foreground">
                Owner-only queue health, active work, retries, and dead letters.
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

        <section className="grid gap-3 sm:grid-cols-4">
          {[
            "queued_count",
            "running_count",
            "dead_letter_count",
            "oldest_queued_at",
          ].map((key) => (
            <div key={key} className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {key.replace(/_/g, " ")}
              </p>
              <p className="mt-2 text-lg font-semibold">
                {value(healthRow, key)}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <BriefcaseBusiness className="h-4 w-4" />
              Recent jobs
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Queue</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Progress</th>
                  <th className="px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {jobRows.map((job) => (
                  <tr key={value(job, "id")} className="border-t">
                    <td className="px-4 py-2 font-mono">{value(job, "id")}</td>
                    <td className="px-4 py-2">{value(job, "type")}</td>
                    <td className="px-4 py-2">{value(job, "queue")}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{value(job, "status")}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      {value(job, "progress_percent")}%
                    </td>
                    <td className="px-4 py-2">{value(job, "updated_at")}</td>
                  </tr>
                ))}
                {jobRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                      No jobs recorded yet.
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
