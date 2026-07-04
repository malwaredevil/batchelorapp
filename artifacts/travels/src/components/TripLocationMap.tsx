import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { MapPlaceResult } from "@workspace/api-client-react";

function makePinIcon(color: string, size = 30) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="${size}" height="${(size * 32) / 24}"><path d="M12 0C7.6 0 4 3.6 4 8c0 5.4 8 24 8 24s8-18.6 8-24c0-4.4-3.6-8-8-8z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="8" r="3.5" fill="white"/></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [size, (size * 32) / 24],
    iconAnchor: [size / 2, (size * 32) / 24],
    popupAnchor: [0, -(size * 32) / 24],
  });
}

const DESTINATION_COLOR = "#2563eb";
const PLACE_COLOR = "#f97316";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function placePopupHtml(place: MapPlaceResult): string {
  const ratingHtml =
    place.rating != null
      ? `<p style="font-size:12px;color:#6b7280;margin:2px 0 0">⭐ ${place.rating}${place.userRatingCount != null ? ` (${place.userRatingCount})` : ""}</p>`
      : "";
  const nameHtml = place.googleMapsUri
    ? `<a href="${escapeHtml(place.googleMapsUri)}" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:13px;line-height:1.3;color:#2563eb;text-decoration:none">${escapeHtml(place.name)}</a>`
    : `<p style="font-weight:600;font-size:13px;margin:0 0 2px;line-height:1.3">${escapeHtml(place.name)}</p>`;
  const websiteHtml = place.websiteUri
    ? `<a href="${escapeHtml(place.websiteUri)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#2563eb;text-decoration:underline">Website</a>`
    : "";
  return `
    <div style="min-width:160px;padding:2px 1px;font-family:inherit">
      ${nameHtml}
      <p style="font-size:11px;color:#9ca3af;margin:2px 0 0">${escapeHtml(place.address)}</p>
      ${ratingHtml}
      ${websiteHtml ? `<p style="margin:4px 0 0">${websiteHtml}</p>` : ""}
    </div>`;
}

interface TripLocationMapProps {
  lat: number;
  lng: number;
  places: MapPlaceResult[];
}

export function TripLocationMap({ lat, lng, places }: TripLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    // Re-enable wheel zoom only once the user interacts, so the page can
    // still scroll normally when the cursor merely passes over the map.
    map.on("focus", () => map.scrollWheelZoom.enable());
    map.on("blur", () => map.scrollWheelZoom.disable());
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([lat, lng], map.getZoom());
    destMarkerRef.current?.remove();
    const marker = L.marker([lat, lng], { icon: makePinIcon(DESTINATION_COLOR, 32) });
    marker.bindPopup(`<div style="font-size:12px;font-weight:600">Destination</div>`, { maxWidth: 200 });
    marker.addTo(map);
    destMarkerRef.current = marker;
  }, [lat, lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: L.Marker[] = [];
    places
      .filter((p) => p.lat != null && p.lng != null)
      .forEach((place) => {
        const marker = L.marker([place.lat!, place.lng!], { icon: makePinIcon(PLACE_COLOR, 24) });
        marker.bindPopup(placePopupHtml(place), { maxWidth: 220 });
        marker.addTo(map);
        markers.push(marker);
      });
    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [places]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="Interactive destination map"
      className="w-full h-40 rounded-lg border border-border/50 bg-secondary outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
