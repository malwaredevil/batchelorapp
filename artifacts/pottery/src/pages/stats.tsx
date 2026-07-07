import { useMemo } from "react";
import {
  useListPottery,
  useGetCollectionStats,
} from "@workspace/api-client-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2, Package, Layers, TrendingUp } from "lucide-react";
import { colorToHex } from "@/lib/colors";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="rounded-full bg-primary/10 p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-card-border bg-background px-3 py-2 shadow-md text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{payload[0].value} piece{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const { data: items, isLoading: itemsLoading } = useListPottery();
  const { data: stats, isLoading: statsLoading } = useGetCollectionStats();

  const isLoading = itemsLoading || statsLoading;

  // ── Derived aggregates ─────────────────────────────────────────────────────

  const { timelineData, shapeData, uniqueCount } = useMemo(() => {
    if (!items) return { timelineData: [], shapeData: [], uniqueCount: 0 };

    const yearCounts = new Map<string, number>();
    const shapeCounts = new Map<string, number>();

    for (const item of items) {
      const qty = item.quantity ?? 1;

      if (item.acquiredAt) {
        const yr = item.acquiredAt.slice(0, 4);
        yearCounts.set(yr, (yearCounts.get(yr) ?? 0) + qty);
      }

      const rawShape = item.shape?.trim();
      const shape = rawShape
        ? rawShape.charAt(0).toUpperCase() + rawShape.slice(1).toLowerCase()
        : "Unknown";
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + qty);
    }

    const timelineData = [...yearCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, count]) => ({ year, count }));

    const shapeData = [...shapeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    return { timelineData, shapeData, uniqueCount: items.length };
  }, [items]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Collection Stats</h1>
        <p className="text-sm text-muted-foreground">
          Visual breakdown of your pottery collection
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total pieces"
          value={stats?.totalItems ?? 0}
          icon={Package}
        />
        <StatCard
          label="Unique items"
          value={uniqueCount}
          icon={Layers}
        />
        <StatCard
          label="Years tracked"
          value={timelineData.length}
          icon={TrendingUp}
        />
      </div>

      {/* Acquisition timeline */}
      {timelineData.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Pieces acquired by year</h2>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={timelineData}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              >
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="count"
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Top motifs */}
      {(stats?.topMotifs.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Top motifs</h2>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="space-y-2">
              {stats!.topMotifs.map((m, i) => {
                const max = stats!.topMotifs[0].count;
                const pct = max > 0 ? (m.count / max) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm capitalize">
                      {m.label}
                    </span>
                    <div className="relative flex-1 overflow-hidden rounded-full bg-muted h-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                      {m.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Shape distribution */}
      {shapeData.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Shape breakdown</h2>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="space-y-2">
              {shapeData.map((entry, i) => {
                const max = shapeData[0].value;
                const pct = max > 0 ? (entry.value / max) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm capitalize">
                      {entry.name}
                    </span>
                    <div className="relative flex-1 overflow-hidden rounded-full bg-muted h-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-violet-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                      {entry.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Colour palette */}
      {(stats?.topColors.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Glaze colour palette</h2>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="flex flex-wrap gap-2">
              {stats!.topColors.map((c, i) => {
                const hex = colorToHex(c.label);
                return (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1"
                    title={`${c.label} — ${c.count} piece${c.count !== 1 ? "s" : ""}`}
                  >
                    <div
                      className="h-10 w-10 rounded-full border border-black/10 shadow-sm"
                      style={{ backgroundColor: hex ?? "#e5e7eb" }}
                    />
                    <span className="text-[10px] text-muted-foreground capitalize max-w-[48px] text-center leading-tight">
                      {c.label}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground">
                      ×{c.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
