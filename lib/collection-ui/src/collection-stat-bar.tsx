import { type ReactNode } from "react";
import { Skeleton } from "@workspace/ui/skeleton";

export interface StatBarItem {
  value: ReactNode;
  label: string;
  sub?: ReactNode;
}

export interface CollectionStatBarProps {
  stats: StatBarItem[];
  loading?: boolean;
}

export function CollectionStatBar({ stats, loading }: CollectionStatBarProps) {
  if (loading) {
    return (
      <div className="mb-4 hidden sm:grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-xl" />
        ))}
      </div>
    );
  }

  if (stats.length === 0) return null;

  return (
    <div
      className="mb-4 hidden sm:grid grid-cols-2 gap-3"
      style={{
        gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0,1fr))`,
      }}
    >
      {stats.map((stat, i) => (
        <div
          key={i}
          className="rounded-xl border border-card-border bg-card p-4"
        >
          <p className="text-2xl font-bold">{stat.value}</p>
          <p className="text-sm font-medium mt-0.5">{stat.label}</p>
          {stat.sub && (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {stat.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
