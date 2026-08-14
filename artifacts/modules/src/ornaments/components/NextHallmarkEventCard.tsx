/**
 * NextHallmarkEventCard — upcoming/live Hallmark event banner shown at the top
 * of the Ornaments collection page.
 *
 * Returns null when there are no upcoming events so the space collapses
 * cleanly.
 */
import React from "react";
import { Link } from "wouter";
import { CalendarHeart } from "lucide-react";
import { useUpcomingHallmarkEvents } from "@workspace/api-client-react";

export function NextHallmarkEventCard() {
  // No lookaheadDays → defaults to exactly one calendar year (setFullYear),
  // matching the original NextHallmarkEventCard useMemo behavior precisely
  // (and handling leap years correctly).
  const { events: upcoming } = useUpcomingHallmarkEvents();

  const next = upcoming[0];
  if (!next) return null;

  // Compute time-sensitive values fresh at render time — not inside the hook —
  // so they remain accurate on any re-render without waiting for a query refetch.
  const nowMs = Date.now();
  const isLive = nowMs >= next.startMs && nowMs <= next.endMs;
  const daysAway = isLive
    ? 0
    : Math.max(0, Math.ceil((next.startMs - nowMs) / 86_400_000));

  // dateRangeLabel format: "Oct 8 – Oct 10, 2026" (year on end date only,
  // matching the original NextHallmarkEventCard display).
  const dateRangeLabel = `${new Date(
    `${next.startDate}T00:00:00`,
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} – ${new Date(`${next.endDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  // Include ?view=month so the calendar page always opens in month view when
  // the user arrives via the hero card — consistent with HallmarkEventStatTile.
  const eventHref = `/ornaments/hallmark-events?view=month&month=${next.startDate.slice(0, 7)}&event=${encodeURIComponent(next.gcalId)}`;

  return (
    <Link href={eventHref}>
      <div
        data-testid="next-hallmark-event-card"
        className="flex items-center gap-4 rounded-xl border border-rose-200/60 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 p-4 hover:bg-rose-100/70 dark:hover:bg-rose-900/30 transition-colors cursor-pointer"
      >
        <div className="w-12 h-12 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
          <CalendarHeart className="w-6 h-6 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-serif font-semibold truncate">{next.title}</div>
          <div className="text-sm text-muted-foreground">{dateRangeLabel}</div>
        </div>
        <div className="text-center flex-shrink-0">
          <div
            data-testid="hallmark-countdown-value"
            className={`text-3xl font-bold tabular-nums leading-none ${isLive ? "text-red-700 dark:text-red-400" : "text-rose-600 dark:text-rose-400"}`}
          >
            {isLive ? "Live" : daysAway}
          </div>
          {!isLive && (
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              days away
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
