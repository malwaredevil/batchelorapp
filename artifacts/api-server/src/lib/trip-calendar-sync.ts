// Reconciles a trip's itinerary content against the household's shared
// Family Calendar: one Google event for the trip overall, plus one per
// itinerary activity (flights, hotel check-in/out, activities), all tagged
// with the household's chosen "Travel" colorId.
//
// Itinerary days/activities have no stable ids (they're a plain JSON array
// edited in place), so this maps each item to a content-derived `itemKey`
// (e.g. `activity:<dayDate>:<hash(name+time)>`) instead of an array index.
// That survives reordering, insertion, and deletion of other items — only
// renaming an activity or changing its time changes its key, which is
// treated as delete-old + create-new (acceptable, rare, and self-healing).
//
// Every trip save calls syncTripCalendarEvents(tripId) — best effort, never
// throws past this module, so a Google Calendar hiccup never blocks a trip
// save.
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, travelsTripCalendarEvents } from "@workspace/db";
import {
  getHouseholdCalendarConnection,
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
type ItineraryDay = { date?: string; title?: string; activities?: ItineraryActivity[] };
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

function buildDesiredItems(
  trip: TripForCalendarSync,
  travelColorId: string | null,
): DesiredItem[] {
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
        colorId: travelColorId,
      },
    });
  }

  const itinerary = trip.itinerary as Itinerary | null;
  for (const day of itinerary?.days ?? []) {
    if (!day?.date) continue;
    for (const activity of day.activities ?? []) {
      if (!activity?.name) continue;
      const itemKey = `activity:${day.date}:${shortHash(`${activity.name}|${activity.time ?? ""}`)}`;
      const descParts = [activity.description, activity.proximity, activity.tip].filter(
        (s): s is string => Boolean(s && s.trim()),
      );
      const timed = activity.time ? activityDateTime(day.date, activity.time) : null;
      const allDay = !timed;
      const start = timed ?? day.date;
      const end = timed ? addHourIso(timed) : day.date;
      items.push({
        itemKey,
        input: {
          title: activity.name,
          description: descParts.length > 0 ? descParts.join("\n\n") : undefined,
          allDay,
          start,
          end,
          colorId: travelColorId,
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
export async function syncTripCalendarEvents(trip: TripForCalendarSync): Promise<void> {
  try {
    const connection = await getHouseholdCalendarConnection();
    if (!connection?.calendarId) return;
    const accessToken = await getValidAccessToken(connection.userId);
    if (!accessToken) return;

    const desired = buildDesiredItems(trip, connection.travelColorId);
    const desiredByKey = new Map(desired.map((d) => [d.itemKey, d]));

    const existing = await db
      .select()
      .from(travelsTripCalendarEvents)
      .where(eq(travelsTripCalendarEvents.tripId, trip.id));
    const existingByKey = new Map(existing.map((e) => [e.itemKey, e]));

    // Delete mapping rows (and their Google events) for items no longer present.
    for (const row of existing) {
      if (!desiredByKey.has(row.itemKey)) {
        await deleteCalendarEvent(accessToken, connection.calendarId, row.googleEventId).catch(
          (err: unknown) =>
            logger.warn({ err, tripId: trip.id, itemKey: row.itemKey }, "trip-calendar-sync: delete failed"),
        );
        await db.delete(travelsTripCalendarEvents).where(eq(travelsTripCalendarEvents.id, row.id));
      }
    }

    // Create or update the rest.
    for (const item of desired) {
      const hash = contentHash(item.input);
      const existingRow = existingByKey.get(item.itemKey);
      if (!existingRow) {
        const event = await createCalendarEvent(accessToken, connection.calendarId, item.input);
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
          connection.calendarId,
          existingRow.googleEventId,
          item.input,
        );
        await db
          .update(travelsTripCalendarEvents)
          .set({ contentHash: hash, updatedAt: new Date() })
          .where(eq(travelsTripCalendarEvents.id, existingRow.id));
      }
    }
  } catch (err) {
    logger.warn({ err, tripId: trip.id }, "trip-calendar-sync: reconciliation failed");
  }
}

/**
 * Remove all Google Calendar events synced for a trip (called on trip
 * delete). Best effort — never throws.
 */
export async function deleteTripCalendarEvents(tripId: number): Promise<void> {
  try {
    const connection = await getHouseholdCalendarConnection();
    const rows = await db
      .select()
      .from(travelsTripCalendarEvents)
      .where(eq(travelsTripCalendarEvents.tripId, tripId));
    if (rows.length === 0) return;

    const accessToken = connection?.calendarId
      ? await getValidAccessToken(connection.userId)
      : null;

    if (accessToken && connection?.calendarId) {
      for (const row of rows) {
        await deleteCalendarEvent(accessToken, connection.calendarId, row.googleEventId).catch(
          (err: unknown) =>
            logger.warn({ err, tripId, itemKey: row.itemKey }, "trip-calendar-sync: delete-on-cleanup failed"),
        );
      }
    }
    await db.delete(travelsTripCalendarEvents).where(eq(travelsTripCalendarEvents.tripId, tripId));
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
