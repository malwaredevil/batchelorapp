import { useState } from "react";
import { useLocation } from "wouter";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { useListTrips, type Trip, type TripStatus } from "@workspace/api-client-react";
import { Globe, MapPin } from "lucide-react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const PIN_FILL: Record<TripStatus, string> = {
  wishlist: "#94a3b8",
  planning: "#3b82f6",
  booked: "#22c55e",
  active: "#f59e0b",
  completed: "#9ca3af",
};

const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "Wishlist",
  planning: "Planning",
  booked: "Booked",
  active: "Active",
  completed: "Completed",
};

const STATUS_ORDER: TripStatus[] = ["active", "booked", "planning", "wishlist", "completed"];

export default function WorldMap() {
  const [, navigate] = useLocation();
  const { data: trips = [], isLoading } = useListTrips();
  const [hovered, setHovered] = useState<Trip | null>(null);

  const mapped = trips.filter((t) => t.lat != null && t.lng != null);
  const unmapped = trips.filter((t) => t.lat == null || t.lng == null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Globe className="w-6 h-6 text-primary" />
        <div>
          <h1 className="font-serif text-2xl text-foreground">World Map</h1>
          <p className="text-sm text-muted-foreground">
            {mapped.length} of {trips.length} trip{trips.length !== 1 ? "s" : ""} plotted
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full border border-white/60 shadow-sm"
              style={{ background: PIN_FILL[s] }}
            />
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border border-border/50 bg-card">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-xl">
            <span className="text-sm text-muted-foreground">Loading map…</span>
          </div>
        )}

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 text-sm pointer-events-none whitespace-nowrap">
            <p className="font-medium">{hovered.title}</p>
            <p className="text-xs text-muted-foreground">
              {hovered.destination} · {STATUS_LABELS[hovered.status]}
            </p>
          </div>
        )}

        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 130, center: [10, 20] }}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="hsl(var(--muted))"
                  stroke="hsl(var(--border))"
                  strokeWidth={0.4}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fill: "hsl(var(--muted))" },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>

          {mapped.map((trip) => (
            <Marker
              key={trip.id}
              coordinates={[trip.lng!, trip.lat!]}
              onClick={() => navigate(`/trips/${trip.id}`)}
              onMouseEnter={() => setHovered(trip)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                r={6}
                fill={PIN_FILL[trip.status]}
                stroke="white"
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
              />
            </Marker>
          ))}
        </ComposableMap>
      </div>

      {/* Trips with no coordinates */}
      {unmapped.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />
            Not yet plotted ({unmapped.length})
          </p>
          <p className="text-xs text-muted-foreground">
            These trips don't have coordinates yet. Open each trip and save it to auto-plot it on the map.
          </p>
          <div className="flex flex-wrap gap-2">
            {unmapped.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(`/trips/${t.id}`)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-sm transition-colors"
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: PIN_FILL[t.status] }}
                />
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {trips.length === 0 && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Globe className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">No trips yet. Add your first trip to see it on the map.</p>
        </div>
      )}
    </div>
  );
}
