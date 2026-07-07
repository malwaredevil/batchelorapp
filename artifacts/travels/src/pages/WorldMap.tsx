import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import { Globe, MapPin, LocateFixed, TrendingUp, Calendar, Flag } from "lucide-react";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { loadGoogleMaps, svgToMarkerContent } from "@/lib/google-maps-loader";

const WORLD_MAP_ID = "travels-world-map";

const WISH_COLOR = "#eab308";
const MAP_COLORS = {
  booked: "#22c55e",
  completed: "#ef4444",
  planning: "#f97316",
  wishlist: WISH_COLOR,
} as const;

type MapStatus = "booked" | "completed" | "planning" | "wishlist";

// Derive what status to DISPLAY on the map (independent of the stored trip.status).
// - wishlist trips → star icon (yellow)
// - planning status OR no end date → planning (yellow pin)
// - end date in the past → completed (green pin)
// - end date in the future → booked (orange pin)
function getMapStatus(trip: Trip): MapStatus | null {
  if (trip.status === "wishlist") return "wishlist";
  if (trip.status === "planning" || !trip.endDate) return "planning";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(trip.endDate);
  return end < today ? "completed" : "booked";
}

function makeStarSvg(color: string, size = 28) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="${size}" height="${size}" style="cursor:pointer"><polygon points="14,2 17.5,11 27,11 19.5,16.5 22.5,26 14,20.5 5.5,26 8.5,16.5 1,11 10.5,11" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function makePinSvg(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32" style="cursor:pointer"><path d="M12 0C7.6 0 4 3.6 4 8c0 5.4 8 24 8 24s8-18.6 8-24c0-4.4-3.6-8-8-8z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="8" r="3.5" fill="white"/></svg>`;
}

const MAP_STATUS_LABELS: Record<MapStatus, string> = {
  booked: "Booked",
  completed: "Completed",
  planning: "Planning",
  wishlist: "Wishlist trip",
};

function tripPopupHtml(trip: Trip, mapStatus: MapStatus): string {
  const color = MAP_COLORS[mapStatus];
  const label = MAP_STATUS_LABELS[mapStatus];
  const dateStr = trip.startDate
    ? new Date(trip.startDate).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
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
        <span style="font-size:11px;padding:1px 7px;border-radius:999px;font-weight:500;background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>
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
    ? new Date(item.targetDate).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
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

async function geocodeDestination(
  destination: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "batchelor-travels/1.0" },
    });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0])
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

interface MapPanelProps {
  trips: Trip[];
  wishlistItems: WishlistItem[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
  resetViewRef: React.MutableRefObject<(() => void) | null>;
}

function MapPanel({
  trips,
  wishlistItems,
  isLoading,
  onNavigate,
  resetViewRef,
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      .then(([{ Map }]) => {
        if (cancelled || !containerRef.current) return;
        const map = new Map(containerRef.current, {
          center: { lat: 30, lng: 10 },
          zoom: 2,
          mapId: WORLD_MAP_ID,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
        setMapReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load Google Maps",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || isLoading || !mapReady) return;

    let markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let arcs: google.maps.Polyline[] = [];
    let animInterval: ReturnType<typeof setInterval> | null = null;
    let dataLayer: google.maps.Data | null = null;
    let infoWindow: google.maps.InfoWindow | null = null;

    try {
      const { AdvancedMarkerElement } = google.maps.marker;
      infoWindow = new google.maps.InfoWindow({ maxWidth: 260 });

      // ── Pulse CSS (injected once per document) ──────────────────────────────
      const PULSE_STYLE_ID = "travels-map-pulse-style";
      if (!document.getElementById(PULSE_STYLE_ID)) {
        const styleEl = document.createElement("style");
        styleEl.id = PULSE_STYLE_ID;
        styleEl.textContent = `
          @keyframes map-pulse {
            0%   { transform: scale(1);   opacity: 0.55; }
            70%  { transform: scale(2.6); opacity: 0;    }
            100% { transform: scale(2.6); opacity: 0;    }
          }
          .map-pulse-ring {
            width: 18px; height: 18px; border-radius: 50%;
            background: rgba(37,99,235,0.4);
            animation: map-pulse 2.2s ease-out infinite;
            pointer-events: none;
          }
        `;
        document.head.appendChild(styleEl);
      }

      // ── Country visit counts for polygon fills ──────────────────────────────
      // Extract the last comma-separated token from the destination as the
      // country name; normalise to lower-case for fuzzy matching.
      const visitedCountryNames = new Set(
        trips
          .filter((t) => t.status === "completed" || t.status === "booked")
          .map((t) => {
            const parts = t.destination.split(",");
            return (parts[parts.length - 1] ?? "").trim().toLowerCase();
          })
          .filter(Boolean),
      );

      if (visitedCountryNames.size > 0) {
        dataLayer = new google.maps.Data({ map });
        // Natural Earth 1:110m world boundaries (~1.1 MB) — loaded once, cached
        // by the browser on repeat visits.
        dataLayer.loadGeoJson(
          "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
          {},
          () => {
            dataLayer!.setStyle((feature) => {
              const name = String(
                feature.getProperty("NAME") ?? "",
              ).toLowerCase();
              const nameLong = String(
                feature.getProperty("NAME_LONG") ?? "",
              ).toLowerCase();
              const isVisited =
                visitedCountryNames.has(name) ||
                visitedCountryNames.has(nameLong) ||
                [...visitedCountryNames].some(
                  (v) =>
                    name.includes(v) ||
                    v.includes(name) ||
                    nameLong.includes(v),
                );
              return {
                fillColor: "#2563eb",
                fillOpacity: isVisited ? 0.1 : 0,
                strokeWeight: isVisited ? 1 : 0,
                strokeColor: "#2563eb",
                strokeOpacity: isVisited ? 0.25 : 0,
                clickable: false,
              };
            });
          },
        );
      }

      // ── Multi-visit location counts ─────────────────────────────────────────
      // Key by lat/lng rounded to 3 dp (~110 m precision) to group co-located trips.
      const visitCount = new Map<string, number>();
      trips
        .filter((t) => t.lat != null && t.lng != null)
        .forEach((t) => {
          const key = `${Math.round(t.lat! * 1000)},${Math.round(t.lng! * 1000)}`;
          visitCount.set(key, (visitCount.get(key) ?? 0) + 1);
        });

      const attachPopupNav = (win: google.maps.InfoWindow) => {
        const listener = google.maps.event.addListener(win, "domready", () => {
          const link = document.querySelector<HTMLAnchorElement>(
            ".gm-style-iw a[data-trip-id]",
          );
          if (link) {
            link.addEventListener("click", (e) => {
              e.preventDefault();
              onNavigate(`/trips/${link.dataset.tripId}`);
            });
          }
        });
        return listener;
      };
      const domReadyListener = attachPopupNav(infoWindow);

      // ── Trip markers — only those with a computable map status ───────────────
      trips
        .filter((t) => t.lat != null && t.lng != null)
        .forEach((trip) => {
          const mapStatus = getMapStatus(trip);
          if (!mapStatus) return; // planning/active with no end date → skip

          const posKey = `${Math.round(trip.lat! * 1000)},${Math.round(trip.lng! * 1000)}`;
          const visits = visitCount.get(posKey) ?? 1;

          // Pulse ring for multi-visit destinations
          if (visits > 1) {
            const ringEl = document.createElement("div");
            ringEl.className = "map-pulse-ring";
            const pulseMarker = new AdvancedMarkerElement({
              map,
              position: { lat: trip.lat!, lng: trip.lng! },
              content: ringEl,
              zIndex: 0,
            });
            markers.push(pulseMarker);
          }

          const content = svgToMarkerContent(
            mapStatus === "wishlist"
              ? makeStarSvg(MAP_COLORS.wishlist)
              : makePinSvg(MAP_COLORS[mapStatus]),
          );
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: trip.lat!, lng: trip.lng! },
            content,
            title: trip.title,
          });
          marker.addListener("click", () => {
            infoWindow!.setContent(tripPopupHtml(trip, mapStatus));
            infoWindow!.open({ map, anchor: marker });
          });
          markers.push(marker);
        });

      // Wishlist item markers (yellow star, slightly smaller)
      wishlistItems
        .filter((w) => w.lat != null && w.lng != null)
        .forEach((item) => {
          const content = svgToMarkerContent(makeStarSvg(WISH_COLOR, 26));
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: item.lat!, lng: item.lng! },
            content,
            title: item.destination,
          });
          marker.addListener("click", () => {
            infoWindow!.setContent(wishlistPopupHtml(item));
            infoWindow!.open({ map, anchor: marker });
          });
          markers.push(marker);
        });

      // ── Animated geodesic arcs between consecutive completed/booked trips ────
      // Sort completed AND booked trips with coords chronologically, then
      // connect each adjacent pair with an animated dashed polyline.
      const completedWithCoords = trips
        .filter(
          (t) =>
            (t.status === "completed" || t.status === "booked") &&
            t.lat != null &&
            t.lng != null &&
            t.startDate,
        )
        .sort(
          (a, b) =>
            new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime(),
        );

      if (completedWithCoords.length > 1) {
        const arrowSymbol: google.maps.Symbol = {
          path: google.maps.SymbolPath.FORWARD_OPEN_ARROW,
          strokeOpacity: 0.85,
          scale: 3,
          strokeColor: "#2563eb",
        };
        for (let i = 0; i < completedWithCoords.length - 1; i++) {
          const t1 = completedWithCoords[i]!;
          const t2 = completedWithCoords[i + 1]!;
          // Skip same-location consecutive trips (arc would collapse to a dot)
          if (t1.lat === t2.lat && t1.lng === t2.lng) continue;
          const arc = new google.maps.Polyline({
            path: [
              { lat: t1.lat!, lng: t1.lng! },
              { lat: t2.lat!, lng: t2.lng! },
            ],
            geodesic: true,
            strokeColor: "#2563eb",
            strokeOpacity: 0,
            strokeWeight: 2,
            icons: [{ icon: arrowSymbol, offset: "0%", repeat: "20px" }],
            map,
          });
          arcs.push(arc);
        }

        // Animate: cycle the icon offset to make the dashes flow
        if (arcs.length > 0) {
          let count = 0;
          animInterval = setInterval(() => {
            count = (count + 1) % 200;
            const pct = `${(count / 2).toFixed(1)}%`;
            arcs.forEach((arc) => {
              const icons = arc.get("icons") as
                | google.maps.IconSequence[]
                | undefined;
              if (icons && icons[0]) {
                icons[0].offset = pct;
                arc.set("icons", icons);
              }
            });
          }, 30);
        }
      }

      // Fit bounds to all plotted points once, and store as the "home" view for recenter
      const allPoints: google.maps.LatLngLiteral[] = [
        ...trips
          .filter((t) => t.lat != null)
          .map((t) => ({ lat: t.lat!, lng: t.lng! })),
        ...wishlistItems
          .filter((w) => w.lat != null)
          .map((w) => ({ lat: w.lat!, lng: w.lng! })),
      ];
      if (allPoints.length === 1) {
        map.setCenter(allPoints[0]);
        map.setZoom(8);
        resetViewRef.current = () => {
          map.setCenter(allPoints[0]);
          map.setZoom(8);
        };
      } else if (allPoints.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        allPoints.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 40);
        resetViewRef.current = () => map.fitBounds(bounds, 40);
      } else {
        resetViewRef.current = () => {
          map.setCenter({ lat: 30, lng: 10 });
          map.setZoom(2);
        };
      }

      return () => {
        if (animInterval != null) clearInterval(animInterval);
        arcs.forEach((a) => a.setMap(null));
        arcs = [];
        dataLayer?.setMap(null);
        markers.forEach((m) => (m.map = null));
        markers = [];
        google.maps.event.removeListener(domReadyListener);
        infoWindow?.close();
      };
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to render map markers",
      );
      return () => {
        if (animInterval != null) clearInterval(animInterval);
        arcs.forEach((a) => a.setMap(null));
        dataLayer?.setMap(null);
        markers.forEach((m) => (m.map = null));
        infoWindow?.close();
      };
    }
  }, [trips, wishlistItems, isLoading, onNavigate, mapReady]);

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 bg-muted/30 text-center px-6">
        <Globe className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground max-w-sm">
          Map is currently unavailable (the Google Maps API key may not be
          authorized for this domain).
        </p>
      </div>
    );
  }

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}

export default function WorldMap() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: trips = [], isLoading: tripsLoading } = useListTrips();
  const { data: wishlistItems = [], isLoading: wishlistLoading } =
    useListWishlist();
  const updateWishlistItem = useUpdateWishlistItem();
  const resetViewRef = useRef<(() => void) | null>(null);

  const isLoading = tripsLoading || wishlistLoading;

  usePageAssistantContext(
    "world-map",
    isLoading
      ? undefined
      : `World Map page: an interactive map plotting every trip and wishlist destination as color-coded pins/stars (booked=green, planning=orange, completed=red, wishlist=yellow star). Showing ${trips.length} trip(s) and ${wishlistItems.length} wishlist destination(s).`,
  );

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
          {
            onSuccess: () =>
              qc.invalidateQueries({ queryKey: getListWishlistQueryKey() }),
          },
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
  const mappedWishlist = wishlistItems.filter(
    (w) => w.lat != null && w.lng != null,
  );
  const unmappedWishlist = wishlistItems.filter(
    (w) => w.lat == null || w.lng == null,
  );

  const totalMapped = mappedTrips.length + mappedWishlist.length;
  const totalAll = trips.length + wishlistItems.length;

  // Stats derived from completed/booked trips
  const completedTrips = useMemo(
    () => trips.filter((t) => t.status === "completed"),
    [trips],
  );

  const uniqueCountries = useMemo(() => {
    const countries = new Set<string>();
    completedTrips.forEach((t) => {
      const parts = t.destination.split(",");
      const country = (parts[parts.length - 1] ?? "").trim();
      if (country) countries.add(country);
    });
    return countries.size;
  }, [completedTrips]);

  const totalNights = useMemo(() => {
    return completedTrips.reduce((sum, t) => {
      if (!t.startDate || !t.endDate) return sum;
      const nights = Math.round(
        (new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) /
          86400000,
      );
      return sum + Math.max(0, nights);
    }, 0);
  }, [completedTrips]);

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
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: MAP_COLORS.booked }}
            />
            <span className="text-xs text-muted-foreground">Booked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: MAP_COLORS.completed }}
            />
            <span className="text-xs text-muted-foreground">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: MAP_COLORS.planning }}
            />
            <span className="text-xs text-muted-foreground">Planning</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="text-sm leading-none"
              style={{ color: WISH_COLOR }}
            >
              ★
            </span>
            <span className="text-xs text-muted-foreground">Wishlist trip</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="text-sm leading-none"
              style={{ color: WISH_COLOR }}
            >
              ★
            </span>
            <span className="text-xs text-muted-foreground">
              Wishlist destination
            </span>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      {!isLoading && completedTrips.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border/50 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Flag className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground tabular-nums">{uniqueCountries}</p>
              <p className="text-xs text-muted-foreground leading-tight">
                {uniqueCountries === 1 ? "country" : "countries"}
              </p>
            </div>
          </div>
          <div className="bg-card border border-border/50 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground tabular-nums">{completedTrips.length}</p>
              <p className="text-xs text-muted-foreground leading-tight">
                {completedTrips.length === 1 ? "trip" : "trips"} completed
              </p>
            </div>
          </div>
          <div className="bg-card border border-border/50 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground tabular-nums">{totalNights}</p>
              <p className="text-xs text-muted-foreground leading-tight">
                {totalNights === 1 ? "night" : "nights"} abroad
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <div
        className="relative rounded-xl overflow-hidden border border-border/50"
        style={{ height: "calc(100vh - 220px)", minHeight: 420 }}
      >
        {/* Recenter button — floats above the map */}
        {!isLoading && (
          <button
            onClick={() => resetViewRef.current?.()}
            title="Recenter map"
            className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 dark:bg-card/90 backdrop-blur-sm border border-border/60 shadow-sm hover:bg-white dark:hover:bg-card text-foreground transition-colors text-xs font-medium"
          >
            <LocateFixed className="w-3.5 h-3.5" />
            Recenter
          </button>
        )}
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
            resetViewRef={resetViewRef}
          />
        )}
      </div>

      {/* Geocoding progress */}
      {!isLoading && unmappedWishlist.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="animate-pulse">⭐</span>
          Locating {unmappedWishlist.length} wishlist destination
          {unmappedWishlist.length !== 1 ? "s" : ""} — they'll appear on the map
          shortly…
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
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    background: MAP_COLORS[getMapStatus(t) ?? "booked"],
                  }}
                />
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isLoading && totalAll === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Globe className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">
            No trips or wishlist destinations yet.
          </p>
        </div>
      )}
    </div>
  );
}
