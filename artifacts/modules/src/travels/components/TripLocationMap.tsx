import { useEffect, useRef, useState } from "react";
import type { MapPlaceResult } from "@workspace/api-client-react";
import {
  loadGoogleMaps,
  onGoogleMapsAuthFailure,
} from "@/travels/lib/google-maps-loader";

const AUTH_FAILURE_MESSAGE =
  "Map is currently unavailable (the Google Maps API key isn't authorized for this domain).";

const DESTINATION_COLOR = "#2563eb";
const PLACE_COLOR = "#f97316";

const MAP_ID = "travels-trip-location-map";

function makePinElement(color: string, scale = 1) {
  const { PinElement } = google.maps.marker;
  return new PinElement({
    background: color,
    borderColor: "white",
    glyphColor: "white",
    scale,
  }).element;
}

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
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const destMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(
    null,
  );
  const placeMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>(
    [],
  );
  const latestPropsRef = useRef({ lat, lng, places });
  latestPropsRef.current = { lat, lng, places };
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current || mapRef.current) return;

    // The Google Maps JS API reports referrer/key auth failures (e.g.
    // RefererNotAllowedMapError) asynchronously via window.gm_authFailure,
    // not by rejecting the load promise or throwing synchronously. Without
    // this listener the component would keep trying to construct markers
    // against a broken `google.maps` namespace, which is what produced the
    // downstream "Cannot read properties of undefined (reading 'keys')"
    // crash.
    const unsubscribeAuthFailure = onGoogleMapsAuthFailure(() => {
      if (cancelled) return;
      cancelled = true;
      console.error("Google Maps auth/referrer failure (gm_authFailure)");
      setLoadError(AUTH_FAILURE_MESSAGE);
    });

    loadGoogleMaps()
      .then(([{ Map }, { AdvancedMarkerElement }]) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const { lat: initialLat, lng: initialLng } = latestPropsRef.current;
        const map = new Map(containerRef.current, {
          center: { lat: initialLat, lng: initialLng },
          zoom: 13,
          mapId: MAP_ID,
          streetViewControl: true,
          mapTypeControl: true,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: "cooperative",
        });
        mapRef.current = map;
        infoWindowRef.current = new google.maps.InfoWindow();

        const destMarker = new AdvancedMarkerElement({
          map,
          position: { lat: initialLat, lng: initialLng },
          content: makePinElement(DESTINATION_COLOR, 1.15),
          title: "Destination",
        });
        destMarker.addListener("click", () => {
          infoWindowRef.current?.setContent(
            `<div style="font-size:12px;font-weight:600">Destination</div>`,
          );
          infoWindowRef.current?.open({ map, anchor: destMarker });
        });
        destMarkerRef.current = destMarker;

        latestPropsRef.current.places
          .filter((p) => p.lat != null && p.lng != null)
          .forEach((place) => {
            const marker = new AdvancedMarkerElement({
              map,
              position: { lat: place.lat!, lng: place.lng! },
              content: makePinElement(PLACE_COLOR, 0.85),
              title: place.name,
            });
            marker.addListener("click", () => {
              infoWindowRef.current?.setContent(placePopupHtml(place));
              infoWindowRef.current?.open({ map, anchor: marker });
            });
            placeMarkersRef.current.push(marker);
          });
      })
      .catch((err) => {
        console.error("Failed to load Google Maps", err);
        if (!cancelled) {
          setLoadError(AUTH_FAILURE_MESSAGE);
        }
      });

    return () => {
      cancelled = true;
      unsubscribeAuthFailure();
      placeMarkersRef.current.forEach((m) => (m.map = null));
      placeMarkersRef.current = [];
      destMarkerRef.current && (destMarkerRef.current.map = null);
      destMarkerRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !destMarkerRef.current) return;
    map.panTo({ lat, lng });
    destMarkerRef.current.position = { lat, lng };
  }, [lat, lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof google === "undefined" || loadError) return;

    try {
      placeMarkersRef.current.forEach((m) => (m.map = null));
      placeMarkersRef.current = [];

      places
        .filter((p) => p.lat != null && p.lng != null)
        .forEach((place) => {
          const marker = new google.maps.marker.AdvancedMarkerElement({
            map,
            position: { lat: place.lat!, lng: place.lng! },
            content: makePinElement(PLACE_COLOR, 0.85),
            title: place.name,
          });
          marker.addListener("click", () => {
            infoWindowRef.current?.setContent(placePopupHtml(place));
            infoWindowRef.current?.open({ map, anchor: marker });
          });
          placeMarkersRef.current.push(marker);
        });
    } catch (err) {
      console.error("Failed to render nearby place markers", err);
      setLoadError(AUTH_FAILURE_MESSAGE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, loadError]);

  if (loadError) {
    return (
      <div className="w-full h-64 sm:h-full min-h-64 rounded-lg border border-border/50 bg-secondary flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground text-center">{loadError}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Interactive destination map"
      className="w-full h-64 sm:h-full min-h-64 rounded-lg border border-border/50 bg-secondary outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
