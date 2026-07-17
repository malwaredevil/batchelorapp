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
} from "../../lib/google-calendar";
import { requireAuth } from "../../middleware/auth";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

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

router.post("/hallmark-events", async (req, res) => {
  const body = EventBody.parse(req.body);
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
