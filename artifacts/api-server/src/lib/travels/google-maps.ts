import { env } from "../env";

/**
 * Thin, typed wrappers around the Google Maps Platform REST APIs used by the
 * Travels app (Weather, Time Zone, Air Quality, Pollen, Static Maps, Places
 * (New), Area Insights / Places Aggregate, Street View, Aerial View, Routes,
 * and Isochrones). All calls use `env.googleMapsApiKey` server-side only —
 * never return the raw API key to the client. Image-producing APIs (Static
 * Maps, Street View) are meant to be proxied through our own routes so the
 * key never appears in a client-visible URL.
 */

function requireMapsKey(): string {
  if (!env.googleMapsApiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  }
  return env.googleMapsApiKey;
}

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Maps API request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ── Weather ──────────────────────────────────────────────────────────────

export interface DailyWeather {
  date: string;
  conditionDescription: string;
  maxTempC: number | null;
  minTempC: number | null;
  precipitationChancePercent: number | null;
}

export async function getWeatherForecast(
  lat: number,
  lng: number,
  days = 5,
): Promise<DailyWeather[]> {
  const key = requireMapsKey();
  const url =
    `https://weather.googleapis.com/v1/forecast/days:lookup?key=${key}` +
    `&location.latitude=${lat}&location.longitude=${lng}&days=${Math.min(Math.max(days, 1), 10)}`;
  const data = await fetchJson<{
    forecastDays?: Array<{
      displayDate: { year: number; month: number; day: number };
      maxTemperature?: { degrees: number };
      minTemperature?: { degrees: number };
      daytimeForecast?: {
        weatherCondition?: { description?: { text?: string } };
        precipitation?: { probability?: { percent?: number } };
      };
    }>;
  }>(url);

  return (data.forecastDays ?? []).map((d) => {
    const { year, month, day } = d.displayDate;
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${year}-${pad(month)}-${pad(day)}`,
      conditionDescription: d.daytimeForecast?.weatherCondition?.description?.text ?? "Unknown",
      maxTempC: d.maxTemperature?.degrees ?? null,
      minTempC: d.minTemperature?.degrees ?? null,
      precipitationChancePercent: d.daytimeForecast?.precipitation?.probability?.percent ?? null,
    };
  });
}

// ── Time Zone ────────────────────────────────────────────────────────────

export interface TimeZoneInfo {
  timeZoneId: string;
  timeZoneName: string;
  rawOffsetSeconds: number;
  dstOffsetSeconds: number;
}

export async function getTimeZone(lat: number, lng: number): Promise<TimeZoneInfo | null> {
  const key = requireMapsKey();
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${key}`;
  const data = await fetchJson<{
    status: string;
    timeZoneId?: string;
    timeZoneName?: string;
    rawOffset?: number;
    dstOffset?: number;
  }>(url);
  if (data.status !== "OK" || !data.timeZoneId) return null;
  return {
    timeZoneId: data.timeZoneId,
    timeZoneName: data.timeZoneName ?? data.timeZoneId,
    rawOffsetSeconds: data.rawOffset ?? 0,
    dstOffsetSeconds: data.dstOffset ?? 0,
  };
}

// ── Air Quality ──────────────────────────────────────────────────────────

export interface AirQualityInfo {
  aqi: number;
  category: string;
  dominantPollutant: string;
}

export async function getAirQuality(lat: number, lng: number): Promise<AirQualityInfo | null> {
  const key = requireMapsKey();
  const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${key}`;
  const data = await fetchJson<{
    indexes?: Array<{ aqi: number; category: string; dominantPollutant: string }>;
  }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { latitude: lat, longitude: lng } }),
  });
  const index = data.indexes?.[0];
  if (!index) return null;
  return { aqi: index.aqi, category: index.category, dominantPollutant: index.dominantPollutant };
}

// ── Pollen ───────────────────────────────────────────────────────────────

export interface PollenInfo {
  date: string;
  overallCategory: string;
  types: Array<{ code: string; displayName: string; category: string }>;
}

export async function getPollenForecast(lat: number, lng: number): Promise<PollenInfo | null> {
  const key = requireMapsKey();
  const url =
    `https://pollen.googleapis.com/v1/forecast:lookup?key=${key}` +
    `&location.latitude=${lat}&location.longitude=${lng}&days=1`;
  const data = await fetchJson<{
    dailyInfo?: Array<{
      date: { year: number; month: number; day: number };
      pollenTypeInfo?: Array<{
        code: string;
        displayName: string;
        indexInfo?: { category?: string };
      }>;
    }>;
  }>(url);
  const day = data.dailyInfo?.[0];
  if (!day) return null;
  const { year, month, day: d } = day.date;
  const pad = (n: number) => String(n).padStart(2, "0");
  const types = (day.pollenTypeInfo ?? []).map((t) => ({
    code: t.code,
    displayName: t.displayName,
    category: t.indexInfo?.category ?? "Unknown",
  }));
  const worst =
    types.find((t) => t.category === "Very High") ??
    types.find((t) => t.category === "High") ??
    types.find((t) => t.category === "Moderate") ??
    types[0];
  return {
    date: `${year}-${pad(month)}-${pad(d)}`,
    overallCategory: worst?.category ?? "Unknown",
    types,
  };
}

// ── Static Maps / Street View (proxied — key never leaves the server) ────

export async function fetchStaticMapImage(
  lat: number,
  lng: number,
  width = 400,
  height = 240,
  zoom = 12,
): Promise<{ buffer: Buffer; contentType: string }> {
  const key = requireMapsKey();
  const size = `${Math.min(width, 640)}x${Math.min(height, 640)}`;
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}` +
    `&size=${size}&scale=2&markers=color:red%7C${lat},${lng}&key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Static Maps request failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") ?? "image/png" };
}

export async function fetchStreetViewImage(
  lat: number,
  lng: number,
  width = 400,
  height = 240,
): Promise<{ buffer: Buffer; contentType: string }> {
  const key = requireMapsKey();
  const size = `${Math.min(width, 640)}x${Math.min(height, 640)}`;
  const url = `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Street View request failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") ?? "image/jpeg" };
}

export async function hasStreetView(lat: number, lng: number): Promise<boolean> {
  const key = requireMapsKey();
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${key}`;
  const data = await fetchJson<{ status: string }>(url);
  return data.status === "OK";
}

// ── Places (New) ─────────────────────────────────────────────────────────

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  userRatingCount: number | null;
  lat: number | null;
  lng: number | null;
  // Google's own place page — shows reviews, photos, and (for restaurants
  // that have supplied one to Google) a Menu tab.
  googleMapsUri: string | null;
  // The business's own website, when Google has one on file.
  websiteUri: string | null;
}

export async function searchPlaces(
  query: string,
  lat?: number,
  lng?: number,
): Promise<PlaceResult[]> {
  const key = requireMapsKey();
  const body: Record<string, unknown> = { textQuery: query };
  if (lat != null && lng != null) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 20000 },
    };
  }
  const data = await fetchJson<{
    places?: Array<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      rating?: number;
      userRatingCount?: number;
      location?: { latitude: number; longitude: number };
      googleMapsUri?: string;
      websiteUri?: string;
    }>;
  }>("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.googleMapsUri,places.websiteUri",
    },
    body: JSON.stringify(body),
  });

  return (data.places ?? []).slice(0, 10).map((p) => ({
    id: p.id,
    name: p.displayName?.text ?? "Unknown",
    address: p.formattedAddress ?? "",
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    googleMapsUri: p.googleMapsUri ?? null,
    websiteUri: p.websiteUri ?? null,
  }));
}

// ── Places Aggregate / Area Insights ─────────────────────────────────────

export async function getNearbyPlaceCount(
  lat: number,
  lng: number,
  placeType: string,
  radiusMeters = 2000,
): Promise<number> {
  const key = requireMapsKey();
  const data = await fetchJson<{ count?: string | number }>(
    "https://areainsights.googleapis.com/v1:computeInsights",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        insights: ["INSIGHT_COUNT"],
        filter: {
          locationFilter: {
            circle: {
              latLng: { latitude: lat, longitude: lng },
              radius: radiusMeters,
            },
          },
          typeFilter: { includedTypes: [placeType] },
        },
      }),
    },
  );
  return Number(data.count ?? 0);
}

// ── Aerial View ──────────────────────────────────────────────────────────

export type AerialViewState = "ACTIVE" | "PROCESSING" | "NOT_FOUND" | "FAILED";

export interface AerialViewResult {
  state: AerialViewState;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export async function lookupOrRequestAerialView(
  address: string,
): Promise<AerialViewResult> {
  const key = requireMapsKey();
  const lookupUrl = `https://aerialview.googleapis.com/v1/videos:lookupVideo?key=${key}&address=${encodeURIComponent(address)}`;
  try {
    const data = await fetchJson<{
      state: AerialViewState;
      uris?: { mp4?: { landscapeUri?: string }; thumbnail?: { landscapeUri?: string } };
    }>(lookupUrl);
    if (data.state === "ACTIVE") {
      return {
        state: "ACTIVE",
        videoUrl: data.uris?.mp4?.landscapeUri,
        thumbnailUrl: data.uris?.thumbnail?.landscapeUri,
      };
    }
    if (data.state === "PROCESSING") return { state: "PROCESSING" };
  } catch {
    // Fall through to render request below — lookup 404s when no video has
    // ever been requested for this address yet.
  }

  const renderUrl = `https://aerialview.googleapis.com/v1/videos:renderVideo?key=${key}&address=${encodeURIComponent(address)}`;
  try {
    const data = await fetchJson<{ state: AerialViewState }>(renderUrl);
    return { state: data.state ?? "PROCESSING" };
  } catch {
    return { state: "NOT_FOUND" };
  }
}

// ── Routes ───────────────────────────────────────────────────────────────

export type TravelMode = "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";

export interface RouteWaypointInput {
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  optimizedIntermediateWaypointIndex?: number[];
  encodedPolyline?: string;
}

export async function computeRoute(
  origin: RouteWaypointInput,
  destination: RouteWaypointInput,
  intermediates: RouteWaypointInput[] = [],
  mode: TravelMode = "DRIVE",
  optimizeWaypoints = false,
): Promise<RouteResult | null> {
  const key = requireMapsKey();
  const toWaypoint = (w: RouteWaypointInput) => ({
    location: { latLng: { latitude: w.lat, longitude: w.lng } },
  });

  const body: Record<string, unknown> = {
    origin: toWaypoint(origin),
    destination: toWaypoint(destination),
    travelMode: mode,
    ...(mode === "DRIVE" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
  };
  if (intermediates.length > 0) {
    body.intermediates = intermediates.map(toWaypoint);
    if (optimizeWaypoints) body.optimizeWaypointOrder = true;
  }

  const data = await fetchJson<{
    routes?: Array<{
      distanceMeters: number;
      duration: string;
      optimizedIntermediateWaypointIndex?: number[];
      polyline?: { encodedPolyline?: string };
    }>;
  }>("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
  });

  const route = data.routes?.[0];
  if (!route) return null;
  const seconds = parseInt(route.duration.replace(/s$/, ""), 10) || 0;
  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: seconds,
    optimizedIntermediateWaypointIndex: route.optimizedIntermediateWaypointIndex,
    encodedPolyline: route.polyline?.encodedPolyline,
  };
}

// ── Isochrones ───────────────────────────────────────────────────────────

export interface IsochronePolygon {
  travelDurationSeconds: number;
  points: Array<{ lat: number; lng: number }>;
}

export async function getIsochrone(
  lat: number,
  lng: number,
  travelDurationSeconds: number,
  mode: "DRIVE" | "WALK" | "BICYCLE" = "WALK",
): Promise<IsochronePolygon | null> {
  const key = requireMapsKey();
  const data = await fetchJson<{
    polygons?: Array<{
      travelDurationSeconds: string | number;
      shape?: { polygon?: { coordinates?: Array<{ latitude: number; longitude: number }[]> } };
    }>;
  }>("https://isochrones.googleapis.com/v1/isochrones:generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      location: { latitude: lat, longitude: lng },
      travelDuration: `${travelDurationSeconds}s`,
      travelMode: mode,
      routingPreference: mode === "DRIVE" ? "TRAFFIC_AWARE" : "ROUTING_PREFERENCE_UNSPECIFIED",
      enableSmoothing: true,
      travelDirection: "TRAVEL_DIRECTION_UNSPECIFIED",
    }),
  });

  const polygon = data.polygons?.[0];
  const ring = polygon?.shape?.polygon?.coordinates?.[0];
  if (!polygon || !ring) return null;

  return {
    travelDurationSeconds: Number(polygon.travelDurationSeconds),
    points: ring.map((c) => ({ lat: c.latitude, lng: c.longitude })),
  };
}
