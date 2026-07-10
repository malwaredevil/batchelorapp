import { useState } from "react";
import { useLocation } from "wouter";
import {
  useExploreDestination,
  useCreateTrip,
  getListTripsQueryKey,
  getGetTravelsStatsQueryKey,
  type ExploreDestinationResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Compass,
  Search,
  MapPin,
  Clock,
  Globe,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Navigation,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/travels/lib/assistant-context";

function HighlightCard({
  h,
}: {
  h: { name: string; description: string; category: string };
}) {
  return (
    <div className="border border-border/60 rounded-lg p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-foreground text-sm">{h.name}</p>
        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border/50 shrink-0 capitalize">
          {h.category}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{h.description}</p>
    </div>
  );
}

function currentTimeInZone(timeZoneId: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZoneId,
    }).format(new Date());
  } catch {
    return "";
  }
}

function ExploreResult({ result }: { result: ExploreDestinationResult }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const createTrip = useCreateTrip();
  const [showAll, setShowAll] = useState(false);
  const { overview } = result;
  const highlights = overview.highlights ?? [];
  const displayed = showAll ? highlights : highlights.slice(0, 3);
  const tz = result.timezone;

  const handleAddToWishlist = () => {
    createTrip.mutate(
      {
        data: {
          title: `Trip to ${result.destination}`,
          destination: result.destination,
          lat: result.lat,
          lng: result.lng,
          status: "wishlist",
        },
      },
      {
        onSuccess: (trip) => {
          qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
          toast.success("Added to wishlist");
          setLocation(`/trips/${trip.id}`);
        },
        onError: () => toast.error("Failed to add to wishlist"),
      },
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-2xl text-foreground">
            {result.destination}
          </h2>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {result.distanceKm != null && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5 shrink-0" />
                {result.distanceKm.toLocaleString()} km from home
              </p>
            )}
            {result.mapsUrl && (
              <a
                href={result.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                Directions from Reichenbach
              </a>
            )}
          </div>
        </div>
        <Button
          onClick={handleAddToWishlist}
          disabled={createTrip.isPending}
          variant="outline"
        >
          <MapPin className="w-4 h-4 mr-2" />
          {createTrip.isPending ? "Adding..." : "Add to wishlist"}
        </Button>
      </div>

      {overview.description && (
        <Card className="border-border/50">
          <CardContent className="py-4">
            <p className="text-foreground leading-relaxed">
              {overview.description}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {overview.bestTimeToVisit && (
          <Card className="border-border/50">
            <CardContent className="py-3 flex items-start gap-3">
              <Clock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Best time to visit
                </p>
                <p className="text-sm text-foreground">
                  {overview.bestTimeToVisit}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {tz && (
          <Card className="border-border/50">
            <CardContent className="py-3 flex items-start gap-3">
              <Clock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Local time
                </p>
                <p className="text-sm text-foreground">
                  {currentTimeInZone(tz.timeZoneId)} · {tz.timeZoneName}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {overview.practicalInfo?.currency && (
          <Card className="border-border/50">
            <CardContent className="py-3 flex items-start gap-3">
              <Globe className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Currency / Language
                </p>
                <p className="text-sm text-foreground">
                  {overview.practicalInfo.currency}
                  {overview.practicalInfo.language
                    ? ` · ${overview.practicalInfo.language}`
                    : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {overview.practicalInfo?.transit && (
          <Card className="border-border/50">
            <CardContent className="py-3 flex items-start gap-3">
              <Compass className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Getting around
                </p>
                <p className="text-sm text-foreground">
                  {overview.practicalInfo.transit}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {overview.practicalInfo?.tipping && (
          <Card className="border-border/50 sm:col-span-3">
            <CardContent className="py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Tipping culture
              </p>
              <p className="text-sm text-foreground">
                {overview.practicalInfo.tipping}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {highlights.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">Highlights</h3>
          <div className="grid grid-cols-1 gap-2">
            {displayed.map((h, i) => (
              <HighlightCard key={i} h={h} />
            ))}
          </div>
          {highlights.length > 3 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {showAll ? (
                <>
                  <ChevronUp className="w-4 h-4" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" /> Show all{" "}
                  {highlights.length} highlights
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Explore() {
  const [destination, setDestination] = useState("");
  const explore = useExploreDestination();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) return;
    explore.mutate(
      { data: { destination: destination.trim() } },
      {
        onError: () => toast.error("Failed to explore destination. Try again."),
      },
    );
  };

  usePageAssistantContext(
    "explore",
    `On the Explore page.` +
      (destination.trim()
        ? ` User has typed "${destination.trim()}" in the destination search box.`
        : "") +
      (explore.data
        ? ` Currently showing AI overview results for "${destination.trim()}".`
        : ""),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Explore</h1>
        <p className="text-muted-foreground mt-1">
          Get an AI overview of any destination, then add it to your wishlist.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search a destination — e.g. Kyoto, Japan"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          disabled={explore.isPending || !destination.trim()}
        >
          {explore.isPending ? (
            <>
              <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
              Exploring...
            </>
          ) : (
            "Explore"
          )}
        </Button>
      </form>

      {explore.isPending && (
        <div className="space-y-3">
          <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
          <div className="h-24 rounded-xl bg-muted animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {explore.data && !explore.isPending && (
        <ExploreResult result={explore.data} />
      )}

      {!explore.data && !explore.isPending && (
        <Card className="border-dashed border-2 border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Compass className="w-10 h-10 text-muted-foreground/40" />
            <p className="font-medium text-foreground">Where to next?</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Search any city, region, or country and get an AI-generated
              overview with highlights and practical tips.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
