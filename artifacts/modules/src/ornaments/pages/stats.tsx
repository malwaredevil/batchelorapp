import { useGetOrnamentStats } from "@workspace/api-client-react";
import { Loader2, TrendingUp, Hash, BookOpen } from "lucide-react";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function StatsPage() {
  const { data: stats, isLoading, isError } = useGetOrnamentStats();

  usePageAssistantContext(
    "ornaments-stats",
    `Collection statistics page. Total items: ${stats?.totalItems || 0}, estimated collection value: ${formatCurrency(stats?.totalEstimatedValue || 0)} across ${stats?.itemsWithEstimatedValue || 0} priced designs. Valuation policy: average a design's saved current-market signals (book value, eBay prices, and AI appraisal); if it has no market signal, use saved retail/MSRP instead. Values include quantity.`,
  );

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Failed to load statistics</p>
      </div>
    );
  }

  const seriesData = stats.bySeriesOrCollection
    .slice()
    .sort(
      (
        a: (typeof stats.bySeriesOrCollection)[number],
        b: (typeof stats.bySeriesOrCollection)[number],
      ) => b.totalValue - a.totalValue,
    )
    .slice(0, 10)
    .map((s: (typeof stats.bySeriesOrCollection)[number]) => ({
      name: s.seriesOrCollection || "Uncategorized",
      value: s.totalValue,
      count: s.count,
    }));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Collection Stats
        </h1>
        <p className="text-muted-foreground mt-1">
          Overview of your Hallmark Keepsake ornaments
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-sm border-card-border overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Hash className="h-16 w-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Total Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-serif font-bold text-foreground">
              {stats.totalQuantity.toLocaleString()}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              across {stats.totalItems.toLocaleString()} unique designs
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-card-border overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-primary">
            <TrendingUp className="h-16 w-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Estimated Collection Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-serif font-bold text-primary">
              {formatCurrency(stats.totalEstimatedValue)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              market signals first; retail/MSRP only as a fallback
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-card-border overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <BookOpen className="h-16 w-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Priced Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-serif font-bold text-foreground">
              {stats.itemsWithEstimatedValue.toLocaleString()}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {Math.round(
                (stats.itemsWithEstimatedValue / stats.totalItems) * 100,
              ) || 0}
              % of unique collection
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="rounded-lg border border-card-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <strong className="text-foreground">How the estimate works:</strong>{" "}
        each design uses the average of its saved current-market signals (book
        value, eBay prices, and AI appraisal). When no market signal is saved,
        its retail/MSRP value is used instead. Quantities are included in every
        total and series bar.
      </p>

      {seriesData.length > 0 && (
        <Card className="shadow-sm border-card-border">
          <CardHeader>
            <CardTitle className="font-serif">
              Top Series by Estimated Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={seriesData}
                  margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) =>
                      value.length > 15 ? value.substring(0, 15) + "..." : value
                    }
                  />
                  <YAxis
                    tickFormatter={(value) => `$${value}`}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12 }}
                  />
                  <RechartsTooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                    formatter={(value: number) => [
                      formatCurrency(value),
                      "Estimated value",
                    ]}
                  />
                  <Bar
                    dataKey="value"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={50}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
