import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListDestinations,
  type DestinationGroup,
  type Trip,
  type TripStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Search, Plane, Users, ChevronDown, ChevronUp, Globe } from "lucide-react";

const STATUS_COLORS: Record<TripStatus, string> = {
  wishlist:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  planning:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  booked:    "bg-orange-50 text-orange-700 border-orange-200",
  active:    "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-green-50  text-green-700  border-green-200",
};

const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist:  "Wishlist",
  planning:  "Planning",
  booked:    "Booked",
  active:    "Active",
  completed: "Completed",
};

function TripTimelineRow({ trip }: { trip: Trip }) {
  const travelers = trip.travelers as string[] | null;
  const oneThings = trip.theOneThing as string[] | null;

  return (
    <Link href={`/trips/${trip.id}`}>
      <div className="flex items-start gap-4 py-3 px-4 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group">
        <div className="w-1 self-stretch rounded-full bg-border/60 shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-medium text-sm text-foreground">{trip.title}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_COLORS[trip.status]}`}>
              {STATUS_LABELS[trip.status]}
            </span>
          </div>
          {trip.startDate && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(trip.startDate).toLocaleDateString("en-GB", {
                day: "numeric", month: "short", year: "numeric",
              })}
              {trip.endDate && (
                <> — {new Date(trip.endDate).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}</>
              )}
            </p>
          )}
          {travelers?.length ? (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Users className="w-3 h-3 shrink-0" />
              {travelers.join(", ")}
            </p>
          ) : null}
          {oneThings?.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {oneThings.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-primary/25 bg-primary/5 text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function DestinationCard({ group }: { group: DestinationGroup }) {
  const [expanded, setExpanded] = useState(group.trips.length === 1);
  const completedCount = group.trips.filter((t) => t.status === "completed").length;
  const upcomingCount = group.trips.filter((t) =>
    ["booked", "planning", "active"].includes(t.status),
  ).length;

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader className="py-4 px-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold text-foreground leading-tight">
                {group.destination}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {group.trips.length} {group.trips.length === 1 ? "visit" : "visits"}
                {completedCount > 0 && ` · ${completedCount} completed`}
                {upcomingCount > 0 && ` · ${upcomingCount} upcoming`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-0 pb-0 pt-2">
          <div className="divide-y divide-border/30">
            {group.trips.map((trip) => (
              <TripTimelineRow key={trip.id} trip={trip} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

const FAMILY_MEMBERS = ["John", "Ashley", "Karis", "Angela"] as const;

/** Extract the country from "City, Country" — falls back to the full string. */
function extractCountry(destination: string): string {
  const parts = destination.split(",");
  return parts.length > 1 ? parts[parts.length - 1].trim() : destination.trim();
}

// ─── Cat portrait SVGs ───────────────────────────────────────────────────────

/** John — Dad orange tabby. Broad brow, confident look. */
function JohnCat() {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="52" height="52">
      {/* Ears */}
      <polygon points="7,17 12,4 17,17" fill="#f97316" />
      <polygon points="23,17 28,4 33,17" fill="#f97316" />
      <polygon points="9,16 12,7 15,16" fill="#fda4af" />
      <polygon points="25,16 28,7 31,16" fill="#fda4af" />
      {/* Head */}
      <circle cx="20" cy="24" r="13" fill="#f97316" />
      {/* Tabby forehead stripes */}
      <path d="M14,16 Q17,14 20,16" stroke="#c2410c" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M16,13 Q19,11 22,13" stroke="#c2410c" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M13,18.5 Q16,17 19,18.5" stroke="#c2410c" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      {/* Dad brows — straight and a bit heavy */}
      <path d="M11.5,19.5 Q14.5,18 17.5,19.5" stroke="#c2410c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M22.5,19.5 Q25.5,18 28.5,19.5" stroke="#c2410c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Eyes — slightly narrowed */}
      <ellipse cx="14.5" cy="22.5" rx="2.8" ry="2.4" fill="#1c0a00" />
      <ellipse cx="25.5" cy="22.5" rx="2.8" ry="2.4" fill="#1c0a00" />
      <circle cx="15.2" cy="21.8" r="0.9" fill="white" />
      <circle cx="26.2" cy="21.8" r="0.9" fill="white" />
      {/* Muzzle */}
      <ellipse cx="20" cy="28" rx="5" ry="3.5" fill="#fb923c" opacity="0.45" />
      {/* Nose */}
      <polygon points="20,26 18.8,27.8 21.2,27.8" fill="#e879a0" />
      {/* Mouth */}
      <path d="M18.8,27.8 Q20,29.5 21.2,27.8" fill="none" stroke="#7c2d12" strokeWidth="0.8" strokeLinecap="round" />
      {/* Whiskers */}
      <line x1="3" y1="25.5" x2="14.5" y2="27" stroke="#7c2d12" strokeWidth="0.6" opacity="0.6" />
      <line x1="3" y1="27.5" x2="14.5" y2="28" stroke="#7c2d12" strokeWidth="0.6" opacity="0.6" />
      <line x1="3" y1="29.5" x2="14.5" y2="29" stroke="#7c2d12" strokeWidth="0.6" opacity="0.6" />
      <line x1="25.5" y1="27" x2="37" y2="25.5" stroke="#7c2d12" strokeWidth="0.6" opacity="0.6" />
      <line x1="25.5" y1="28" x2="37" y2="27.5" stroke="#7c2d12" strokeWidth="0.6" opacity="0.6" />
      <line x1="25.5" y1="29" x2="37" y2="29.5" stroke="#7c2d12" strokeWidth="0.6" opacity="0.6" />
    </svg>
  );
}

/** Ashley — Mom orange tabby. Softer eyes, eyelashes, warm smile. */
function AshleyCat() {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="52" height="52">
      {/* Ears */}
      <polygon points="7,17 12,4 17,17" fill="#fb923c" />
      <polygon points="23,17 28,4 33,17" fill="#fb923c" />
      <polygon points="9,16 12,7 15,16" fill="#fecdd3" />
      <polygon points="25,16 28,7 31,16" fill="#fecdd3" />
      {/* Head */}
      <circle cx="20" cy="24" r="13" fill="#fb923c" />
      {/* Light tabby stripes */}
      <path d="M15,15 Q18,13.5 21,15" stroke="#ea580c" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M16.5,12.5 Q19,11 21.5,12.5" stroke="#ea580c" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      {/* Gentle curved brows */}
      <path d="M11.5,20 Q14.5,18.5 17.5,20" stroke="#ea580c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M22.5,20 Q25.5,18.5 28.5,20" stroke="#ea580c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      {/* Eyes — rounder */}
      <ellipse cx="14.5" cy="22.5" rx="2.8" ry="3" fill="#1c0a00" />
      <ellipse cx="25.5" cy="22.5" rx="2.8" ry="3" fill="#1c0a00" />
      <circle cx="15.2" cy="21.6" r="1" fill="white" />
      <circle cx="26.2" cy="21.6" r="1" fill="white" />
      {/* Eyelashes — left eye */}
      <line x1="12" y1="20.2" x2="11" y2="19" stroke="#1c0a00" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="14" y1="19.6" x2="13.5" y2="18.2" stroke="#1c0a00" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="16.5" y1="20" x2="17" y2="18.7" stroke="#1c0a00" strokeWidth="0.8" strokeLinecap="round" />
      {/* Eyelashes — right eye */}
      <line x1="23" y1="20" x2="22.5" y2="18.7" stroke="#1c0a00" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="25.5" y1="19.6" x2="25" y2="18.2" stroke="#1c0a00" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="28" y1="20.2" x2="29" y2="19" stroke="#1c0a00" strokeWidth="0.8" strokeLinecap="round" />
      {/* Cheek blush */}
      <ellipse cx="11.5" cy="27" rx="3.5" ry="2" fill="#fca5a5" opacity="0.45" />
      <ellipse cx="28.5" cy="27" rx="3.5" ry="2" fill="#fca5a5" opacity="0.45" />
      {/* Muzzle */}
      <ellipse cx="20" cy="28" rx="5" ry="3.5" fill="#fdba74" opacity="0.5" />
      {/* Nose */}
      <polygon points="20,26 18.8,27.6 21.2,27.6" fill="#e879a0" />
      {/* Smile */}
      <path d="M18.8,27.6 Q20,29.8 21.2,27.6" fill="none" stroke="#7c2d12" strokeWidth="0.8" strokeLinecap="round" />
      {/* Whiskers */}
      <line x1="3" y1="25.5" x2="14.5" y2="26.8" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="3" y1="27.5" x2="14.5" y2="28" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="3" y1="29.5" x2="14.5" y2="29.2" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="25.5" y1="26.8" x2="37" y2="25.5" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="25.5" y1="28" x2="37" y2="27.5" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="25.5" y1="29.2" x2="37" y2="29.5" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
    </svg>
  );
}

/** Karis — Teen girl orange & white tabby. Bold body stripes, white bib, blue eyes, bow. */
function KarisCat() {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="52" height="52">
      {/* Ears — orange with white tips */}
      <polygon points="7,17 12,4 17,17" fill="#f97316" />
      <polygon points="23,17 28,4 33,17" fill="#f97316" />
      <polygon points="9.5,15.5 12,8 14.5,15.5" fill="#fafaf9" />
      <polygon points="25.5,15.5 28,8 30.5,15.5" fill="#fafaf9" />
      {/* Head base — orange */}
      <circle cx="20" cy="24" r="13" fill="#f97316" />
      {/* Bold classic-tabby "M" mark + swirl stripes on forehead */}
      <path d="M14,14 L17,19 M26,14 L23,19 M17,19 L20,15 L23,19" stroke="#9a3412" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Bold cheek/side stripes */}
      <path d="M6.5,20 Q9.5,19 12,21" stroke="#9a3412" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M28,21 Q30.5,19 33.5,20" stroke="#9a3412" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M7,25 Q10,24.3 12.5,25.5" stroke="#9a3412" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M27.5,25.5 Q30,24.3 33,25" stroke="#9a3412" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* White bib patch — rounder/smaller than Angela's */}
      <ellipse cx="20" cy="31.5" rx="6.5" ry="5" fill="#fafaf9" />
      {/* Brows — arched, playful */}
      <path d="M11,19.5 Q13.5,17.5 16,19" stroke="#9a3412" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M24,19 Q26.5,17.5 29,19.5" stroke="#9a3412" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* Eyes — wide, bright blue */}
      <ellipse cx="14" cy="22.5" rx="3" ry="3.2" fill="#fafaf9" />
      <ellipse cx="14" cy="22.5" rx="2.2" ry="2.5" fill="#0284c7" />
      <ellipse cx="14" cy="22.5" rx="1.2" ry="1.6" fill="#0a0a0a" />
      <circle cx="14.6" cy="21.6" r="0.8" fill="white" />
      <ellipse cx="26" cy="22.5" rx="3" ry="3.2" fill="#fafaf9" />
      <ellipse cx="26" cy="22.5" rx="2.2" ry="2.5" fill="#0284c7" />
      <ellipse cx="26" cy="22.5" rx="1.2" ry="1.6" fill="#0a0a0a" />
      <circle cx="26.6" cy="21.6" r="0.8" fill="white" />
      {/* Nose */}
      <polygon points="20,26.5 18.8,28 21.2,28" fill="#e879a0" />
      {/* Mouth */}
      <path d="M18.8,28 Q20,30 21.2,28" fill="none" stroke="#78716c" strokeWidth="0.8" strokeLinecap="round" />
      {/* Whiskers */}
      <line x1="3" y1="26" x2="14.5" y2="27.5" stroke="#78716c" strokeWidth="0.55" opacity="0.6" />
      <line x1="3" y1="28" x2="14.5" y2="28.5" stroke="#78716c" strokeWidth="0.55" opacity="0.6" />
      <line x1="25.5" y1="27.5" x2="37" y2="26" stroke="#78716c" strokeWidth="0.55" opacity="0.6" />
      <line x1="25.5" y1="28.5" x2="37" y2="28" stroke="#78716c" strokeWidth="0.55" opacity="0.6" />
      {/* Bow — between ears, teal (distinct from Angela's plain look) */}
      <polygon points="14,5.5 17,8 14,10.5 11,8" fill="#5eead4" />
      <circle cx="14" cy="8" r="1.3" fill="#0d9488" />
      <polygon points="14,5.5 11,8 14,10.5 17,8" fill="#99f6e4" opacity="0.6" />
    </svg>
  );
}

/** Angela — Orange and white teen tabby. Orange top, white muzzle, bright eyes. */
function AngelaCat() {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="52" height="52">
      {/* Ears */}
      <polygon points="7,17 12,4 17,17" fill="#f97316" />
      <polygon points="23,17 28,4 33,17" fill="#f97316" />
      <polygon points="9,16 12,7 15,16" fill="#fecdd3" />
      <polygon points="25,16 28,7 31,16" fill="#fecdd3" />
      {/* Head base — orange */}
      <circle cx="20" cy="24" r="13" fill="#f97316" />
      {/* White chest/muzzle patch */}
      <ellipse cx="20" cy="30" rx="9" ry="7" fill="#fafaf9" />
      {/* Tabby stripes on forehead */}
      <path d="M14,15.5 Q17,14 20,15.5" stroke="#c2410c" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M15.5,12.5 Q18.5,11 21.5,12.5" stroke="#c2410c" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* Tabby cheek marks */}
      <path d="M8,24 Q10,22.5 12,24" stroke="#c2410c" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <path d="M28,24 Q30,22.5 32,24" stroke="#c2410c" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      {/* Brows — gentle teen arch */}
      <path d="M11.5,20 Q14.5,18 17.5,20" stroke="#c2410c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M22.5,20 Q25.5,18 28.5,20" stroke="#c2410c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      {/* Eyes — round, bright green-hazel */}
      <ellipse cx="14.5" cy="22.5" rx="3" ry="3.2" fill="#fafaf9" />
      <ellipse cx="14.5" cy="22.5" rx="2.2" ry="2.5" fill="#15803d" />
      <ellipse cx="14.5" cy="22.5" rx="1.2" ry="1.6" fill="#0a0a0a" />
      <circle cx="15.2" cy="21.5" r="0.9" fill="white" />
      <ellipse cx="25.5" cy="22.5" rx="3" ry="3.2" fill="#fafaf9" />
      <ellipse cx="25.5" cy="22.5" rx="2.2" ry="2.5" fill="#15803d" />
      <ellipse cx="25.5" cy="22.5" rx="1.2" ry="1.6" fill="#0a0a0a" />
      <circle cx="26.2" cy="21.5" r="0.9" fill="white" />
      {/* Nose */}
      <polygon points="20,26.5 18.8,28.2 21.2,28.2" fill="#e879a0" />
      {/* Mouth */}
      <path d="M18.8,28.2 Q20,30.2 21.2,28.2" fill="none" stroke="#7c2d12" strokeWidth="0.8" strokeLinecap="round" />
      {/* Whiskers */}
      <line x1="3" y1="26" x2="14.5" y2="27.5" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="3" y1="28" x2="14.5" y2="28.5" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="3" y1="30" x2="14.5" y2="29.5" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="25.5" y1="27.5" x2="37" y2="26" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="25.5" y1="28.5" x2="37" y2="28" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
      <line x1="25.5" y1="29.5" x2="37" y2="30" stroke="#7c2d12" strokeWidth="0.55" opacity="0.55" />
    </svg>
  );
}

const CAT_AVATARS: Record<string, React.FC> = {
  John: JohnCat,
  Ashley: AshleyCat,
  Karis: KarisCat,
  Angela: AngelaCat,
};

function FamilyCountrySummary({ groups }: { groups: DestinationGroup[] }) {
  const completedGroups = groups.map((g) => ({
    ...g,
    trips: g.trips.filter((t) => t.status === "completed"),
  })).filter((g) => g.trips.length > 0);

  const stats = FAMILY_MEMBERS.map((name) => {
    const countries = new Set<string>();
    const destinations = new Set<string>();
    completedGroups.forEach((g) => {
      g.trips.forEach((t) => {
        const travelers = t.travelers as string[] | null;
        if (travelers?.includes(name)) {
          countries.add(extractCountry(g.destination));
          destinations.add(g.destination);
        }
      });
    });
    return { name, countries: countries.size, destinations: destinations.size };
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(({ name, countries, destinations }) => {
        const CatIcon = CAT_AVATARS[name];
        return (
          <Card key={name} className="border-border/50">
            <CardContent className="py-4 px-4 flex flex-col items-center text-center gap-1.5">
              <div className="w-14 h-14 flex items-center justify-center">
                {CatIcon && <CatIcon />}
              </div>
              <p className="font-medium text-foreground text-sm leading-tight">{name}</p>
              <div className="flex items-center gap-1 text-2xl font-bold text-foreground leading-none">
                <Globe className="w-4 h-4 text-muted-foreground mb-0.5" />
                {countries}
              </div>
              <p className="text-xs text-muted-foreground">
                {countries === 1 ? "country" : "countries"}
                {destinations > 0 && ` · ${destinations} ${destinations === 1 ? "place" : "places"}`}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function Destinations() {
  const { data: groups = [], isLoading } = useListDestinations();
  const [search, setSearch] = useState("");
  const [filterPerson, setFilterPerson] = useState<string[]>([]);

  const filtered = useMemo(() => {
    let result = groups;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((g) => g.destination.toLowerCase().includes(q));
    }
    if (filterPerson.length > 0) {
      result = result.filter((g) =>
        g.trips.some((t) => {
          const travelers = t.travelers as string[] | null;
          return filterPerson.every((p) => travelers?.includes(p));
        }),
      );
    }
    return result;
  }, [groups, search, filterPerson]);

  const togglePerson = (name: string) =>
    setFilterPerson((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );

  const totalVisits = groups.reduce((sum, g) => sum + g.trips.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Places</h1>
        <p className="text-muted-foreground mt-1">
          {isLoading
            ? "Loading..."
            : `${groups.length} destination${groups.length !== 1 ? "s" : ""} · ${totalVisits} total visits`}
        </p>
      </div>

      {/* Family country summary */}
      {!isLoading && groups.length > 0 && <FamilyCountrySummary groups={groups} />}

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search destinations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center">Filter by traveler:</span>
          {FAMILY_MEMBERS.map((name) => {
            const active = filterPerson.includes(name);
            return (
              <button
                key={name}
                onClick={() => togglePerson(name)}
                className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {name}
              </button>
            );
          })}
          {filterPerson.length > 0 && (
            <button
              onClick={() => setFilterPerson([])}
              className="text-xs px-2 py-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Plane className="w-10 h-10 text-muted-foreground/40" />
            <p className="font-medium text-foreground">No destinations found</p>
            <p className="text-sm text-muted-foreground">
              {search || filterPerson.length > 0
                ? "Try adjusting your filters."
                : "Add trips to see your destination timeline here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((group) => (
            <DestinationCard key={group.destination} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
