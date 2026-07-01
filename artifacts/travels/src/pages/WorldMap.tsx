import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useListTrips, type Trip, type TripStatus } from "@workspace/api-client-react";
import { Globe, MapPin } from "lucide-react";

const PIN_COLOR: Record<TripStatus, string> = {
  wishlist: "#94a3b8",
  planning: "#3b82f6",
  booked: "#22c55e",
  active: "#f59e0b",
  completed: "#6366f1",
};

const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "Wishlist",
  planning: "Planning",
  booked: "Booked",
  active: "Active",
  completed: "Completed",
};

const STATUS_ORDER: TripStatus[] = ["active", "booked", "planning", "wishlist", "completed"];

function makeIcon(status: TripStatus) {
  const color = PIN_COLOR[status];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32"><path d="M12 0C7.6 0 4 3.6 4 8c0 5.4 8 24 8 24s8-18.6 8-24c0-4.4-3.6-8-8-8z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="8" r="3.5" fill="white"/></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
  });
}

function popupHtml(trip: Trip): string {
  const statusColor = PIN_COLOR[trip.status];
  const statusLabel = STATUS_LABELS[trip.status];
  const dateStr = trip.startDate
    ? new Date(trip.startDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : "";
  const oneThing =
    trip.theOneThing && trip.theOneThing.length > 0
      ? `<p style="font-size:12px;color:#6b7280;font-style:italic;margin:4px 0 0">"${trip.theOneThing.slice(0, 2).join(", ")}"</p>`
      : "";
  return `
    <div style="min-width:180px;padding:4px 2px;font-family:inherit">
      <p style="font-weight:600;font-size:13px;margin:0 0 2px;line-height:1.3">${trip.title}</p>
      <p style="font-size:11px;color:#9ca3af;margin:0 0 6px">${trip.destination}</p>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:11px;padding:1px 7px;border-radius:999px;font-weight:500;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">${statusLabel}</span>
        ${dateStr ? `<span style="font-size:11px;color:#9ca3af">${dateStr}</span>` : ""}
      </div>
      ${oneThing}
      <a data-trip-id="${trip.id}" href="#" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;color:#2563eb;margin-top:8px;text-decoration:none">
        View trip →
      </a>
    </div>`;
}

interface MapPanelProps {
  trips: Trip[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

function MapPanel({ trips, isLoading, onNavigate }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [48, 10],
      zoom: 4,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isLoading) return;

    const mapped = trips.filter((t) => t.lat != null && t.lng != null);
    const markers: L.Marker[] = [];

    mapped.forEach((trip) => {
      const marker = L.marker([trip.lat!, trip.lng!], { icon: makeIcon(trip.status) });
      marker.bindPopup(popupHtml(trip), { maxWidth: 260 });
      marker.addTo(map);
      markers.push(marker);
    });

    // Delegate navigation via click on the popup link (popup is raw HTML)
    const handlePopupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest<HTMLAnchorElement>("a[data-trip-id]");
      if (link) {
        e.preventDefault();
        onNavigate(`/trips/${link.dataset.tripId}`);
      }
    };
    const container = map.getContainer();
    container.addEventListener("click", handlePopupClick);

    // Fit bounds to all plotted trips once
    if (mapped.length === 1) {
      map.setView([mapped[0].lat!, mapped[0].lng!], 8);
    } else if (mapped.length > 1) {
      const bounds = L.latLngBounds(mapped.map((t) => [t.lat!, t.lng!] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }

    return () => {
      markers.forEach((m) => m.remove());
      container.removeEventListener("click", handlePopupClick);
    };
  }, [trips, isLoading, onNavigate]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}

export default function WorldMap() {
  const [, navigate] = useLocation();
  const { data: trips = [], isLoading } = useListTrips();

  const mapped = trips.filter((t) => t.lat != null && t.lng != null);
  const unmapped = trips.filter((t) => t.lat == null || t.lng == null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-primary" />
          <div>
            <h1 className="font-serif text-2xl text-foreground">World Map</h1>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? "Loading…"
                : `${mapped.length} of ${trips.length} trip${trips.length !== 1 ? "s" : ""} plotted`}
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: PIN_COLOR[s] }}
              />
              <span className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Map */}
      <div
        className="rounded-xl overflow-hidden border border-border/50"
        style={{ height: "calc(100vh - 220px)", minHeight: 420 }}
      >
        {isLoading ? (
          <div className="h-full flex items-center justify-center bg-muted/30">
            <span className="text-sm text-muted-foreground">Loading trips…</span>
          </div>
        ) : (
          <MapPanel trips={trips} isLoading={isLoading} onNavigate={navigate} />
        )}
      </div>

      {/* Unmapped trips */}
      {!isLoading && unmapped.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />
            Not yet plotted ({unmapped.length})
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
                  style={{ background: PIN_COLOR[t.status] }}
                />
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isLoading && trips.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Globe className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">No trips yet. Add your first trip to see it on the map.</p>
        </div>
      )}
    </div>
  );
}
