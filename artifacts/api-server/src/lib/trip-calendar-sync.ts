// Reconciles a trip's itinerary content against the shared Travel Calendar
// (the one connected calendar with isTravelCalendar = true): one Google
// event for the trip overall, plus one per itinerary activity (flights,
// hotel check-in/out, activities). Being on the dedicated Travel calendar
// is itself the "this is a trip" signal — no colorId tagging needed.
//
// Itinerary days/activities have no stable ids (they're a plain JSON array
// edited in place), so this maps each item to a content-derived `itemKey`
// (e.g. `activity:<dayDate>:<hash(name+time)>`) instead of an array index.
// That survives reordering, insertion, and deletion of other items — only
// renaming an activity or changing its time changes its key, which is
// treated as delete-old + create-new (acceptable, rare, and self-healing).
//
// Every trip save calls syncTripCalendarEvents() — throws on GCal write
// failure so the calling route can surface the error to the user instead of
// silently swallowing it.
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, travelsTripCalendarEvents, travelsTrips } from "@workspace/db";
import {
  getTravelCalendarConnection,
  getValidAccessToken,
} from "./google-calendar-tokens";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type CalendarEventInput,
} from "./google-calendar";
import { logger } from "./logger";

type ItineraryActivity = {
  time?: string;
  name?: string;
  description?: string;
  proximity?: string;
  tip?: string;
};
type ItineraryDay = {
  date?: string;
  title?: string;
  activities?: ItineraryActivity[];
};
type Itinerary = { days?: ItineraryDay[] };

export interface TripForCalendarSync {
  id: number;
  title: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  itinerary: unknown;
}

interface DesiredItem {
  itemKey: string;
  input: CalendarEventInput;
}

function shortHash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function contentHash(input: CalendarEventInput): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify([
        input.title,
        input.description ?? "",
        input.location ?? "",
        input.allDay,
        input.start,
        input.end,
        input.colorId ?? "",
      ]),
    )
    .digest("hex");
}

function activityDateTime(date: string, time: string): string | null {
  const d = new Date(`${date}T${time}:00`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function addHourIso(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}

function buildDesiredItems(trip: TripForCalendarSync): DesiredItem[] {
  const items: DesiredItem[] = [];

  if (trip.startDate && trip.endDate) {
    items.push({
      itemKey: "trip",
      input: {
        title: `Trip: ${trip.title}`,
        description: `Trip to ${trip.destination}`,
        allDay: true,
        start: trip.startDate,
        end: trip.endDate,
        colorId: null,
      },
    });
  }

  const itinerary = trip.itinerary as Itinerary | null;
  for (const day of itinerary?.days ?? []) {
    if (!day?.date) continue;
    for (const activity of day.activities ?? []) {
      if (!activity?.name) continue;
      const itemKey = `activity:${day.date}:${shortHash(`${activity.name}|${activity.time ?? ""}`)}`;
      const descParts = [
        activity.description,
        activity.proximity,
        activity.tip,
      ].filter((s): s is string => Boolean(s && s.trim()));
      const timed = activity.time
        ? activityDateTime(day.date, activity.time)
        : null;
      const allDay = !timed;
      const start = timed ?? day.date;
      const end = timed ? addHourIso(timed) : day.date;
      items.push({
        itemKey,
        input: {
          title: activity.name,
          description:
            descParts.length > 0 ? descParts.join("\n\n") : undefined,
          allDay,
          start,
          end,
          colorId: null,
        },
      });
    }
  }

  return items;
}

/**
 * Reconcile the Google Calendar events for one trip against its current
 * title/dates/itinerary. Safe to call after every trip create/update; a
 * no-op (fast) if nothing changed and if no household calendar is
 * configured.
 */
export async function syncTripCalendarEvents(
  trip: TripForCalendarSync,
): Promise<void> {
  const connection = await getTravelCalendarConnection();
  if (!connection) return;
  const accessToken = await getValidAccessToken(connection.userId);
  if (!accessToken) return;

  const desired = buildDesiredItems(trip);
  const desiredByKey = new Map(desired.map((d) => [d.itemKey, d]));

  const existing = await db
    .select()
    .from(travelsTripCalendarEvents)
    .where(eq(travelsTripCalendarEvents.tripId, trip.id));
  const existingByKey = new Map(existing.map((e) => [e.itemKey, e]));

  // Delete mapping rows (and their Google events) for items no longer present.
  // Stale-event deletes are best-effort: a failed delete is non-fatal since
  // the event is orphaned on GCal but doesn't block the save.
  for (const row of existing) {
    if (!desiredByKey.has(row.itemKey)) {
      await deleteCalendarEvent(
        accessToken,
        connection.googleCalendarId,
        row.googleEventId,
      ).catch((err: unknown) =>
        logger.warn(
          { err, tripId: trip.id, itemKey: row.itemKey },
          "trip-calendar-sync: stale-event delete failed (non-fatal)",
        ),
      );
      await db
        .delete(travelsTripCalendarEvents)
        .where(eq(travelsTripCalendarEvents.id, row.id));
    }
  }

  // Create or update the rest. Throws on failure so callers surface the error.
  for (const item of desired) {
    const hash = contentHash(item.input);
    const existingRow = existingByKey.get(item.itemKey);
    if (!existingRow) {
      const event = await createCalendarEvent(
        accessToken,
        connection.googleCalendarId,
        item.input,
      );
      await db.insert(travelsTripCalendarEvents).values({
        tripId: trip.id,
        itemKey: item.itemKey,
        kind: item.itemKey === "trip" ? "trip" : "itinerary_activity",
        contentHash: hash,
        googleEventId: event.id,
      });
    } else if (existingRow.contentHash !== hash) {
      await updateCalendarEvent(
        accessToken,
        connection.googleCalendarId,
        existingRow.googleEventId,
        item.input,
      );
      await db
        .update(travelsTripCalendarEvents)
        .set({ contentHash: hash, updatedAt: new Date() })
        .where(eq(travelsTripCalendarEvents.id, existingRow.id));
    }
  }
}

function dateOnly(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function localTimeOfIso(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Reverse-sync: when a user edits a Travel Calendar event that was
 * originally generated from a trip/itinerary (has a row in
 * travelsTripCalendarEvents), push the edited title/dates/description back
 * into the owning trip's Supabase record so the two stay consistent.
 *
 * - kind 'trip': updates the trip's title (stripping the "Trip: " prefix)
 *   and start/end dates.
 * - kind 'itinerary_activity': updates the matching activity's name, time,
 *   and description within the trip's itinerary JSON. Note: activities also
 *   have separate `proximity`/`tip` fields that get folded into
 *   `description` on save from here (there's no way to tell them apart from
 *   the calendar's single description field) — an accepted simplification.
 * - kind 'suggested_event': no owned trip content to update; skipped.
 *
 * Best effort — never throws, and never blocks the calendar response.
 */
export async function applyCalendarEventEditToTrip(
  googleEventId: string,
  input: CalendarEventInput,
): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(travelsTripCalendarEvents)
      .where(eq(travelsTripCalendarEvents.googleEventId, googleEventId));
    if (!row || row.kind === "suggested_event") return;

    const [trip] = await db
      .select()
      .from(travelsTrips)
      .where(eq(travelsTrips.id, row.tripId));
    if (!trip) return;

    if (row.kind === "trip") {
      const title = input.title.startsWith("Trip: ")
        ? input.title.slice("Trip: ".length)
        : input.title;
      const startDate = dateOnly(input.start);
      const endDate = dateOnly(input.end);
      await db
        .update(travelsTrips)
        .set({ title, startDate, endDate })
        .where(eq(travelsTrips.id, trip.id));

      const newHash = contentHash({ ...input, title: `Trip: ${title}` });
      await db
        .update(travelsTripCalendarEvents)
        .set({ contentHash: newHash, updatedAt: new Date() })
        .where(eq(travelsTripCalendarEvents.id, row.id));
      logger.info(
        { tripId: trip.id },
        "trip-calendar-sync: reverse-synced trip fields from calendar edit",
      );
      return;
    }

    // kind === "itinerary_activity"
    const match = /^activity:([^:]+):(.+)$/.exec(row.itemKey);
    if (!match) return;
    const [, oldDate, oldHash] = match;
    const itinerary = trip.itinerary as Itinerary | null;
    const day = itinerary?.days?.find((d) => d?.date === oldDate);
    const activity = day?.activities?.find(
      (a) => a?.name && shortHash(`${a.name}|${a.time ?? ""}`) === oldHash,
    );
    if (!itinerary || !day || !activity) return;

    const newDate = dateOnly(input.start);
    activity.name = input.title;
    activity.time = input.allDay ? undefined : localTimeOfIso(input.start);
    activity.description = input.description ?? undefined;
    if (day.date !== newDate) day.date = newDate;

    await db
      .update(travelsTrips)
      .set({ itinerary })
      .where(eq(travelsTrips.id, trip.id));

    const newItemKey = `activity:${newDate}:${shortHash(`${activity.name}|${activity.time ?? ""}`)}`;
    const newHash = contentHash(input);
    if (newItemKey !== row.itemKey) {
      const clash = await db
        .select({ id: travelsTripCalendarEvents.id })
        .from(travelsTripCalendarEvents)
        .where(
          and(
            eq(travelsTripCalendarEvents.tripId, trip.id),
            eq(travelsTripCalendarEvents.itemKey, newItemKey),
          ),
        );
      if (clash.length === 0) {
        await db
          .update(travelsTripCalendarEvents)
          .set({
            itemKey: newItemKey,
            contentHash: newHash,
            updatedAt: new Date(),
          })
          .where(eq(travelsTripCalendarEvents.id, row.id));
      } else {
        await db
          .update(travelsTripCalendarEvents)
          .set({ contentHash: newHash, updatedAt: new Date() })
          .where(eq(travelsTripCalendarEvents.id, row.id));
      }
    } else {
      await db
        .update(travelsTripCalendarEvents)
        .set({ contentHash: newHash, updatedAt: new Date() })
        .where(eq(travelsTripCalendarEvents.id, row.id));
    }
    logger.info(
      { tripId: trip.id, itemKey: newItemKey },
      "trip-calendar-sync: reverse-synced itinerary activity from calendar edit",
    );
  } catch (err) {
    logger.warn(
      { err, googleEventId },
      "trip-calendar-sync: reverse-sync failed",
    );
  }
}

/**
 * Remove all Google Calendar events synced for a trip (called on trip
 * delete). Best effort — never throws.
 */
export async function deleteTripCalendarEvents(tripId: number): Promise<void> {
  try {
    const connection = await getTravelCalendarConnection();
    const rows = await db
      .select()
      .from(travelsTripCalendarEvents)
      .where(eq(travelsTripCalendarEvents.tripId, tripId));
    if (rows.length === 0) return;

    const accessToken = connection
      ? await getValidAccessToken(connection.userId)
      : null;

    if (accessToken && connection) {
      for (const row of rows) {
        await deleteCalendarEvent(
          accessToken,
          connection.googleCalendarId,
          row.googleEventId,
        ).catch((err: unknown) =>
          logger.warn(
            { err, tripId, itemKey: row.itemKey },
            "trip-calendar-sync: delete-on-cleanup failed",
          ),
        );
      }
    }
    await db
      .delete(travelsTripCalendarEvents)
      .where(eq(travelsTripCalendarEvents.tripId, tripId));
  } catch (err) {
    logger.warn({ err, tripId }, "trip-calendar-sync: delete-all failed");
  }
}

/**
 * Link an already-existing Google Calendar event to a trip (used when a
 * user accepts an AI travel suggestion) so future itinerary syncs don't
 * recreate a duplicate event for it, and so it can be cleaned up if the
 * trip is later deleted.
 */
export async function linkExistingCalendarEvent(
  tripId: number,
  googleEventId: string,
): Promise<void> {
  await db
    .insert(travelsTripCalendarEvents)
    .values({
      tripId,
      itemKey: `suggested:${googleEventId}`,
      kind: "suggested_event",
      contentHash: "",
      googleEventId,
    })
    .onConflictDoNothing();
}
