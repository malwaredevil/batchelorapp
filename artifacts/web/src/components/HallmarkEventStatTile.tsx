/**
 * HallmarkEventStatTile — compact stat-square–sized countdown tile for the Hub.
 *
 * Yellow while counting down, red when live.  Rotates through multiple
 * upcoming events every 4 seconds.  Falls back to the hardcoded
 * HALLMARK_OPEN_HOUSE constant when no calendar is connected or no events
 * are found within the 90-day look-ahead window.
 */
import { useEffect, useState } from "react";
import { useUpcomingHallmarkEvents } from "@workspace/api-client-react";

/**
 * Hallmark's annual Keepsake Ornament Premiere ("Open House") event.
 * Used as a placeholder until real event data loads from the Hallmark GCal.
 */
export const HALLMARK_OPEN_HOUSE = {
  start: new Date("2026-07-11T00:00:00"),
  end: new Date("2026-07-19T23:59:59"),
};

export function HallmarkEventStatTile() {
  const now = Date.now();
  const [index, setIndex] = useState(0);

  // 90-day window matches the original tile behavior.
  const { events: upcoming } = useUpcomingHallmarkEvents({ lookaheadDays: 90 });

  // Falls back to the hardcoded HALLMARK_OPEN_HOUSE constant only when no
  // calendar is connected or no upcoming events are found within 90 days.
  const list: Array<{
    gcalId?: string;
    title: string;
    startDate?: string;
    startMs: number;
    endMs: number;
  }> =
    upcoming.length > 0
      ? upcoming
      : [
          {
            title: "Hallmark Open House",
            startMs: HALLMARK_OPEN_HOUSE.start.getTime(),
            endMs: HALLMARK_OPEN_HOUSE.end.getTime(),
          },
        ];

  // Reset the carousel to event 0 whenever the list length changes.
  // Without this, a stale index combined with a shorter list silently shows the
  // wrong event (e.g. index=2 with list.length=2 after expiry → still valid by
  // modulo, but points to a different slot than before the shrink).
  useEffect(() => {
    setIndex(0);
  }, [list.length]);

  useEffect(() => {
    if (list.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % list.length), 4000);
    return () => clearInterval(id);
  }, [list.length]);

  const current = list[index % list.length];
  const isLive = now >= current.startMs && now <= current.endMs;
  const daysAway = isLive
    ? 0
    : Math.max(0, Math.ceil((current.startMs - now) / 86_400_000));

  const shortTitle = current.title.replace(/hallmark'?s?\s*/i, "").trim();
  // Deep-link to the currently displayed event's month with its detail view
  // auto-opened.  Falls back to a plain calendar link when there's no real
  // gcalId/startDate (the hardcoded HALLMARK_OPEN_HOUSE placeholder).
  const href =
    current.gcalId && current.startDate
      ? `/modules/ornaments/hallmark-events?month=${current.startDate.slice(0, 7)}&event=${encodeURIComponent(current.gcalId)}`
      : `/modules/ornaments/hallmark-events?view=month`;

  const dateRange =
    new Date(current.startMs).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }) +
    " – " +
    new Date(current.endMs).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  return (
    <div
      data-testid="hallmark-event-tile"
      role="link"
      tabIndex={0}
      title={current.title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        window.location.href = href;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          window.location.href = href;
        }
      }}
      className={`flex-[2] flex flex-col justify-between p-3 rounded-lg min-w-0 cursor-pointer h-[76px] overflow-hidden ${
        isLive
          ? "bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60"
          : "bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50"
      }`}
    >
      {/* Top: countdown or LIVE indicator */}
      <div>
        {isLive ? (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="text-lg font-bold text-red-700 dark:text-red-300 leading-none uppercase tracking-wide">
              Live Now
            </span>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-amber-800 dark:text-amber-200 tabular-nums leading-none">
              {daysAway}
            </span>
            <div className="text-[10px] font-medium text-amber-700/70 dark:text-amber-300/70 uppercase tracking-wider leading-tight pb-0.5">
              days
              <br />
              until
            </div>
          </div>
        )}
      </div>
      {/* Bottom: event name + date range */}
      <div className="mt-2 min-w-0">
        <span
          className={`text-xs font-semibold uppercase tracking-wide truncate block ${isLive ? "text-red-900/80 dark:text-red-100/70" : "text-amber-900/80 dark:text-amber-100/70"}`}
        >
          {shortTitle || current.title}
        </span>
        <span
          className={`text-[9px] block mt-0.5 ${isLive ? "text-red-700/60 dark:text-red-300/50" : "text-amber-700/55 dark:text-amber-300/50"}`}
        >
          {dateRange}
        </span>
      </div>
    </div>
  );
}
