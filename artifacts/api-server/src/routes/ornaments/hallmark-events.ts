// GCal-direct CRUD for household-shared Hallmark collector events.
// Google Calendar (the designated Hallmark calendar) is the sole source of
// truth — the ornaments_hallmark_events DB table has been removed.
// Any authenticated user may create/edit/delete; the backend proxies the
// write through the calendar-owner's access token via
// getHallmarkCalendarConnection(), consistent with the household-shared model.
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  getHallmarkCalendarConnection,
  getValidAccessToken,
} from "../../lib/google-calendar-tokens";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listAllCalendarEvents,
} from "../../lib/google-calendar";
import { requireAuth } from "../../middleware/auth";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

// Event titles matching any of these patterns are permanently blocked from
// being created or updated in the Hallmark calendar — they are never useful
// and have historically been imported by accident from scan data.
const BLOCKED_TITLE_PATTERNS = [/artist\s+signing/i];

function isBlockedTitle(title: string): boolean {
  return BLOCKED_TITLE_PATTERNS.some((re) => re.test(title));
}

const EventBody = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

// GCal all-day events use an exclusive end date (next day after the actual
// last day). Our form/UI uses inclusive end dates, so we add 1 day here.
function toExclusiveEnd(endDate: string): string {
  const d = new Date(`${endDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function resolveConn(res: {
  status: (n: number) => { json: (body: unknown) => void };
}): Promise<{ calendarId: string; accessToken: string } | null> {
  const calendar = await getHallmarkCalendarConnection();
  if (!calendar) {
    res.status(409).json({ error: "No Hallmark calendar is configured." });
    return null;
  }
  const accessToken = await getValidAccessToken(calendar.userId);
  if (!accessToken) {
    res.status(502).json({ error: "Could not connect to Google Calendar." });
    return null;
  }
  return { calendarId: calendar.googleCalendarId, accessToken };
}

// ── One-time admin cleanup ────────────────────────────────────────────────────
// POST /api/ornaments/hallmark-events/admin/cleanup
// Deletes every "Artist Signing" event and every duplicate (same title + start
// date) from the Hallmark calendar. Safe to call multiple times — idempotent.
router.post("/hallmark-events/admin/cleanup", async (req, res) => {
  const conn = await resolveConn(res);
  if (!conn) return;

  try {
    const events = await listAllCalendarEvents(
      conn.accessToken,
      conn.calendarId,
    );
    logger.info(
      { total: events.length },
      "hallmark-cleanup: fetched all events",
    );

    const toDelete: string[] = [];

    // Pass 1 — collect blocked-title events
    for (const e of events) {
      if (isBlockedTitle(e.title)) {
        toDelete.push(e.id);
      }
    }

    // Pass 2 — collect duplicates among the remaining events.
    // Key = normalised title + start date (YYYY-MM-DD).
    // First occurrence wins; all later occurrences are duplicates.
    const seen = new Set<string>();
    const deletedIds = new Set(toDelete);
    for (const e of events) {
      if (deletedIds.has(e.id)) continue;
      const key = `${e.title.toLowerCase().trim()}|${e.start.slice(0, 10)}`;
      if (seen.has(key)) {
        toDelete.push(e.id);
        deletedIds.add(e.id);
      } else {
        seen.add(key);
      }
    }

    // Delete in sequence to avoid rate-limit bursts
    let deleted = 0;
    const errors: string[] = [];
    for (const id of toDelete) {
      try {
        await deleteCalendarEvent(conn.accessToken, conn.calendarId, id);
        deleted++;
      } catch (err) {
        errors.push(id);
        logger.warn({ err, id }, "hallmark-cleanup: failed to delete event");
      }
    }

    const result = {
      scanned: events.length,
      deletedTotal: deleted,
      blockedTitleDeleted: toDelete
        .slice(0, toDelete.length - (toDelete.length - deleted))
        .filter((id) =>
          events.find((e) => e.id === id && isBlockedTitle(e.title)),
        ).length,
      duplicatesDeleted:
        deleted -
        events.filter((e) => toDelete.includes(e.id) && isBlockedTitle(e.title))
          .length,
      remaining: events.length - deleted,
      errors,
    };
    logger.info(result, "hallmark-cleanup: complete");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "hallmark-cleanup: failed");
    res.status(502).json({ error: "Cleanup failed." });
  }
});

router.post("/hallmark-events", async (req, res) => {
  const body = EventBody.parse(req.body);
  if (isBlockedTitle(body.title)) {
    res
      .status(422)
      .json({ error: "Event type not allowed in the Hallmark calendar." });
    return;
  }
  const conn = await resolveConn(res);
  if (!conn) return;
  try {
    const event = await createCalendarEvent(conn.accessToken, conn.calendarId, {
      title: body.title,
      description: body.description ?? null,
      location: null,
      allDay: true,
      start: body.startDate,
      end: toExclusiveEnd(body.endDate),
      colorId: null,
    });
    res.status(201).json(event);
  } catch (err) {
    logger.error({ err }, "hallmark-events: create GCal event failed");
    res
      .status(502)
      .json({ error: "Failed to create event in Google Calendar." });
  }
});

router.patch("/hallmark-events/:eventId", async (req, res) => {
  const eventId = req.params["eventId"] as string;
  const body = EventBody.parse(req.body);
  if (isBlockedTitle(body.title)) {
    res
      .status(422)
      .json({ error: "Event type not allowed in the Hallmark calendar." });
    return;
  }
  const conn = await resolveConn(res);
  if (!conn) return;
  try {
    const event = await updateCalendarEvent(
      conn.accessToken,
      conn.calendarId,
      eventId,
      {
        title: body.title,
        description: body.description ?? null,
        location: null,
        allDay: true,
        start: body.startDate,
        end: toExclusiveEnd(body.endDate),
        colorId: null,
      },
    );
    res.json(event);
  } catch (err) {
    logger.error({ err, eventId }, "hallmark-events: update GCal event failed");
    res
      .status(502)
      .json({ error: "Failed to update event in Google Calendar." });
  }
});

router.delete("/hallmark-events/:eventId", async (req, res) => {
  const eventId = req.params["eventId"] as string;
  const conn = await resolveConn(res);
  if (!conn) return;
  try {
    await deleteCalendarEvent(conn.accessToken, conn.calendarId, eventId);
    res.status(204).send();
  } catch (err) {
    logger.error({ err, eventId }, "hallmark-events: delete GCal event failed");
    res
      .status(502)
      .json({ error: "Failed to delete event from Google Calendar." });
  }
});

export default router;
