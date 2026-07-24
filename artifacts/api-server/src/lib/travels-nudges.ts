/**
 * Proactive nudges — elAIne messaging a user without being asked first
 * (e.g. "your trip starts in 2 days and your packing list is still empty").
 * Runs on the same cadence as the reminder-alert scheduler (in-process
 * hourly fallback + Replit Scheduled Deployment, see reminder-scheduler.ts
 * and scripts/send-reminder-alerts.ts). Every generated nudge is inserted
 * with a stable `nudgeKey` and a unique (user_id, nudge_key) index, so
 * re-running this job never produces a duplicate nag — a condition either
 * hasn't fired yet (row gets created) or already has (ON CONFLICT DO
 * NOTHING). Nudges are surfaced to the user by
 * GET /api/travels/assistant/conversation, which folds any unseen rows into
 * the chat history as ordinary assistant messages the next time it loads.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { getAirQuality, getPollenForecast } from "./travels/google-maps";
import { shouldRunScheduledTask } from "./scheduler-guard";

// How close a trip's start date has to be before we start nudging about it.
const NUDGE_WINDOW_DAYS = 3;

// AQI thresholds per Google's Universal AQI scale (0-100, higher = worse).
const AQI_UNHEALTHY_THRESHOLD = 100;
const HIGH_POLLEN_CATEGORIES = new Set(["High", "Very High"]);

type PackingItem = { item: string; packed: boolean };
type ItineraryDay = { activities?: unknown[] } | Record<string, unknown>;

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00.000Z`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export async function computeAndStoreNudges(): Promise<void> {
  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "travels-nudges: could not connect to DB");
    return null;
  });
  if (!client) return;

  try {
    const { rows: trips } = await client.query<{
      id: number;
      user_id: number;
      destination: string;
      start_date: string;
      packing_list: PackingItem[] | null;
      itinerary: ItineraryDay[] | null;
      lat: number | null;
      lng: number | null;
    }>(
      `SELECT id, user_id, destination, start_date::text AS start_date,
              packing_list, itinerary, lat, lng
         FROM travels_trips
        WHERE start_date IS NOT NULL
          AND start_date >= CURRENT_DATE
          AND start_date <= CURRENT_DATE + $1::integer
          AND status IN ('planning', 'booked')`,
      [NUDGE_WINDOW_DAYS],
    );

    const candidates: {
      userId: number;
      tripId: number;
      nudgeKey: string;
      message: string;
    }[] = [];

    for (const trip of trips) {
      const days = daysUntil(trip.start_date);
      const dayLabel =
        days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

      const packingList = trip.packing_list ?? [];
      if (packingList.length === 0) {
        candidates.push({
          userId: trip.user_id,
          tripId: trip.id,
          nudgeKey: `packing_empty:${trip.id}`,
          message: `Heads up — your trip to ${trip.destination} starts ${dayLabel} and your packing list is still empty. Want me to help you put one together?`,
        });
      }

      const itinerary = trip.itinerary ?? [];
      if (itinerary.length === 0) {
        candidates.push({
          userId: trip.user_id,
          tripId: trip.id,
          nudgeKey: `itinerary_empty:${trip.id}`,
          message: `Your trip to ${trip.destination} kicks off ${dayLabel} but there's no itinerary yet — want me to put one together?`,
        });
      }

      if (trip.lat != null && trip.lng != null) {
        const [airQuality, pollen] = await Promise.all([
          getAirQuality(trip.lat, trip.lng).catch((err: unknown) => {
            logger.warn(
              { err, tripId: trip.id },
              "travels-nudges: air quality lookup failed",
            );
            return null;
          }),
          getPollenForecast(trip.lat, trip.lng).catch((err: unknown) => {
            logger.warn(
              { err, tripId: trip.id },
              "travels-nudges: pollen lookup failed",
            );
            return null;
          }),
        ]);

        if (airQuality && airQuality.aqi >= AQI_UNHEALTHY_THRESHOLD) {
          candidates.push({
            userId: trip.user_id,
            tripId: trip.id,
            nudgeKey: `air_quality:${trip.id}:${trip.start_date}`,
            message: `Air quality in ${trip.destination} is currently "${airQuality.category}" (AQI ${airQuality.aqi}) ahead of your trip ${dayLabel}. You may want to pack a mask or plan more indoor time.`,
          });
        }

        if (pollen && HIGH_POLLEN_CATEGORIES.has(pollen.overallCategory)) {
          candidates.push({
            userId: trip.user_id,
            tripId: trip.id,
            nudgeKey: `pollen:${trip.id}:${trip.start_date}`,
            message: `Pollen levels in ${trip.destination} are "${pollen.overallCategory}" ahead of your trip ${dayLabel}. If anyone in your group has allergies, it might be worth packing medication.`,
          });
        }
      }
    }

    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO elaine_nudges (user_id, source_app, source_id, nudge_key, message)
         VALUES ($1, 'travels', $2, $3, $4)
         ON CONFLICT (user_id, nudge_key) DO NOTHING`,
        [
          candidate.userId,
          candidate.tripId,
          candidate.nudgeKey,
          candidate.message,
        ],
      );
    }

    if (candidates.length > 0) {
      logger.info(
        { candidateCount: candidates.length },
        "travels-nudges: evaluated proactive nudge candidates",
      );
    }
  } finally {
    client.release();
  }
}

const IN_PROCESS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Best-effort, in-process fallback — same caveat as the reminder scheduler:
 * an `autoscale` instance can be asleep for long stretches, so this alone
 * cannot guarantee timely nudges. Reliable delivery comes from also running
 * this from the Replit Scheduled Deployment (see
 * scripts/send-reminder-alerts.ts), which runs independently of whether the
 * web server instance happens to be awake. The unique nudge-key index makes
 * both paths safely idempotent together.
 */
export function startNudgeScheduler(): () => void {
  const run = async (): Promise<void> => {
    if (
      !(await shouldRunScheduledTask("travels-nudges", IN_PROCESS_INTERVAL_MS))
    ) {
      logger.info("travels-nudges: skipped (ran within the last hour)");
      return;
    }
    const t0 = Date.now();
    logger.info("travels-nudges: run starting");
    try {
      await computeAndStoreNudges();
      logger.info(
        { durationMs: Date.now() - t0 },
        "travels-nudges: run complete",
      );
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "travels-nudges: run failed",
      );
    }
  };

  void run();

  const interval = setInterval(() => void run(), IN_PROCESS_INTERVAL_MS);
  interval.unref();

  logger.info("travels-nudges: started (in-process fallback, runs hourly)");
  return () => clearInterval(interval);
}
