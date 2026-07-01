import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrips,
  useListWishlist,
  useUpdateWishlistItem,
  type Trip,
  type TripStatus,
  type WishlistItem,
  getListWishlistQueryKey,
} from "@workspace/api-client-react";
import { Globe, MapPin } from "lucide-react";

const PIN_COLOR: Record<TripStatus, string> = {
  completed: "#22c55e",
  booked:    "#f97316",
  active:    "#f97316",
  planning:  "#f97316",
  wishlist:  "#eab308",
};
const WISH_COLOR = "#eab308";

const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "Wishlist trip",
  planning: "Planning",
  booked: "Booked",
  active: "Active",
  completed: "Completed",
};

const STATUS_ORDER: TripStatus[] = ["active", "booked", "planning", "wishlist", "completed"];

function makeStarIcon(color: string, size = 28) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="${size}" height="${size}"><polygon points="14,2 17.5,11 27,11 19.5,16.5 22.5,26 14,20.5 5.5,26 8.5,16.5 1,11 10.5,11" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function makePinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32"><path d="M12 0C7.6 0 4 3.6 4 8c0 5.4 8 24 8 24s8-18.6 8-24c0-4.4-3.6-8-8-8z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="8" r="3.5" fill="white"/></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
  });
}

function tripPopupHtml(trip: Trip): string {
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

function wishlistPopupHtml(item: WishlistItem): string {
  const dateStr = item.targetDate
    ? new Date(item.targetDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : "";
  const notes = item.notes
    ? `<p style="font-size:12px;color:#6b7280;font-style:italic;margin:4px 0 0">${item.notes}</p>`
    : "";
  return `
    <div style="min-width:160px;padding:4px 2px;font-family:inherit">
      <p style="font-weight:600;font-size:13px;margin:0 0 2px;line-height:1.3">${item.destination}</p>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:11px;padding:1px 7px;border-radius:999px;font-weight:500;background:#eab30822;color:#eab308;border:1px solid #eab30844">⭐ Wishlist</span>
        ${dateStr ? `<span style="font-size:11px;color:#9ca3af">${dateStr}</span>` : ""}
      </div>
      ${notes}
    </div>`;
}

async function geocodeDestination(destination: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "batchelor-travels/1.0" } });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

interface MapPanelProps {
  trips: Trip[];
  wishlistItems: WishlistItem[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

function MapPanel({ trips, wishlistItems, isLoading, onNavigate }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [30, 10], zoom: 2, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isLoading) return;

    const markers: L.Marker[] = [];

    // Trip markers
    trips
      .filter((t) => t.lat != null && t.lng != null)
      .forEach((trip) => {
        const icon = trip.status === "wishlist" ? makeStarIcon(PIN_COLOR.wishlist) : makePinIcon(PIN_COLOR[trip.status]);
        const marker = L.marker([trip.lat!, trip.lng!], { icon });
        marker.bindPopup(tripPopupHtml(trip), { maxWidth: 260 });
        marker.addTo(map);
        markers.push(marker);
      });

    // Wishlist item markers (yellow star, slightly smaller)
    wishlistItems
      .filter((w) => w.lat != null && w.lng != null)
      .forEach((item) => {
        const marker = L.marker([item.lat!, item.lng!], { icon: makeStarIcon(WISH_COLOR, 26) });
        marker.bindPopup(wishlistPopupHtml(item), { maxWidth: 240 });
        marker.addTo(map);
        markers.push(marker);
      });

    // Navigate on trip popup link click
    const handlePopupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest<HTMLAnchorElement>("a[data-trip-id]");
      if (link) { e.preventDefault(); onNavigate(`/trips/${link.dataset.tripId}`); }
    };
    const container = map.getContainer();
    container.addEventListener("click", handlePopupClick);

    // Fit bounds to all plotted points once
    const allPoints: [number, number][] = [
      ...trips.filter((t) => t.lat != null).map((t) => [t.lat!, t.lng!] as [number, number]),
      ...wishlistItems.filter((w) => w.lat != null).map((w) => [w.lat!, w.lng!] as [number, number]),
    ];
    if (allPoints.length === 1) {
      map.setView(allPoints[0], 8);
    } else if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40], maxZoom: 10 });
    }

    return () => {
      markers.forEach((m) => m.remove());
      container.removeEventListener("click", handlePopupClick);
    };
  }, [trips, wishlistItems, isLoading, onNavigate]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}

export default function WorldMap() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: trips = [], isLoading: tripsLoading } = useListTrips();
  const { data: wishlistItems = [], isLoading: wishlistLoading } = useListWishlist();
  const updateWishlistItem = useUpdateWishlistItem();

  const isLoading = tripsLoading || wishlistLoading;

  // Geocode wishlist items that have no coordinates, persisting results back to server
  const geocodingRef = useRef(false);
  const geocodeWishlist = useCallback(async () => {
    if (geocodingRef.current) return;
    const missing = wishlistItems.filter((w) => w.lat == null && w.lng == null);
    if (missing.length === 0) return;
    geocodingRef.current = true;
    for (let i = 0; i < missing.length; i++) {
      const item = missing[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 1100)); // Nominatim: 1 req/sec
      const coords = await geocodeDestination(item.destination);
      if (coords) {
        updateWishlistItem.mutate(
          { id: item.id, body: { lat: coords.lat, lng: coords.lng } },
          { onSuccess: () => qc.invalidateQueries({ queryKey: getListWishlistQueryKey() }) },
        );
      }
    }
    geocodingRef.current = false;
  }, [wishlistItems, updateWishlistItem, qc]);

  useEffect(() => {
    if (!wishlistLoading && wishlistItems.length > 0) {
      void geocodeWishlist();
    }
  }, [wishlistLoading, wishlistItems.length, geocodeWishlist]);

  const mappedTrips = trips.filter((t) => t.lat != null && t.lng != null);
  const unmappedTrips = trips.filter((t) => t.lat == null || t.lng == null);
  const mappedWishlist = wishlistItems.filter((w) => w.lat != null && w.lng != null);
  const unmappedWishlist = wishlistItems.filter((w) => w.lat == null || w.lng == null);

  const totalMapped = mappedTrips.length + mappedWishlist.length;
  const totalAll = trips.length + wishlistItems.length;

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
                : `${totalMapped} of ${totalAll} location${totalAll !== 1 ? "s" : ""} plotted`}
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              {s === "wishlist" ? (
                <span className="text-sm leading-none" style={{ color: PIN_COLOR[s] }}>★</span>
              ) : (
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PIN_COLOR[s] }} />
              )}
              <span className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="text-sm leading-none" style={{ color: WISH_COLOR }}>★</span>
            <span className="text-xs text-muted-foreground">Wishlist destination</span>
          </div>
        </div>
      </div>

      {/* Map */}
      <div
        className="rounded-xl overflow-hidden border border-border/50"
        style={{ height: "calc(100vh - 220px)", minHeight: 420 }}
      >
        {isLoading ? (
          <div className="h-full flex items-center justify-center bg-muted/30">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : (
          <MapPanel
            trips={trips}
            wishlistItems={mappedWishlist}
            isLoading={isLoading}
            onNavigate={navigate}
          />
        )}
      </div>

      {/* Geocoding progress */}
      {!isLoading && unmappedWishlist.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="animate-pulse">⭐</span>
          Locating {unmappedWishlist.length} wishlist destination{unmappedWishlist.length !== 1 ? "s" : ""} — they'll appear on the map shortly…
        </p>
      )}

      {/* Unmapped trips */}
      {!isLoading && unmappedTrips.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />
            Trips not yet plotted ({unmappedTrips.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {unmappedTrips.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(`/trips/${t.id}`)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-sm transition-colors"
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIN_COLOR[t.status] }} />
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isLoading && totalAll === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Globe className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">No trips or wishlist destinations yet.</p>
        </div>
      )}
    </div>
  );
}
