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
import { usePageAssistantContext } from "@/lib/assistant-context";

// ── Palette ───────────────────────────────────────────────────────────────────

const DONUT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a78bfa",
  "#c084fc",
  "#818cf8",
  "#4f46e5",
  "#7c3aed",
  "#9333ea",
];

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
      <p className="text-muted-foreground">
        {payload[0].value} piece{payload[0].value !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ── SVG Donut chart ───────────────────────────────────────────────────────────

interface DonutSegment {
  name: string;
  value: number;
  color: string;
}

function DonutChart({
  data,
  size = 180,
}: {
  data: DonutSegment[];
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 28;
  const r = (size - strokeWidth - 4) / 2;
  const circumference = 2 * Math.PI * r;

  let accumulated = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label="Shape breakdown donut chart"
    >
      {/* Background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={strokeWidth}
      />
      {data.map((seg, i) => {
        const pct = seg.value / total;
        const dash = pct * circumference - 1.5; // 1.5px gap between segments
        const gap = circumference - dash;
        const rotation = (accumulated / total) * 360 - 90;
        accumulated += seg.value;

        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${gap}`}
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
            }}
          >
            <title>
              {seg.name}: {seg.value} piece{seg.value !== 1 ? "s" : ""}
            </title>
          </circle>
        );
      })}
      {/* Centre label */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 22, fontWeight: 700, fill: "#111" }}
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 10, fill: "#6b7280" }}
      >
        pieces
      </text>
    </svg>
  );
}

// ── Horizontal bar row ────────────────────────────────────────────────────────

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-sm capitalize">{label}</span>
      <div className="relative flex-1 overflow-hidden rounded-full bg-muted h-3">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: color ?? "hsl(var(--primary))",
          }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

// ── Size bucketing ────────────────────────────────────────────────────────────

const SIZE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "Small (< 8 cm)", min: 0, max: 8 },
  { label: "Medium (8–15 cm)", min: 8, max: 15 },
  { label: "Large (> 15 cm)", min: 15, max: Infinity },
];

function parseDimensionCm(dim: string | null | undefined): number | null {
  if (!dim) return null;
  const match = dim.match(/(\d+(?:\.\d+)?)\s*(?:cm|mm|in)?/i);
  if (!match) return null;
  let n = parseFloat(match[1]);
  if (/\bmm\b/i.test(dim)) n /= 10;
  if (/\bin\b/i.test(dim)) n *= 2.54;
  return n;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const { data: listData, isLoading: itemsLoading } = useListPottery({
    pageSize: 200,
  });
  const items = listData?.items;
  const { data: stats, isLoading: statsLoading } = useGetCollectionStats();

  const isLoading = itemsLoading || statsLoading;

  // ── Derived aggregates ──────────────────────────────────────────────────────

  const { timelineData, shapeData, sizeData, uniqueCount } = useMemo(() => {
    if (!items)
      return {
        timelineData: [],
        shapeData: [],
        sizeData: [],
        uniqueCount: 0,
      };

    const yearCounts = new Map<string, number>();
    const shapeCounts = new Map<string, number>();
    const sizeCounts = new Map<string, number>([
      ["Small (< 8 cm)", 0],
      ["Medium (8–15 cm)", 0],
      ["Large (> 15 cm)", 0],
      ["Unknown", 0],
    ]);

    for (const item of items) {
      const qty = item.quantity ?? 1;

      // Timeline
      if (item.acquiredAt) {
        const yr = item.acquiredAt.slice(0, 4);
        yearCounts.set(yr, (yearCounts.get(yr) ?? 0) + qty);
      }

      // Shape
      const rawShape = item.shape?.trim();
      const shape = rawShape
        ? rawShape.charAt(0).toUpperCase() + rawShape.slice(1).toLowerCase()
        : "Unknown";
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + qty);

      // Size
      const cm = parseDimensionCm(item.dimensions);
      if (cm === null) {
        sizeCounts.set("Unknown", (sizeCounts.get("Unknown") ?? 0) + qty);
      } else {
        const bucket =
          SIZE_BUCKETS.find((b) => cm >= b.min && cm < b.max) ??
          SIZE_BUCKETS[2];
        sizeCounts.set(bucket.label, (sizeCounts.get(bucket.label) ?? 0) + qty);
      }
    }

    const timelineData = [...yearCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, count]) => ({ year, count }));

    const shapeData = [...shapeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value], i) => ({
        name,
        value,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }));

    const sizeData = [...sizeCounts.entries()]
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));

    return { timelineData, shapeData, sizeData, uniqueCount: items.length };
  }, [items]);

  usePageAssistantContext(
    "pottery-stats",
    isLoading
      ? undefined
      : `Collection Stats page: ${stats?.totalItems ?? 0} total pieces (${uniqueCount} unique items) across ${timelineData.length} tracked years. Top motifs: ${
          stats?.topMotifs
            .slice(0, 5)
            .map((m) => `${m.label} (${m.count})`)
            .join(", ") || "none"
        }. Shape breakdown: ${shapeData.map((s) => `${s.name} (${s.value})`).join(", ") || "none"}. Size distribution: ${sizeData.map((s) => `${s.name} (${s.value})`).join(", ") || "none"}. Top glaze colours: ${
          stats?.topColors
            .slice(0, 8)
            .map((c) => `${c.label} (${c.count})`)
            .join(", ") || "none"
        }.`,
  );

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
        <StatCard label="Unique items" value={uniqueCount} icon={Layers} />
        <StatCard
          label="Years tracked"
          value={timelineData.length}
          icon={TrendingUp}
        />
      </div>

      {/* Acquisition timeline */}
      {timelineData.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">
            Pieces acquired by year
          </h2>
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
              {stats!.topMotifs.map((m, i) => (
                <BarRow
                  key={i}
                  label={m.label}
                  value={m.count}
                  max={stats!.topMotifs[0].count}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Shape donut */}
      {shapeData.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Shape breakdown</h2>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              {/* Donut */}
              <div className="shrink-0">
                <DonutChart data={shapeData} size={180} />
              </div>
              {/* Legend */}
              <div className="flex-1 w-full space-y-2">
                {shapeData.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="flex-1 text-sm capitalize truncate">
                      {entry.name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Size distribution */}
      {sizeData.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Size distribution</h2>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="space-y-2">
              {sizeData.map((entry, i) => (
                <BarRow
                  key={i}
                  label={entry.name}
                  value={entry.value}
                  max={sizeData[0].value}
                  color="#8b5cf6"
                />
              ))}
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
