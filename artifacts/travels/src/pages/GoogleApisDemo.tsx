import { useState } from "react";
import { Link } from "wouter";
import {
  useListTrips,
  useCreateTrip,
  getWeatherForecast,
  getTimeZoneInfo,
  getAirQualityInfo,
  getPollenInfo,
  searchNearbyPlaces,
  getNearbyPlaceCountInfo,
  getStaticMapImageUrl,
  getStreetViewImageUrl,
  computeRouteInfo,
  getAerialViewInfo,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ExternalLink, Sparkles } from "lucide-react";

const DEMO_TRIP_TITLE = "🧪 Google APIs Demo Trip";
const DEMO_DESTINATION = "Paris, France";
const DEMO_LAT = 48.8584; // Eiffel Tower — reliable coverage for every Maps Platform API below
const DEMO_LNG = 2.2945;
const NEARBY_LANDMARK = { lat: 48.8738, lng: 2.295 }; // Arc de Triomphe, for the route demo
const AERIAL_VIEW_DEMO_ADDRESS = "Golden Gate Bridge, San Francisco, CA"; // Aerial View coverage is landmark-specific, not address-general

type Status = "live" | "not-yet-wired";

function ApiCard({
  name,
  description,
  status,
  usedIn,
  children,
}: {
  name: string;
  description: string;
  status: Status;
  usedIn?: { label: string; href: string }[];
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          <Badge variant={status === "live" ? "default" : "secondary"}>
            {status === "live" ? "Used in app" : "Demo only"}
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {usedIn && usedIn.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {usedIn.map((u) => (
              <Link key={u.href} href={u.href}>
                <Button variant="outline" size="sm" className="gap-1">
                  {u.label}
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeatherDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-weather", lat, lng],
    queryFn: () => getWeatherForecast(lat, lng),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error)
    return (
      <p className="text-sm text-muted-foreground">Unavailable right now.</p>
    );
  const days = data?.forecast?.slice(0, 3) ?? [];
  return (
    <div className="flex gap-3 text-sm">
      {days.map((d) => (
        <div
          key={d.date}
          className="rounded-md border border-card-border px-2 py-1"
        >
          <div className="font-medium">{d.date}</div>
          <div className="text-muted-foreground">{d.conditionDescription}</div>
          <div>
            {d.maxTempC}° / {d.minTempC}°C
          </div>
        </div>
      ))}
    </div>
  );
}

function TimeZoneDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-timezone", lat, lng],
    queryFn: () => getTimeZoneInfo(lat, lng),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error || !data?.timeZone)
    return (
      <p className="text-sm text-muted-foreground">Unavailable right now.</p>
    );
  const tz = data.timeZone;
  return (
    <p className="text-sm">
      <span className="font-medium">{tz.timeZoneId}</span> ({tz.timeZoneName}) —
      UTC offset {(tz.rawOffsetSeconds + tz.dstOffsetSeconds) / 3600}h
    </p>
  );
}

function AirQualityDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-air-quality", lat, lng],
    queryFn: () => getAirQualityInfo(lat, lng),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error || !data?.airQuality)
    return (
      <p className="text-sm text-muted-foreground">
        No coverage for this location.
      </p>
    );
  const aq = data.airQuality;
  return (
    <p className="text-sm">
      AQI <span className="font-medium">{aq.aqi}</span> — {aq.category}{" "}
      (dominant: {aq.dominantPollutant})
    </p>
  );
}

function PollenDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-pollen", lat, lng],
    queryFn: () => getPollenInfo(lat, lng),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error || !data?.pollen)
    return (
      <p className="text-sm text-muted-foreground">
        No coverage for this location.
      </p>
    );
  const p = data.pollen;
  return (
    <div className="text-sm">
      <p>
        {p.date} — overall{" "}
        <span className="font-medium">{p.overallCategory}</span>
      </p>
      <ul className="list-disc pl-5 text-muted-foreground">
        {p.types.map((t) => (
          <li key={t.code}>
            {t.displayName}: {t.category}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlacesDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-places", lat, lng],
    queryFn: () => searchNearbyPlaces("coffee", lat, lng),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error)
    return (
      <p className="text-sm text-muted-foreground">Unavailable right now.</p>
    );
  const places = data?.places?.slice(0, 3) ?? [];
  return (
    <ul className="space-y-1 text-sm">
      {places.map((p) => (
        <li key={p.id}>
          <span className="font-medium">{p.name}</span>
          {p.rating != null && (
            <span className="text-muted-foreground"> · ★{p.rating}</span>
          )}
        </li>
      ))}
      {places.length === 0 && (
        <p className="text-muted-foreground">No results found.</p>
      )}
    </ul>
  );
}

function AreaInsightsDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-nearby-count", lat, lng],
    queryFn: () => getNearbyPlaceCountInfo(lat, lng, "restaurant", 1500),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error)
    return (
      <p className="text-sm text-muted-foreground">Unavailable right now.</p>
    );
  return (
    <p className="text-sm">
      <span className="font-medium">{data?.count ?? 0}</span> restaurants within
      1.5km
    </p>
  );
}

function StaticMapDemo({ lat, lng }: { lat: number; lng: number }) {
  return (
    <img
      src={getStaticMapImageUrl(lat, lng, 400, 200, 13)}
      alt="Static map preview"
      className="w-full max-w-sm rounded-md border border-card-border"
    />
  );
}

function StreetViewDemo({ lat, lng }: { lat: number; lng: number }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <p className="text-sm text-muted-foreground">
        No Street View coverage here.
      </p>
    );
  return (
    <img
      src={getStreetViewImageUrl(lat, lng, 400, 200)}
      alt="Street View preview"
      className="w-full max-w-sm rounded-md border border-card-border"
      onError={() => setFailed(true)}
    />
  );
}

function RoutesDemo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-route", lat, lng],
    queryFn: () =>
      computeRouteInfo({
        origin: { lat, lng },
        destination: NEARBY_LANDMARK,
        mode: "WALK",
      }),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error)
    return (
      <p className="text-sm text-muted-foreground">Unavailable right now.</p>
    );
  return (
    <p className="text-sm">
      Walking to Arc de Triomphe:{" "}
      <span className="font-medium">
        {(data!.distanceMeters / 1000).toFixed(1)} km
      </span>
      , {Math.round(data!.durationSeconds / 60)} min
    </p>
  );
}

function AerialViewDemo({ address }: { address: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-aerial-view", address],
    queryFn: () => getAerialViewInfo(address),
  });
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error)
    return (
      <p className="text-sm text-muted-foreground">Unavailable right now.</p>
    );
  if (data?.state === "ACTIVE" && data.videoUrl) {
    return (
      <video
        src={data.videoUrl}
        poster={data.thumbnailUrl}
        controls
        className="w-full max-w-sm rounded-md"
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {data?.state === "PROCESSING"
        ? "Video is rendering — Google generates aerial views on first request, try again shortly."
        : "No aerial view available for this address."}
    </p>
  );
}

export default function GoogleApisDemo() {
  const { data: trips, isLoading: tripsLoading } = useListTrips();
  const createTrip = useCreateTrip();

  const demoTrip = trips?.find((t) => t.title === DEMO_TRIP_TITLE);

  const handleCreateDemoTrip = () => {
    createTrip.mutate({
      data: {
        title: DEMO_TRIP_TITLE,
        destination: DEMO_DESTINATION,
        lat: DEMO_LAT,
        lng: DEMO_LNG,
        status: "planning",
        startDate: "2026-10-12",
        endDate: "2026-10-19",
        transportTo: "flew",
        accommodationName: "Sample Hotel (fake data)",
        accommodationArea: "Le Marais",
        notes:
          "This trip was created for the Google APIs demo page — safe to delete. It uses fake data pinned at the Eiffel Tower so every Google Maps Platform integration in this app has real coordinates to demonstrate against.",
        funFact:
          "The Eiffel Tower was originally intended as a temporary structure for the 1889 World's Fair.",
        travellerCount: 2,
      },
    });
  };

  const lat = demoTrip?.lat ?? DEMO_LAT;
  const lng = demoTrip?.lng ?? DEMO_LNG;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Google APIs in this app</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Every Google API enabled for this project, demonstrated live against a
          fake demo trip (no real user data). Cards marked "Used in app" link to
          where you'll see that API in the real product; cards marked "Demo
          only" show a live call to an API this app has access to but doesn't
          surface in the main UI yet.
        </p>
      </div>

      {tripsLoading ? (
        <Spinner className="h-5 w-5" />
      ) : !demoTrip ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create the demo trip</CardTitle>
            <CardDescription>
              Creates a "{DEMO_TRIP_TITLE}" trip ({DEMO_DESTINATION}) with fake
              dates and details so the widgets below have real coordinates to
              query against. Safe to delete afterwards from the Trips page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleCreateDemoTrip}
              disabled={createTrip.isPending}
            >
              {createTrip.isPending ? "Creating…" : "Create demo trip"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Using{" "}
          <Link href={`/trips/${demoTrip.id}`} className="underline">
            {demoTrip.title}
          </Link>{" "}
          ({demoTrip.destination}, {lat.toFixed(4)}, {lng.toFixed(4)}) for the
          demos below.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <ApiCard
          name="Weather API"
          description="5-day forecast for a trip's destination."
          status="live"
          usedIn={
            demoTrip
              ? [{ label: "View on trip", href: `/trips/${demoTrip.id}` }]
              : []
          }
        >
          <WeatherDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Time Zone API"
          description="Resolves the local time zone for a trip's coordinates (used server-side for scheduling)."
          status="not-yet-wired"
        >
          <TimeZoneDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Air Quality API"
          description="Current air quality index and dominant pollutant for a location."
          status="not-yet-wired"
        >
          <AirQualityDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Pollen API"
          description="Daily pollen forecast (tree/grass/weed) for a location."
          status="not-yet-wired"
        >
          <PollenDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Places API (New)"
          description="Text search for nearby places (restaurants, cafes, attractions)."
          status="live"
          usedIn={
            demoTrip
              ? [
                  {
                    label: "Search nearby on trip",
                    href: `/trips/${demoTrip.id}`,
                  },
                ]
              : []
          }
        >
          <PlacesDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Area Insights API"
          description="Counts nearby places of a given type within a radius."
          status="live"
          usedIn={[{ label: "View on World Map", href: "/map" }]}
        >
          <AreaInsightsDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Static Maps API"
          description="Server-rendered map image (keeps the API key server-side)."
          status="live"
        >
          <StaticMapDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Street View Static API"
          description="Street-level imagery for a location, shown on the trip map."
          status="live"
          usedIn={
            demoTrip
              ? [{ label: "View on trip", href: `/trips/${demoTrip.id}` }]
              : []
          }
        >
          <StreetViewDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Routes API"
          description="Distance and travel time between two points."
          status="live"
        >
          <RoutesDemo lat={lat} lng={lng} />
        </ApiCard>

        <ApiCard
          name="Aerial View API"
          description="Cinematic aerial flyover video for an address. Coverage is limited to well-known landmarks, so this demo uses one guaranteed to have footage rather than the trip destination."
          status="not-yet-wired"
        >
          <AerialViewDemo address={AERIAL_VIEW_DEMO_ADDRESS} />
        </ApiCard>

        <ApiCard
          name="Maps JavaScript API"
          description="Renders the interactive world map and trip location maps with markers, InfoWindows, and Street View panes."
          status="live"
          usedIn={[
            { label: "World Map", href: "/map" },
            ...(demoTrip
              ? [{ label: "Trip location map", href: `/trips/${demoTrip.id}` }]
              : []),
          ]}
        />

        <ApiCard
          name="Google Identity (OAuth)"
          description="Sign in with Google, shared across the Pottery, Quilting, and Travels apps."
          status="live"
          usedIn={[{ label: "Login / Settings", href: "/settings" }]}
        />

        <ApiCard
          name="Google Calendar API"
          description="Shared Travel Calendar plus 'Add to Calendar' on trip reminders and dates."
          status="live"
          usedIn={[{ label: "Travel Calendar", href: "/travel-calendar" }]}
        />

        <ApiCard
          name="Gmail API"
          description="Scans a connected Gmail inbox for travel confirmation emails and suggests linking them as trip documents."
          status="live"
          usedIn={[{ label: "Gmail review", href: "/gmail" }]}
        />

        <ApiCard
          name="Google Wallet API"
          description="Generates 'Add to Google Wallet' passes for uploaded trip documents (boarding passes, tickets)."
          status="live"
          usedIn={
            demoTrip
              ? [{ label: "Trip documents", href: `/trips/${demoTrip.id}` }]
              : []
          }
        />
      </div>
    </div>
  );
}
