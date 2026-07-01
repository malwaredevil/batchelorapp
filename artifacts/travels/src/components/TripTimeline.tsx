import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import type { Trip, TripStatus } from "@workspace/api-client-react";

// ─── Scale ───────────────────────────────────────────────────────────────────
const TIMELINE_START = new Date("2024-01-01");
const PX_PER_MONTH = 130;  // pixels per calendar month
const CHIP_MIN_W = 88;     // minimum chip width in px
const LANE_H = 36;         // height of each swim-lane
const AXIS_H = 40;         // height of the month/year axis
const PADDING_X = 16;      // left/right padding

// ─── Colours ─────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<TripStatus, { bg: string; border: string; text: string }> = {
  completed: { bg: "#f0fdf4", border: "#22c55e", text: "#14532d" },
  booked:    { bg: "#fff7ed", border: "#f97316", text: "#7c2d12" },
  active:    { bg: "#fff7ed", border: "#f97316", text: "#7c2d12" },
  planning:  { bg: "#fefce8", border: "#eab308", text: "#713f12" },
  wishlist:  { bg: "#fefce8", border: "#eab308", text: "#713f12" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function dateToX(date: Date): number {
  const months = monthsBetween(TIMELINE_START, date);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const dayFraction = (date.getDate() - 1) / daysInMonth;
  return PADDING_X + (months + dayFraction) * PX_PER_MONTH;
}

function shortLocation(destination: string | null | undefined): string {
  if (!destination) return "Trip";
  return destination.split(",")[0].trim();
}

// ─── Lane assignment (greedy, no overlap) ────────────────────────────────────
type LanedTrip = Trip & { lane: number; x: number; w: number };

function assignLanes(trips: Trip[]): LanedTrip[] {
  const sorted = [...trips]
    .filter((t) => t.startDate)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!));

  const laneEnds: number[] = [];
  const result: LanedTrip[] = [];

  for (const t of sorted) {
    const x = dateToX(new Date(t.startDate!));
    const endDate = t.endDate ? new Date(t.endDate) : new Date(new Date(t.startDate!).getTime() + 2 * 86400000);
    const endX = Math.max(dateToX(endDate), x + CHIP_MIN_W);
    const w = Math.max(endX - x, CHIP_MIN_W);

    let lane = laneEnds.findIndex((end) => end <= x - 4);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = x + w;
    result.push({ ...t, lane, x, w });
  }

  return result;
}

// ─── Axis months ─────────────────────────────────────────────────────────────
function buildMonths(totalMonths: number) {
  const months: { label: string; x: number; isJan: boolean; year: number }[] = [];
  for (let i = 0; i <= totalMonths; i++) {
    const d = new Date(TIMELINE_START);
    d.setMonth(d.getMonth() + i);
    const x = PADDING_X + i * PX_PER_MONTH;
    months.push({
      label: d.toLocaleString("en-GB", { month: "short" }),
      x,
      isJan: d.getMonth() === 0,
      year: d.getFullYear(),
    });
  }
  return months;
}

// ─── Component ───────────────────────────────────────────────────────────────
interface Props {
  trips: Trip[];
}

export default function TripTimeline({ trips }: Props) {
  const [, navigate] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayX = dateToX(today);

  // Extend timeline to 2 months past last trip or today, whichever is later
  const lastTripDate = trips.reduce<Date | null>((max, t) => {
    const d = t.endDate ? new Date(t.endDate) : t.startDate ? new Date(t.startDate) : null;
    return d && (!max || d > max) ? d : max;
  }, null);

  const timelineEnd = new Date(Math.max(
    today.getTime(),
    lastTripDate ? lastTripDate.getTime() : 0
  ));
  timelineEnd.setMonth(timelineEnd.getMonth() + 2);

  const totalMonths = Math.ceil(monthsBetween(TIMELINE_START, timelineEnd));
  const totalWidth = PADDING_X * 2 + totalMonths * PX_PER_MONTH;

  const laned = assignLanes(trips);
  const numLanes = Math.max(1, ...laned.map((t) => t.lane + 1));
  const lanesHeight = numLanes * LANE_H;
  const totalHeight = lanesHeight + AXIS_H;

  const months = buildMonths(totalMonths);

  // Scroll so "today" is centred in the viewport
  useEffect(() => {
    if (!scrollRef.current) return;
    const vw = scrollRef.current.clientWidth;
    scrollRef.current.scrollLeft = Math.max(0, todayX - vw / 2);
  }, [todayX]);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
        Trip Timeline · 2024 – present
      </p>

      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-xl border border-border/50 bg-card"
        style={{ userSelect: "none" }}
      >
        <div style={{ position: "relative", width: totalWidth, height: totalHeight, minWidth: "100%" }}>

          {/* ── Year banners ─────────────────────────────────────── */}
          {months.filter((m) => m.isJan).map((m) => (
            <div
              key={m.year}
              style={{
                position: "absolute",
                left: m.x,
                top: 0,
                height: lanesHeight,
                width: 1,
                background: "hsl(var(--border))",
                opacity: 0.6,
              }}
            />
          ))}

          {/* ── Today line ───────────────────────────────────────── */}
          <div
            style={{
              position: "absolute",
              left: todayX,
              top: 0,
              height: lanesHeight,
              width: 2,
              background: "#f43f5e",
              borderRadius: 1,
              zIndex: 10,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: todayX - 14,
              top: 4,
              fontSize: 9,
              fontWeight: 700,
              color: "#f43f5e",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              zIndex: 11,
            }}
          >
            TODAY
          </div>

          {/* ── Trip chips ───────────────────────────────────────── */}
          {laned.map((trip) => {
            const colors = STATUS_COLORS[trip.status];
            const top = trip.lane * LANE_H + 6;
            const chipH = LANE_H - 10;
            return (
              <button
                key={trip.id}
                onClick={() => navigate(`/trips/${trip.id}`)}
                title={`${trip.destination} · ${trip.startDate}`}
                style={{
                  position: "absolute",
                  left: trip.x,
                  top,
                  width: trip.w,
                  height: chipH,
                  background: colors.bg,
                  border: `1.5px solid ${colors.border}`,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 8,
                  paddingRight: 6,
                  cursor: "pointer",
                  zIndex: 5,
                  overflow: "hidden",
                  transition: "filter 0.1s",
                  gap: 4,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(0.93)")}
                onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.text,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1,
                  }}
                >
                  {shortLocation(trip.destination)}
                </span>
              </button>
            );
          })}

          {/* ── Axis ─────────────────────────────────────────────── */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: lanesHeight,
              width: totalWidth,
              height: AXIS_H,
              borderTop: "1px solid hsl(var(--border))",
            }}
          >
            {months.map((m, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: m.x,
                  top: 0,
                  width: PX_PER_MONTH,
                  height: AXIS_H,
                  display: "flex",
                  flexDirection: "column",
                  paddingTop: 6,
                  paddingLeft: 6,
                  gap: 1,
                }}
              >
                {m.isJan && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--foreground))", lineHeight: 1 }}>
                    {m.year}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 10,
                    color: m.isJan ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                    fontWeight: m.isJan ? 600 : 400,
                    lineHeight: 1,
                  }}
                >
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
