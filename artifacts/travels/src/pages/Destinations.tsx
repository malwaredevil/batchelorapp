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
import { MapPin, Search, Plane, Users, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_COLORS: Record<TripStatus, string> = {
  wishlist: "bg-slate-100 text-slate-700 border-slate-200",
  planning: "bg-blue-50 text-blue-700 border-blue-200",
  booked: "bg-green-50 text-green-700 border-green-200",
  active: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-gray-100 text-gray-500 border-gray-200",
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
              {trip.status}
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
