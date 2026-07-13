import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Camera,
  ShoppingBag,
  ArrowRight,
  Activity,
  Settings,
  Sun,
  Moon,
  PlusCircle,
  LayoutGrid,
  X,
  Check,
  LogOut,
  ChevronDown,
  Package,
  Scissors,
  Layers,
  FlaskConical,
  Shirt,
  Rss,
  Sparkles,
  MessageCircle,
  SlidersHorizontal,
  Mail,
  CalendarDays,
  Gift,
  Tag,
  Sparkle,
  GripVertical,
} from "lucide-react";
import { AppSwitcher } from "@workspace/elaine-ui";
import { useListOrnamentsHallmarkEvents } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@workspace/elaine-ui";
import { useWidgets, type WidgetSlot, type RssSlot } from "@/hooks/use-widgets";
import { RssFeedWidget } from "@/components/widgets";
import { useAuth } from "@/lib/auth";
import { APPS, WIDGETS, type WidgetCategory } from "@/config/apps";
import {
  useGetCollectionStats,
  useListPotteryCategories,
  useGetStats,
  useGetTravelsStats,
  useGetOrnamentStats,
  useListNotes,
  useListConnectedCalendars,
  useListConnectedCalendarEvents,
  useGetElaineNudgesUnseenCount,
  useListElaineMemory,
} from "@workspace/api-client-react";
import { useGmailLabels } from "@workspace/gmail-ui";
import { usePageAssistantContext } from "@/lib/assistant-context";

const base = import.meta.env.BASE_URL;

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ADD_ACTIONS = [
  { label: "Pottery piece", href: `${base}pottery/add` },
  { label: "Fabric", href: `${base}quilting/fabrics/add` },
  { label: "Pattern", href: `${base}quilting/patterns/add` },
  { label: "Quilt", href: `${base}quilting/quilts/add` },
];

const POTTERY_QUICK_LINKS = [
  { label: "Collection", icon: Package, href: `${base}pottery/` },
  { label: "Compare", icon: Camera, href: `${base}pottery/compare` },
  {
    label: "Maintenance",
    icon: FlaskConical,
    href: `${base}pottery/maintenance`,
  },
];

const QUILTING_QUICK_LINKS = [
  { label: "Fabrics", icon: Shirt, href: `${base}quilting/fabrics` },
  { label: "Blocks", icon: Scissors, href: `${base}quilting/blocks` },
  { label: "Layouts", icon: Layers, href: `${base}quilting/layouts` },
];

const TRAVELS_QUICK_LINKS = [
  { label: "Home", icon: Activity, href: `${base}travels/` },
  { label: "Trips", icon: Layers, href: `${base}travels/trips` },
  { label: "Explore", icon: Rss, href: `${base}travels/explore` },
];

const ORNAMENTS_QUICK_LINKS = [
  { label: "Collection", icon: Gift, href: `${base}ornaments/` },
  { label: "Categories", icon: Tag, href: `${base}ornaments/categories` },
  { label: "Stats", icon: Activity, href: `${base}ornaments/stats` },
];

/**
 * Hallmark's annual Keepsake Ornament Premiere ("Open House") event.
 * This hardcoded fallback is only used until the real event data (synced
 * from the shared Hallmark Google Calendar / entered in-app) loads from
 * the ornaments-hallmark-events API — see useNextHallmarkEvent().
 */
const HALLMARK_OPEN_HOUSE = {
  start: new Date("2026-07-11T00:00:00"),
  end: new Date("2026-07-19T23:59:59"),
};

const ELAINE_QUICK_LINKS = [
  { label: "Chat", icon: MessageCircle, href: `${base}elaine/` },
  { label: "Account", icon: Settings, href: `${base}account` },
];

const OFFICE_QUICK_LINKS = [
  { label: "Open Office", icon: Activity, href: `${base}modules/office/` },
];

const CATEGORY_LABELS: { id: "all" | WidgetCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "collections", label: "Collections" },
  { id: "tools", label: "Tools" },
  { id: "media", label: "Media" },
  { id: "inspiration", label: "Inspiration" },
];

// ── Widget library modal ──────────────────────────────────────────────────────
function WidgetLibraryModal({
  isStaticEnabled,
  onToggle,
  onAddRss,
  onClose,
}: {
  isStaticEnabled: (id: string) => boolean;
  onToggle: (id: string) => void;
  onAddRss: () => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState<"all" | WidgetCategory>("all");
  const [search, setSearch] = useState("");

  const visible = WIDGETS.filter((w) => {
    const matchCat = cat === "all" || w.category === cat;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      w.title.toLowerCase().includes(q) ||
      w.description.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const staticEnabledCount = WIDGETS.filter(
    (w) => !w.multi && isStaticEnabled(w.id),
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Widget library</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {staticEnabledCount} active · RSS feeds are unlimited
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3 flex-shrink-0 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search widgets…"
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Category tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {CATEGORY_LABELS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  cat === c.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Widget grid — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">No widgets match "{search}"</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visible.map((w) => {
                const isMulti = !!w.multi;
                const added = !isMulti && isStaticEnabled(w.id);
                const Icon = w.icon;
                return (
                  <div
                    key={w.id}
                    className={`relative bg-card border rounded-xl p-4 flex flex-col gap-3 transition-all ${
                      added
                        ? "border-primary/40 ring-1 ring-primary/20"
                        : "border-border hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold leading-tight">
                            {w.title}
                          </span>
                          {isMulti && (
                            <span className="text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded-full leading-none">
                              Multi
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mt-0.5">
                          {w.category}
                        </div>
                      </div>
                      {added && (
                        <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                      {w.description}
                    </p>
                    <button
                      onClick={() => {
                        if (isMulti) {
                          onAddRss();
                          onClose();
                        } else {
                          onToggle(w.id);
                        }
                      }}
                      className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        added
                          ? "bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive"
                          : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      }`}
                    >
                      {added ? (
                        <>
                          <Check className="w-3 h-3" /> Added — click to remove
                        </>
                      ) : isMulti ? (
                        <>
                          <Plus className="w-3 h-3" /> Add another RSS feed
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" /> Add to dashboard
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── App hero card ─────────────────────────────────────────────────────────────
function AppHeroCard({
  app,
  stats,
  quickLinks,
  accentBorderColor,
  accentSectionBg,
  accentIconColor,
  expanded,
  onToggle,
  extraBlock,
  statTile,
  arranging,
}: {
  app: {
    id: string;
    name: string;
    href: string;
    image: string;
    updated: string;
    description: string;
    cta?: string;
  };
  stats: { value: string; label: string }[];
  quickLinks: {
    label: string;
    icon: React.FC<{ className?: string }>;
    href: string;
  }[];
  accentBorderColor: string;
  accentSectionBg: string;
  accentIconColor: string;
  expanded: boolean;
  onToggle: () => void;
  /** Optional extra block rendered below the stats row (e.g. a countdown). */
  extraBlock?: React.ReactNode;
  /** Optional tile rendered inline in the stats row (same height as a stat square). */
  statTile?: React.ReactNode;
  /** When true, suppress click-navigation so drags don't accidentally navigate. */
  arranging?: boolean;
}) {
  return (
    <a
      href={arranging ? undefined : app.href}
      className="group block"
      onClick={(e) => {
        if (arranging) {
          e.preventDefault();
          return;
        }
        const t = e.target as HTMLElement;
        if (t.closest("[data-accordion]")) e.preventDefault();
      }}
    >
      <Card className="h-full overflow-hidden border-border bg-card shadow-sm hover:shadow-md transition-all duration-200 flex flex-col cursor-pointer">
        {/* Hero image */}
        <div className="h-32 sm:h-48 w-full relative overflow-hidden bg-muted flex-shrink-0">
          <img
            src={app.image}
            alt={`${app.name} Collection`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          <div className="absolute bottom-2.5 left-3.5 right-3.5 sm:bottom-4 sm:left-6 sm:right-6 flex justify-between items-end gap-2">
            <h2 className="text-xl sm:text-3xl font-bold text-white tracking-tight truncate">
              {app.name}
            </h2>
            <Badge className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-md border-0 flex-shrink-0 text-[10px] sm:text-xs">
              {app.updated}
            </Badge>
          </div>
        </div>

        {/* Stats */}
        <CardContent className="p-6 pb-4 flex-1">
          <div className="flex gap-3">
            {statTile}
            {stats.map((s) => (
              <div
                key={s.label}
                className="flex-1 flex flex-col space-y-1 p-3 rounded-lg bg-secondary/50"
              >
                <span className="text-2xl font-bold text-primary">
                  {s.value}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          {extraBlock}
        </CardContent>

        {/* Accordion toggle */}
        <button
          data-accordion
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }}
          className="flex items-center justify-between px-6 py-3 border-t border-border hover:bg-muted/30 transition-colors text-xs font-medium text-muted-foreground"
        >
          <span>{expanded ? "Hide quick links" : "Quick links →"}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </button>

        {/* Quick links */}
        {expanded && (
          <div
            className={`px-5 pb-5 pt-3 border-t ${accentBorderColor} ${accentSectionBg}`}
            data-accordion
            onClick={(e) => e.preventDefault()}
          >
            <div className="grid grid-cols-3 gap-2">
              {quickLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = link.href;
                  }}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border bg-card hover:bg-background transition-all text-center ${accentBorderColor}`}
                >
                  <link.icon className={`w-4 h-4 ${accentIconColor}`} />
                  <div className="text-xs font-semibold leading-none">
                    {link.label}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        {!expanded && (
          <CardFooter className="p-6 pt-0 border-t border-border mt-auto bg-muted/20">
            <div className="w-full flex items-center justify-between text-primary font-medium pt-4 group-hover:text-primary/80 transition-colors">
              <span>{app.cta ?? "Open collection"}</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </div>
          </CardFooter>
        )}
      </Card>
    </a>
  );
}

// ── Ornaments card extra: next Hallmark event countdown ─────────────────────
// Pulls from the household-shared ornaments_hallmark_events table (editable
// in the Ornaments app, best-effort synced to the shared Hallmark Google
// Calendar). Falls back to the hardcoded HALLMARK_OPEN_HOUSE constant only
// if no events have been entered yet or the request hasn't resolved.
// Compact stat-square–sized tile that replaces the "Total" square for ornaments.
// Yellow background while counting down, red background when live.
// Rotates through multiple upcoming events every 4 seconds.
function HallmarkEventStatTile() {
  const { data: events } = useListOrnamentsHallmarkEvents();
  const now = Date.now();
  const [index, setIndex] = useState(0);

  const upcoming = (events ?? [])
    .map((e) => ({
      id: e.id,
      title: e.title,
      start: new Date(`${e.startDate}T00:00:00`),
      end: new Date(`${e.endDate}T23:59:59`),
    }))
    .filter((e) => e.end.getTime() >= now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const list: Array<{
    id?: number;
    title: string;
    start: Date;
    end: Date;
  }> =
    upcoming.length > 0
      ? upcoming
      : [
          {
            title: "Hallmark Open House",
            start: HALLMARK_OPEN_HOUSE.start,
            end: HALLMARK_OPEN_HOUSE.end,
          },
        ];

  useEffect(() => {
    if (list.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % list.length), 4000);
    return () => clearInterval(id);
  }, [list.length]);

  const current = list[index % list.length];
  const isLive = now >= current.start.getTime() && now <= current.end.getTime();
  const daysAway = isLive
    ? 0
    : Math.max(0, Math.ceil((current.start.getTime() - now) / 86_400_000));

  const shortTitle = current.title.replace(/hallmark'?s?\s*/i, "").trim();
  const href =
    `/modules/ornaments/hallmark-events?view=month` +
    (current.id != null ? `&eventId=${current.id}` : "");

  return (
    <div
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
      className={`flex-1 flex flex-col justify-between p-3 rounded-lg min-w-0 cursor-pointer ${
        isLive
          ? "bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60"
          : "bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50"
      }`}
    >
      {/* Top: number/LIVE + sub-label */}
      <div>
        {isLive ? (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="text-base font-bold text-red-700 dark:text-red-300 leading-none uppercase tracking-wide">
              Live
            </span>
          </div>
        ) : (
          <>
            <span className="text-lg font-bold text-amber-800 dark:text-amber-200 tabular-nums leading-none">
              {daysAway}
            </span>
            <div className="text-[9px] font-medium text-amber-700/70 dark:text-amber-300/70 uppercase tracking-wider mt-0.5">
              days until
            </div>
          </>
        )}
      </div>
      {/* Bottom: event name */}
      <span className="text-[10px] font-medium uppercase tracking-wider truncate mt-1.5 block text-amber-900/70 dark:text-amber-100/60">
        {shortTitle || current.title}
      </span>
    </div>
  );
}

// Loads upcoming (next 30 days) event count for a single connected calendar
// and reports it up to the parent. Kept as its own component (rather than a
// hook called in a loop) so each connected calendar can independently call
// useListConnectedCalendarEvents — mirrors the CalendarEventsLoader pattern
// used on Office's own calendar page.
function UpcomingCalendarEventsLoader({
  calendarId,
  start,
  end,
  onCount,
}: {
  calendarId: number;
  start: string;
  end: string;
  onCount: (calendarId: number, count: number) => void;
}) {
  const { data } = useListConnectedCalendarEvents(calendarId, start, end);
  useEffect(() => {
    onCount(calendarId, data?.length ?? 0);
  }, [calendarId, data, onCount]);
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function AppLauncher() {
  const { isDark, toggleTheme } = useTheme();
  const {
    slots,
    appCardOrder,
    setAppCardOrder,
    byId,
    isStaticEnabled,
    toggleStatic,
    addRss,
    updateRss,
    removeSlot,
    resetWidgets,
    totalCount,
  } = useWidgets();
  const { user } = useAuth();

  // Cast helper so the grid render is type-safe
  const asRss = (s: WidgetSlot): RssSlot => s as RssSlot;

  const displayName = user?.displayName?.trim() || user?.email || "there";
  const firstName = displayName.split(/[\s@]/)[0] || displayName;
  const initials = initialsFrom(
    user?.displayName?.trim() || user?.email || "?",
  );

  const [searchOpen, setSearchOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>(
    {},
  );
  const [arranging, setArranging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Live stats
  const { data: potteryStatsData } = useGetCollectionStats();
  const { data: potteryCategoriesData } = useListPotteryCategories();
  const { data: quiltingStatsData } = useGetStats();
  const { data: travelsStatsData } = useGetTravelsStats();
  const { data: ornamentsStatsData } = useGetOrnamentStats();
  const { data: notesData } = useListNotes();
  const { data: gmailLabelsData } = useGmailLabels();
  const { data: connectedCalendarsData } = useListConnectedCalendars();
  const { data: elaineNudgesData } = useGetElaineNudgesUnseenCount();
  const { data: elaineMemoryData } = useListElaineMemory();

  const unreadEmailCount =
    gmailLabelsData?.find((l) => l.id === "UNREAD")?.threadsUnread ?? null;

  const upcomingEventsRangeStart = useMemo(() => new Date().toISOString(), []);
  const upcomingEventsRangeEnd = useMemo(
    () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );
  const [upcomingEventsByCalendar, setUpcomingEventsByCalendar] = useState<
    Record<number, number>
  >({});
  const handleUpcomingEventsCount = useCallback(
    (calendarId: number, count: number) => {
      setUpcomingEventsByCalendar((prev) =>
        prev[calendarId] === count ? prev : { ...prev, [calendarId]: count },
      );
    },
    [],
  );
  const upcomingEventsTotal = (connectedCalendarsData ?? []).length
    ? Object.values(upcomingEventsByCalendar).reduce((a, b) => a + b, 0)
    : null;

  function liveStats(appId: string): { value: string; label: string }[] {
    if (appId === "pottery") {
      return [
        {
          value:
            potteryStatsData?.totalItems != null
              ? String(potteryStatsData.totalItems)
              : "—",
          label: "Total",
        },
        {
          value:
            potteryStatsData?.uniqueItems != null
              ? String(potteryStatsData.uniqueItems)
              : "—",
          label: "Unique",
        },
        {
          value:
            potteryCategoriesData != null
              ? String(potteryCategoriesData.length)
              : "—",
          label: "Categories",
        },
      ];
    }
    if (appId === "quilting") {
      return [
        {
          value:
            quiltingStatsData?.totalFabrics != null
              ? String(quiltingStatsData.totalFabrics)
              : "—",
          label: "Fabrics",
        },
        {
          value:
            quiltingStatsData?.totalBlocks != null
              ? String(quiltingStatsData.totalBlocks)
              : "—",
          label: "Blocks",
        },
        {
          value:
            quiltingStatsData?.totalLayouts != null
              ? String(quiltingStatsData.totalLayouts)
              : "—",
          label: "Layouts",
        },
      ];
    }
    if (appId === "travels") {
      return [
        {
          value:
            travelsStatsData?.totalTrips != null
              ? String(travelsStatsData.totalTrips)
              : "—",
          label: "Trips",
        },
        {
          value:
            travelsStatsData?.completedTrips != null
              ? String(travelsStatsData.completedTrips)
              : "—",
          label: "Done",
        },
        {
          value:
            travelsStatsData?.upcomingTrips != null
              ? String(travelsStatsData.upcomingTrips)
              : "—",
          label: "Upcoming",
        },
      ];
    }
    if (appId === "ornaments") {
      return [
        {
          value:
            ornamentsStatsData?.totalQuantity != null
              ? String(ornamentsStatsData.totalQuantity)
              : "—",
          label: "Quantity",
        },
        {
          value:
            ornamentsStatsData?.totalBookValue != null
              ? `$${Math.round(ornamentsStatsData.totalBookValue)}`
              : "—",
          label: "Book Value",
        },
      ];
    }
    if (appId === "office") {
      return [
        {
          value: notesData != null ? String(notesData.length) : "—",
          label: "Notes",
        },
        {
          value: unreadEmailCount != null ? String(unreadEmailCount) : "—",
          label: "Unread",
        },
        {
          value:
            upcomingEventsTotal != null ? String(upcomingEventsTotal) : "—",
          label: "Upcoming",
        },
      ];
    }
    if (appId === "elaine") {
      return [
        {
          value:
            elaineNudgesData?.count != null
              ? String(elaineNudgesData.count)
              : "—",
          label: "Nudges",
        },
        {
          value:
            elaineMemoryData != null ? String(elaineMemoryData.length) : "—",
          label: "Memory",
        },
      ];
    }
    const app = APPS.find((a) => a.id === appId);
    return app?.stats ?? [];
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  usePageAssistantContext(
    "hub-launcher",
    `On the app launcher (the Batchelor hub home page) — lets the household pick which app to open: Pottery (${potteryStatsData?.totalItems ?? "?"} items), Quilting (${quiltingStatsData?.totalFabrics ?? "?"} fabrics), or Travels (${travelsStatsData?.totalTrips ?? "?"} trips). ${totalCount} widget(s) are shown on the dashboard.`,
  );

  type CardCfg = {
    quickLinks: typeof POTTERY_QUICK_LINKS;
    accentBorderColor: string;
    accentSectionBg: string;
    accentIconColor: string;
    extraBlock?: React.ReactNode;
  };
  const CARD_CONFIG: Record<string, CardCfg> = {
    pottery: {
      quickLinks: POTTERY_QUICK_LINKS,
      accentBorderColor: "border-amber-200/60 dark:border-amber-800/40",
      accentSectionBg: "bg-amber-50/60 dark:bg-amber-900/10",
      accentIconColor: "text-amber-600 dark:text-amber-400",
    },
    quilting: {
      quickLinks: QUILTING_QUICK_LINKS,
      accentBorderColor: "border-violet-200/60 dark:border-violet-800/40",
      accentSectionBg: "bg-violet-50/60 dark:bg-violet-900/10",
      accentIconColor: "text-violet-600 dark:text-violet-400",
    },
    travels: {
      quickLinks: TRAVELS_QUICK_LINKS,
      accentBorderColor: "border-sky-200/60 dark:border-sky-800/40",
      accentSectionBg: "bg-sky-50/60 dark:bg-sky-900/10",
      accentIconColor: "text-sky-600 dark:text-sky-400",
    },
    ornaments: {
      quickLinks: ORNAMENTS_QUICK_LINKS,
      accentBorderColor: "border-rose-200/60 dark:border-rose-800/40",
      accentSectionBg: "bg-rose-50/60 dark:bg-rose-900/10",
      accentIconColor: "text-rose-600 dark:text-rose-400",
    },
    elaine: {
      quickLinks: ELAINE_QUICK_LINKS,
      accentBorderColor: "border-indigo-200/60 dark:border-indigo-800/40",
      accentSectionBg: "bg-indigo-50/60 dark:bg-indigo-900/10",
      accentIconColor: "text-indigo-600 dark:text-indigo-400",
    },
    office: {
      quickLinks: OFFICE_QUICK_LINKS,
      accentBorderColor: "border-slate-200/60 dark:border-slate-700/40",
      accentSectionBg: "bg-slate-50/60 dark:bg-slate-900/10",
      accentIconColor: "text-slate-600 dark:text-slate-400",
    },
  };

  function navigate(href: string) {
    window.location.href = href;
  }

  async function signOut() {
    try {
      await fetch(`${base}api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.href = base;
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      {(connectedCalendarsData ?? []).map((cal) => (
        <UpcomingCalendarEventsLoader
          key={cal.id}
          calendarId={cal.id}
          start={upcomingEventsRangeStart}
          end={upcomingEventsRangeEnd}
          onCount={handleUpcomingEventsCount}
        />
      ))}
      {/* Header — max-w-6xl matches pottery/quilting shells */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <AppSwitcher currentAppId="hub" />

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex items-center gap-2 text-muted-foreground border-border"
            >
              <Search className="w-4 h-4" />
              <span>Global search...</span>
              <kbd className="hidden lg:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium ml-2">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="text-muted-foreground hover:text-foreground"
            >
              {isDark ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                window.location.href = "/modules/office/gmail";
              }}
              aria-label="Open Gmail"
              className="text-muted-foreground hover:text-foreground"
            >
              <Mail className="w-5 h-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                window.location.href = "/modules/travels/travel-calendar";
              }}
              aria-label="Travel Calendar"
              title="Travel Calendar"
              className="text-muted-foreground hover:text-foreground"
            >
              <CalendarDays className="w-5 h-5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 pl-3 border-l border-border outline-none">
                  <div className="flex-col items-end hidden sm:flex">
                    <span className="text-sm font-medium leading-none">
                      {displayName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {user?.email}
                    </span>
                  </div>
                  <Avatar className="h-9 w-9 border border-border">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-medium">{displayName}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user?.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate(`${base}account`)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Account settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={signOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Global search */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Search apps and actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Apps">
            {APPS.map((app) => (
              <CommandItem
                key={app.id}
                value={app.name}
                onSelect={() => {
                  setSearchOpen(false);
                  navigate(app.href);
                }}
              >
                <LayoutGrid className="w-4 h-4 mr-2" />
                Open {app.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Quick actions">
            <CommandItem
              value="Add Pottery piece"
              onSelect={() => {
                setSearchOpen(false);
                navigate(`${base}pottery/add`);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Pottery piece
            </CommandItem>
            <CommandItem
              value="Add Fabric"
              onSelect={() => {
                setSearchOpen(false);
                navigate(`${base}quilting/fabrics/add`);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Fabric
            </CommandItem>
            <CommandItem
              value="Do I own this?"
              onSelect={() => {
                setSearchOpen(false);
                navigate(`${base}pottery/compare`);
              }}
            >
              <Camera className="w-4 h-4 mr-2" />
              Do I own this?
            </CommandItem>
            <CommandItem
              value="Shopping List"
              onSelect={() => {
                setSearchOpen(false);
                navigate(`${base}quilting/shopping`);
              }}
            >
              <ShoppingBag className="w-4 h-4 mr-2" />
              Shopping List
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Main content — max-w-6xl matches header */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 pb-12 pt-6 space-y-10">
        {/* Welcome + actions */}
        <div className="flex flex-col lg:flex-row gap-8 justify-between items-start">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Welcome back, {firstName}.
            </h1>
            <p className="text-base text-muted-foreground">
              One account, every collection.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                  <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ADD_ACTIONS.map((a) => (
                  <DropdownMenuItem
                    key={a.href}
                    onSelect={() => navigate(a.href)}
                  >
                    <Plus className="w-4 h-4 mr-2 text-muted-foreground" />
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  <Camera className="w-4 h-4 mr-2" />
                  Do I own this?
                  <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => navigate(`${base}pottery/compare`)}
                >
                  <Camera className="w-4 h-4 mr-2 text-muted-foreground" />
                  Pottery piece
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => navigate(`${base}quilting/compare`)}
                >
                  <Camera className="w-4 h-4 mr-2 text-muted-foreground" />
                  Fabric
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              onClick={() => navigate(`${base}quilting/shopping`)}
            >
              <ShoppingBag className="w-4 h-4 mr-2" />
              Shopping List
            </Button>
          </div>
        </div>

        {/* Apps */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <LayoutGrid className="w-5 h-5 text-primary" />
              <h3 className="text-lg">Your apps</h3>
            </div>
            <button
              onClick={() => {
                if (arranging) {
                  setDraggedId(null);
                  setDragOverId(null);
                }
                setArranging((a) => !a);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                arranging
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <GripVertical className="w-3.5 h-3.5" />
              {arranging ? "Done" : "Arrange"}
            </button>
          </div>

          {arranging && (
            <p className="text-xs text-muted-foreground -mt-1">
              Drag cards to reorder. Your layout is saved automatically.
            </p>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {appCardOrder.map((appId) => {
              const app = APPS.find((a) => a.id === appId);
              const cfg = CARD_CONFIG[appId];
              if (!app || !cfg) return null;

              const isDragged = draggedId === appId;
              const isOver = dragOverId === appId;

              return (
                <div
                  key={appId}
                  draggable={arranging}
                  onDragStart={
                    arranging
                      ? (e) => {
                          setDraggedId(appId);
                          e.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                  onDragOver={
                    arranging
                      ? (e) => {
                          e.preventDefault();
                          if (appId !== draggedId) setDragOverId(appId);
                        }
                      : undefined
                  }
                  onDragLeave={
                    arranging
                      ? () => {
                          if (dragOverId === appId) setDragOverId(null);
                        }
                      : undefined
                  }
                  onDrop={
                    arranging
                      ? (e) => {
                          e.preventDefault();
                          if (draggedId && draggedId !== appId) {
                            const next = [...appCardOrder];
                            const from = next.indexOf(draggedId);
                            const to = next.indexOf(appId);
                            if (from !== -1 && to !== -1) {
                              next.splice(from, 1);
                              next.splice(to, 0, draggedId);
                              setAppCardOrder(next);
                            }
                          }
                          setDraggedId(null);
                          setDragOverId(null);
                        }
                      : undefined
                  }
                  onDragEnd={
                    arranging
                      ? () => {
                          setDraggedId(null);
                          setDragOverId(null);
                        }
                      : undefined
                  }
                  className={`relative transition-all duration-150 ${
                    arranging ? "cursor-grab" : ""
                  } ${isDragged ? "opacity-40 scale-95" : ""} ${
                    isOver && !isDragged
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-2xl"
                      : ""
                  }`}
                >
                  {arranging && (
                    <div className="absolute top-2 right-2 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-background/90 border border-border shadow-sm pointer-events-none">
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <AppHeroCard
                    app={app}
                    stats={liveStats(appId)}
                    quickLinks={cfg.quickLinks}
                    accentBorderColor={cfg.accentBorderColor}
                    accentSectionBg={cfg.accentSectionBg}
                    accentIconColor={cfg.accentIconColor}
                    expanded={!!expandedCards[appId]}
                    onToggle={() =>
                      setExpandedCards((prev) => ({
                        ...prev,
                        [appId]: !prev[appId],
                      }))
                    }
                    extraBlock={cfg.extraBlock}
                    statTile={
                      appId === "ornaments" ? (
                        <HallmarkEventStatTile />
                      ) : undefined
                    }
                    arranging={arranging}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Widgets */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <LayoutGrid className="w-5 h-5 text-primary" />
              <h3 className="text-lg">Widgets</h3>
              {totalCount > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({totalCount} active)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {customizing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground text-xs"
                  onClick={resetWidgets}
                >
                  Reset to defaults
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setLibraryOpen(true)}
              >
                <Activity className="w-3.5 h-3.5" />
                Widget library
              </Button>
              <Button
                variant={customizing ? "secondary" : "ghost"}
                size="sm"
                className="text-muted-foreground"
                onClick={() => setCustomizing((c) => !c)}
              >
                {customizing ? (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Done
                  </>
                ) : (
                  "Customize"
                )}
              </Button>
            </div>
          </div>

          {slots.length === 0 ? (
            <button
              onClick={() => setLibraryOpen(true)}
              className="w-full rounded-xl border-2 border-dashed border-border py-10 flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-muted/20 transition-colors"
            >
              <PlusCircle className="w-8 h-8" />
              <span className="font-medium">Add your first widget</span>
              <span className="text-xs max-w-[200px] text-center">
                Choose from {WIDGETS.length} widgets — stats, tools, RSS feeds,
                and more
              </span>
            </button>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {slots.map((slot) => {
                  // ── RSS instance ─────────────────────────────────────────
                  if (slot.t === "r") {
                    const rss = asRss(slot);
                    return (
                      <div
                        key={rss.iid}
                        className="relative rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-shadow"
                      >
                        {customizing && (
                          <button
                            onClick={() => removeSlot(rss.iid)}
                            aria-label="Remove RSS feed"
                            className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow hover:scale-110 transition-transform"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <RssFeedWidget
                          iid={rss.iid}
                          title={rss.title}
                          url={rss.url}
                          onUpdate={(cfg) => updateRss(rss.iid, cfg)}
                        />
                      </div>
                    );
                  }

                  // ── Static catalogue widget ──────────────────────────────
                  const w = byId.get(slot.id);
                  if (!w) return null;
                  const Icon = w.icon;
                  return (
                    <div
                      key={w.id}
                      className="relative rounded-xl border border-border bg-card p-4 space-y-3 hover:shadow-sm transition-shadow"
                    >
                      {customizing && (
                        <button
                          onClick={() => removeSlot(w.id)}
                          aria-label={`Remove ${w.title}`}
                          className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow hover:scale-110 transition-transform"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        <Icon className="w-4 h-4 text-primary" />
                        {w.title}
                      </div>
                      {w.body}
                    </div>
                  );
                })}
              </div>

              {/* Add more — always visible at the end */}
              {!customizing && (
                <button
                  onClick={() => setLibraryOpen(true)}
                  className="w-full rounded-xl border-2 border-dashed border-border py-5 flex items-center justify-center gap-2 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-muted/20 transition-colors text-sm"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Add widget</span>
                  <Rss className="w-3.5 h-3.5 opacity-60" />
                  <span className="text-muted-foreground/60 text-xs">
                    + RSS feeds
                  </span>
                </button>
              )}
            </>
          )}
        </section>

        {/* Recent Activity */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <Activity className="w-5 h-5 text-primary" />
              <h3 className="text-lg">Recent Activity</h3>
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              View all
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: "Added 'Speckled Mug'",
                cat: "Pottery",
                time: "2 hours ago",
              },
              {
                title: "Updated Fabric Stash",
                cat: "Quilting",
                time: "Yesterday",
              },
              {
                title: "Added 'Large Serving Bowl'",
                cat: "Pottery",
                time: "2 days ago",
              },
              {
                title: "Completed 'Star Pattern'",
                cat: "Quilting",
                time: "Last week",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <div className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg bg-secondary text-primary flex-shrink-0">
                  {item.cat.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.cat}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Widget library modal */}
      {libraryOpen && (
        <WidgetLibraryModal
          isStaticEnabled={isStaticEnabled}
          onToggle={toggleStatic}
          onAddRss={addRss}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
}
