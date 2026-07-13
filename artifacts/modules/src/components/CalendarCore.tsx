import { type ReactNode, useMemo, useState } from "react";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// ─── Shared calendar utilities ────────────────────────────────────────────────

export type ViewMode = "month" | "week" | "list";

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );
}

export function tintColor(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function weekRange(cursor: Date): { start: Date; end: Date } {
  const start = startOfWeek(cursor);
  return { start, end: addDays(start, 7) };
}

export function monthGridRange(cursor: Date): { start: Date; end: Date } {
  const gridStart = startOfWeek(startOfMonth(cursor));
  const lastRowStart = startOfWeek(endOfWeek(endOfMonth(cursor)));
  return { start: gridStart, end: addDays(lastRowStart, 7) };
}

export function monthRange(cursor: Date): { start: Date; end: Date } {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { start, end };
}

export function rangeForView(
  view: ViewMode,
  cursor: Date,
): { start: Date; end: Date } {
  if (view === "week") return weekRange(cursor);
  if (view === "month") return monthGridRange(cursor);
  return monthRange(cursor);
}

export function shiftCursor(
  view: ViewMode,
  cursor: Date,
  direction: 1 | -1,
): Date {
  if (view === "week") return addDays(cursor, 7 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

// ─── CalendarCore component ───────────────────────────────────────────────────

export interface CalendarCoreContext {
  view: ViewMode;
  cursor: Date;
  gridDays: Date[];
  range: { start: Date; end: Date };
}

export interface CalendarCoreProps {
  defaultView?: ViewMode;
  /**
   * Extra content rendered between the toolbar and the grid — e.g. filter
   * chips, overlay calendar toggles, or AI-suggestion panels.
   */
  belowToolbar?: ReactNode;
  /**
   * Override the label shown when view === "list". Defaults to the current
   * month/year (same as month view label).
   */
  listLabel?: string;
  /**
   * Disable the prev/next/today nav buttons when view === "list". Useful
   * when the list shows all upcoming events regardless of month (Hallmark style).
   */
  disableNavInList?: boolean;
  /**
   * Called after the internal view state updates. Lets parents mirror the
   * view for their own derived state (e.g. query keys, assistant context).
   */
  onViewChange?: (v: ViewMode) => void;
  /**
   * Called after the internal cursor state updates. Lets parents mirror the
   * cursor for their own derived state.
   */
  onCursorChange?: (c: Date) => void;
  children: (ctx: CalendarCoreContext) => ReactNode;
}

export function CalendarCore({
  defaultView = "month",
  belowToolbar,
  listLabel,
  disableNavInList = false,
  onViewChange,
  onCursorChange,
  children,
}: CalendarCoreProps) {
  const [cursor, setCursorState] = useState(() => new Date());
  const [view, setViewState] = useState<ViewMode>(defaultView);

  function setView(v: ViewMode) {
    setViewState(v);
    onViewChange?.(v);
  }

  function setCursor(updater: Date | ((prev: Date) => Date)) {
    setCursorState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onCursorChange?.(next);
      return next;
    });
  }

  const range = useMemo(() => rangeForView(view, cursor), [view, cursor]);

  const gridDays = useMemo(() => {
    if (view === "list") return [];
    const lastDayInclusive = addDays(range.end, -1);
    return eachDayOfInterval({ start: range.start, end: lastDayInclusive });
  }, [view, range]);

  const cursorLabel = useMemo(() => {
    if (view === "list") {
      return (
        listLabel ??
        cursor.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        })
      );
    }
    if (view === "week") {
      const weekEnd = addDays(range.start, 6);
      const sameMonth = range.start.getMonth() === weekEnd.getMonth();
      const startLabel = range.start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const endLabel = weekEnd.toLocaleDateString(
        undefined,
        sameMonth
          ? { day: "numeric", year: "numeric" }
          : { month: "short", day: "numeric", year: "numeric" },
      );
      return `${startLabel} – ${endLabel}`;
    }
    return cursor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }, [view, cursor, range.start, listLabel]);

  const navDisabled = disableNavInList && view === "list";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor((c) => shiftCursor(view, c, -1))}
            disabled={navDisabled}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[160px] text-center font-medium text-foreground">
            {cursorLabel}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(new Date())}
            disabled={navDisabled}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor((c) => shiftCursor(view, c, 1))}
            disabled={navDisabled}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as ViewMode)}
          className="justify-start"
        >
          <ToggleGroupItem value="month" size="sm" aria-label="Month view">
            Month
          </ToggleGroupItem>
          <ToggleGroupItem value="week" size="sm" aria-label="Week view">
            Week
          </ToggleGroupItem>
          <ToggleGroupItem value="list" size="sm" aria-label="List view">
            List
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {belowToolbar}

      {children({ view, cursor, gridDays, range })}
    </>
  );
}
