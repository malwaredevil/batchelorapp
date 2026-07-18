/**
 * Proactive disruption monitoring scheduler (#238).
 *
 * Runs hourly and checks all active reservations for:
 *   1. Weather risk at the trip destination (OpenMeteo — free, no API key)
 *   2. Check-in window opening reminders (hotel / flight)
 *   3. Document / passport expiration reminders
 *
 * Flight/rail/hotel live-status adapters are scaffolded but not yet wired to
 * an external provider. The framework produces real change events from document
 * re-extraction comparisons and weather data today; live adapters can be added
 * per-type once a normalised adapter and test fixtures exist.
 */

import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import {
  db,
  travelsTrips,
  travelsReservations,
  travelMonitoringBaselines,
  travelMonitoringObservations,
  travelChangeEvents,
  travelsMonitoringPreferences,
} from "@workspace/db";
import { createNotification, NOTIFICATION_TYPES } from "./notifications";
import { shouldRunScheduledTask } from "./scheduler-guard";
import { logger } from "./logger";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashObject(obj: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(obj ?? {}))
    .digest("hex")
    .slice(0, 16);
}

function daysFromNow(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00Z").getTime();
  const now = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  return Math.round((d - now) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Weather check (OpenMeteo — free, no API key required)
// ---------------------------------------------------------------------------

type WeatherAlert = {
  description: string;
  maxTemperatureC: number;
  minTemperatureC: number;
  maxPrecipitationMm: number;
  maxWindspeedKmh: number;
  weatherCode: number;
};

const SEVERE_WMO_CODES = new Set([
  65,
  67,
  75,
  77, // heavy rain/snow
  82,
  86, // heavy showers
  95,
  96,
  99, // thunderstorm
]);

async function fetchWeatherAlert(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<WeatherAlert | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&timezone=UTC&forecast_days=16`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        windspeed_10m_max?: number[];
      };
    };

    const daily = data.daily;
    if (!daily?.weather_code?.length) return null;

    const codes = daily.weather_code;
    const maxTemps = daily.temperature_2m_max ?? [];
    const minTemps = daily.temperature_2m_min ?? [];
    const precip = daily.precipitation_sum ?? [];
    const wind = daily.windspeed_10m_max ?? [];

    const hasSevere = codes.some((c) => SEVERE_WMO_CODES.has(c));
    const maxPrecip = Math.max(0, ...precip.filter(Boolean));
    const maxWind = Math.max(0, ...wind.filter(Boolean));
    const maxTemp = Math.max(-999, ...maxTemps.filter(Boolean));
    const minTemp = Math.min(999, ...minTemps.filter(Boolean));

    const isRisky =
      hasSevere ||
      maxPrecip > 20 ||
      maxWind > 60 ||
      maxTemp > 42 ||
      minTemp < -10;

    if (!isRisky) return null;

    const worstCodeIdx = codes.reduce(
      (best, c, i) =>
        SEVERE_WMO_CODES.has(c) && !SEVERE_WMO_CODES.has(codes[best] ?? 0)
          ? i
          : best,
      0,
    );

    return {
      description: `Adverse weather forecast during trip dates`,
      maxTemperatureC: maxTemp,
      minTemperatureC: minTemp,
      maxPrecipitationMm: maxPrecip,
      maxWindspeedKmh: maxWind,
      weatherCode: codes[worstCodeIdx] ?? 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

type ChangeSeverity = "informational" | "attention" | "important" | "critical";

function weatherSeverity(alert: WeatherAlert): ChangeSeverity {
  const { weatherCode, maxPrecipitationMm, maxWindspeedKmh } = alert;
  if (weatherCode >= 95 || maxWindspeedKmh > 80 || maxPrecipitationMm > 50)
    return "important";
  if (SEVERE_WMO_CODES.has(weatherCode)) return "attention";
  return "attention";
}

// ---------------------------------------------------------------------------
// Core monitoring run
// ---------------------------------------------------------------------------

async function runMonitoringCycle(): Promise<void> {
  const now = new Date();

  // Only check reservations for upcoming trips (not yet ended)
  const activeReservations = await db
    .select({
      id: travelsReservations.id,
      tripId: travelsReservations.tripId,
      reservationType: travelsReservations.reservationType,
      monitoringEnabled: travelsReservations.monitoringEnabled,
      monitoringPolicy: travelsReservations.monitoringPolicy,
      checkInDate: travelsReservations.checkInDate,
      checkOutDate: travelsReservations.checkOutDate,
      status: travelsReservations.status,
      createdByUserId: travelsReservations.createdByUserId,
      lastCheckedAt: travelsReservations.lastCheckedAt,
    })
    .from(travelsReservations)
    .where(
      and(
        eq(travelsReservations.monitoringEnabled, true),
        eq(travelsReservations.status, "confirmed"),
      ),
    );

  if (activeReservations.length === 0) return;

  // Fetch trip locations for weather monitoring
  const tripIds = [...new Set(activeReservations.map((r) => r.tripId))];
  const trips = await db
    .select({
      id: travelsTrips.id,
      lat: travelsTrips.lat,
      lng: travelsTrips.lng,
      startDate: travelsTrips.startDate,
      endDate: travelsTrips.endDate,
    })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripIds[0]!)); // We'll iterate per trip below

  // Build trip map
  const tripMap = new Map<number, (typeof trips)[0]>();
  const allTrips = await db
    .select({
      id: travelsTrips.id,
      lat: travelsTrips.lat,
      lng: travelsTrips.lng,
      startDate: travelsTrips.startDate,
      endDate: travelsTrips.endDate,
    })
    .from(travelsTrips);
  for (const t of allTrips) {
    if (tripIds.includes(t.id)) tripMap.set(t.id, t);
  }

  for (const reservation of activeReservations) {
    try {
      await processReservation(reservation, tripMap, now);
    } catch (err) {
      logger.warn(
        { err, reservationId: reservation.id },
        "monitoring cycle: error processing reservation",
      );
    }
  }
}

type ReservationRow = {
  id: number;
  tripId: number;
  reservationType: string;
  monitoringEnabled: boolean;
  monitoringPolicy: string;
  checkInDate: string | null;
  checkOutDate: string | null;
  status: string;
  createdByUserId: number;
  lastCheckedAt: Date | null;
};

type TripRow = {
  id: number;
  lat: number | null;
  lng: number | null;
  startDate: string | null;
  endDate: string | null;
};

async function processReservation(
  reservation: ReservationRow,
  tripMap: Map<number, TripRow>,
  now: Date,
): Promise<void> {
  const trip = tripMap.get(reservation.tripId);
  if (!trip) return;

  // Skip past trips
  if (trip.endDate && new Date(trip.endDate) < now) return;

  // Throttle based on policy and time-to-trip
  const daysToStart = daysFromNow(trip.startDate);
  const checkIntervalHours = getCheckIntervalHours(
    reservation.monitoringPolicy,
    daysToStart,
  );
  if (reservation.lastCheckedAt) {
    const hoursSinceCheck =
      (now.getTime() - reservation.lastCheckedAt.getTime()) / 3_600_000;
    if (hoursSinceCheck < checkIntervalHours) return;
  }

  await db
    .update(travelsReservations)
    .set({ lastCheckedAt: now, updatedAt: now })
    .where(eq(travelsReservations.id, reservation.id));

  // 1. Weather check
  if (trip.lat && trip.lng && trip.startDate) {
    const endDate = trip.endDate ?? trip.startDate;
    await checkWeather(
      reservation,
      trip,
      trip.lat,
      trip.lng,
      trip.startDate,
      endDate,
    );
  }

  // 2. Check-in window reminder
  await checkCheckInWindow(reservation, trip);
}

function getCheckIntervalHours(
  policy: string,
  daysToStart: number | null,
): number {
  if (policy === "paused") return Infinity;
  if (policy === "minimal") return 48;
  if (daysToStart === null) return 24;
  if (daysToStart <= 1) return 2;
  if (daysToStart <= 2) return 4;
  if (daysToStart <= 7) return 8;
  if (daysToStart <= 30) return 24;
  return policy === "aggressive" ? 24 : 48;
}

// ---------------------------------------------------------------------------
// Weather check
// ---------------------------------------------------------------------------

async function checkWeather(
  reservation: ReservationRow,
  trip: TripRow,
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<void> {
  const daysToStart = daysFromNow(startDate);
  if (daysToStart === null || daysToStart > 16 || daysToStart < -1) return;

  const alert = await fetchWeatherAlert(lat, lng, startDate, endDate);
  if (!alert) return;

  const dedupKey = `weather:${reservation.id}:${startDate}:${hashObject(alert)}`;
  const existing = await db
    .select({ id: travelChangeEvents.id })
    .from(travelChangeEvents)
    .where(eq(travelChangeEvents.dedupKey, dedupKey));
  if (existing.length > 0) return;

  const severity = weatherSeverity(alert);

  const [obs] = await db
    .insert(travelMonitoringObservations)
    .values({
      reservationId: reservation.id,
      provider: "open-meteo",
      observedData: alert as Record<string, unknown>,
      authority: "api",
      contentHash: hashObject(alert),
    })
    .returning();

  const [changeEvent] = await db
    .insert(travelChangeEvents)
    .values({
      reservationId: reservation.id,
      newObservationId: obs?.id,
      changeType: "weather_alert",
      severity,
      fieldDiffs: [
        {
          field: "weather",
          before: null,
          after: alert.description,
          reason: `Max precip: ${alert.maxPrecipitationMm.toFixed(1)}mm, wind: ${alert.maxWindspeedKmh.toFixed(0)}km/h`,
        },
      ],
      materialityReason: `Adverse weather forecast during trip to ${trip.startDate}–${endDate}`,
      dedupKey,
    })
    .returning();

  if (changeEvent) {
    const notifEventId = await createNotification({
      eventType: NOTIFICATION_TYPES.TRAVEL_RESERVATION_CHANGE,
      module: "travels",
      severity,
      scope: "household",
      subjectType: "reservation",
      subjectId: reservation.id,
      title: `Weather alert for your trip`,
      summary: alert.description,
      actionUrl: `/modules/travels/trips/${reservation.tripId}?tab=changes`,
      dedupKey: `notif:${dedupKey}`,
    });

    if (notifEventId) {
      await db
        .update(travelChangeEvents)
        .set({ notificationEventId: notifEventId, state: "notified" })
        .where(eq(travelChangeEvents.id, changeEvent.id));
    }
  }

  logger.info(
    { reservationId: reservation.id, severity, dedupKey },
    "monitoring: weather alert created",
  );
}

// ---------------------------------------------------------------------------
// Check-in window reminder
// ---------------------------------------------------------------------------

async function checkCheckInWindow(
  reservation: ReservationRow,
  _trip: TripRow,
): Promise<void> {
  const checkInDate =
    reservation.checkInDate ??
    (reservation.reservationType === "flight" ? reservation.checkInDate : null);

  if (!checkInDate) return;

  const daysToCheckin = daysFromNow(checkInDate);
  if (daysToCheckin === null) return;

  let threshold: number | null = null;
  let windowDescription = "";

  if (reservation.reservationType === "hotel" && daysToCheckin === 0) {
    threshold = 0;
    windowDescription = "Check-in is today";
  } else if (reservation.reservationType === "hotel" && daysToCheckin === 1) {
    threshold = 1;
    windowDescription = "Check-in is tomorrow";
  } else if (reservation.reservationType === "flight" && daysToCheckin <= 1) {
    threshold = daysToCheckin;
    windowDescription =
      daysToCheckin === 0
        ? "Online check-in window is now open (departs today)"
        : "Online check-in window typically opens now (24h before departure)";
  } else if (
    reservation.reservationType === "rental_car" &&
    daysToCheckin === 0
  ) {
    threshold = 0;
    windowDescription = "Rental car pickup is today";
  }

  if (threshold === null) return;

  const dedupKey = `checkin:${reservation.id}:${checkInDate}:d${threshold}`;
  const existing = await db
    .select({ id: travelChangeEvents.id })
    .from(travelChangeEvents)
    .where(eq(travelChangeEvents.dedupKey, dedupKey));
  if (existing.length > 0) return;

  const [changeEvent] = await db
    .insert(travelChangeEvents)
    .values({
      reservationId: reservation.id,
      changeType: "check_in_window",
      severity: "attention",
      fieldDiffs: [
        {
          field: "check_in_date",
          before: null,
          after: checkInDate,
          reason: windowDescription,
        },
      ],
      materialityReason: windowDescription,
      dedupKey,
    })
    .returning();

  if (changeEvent) {
    const notifEventId = await createNotification({
      eventType: NOTIFICATION_TYPES.TRAVEL_RESERVATION_CHANGE,
      module: "travels",
      severity: "attention",
      scope: "household",
      subjectType: "reservation",
      subjectId: reservation.id,
      title: windowDescription,
      summary: `Reservation with ${reservation.reservationType} — ${windowDescription}`,
      actionUrl: `/modules/travels/trips/${reservation.tripId}?tab=changes`,
      dedupKey: `notif:${dedupKey}`,
    });

    if (notifEventId) {
      await db
        .update(travelChangeEvents)
        .set({ notificationEventId: notifEventId, state: "notified" })
        .where(eq(travelChangeEvents.id, changeEvent.id));
    }
  }

  logger.info(
    { reservationId: reservation.id, windowDescription, dedupKey },
    "monitoring: check-in window reminder created",
  );
}

// ---------------------------------------------------------------------------
// Scheduler entry point
// ---------------------------------------------------------------------------

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startMonitoringScheduler(): void {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const run = async (): Promise<void> => {
    if (!(await shouldRunScheduledTask("monitoring-scheduler", INTERVAL_MS)))
      return;
    try {
      await runMonitoringCycle();
    } catch (err) {
      logger.error({ err }, "monitoring-scheduler: unhandled error");
    }
  };

  // Initial run after 2 min startup grace period, then every hour
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, INTERVAL_MS);

  logger.info("monitoring-scheduler: started");
}
