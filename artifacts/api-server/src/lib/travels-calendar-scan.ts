/**
 * AI scan across every connected calendar (every user's personal calendars
 * plus the shared Travel calendar) for travel-looking events (flights,
 * hotels, "Trip to ...", etc) that aren't already linked to a trip,
 * surfaced to the user as accept/dismiss suggestion cards instead of
 * silently creating trips. Runs daily in-process plus on-demand via a
 * manual "Scan now" button (POST /travels-calendar-scan).
 *
 * Idempotency: each suggestion gets a `dedupeKey` derived from the sorted
 * set of related Google event ids, inserted with ON CONFLICT DO NOTHING —
 * re-scanning the same events (daily job + manual button both firing)
 * never produces duplicate cards.
 */
import crypto from "node:crypto";
import {
  db,
  travelsCalendarTripSuggestions,
  travelsTripCalendarEvents,
} from "@workspace/db";
import {
  getAllConnectedCalendars,
  getValidAccessToken,
} from "./google-calendar-tokens";
import { listCalendarEvents, type CalendarEvent } from "./google-calendar";
import { callModel, getModels } from "./ai-client";
import { logger } from "./logger";

const SCAN_WINDOW_DAYS_PAST = 7;
const SCAN_WINDOW_DAYS_FUTURE = 120;

function parseAiJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(stripped);
}

interface AiSuggestedTrip {
  title: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  relatedEventIds: string[];
}

function dedupeKeyFor(relatedEventIds: string[]): string {
  const sorted = [...relatedEventIds].sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

async function askAiForTripCandidates(
  events: CalendarEvent[],
): Promise<AiSuggestedTrip[]> {
  if (events.length === 0) return [];

  const eventList = events
    .map(
      (e) =>
        `- id: ${e.id} | title: "${e.title}" | start: ${e.start} | end: ${e.end}${
          e.location ? ` | location: ${e.location}` : ""
        }`,
    )
    .join("\n");

  const prompt = `You are helping a household spot upcoming or past trips hiding in their connected calendars. Below is a list of calendar events. Identify clusters of events that together look like a single trip (e.g. a flight out, a hotel stay, a flight back, "vacation" or destination-named events). Ignore purely local/routine events (appointments, birthdays, recurring chores) that aren't travel-related.

Events:
${eventList}

Return ONLY valid JSON in this exact shape, with no extra text:
{
  "trips": [
    {
      "title": "Short trip title, e.g. 'Trip to Denver'",
      "destination": "City/place name or null if unclear",
      "startDate": "YYYY-MM-DD or null",
      "endDate": "YYYY-MM-DD or null",
      "relatedEventIds": ["<event id>", "..."]
    }
  ]
}

Only include a trip if at least one relatedEventIds entry is present. If no events look travel-related, return {"trips": []}.`;

  const models = await getModels();
  const raw = await callModel(models.fastVision, async (client, model) => {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });
    return resp.choices[0]?.message?.content ?? "{}";
  });

  try {
    const parsed = parseAiJson(raw) as { trips?: AiSuggestedTrip[] };
    return Array.isArray(parsed.trips) ? parsed.trips : [];
  } catch (err) {
    logger.warn({ err }, "travels-calendar-scan: failed to parse AI response");
    return [];
  }
}

/**
 * Scan every connected calendar (every user's personal calendars plus the
 * shared Travel calendar) for travel-looking events not already linked to a
 * trip, ask the AI to cluster them into candidate trips, and store any new
 * candidates as pending suggestions. Best-effort — logs and returns rather
 * than throwing, so it's always safe to call from a scheduler or a manual
 * "Scan now" endpoint.
 */
export async function scanCalendarForTripSuggestions(): Promise<{
  scanned: number;
  created: number;
}> {
  const calendars = await getAllConnectedCalendars();
  if (calendars.length === 0) return { scanned: 0, created: 0 };

  const now = new Date();
  const timeMin = new Date(
    now.getTime() - SCAN_WINDOW_DAYS_PAST * 86_400_000,
  ).toISOString();
  const timeMax = new Date(
    now.getTime() + SCAN_WINDOW_DAYS_FUTURE * 86_400_000,
  ).toISOString();

  // Track which connected calendar (owner + shared/personal) each event
  // came from, so the resulting suggestion can be scoped to the right
  // audience — a personal calendar's events must never surface a
  // suggestion visible to other household members.
  const accessTokenByUser = new Map<number, string | null>();
  const events: CalendarEvent[] = [];
  const eventSource = new Map<
    string,
    { userId: number; isFromSharedCalendar: boolean }
  >();
  for (const cal of calendars) {
    let accessToken = accessTokenByUser.get(cal.userId);
    if (accessToken === undefined) {
      accessToken = await getValidAccessToken(cal.userId);
      accessTokenByUser.set(cal.userId, accessToken);
    }
    if (!accessToken) continue;
    try {
      const calEvents = await listCalendarEvents(
        accessToken,
        cal.googleCalendarId,
        timeMin,
        timeMax,
      );
      for (const e of calEvents) {
        eventSource.set(e.id, {
          userId: cal.userId,
          isFromSharedCalendar: cal.isTravelCalendar,
        });
      }
      events.push(...calEvents);
    } catch (err) {
      logger.warn(
        { err, calendarId: cal.googleCalendarId },
        "travels-calendar-scan: could not list events",
      );
    }
  }

  // Skip events already linked to a trip. Being on the dedicated Travel
  // calendar no longer needs a colorId check — a trip-sync-created event on
  // that calendar is already linked via travels_trip_calendar_events.
  const linkedEventIds = new Set(
    (
      await db
        .select({ googleEventId: travelsTripCalendarEvents.googleEventId })
        .from(travelsTripCalendarEvents)
    ).map((r) => r.googleEventId),
  );

  const candidates = events.filter((e) => !linkedEventIds.has(e.id));

  if (candidates.length === 0) return { scanned: events.length, created: 0 };

  let aiTrips: AiSuggestedTrip[] = [];
  try {
    aiTrips = await askAiForTripCandidates(candidates);
  } catch (err) {
    logger.warn({ err }, "travels-calendar-scan: AI call failed");
    return { scanned: events.length, created: 0 };
  }

  const validEventIds = new Set(candidates.map((e) => e.id));
  let created = 0;

  for (const trip of aiTrips) {
    const relatedEventIds = (trip.relatedEventIds ?? []).filter((id) =>
      validEventIds.has(id),
    );
    if (relatedEventIds.length === 0) continue;

    // A cluster is treated as shared if any related event came from the
    // Travel calendar; otherwise it's scoped to the owner of the personal
    // calendar the events came from (falling back to the first related
    // event's owner if a cluster somehow spans multiple personal owners).
    const sources = relatedEventIds
      .map((id) => eventSource.get(id))
      .filter((s) => s !== undefined);
    const isFromSharedCalendar = sources.some((s) => s.isFromSharedCalendar);
    const ownerUserId =
      sources.find((s) => !s.isFromSharedCalendar)?.userId ??
      sources[0]?.userId ??
      null;

    const dedupeKey = dedupeKeyFor(relatedEventIds);
    const result = await db
      .insert(travelsCalendarTripSuggestions)
      .values({
        suggestedTitle: trip.title,
        destination: trip.destination ?? null,
        startDate: trip.startDate ?? null,
        endDate: trip.endDate ?? null,
        relatedEventIds,
        dedupeKey,
        status: "pending",
        userId: ownerUserId,
        isFromSharedCalendar,
      })
      .onConflictDoNothing()
      .returning({ id: travelsCalendarTripSuggestions.id });

    if (result.length > 0) created += 1;
  }

  if (created > 0) {
    logger.info(
      { created, scanned: events.length },
      "travels-calendar-scan: created new suggestions",
    );
  }

  return { scanned: events.length, created };
}

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Best-effort in-process daily scheduler, same caveat as other schedulers
 * in this codebase (see travels-nudges.ts): an autoscale instance can sleep
 * for long stretches, so this is a convenience, not a delivery guarantee.
 * The dedupeKey unique index keeps this safely idempotent alongside the
 * manual "Scan now" button.
 */
export function startCalendarTripScanScheduler(): void {
  scanCalendarForTripSuggestions().catch((err: unknown) =>
    logger.error({ err }, "travels-calendar-scan: initial run failed"),
  );

  const interval = setInterval(() => {
    scanCalendarForTripSuggestions().catch((err: unknown) =>
      logger.error({ err }, "travels-calendar-scan: scheduled run failed"),
    );
  }, SCAN_INTERVAL_MS);

  interval.unref();

  logger.info(
    "travels-calendar-scan: started (in-process fallback, runs daily)",
  );
}
