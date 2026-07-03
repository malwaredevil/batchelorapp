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

// How close a trip's start date has to be before we start nudging about it.
const NUDGE_WINDOW_DAYS = 3;

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
    }>(
      `SELECT id, user_id, destination, start_date::text AS start_date,
              packing_list, itinerary
         FROM travels_trips
        WHERE start_date IS NOT NULL
          AND start_date >= CURRENT_DATE
          AND start_date <= CURRENT_DATE + $1::integer
          AND status IN ('planning', 'booked')`,
      [NUDGE_WINDOW_DAYS],
    );

    const candidates: { userId: number; tripId: number; nudgeKey: string; message: string }[] =
      [];

    for (const trip of trips) {
      const days = daysUntil(trip.start_date);
      const dayLabel = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

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
    }

    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO travels_assistant_nudges (user_id, trip_id, nudge_key, message)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, nudge_key) DO NOTHING`,
        [candidate.userId, candidate.tripId, candidate.nudgeKey, candidate.message],
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
export function startNudgeScheduler(): void {
  computeAndStoreNudges().catch((err: unknown) =>
    logger.error({ err }, "travels-nudges: initial run failed"),
  );

  const interval = setInterval(() => {
    computeAndStoreNudges().catch((err: unknown) =>
      logger.error({ err }, "travels-nudges: scheduled run failed"),
    );
  }, IN_PROCESS_INTERVAL_MS);

  interval.unref();

  logger.info("travels-nudges: started (in-process fallback, runs hourly)");
}
