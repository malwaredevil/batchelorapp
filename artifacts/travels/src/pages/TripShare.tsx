import { useRoute } from "wouter";
import { useEffect, useState } from "react";
import { Calendar, MapPin, Users, Plane, Train, Car, Clock } from "lucide-react";

type ItineraryActivity = {
  time: string;
  name: string;
  description: string;
  proximity: string;
  tip: string;
};

type ItineraryDay = {
  date: string;
  title: string;
  activities: ItineraryActivity[];
};

type TripShareData = {
  id: number;
  title: string;
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  travellerCount: number;
  notes?: string | null;
  itinerary?: { days: ItineraryDay[] } | null;
  theOneThing?: string[] | null;
  transportTo?: string | null;
  accommodationName?: string | null;
  accommodationArea?: string | null;
};

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;
  const parsed = new Date(`2000-01-01T${match[1]!.padStart(2, "0")}:${match[2]}:00`);
  if (isNaN(parsed.getTime())) return time;
  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function TransportIcon({ transport }: { transport?: string | null }) {
  if (transport === "flew") return <Plane className="w-4 h-4" />;
  if (transport === "train") return <Train className="w-4 h-4" />;
  return <Car className="w-4 h-4" />;
}

export default function TripShare() {
  const [, params] = useRoute("/trips/share/:token");
  const token = params?.token ?? "";
  const [trip, setTrip] = useState<TripShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detect ?print=1 — auto-trigger print dialog once data loads
  const autoPrint =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("print") === "1";

  useEffect(() => {
    if (!token) {
      setError("Invalid share link");
      setLoading(false);
      return;
    }
    fetch(`/api/travels/trips/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Not found");
        }
        return res.json() as Promise<TripShareData>;
      })
      .then((data) => {
        setTrip(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, [token]);

  // Auto-print once the trip data has fully loaded
  useEffect(() => {
    if (!autoPrint || !trip || loading) return;
    // Small delay lets the DOM finish rendering before the print dialog opens
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [autoPrint, trip, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground animate-pulse">Loading itinerary…</div>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3 px-6">
        <MapPin className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-lg font-medium text-foreground">Itinerary not found</p>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          This share link may have expired or been revoked.
        </p>
      </div>
    );
  }

  const itinerary = trip.itinerary;
  const nights =
    trip.startDate && trip.endDate
      ? Math.round(
          (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) /
            86400000,
        )
      : null;

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 12pt; }
          .page-break { page-break-before: always; }
        }
      `}</style>

      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="bg-card border-b border-border/50 sticky top-0 z-10 no-print">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Shared itinerary via Batchelor Travels</p>
            <button
              onClick={() => window.print()}
              className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              Print / Save as PDF
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
          {/* Trip header */}
          <div className="space-y-3">
            <h1 className="font-serif text-3xl text-foreground leading-tight">{trip.title}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {trip.destination}
              </span>
              {trip.startDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {formatDate(trip.startDate)}
                  {trip.endDate && ` – ${formatDate(trip.endDate)}`}
                  {nights != null && nights > 0 && ` (${nights} night${nights !== 1 ? "s" : ""})`}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                {trip.travellerCount} traveller{trip.travellerCount !== 1 ? "s" : ""}
              </span>
              {trip.transportTo && (
                <span className="flex items-center gap-1.5">
                  <TransportIcon transport={trip.transportTo} />
                  {trip.transportTo === "flew"
                    ? "Flying"
                    : trip.transportTo === "train"
                      ? "By train"
                      : "Driving"}
                </span>
              )}
            </div>
            {trip.accommodationName && (
              <p className="text-sm text-muted-foreground">
                Staying at: <span className="text-foreground font-medium">{trip.accommodationName}</span>
                {trip.accommodationArea && `, ${trip.accommodationArea}`}
              </p>
            )}
            {trip.theOneThing && (trip.theOneThing as string[]).length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary/70 mb-1">The one thing</p>
                <p className="text-sm text-foreground italic">
                  "{(trip.theOneThing as string[]).join(", ")}"
                </p>
              </div>
            )}
            {trip.notes && (
              <p className="text-sm text-muted-foreground leading-relaxed">{trip.notes}</p>
            )}
          </div>

          {/* Itinerary */}
          {itinerary?.days && itinerary.days.length > 0 ? (
            <div className="space-y-6">
              <h2 className="font-serif text-2xl text-foreground border-b border-border/50 pb-2">
                Day-by-Day Itinerary
              </h2>
              {itinerary.days.map((day, dayIdx) => (
                <div key={dayIdx} className="space-y-3">
                  {/* Day header */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary">{dayIdx + 1}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{day.title}</p>
                      {day.date && (
                        <p className="text-xs text-muted-foreground">{formatDate(day.date)}</p>
                      )}
                    </div>
                  </div>

                  {/* Activities */}
                  <div className="ml-11 space-y-3">
                    {day.activities.map((act, actIdx) => (
                      <div
                        key={actIdx}
                        className="bg-card border border-border/50 rounded-lg p-3 space-y-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground shrink-0 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(act.time)}
                            </span>
                            <span className="font-medium text-sm text-foreground">{act.name}</span>
                          </div>
                          {act.proximity && (
                            <span className="text-xs text-muted-foreground shrink-0">{act.proximity}</span>
                          )}
                        </div>
                        {act.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {act.description}
                          </p>
                        )}
                        {act.tip && (
                          <p className="text-xs text-primary/80 italic">
                            💡 {act.tip}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No itinerary has been created for this trip yet.</p>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-border/50 pt-6 text-center no-print">
            <p className="text-xs text-muted-foreground">
              Created with{" "}
              <a
                href="/travels"
                className="text-primary hover:underline"
              >
                Batchelor Travels
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
