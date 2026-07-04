// Shared "Travel Calendar" — every app_user (whether or not they have their
// own Google account) can view/add/edit/delete events here. Requests are
// always proxied through whichever connected calendar is marked
// isTravelCalendar, using that connection owner's Google token, regardless
// of who is asking.
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, appUsers } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  getTravelCalendarConnection,
  getValidAccessToken,
} from "../../lib/google-calendar-tokens";
import {
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../../lib/google-calendar";
import { applyCalendarEventEditToTrip } from "../../lib/trip-calendar-sync";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// GET /travel-calendar/status — is the shared Travel calendar configured.
// isOwner reflects app_users.is_owner (the app owner who may assign/reassign
// the Travel calendar), NOT whether the caller happens to own the
// currently-assigned connection — otherwise the true owner could get locked
// out of reassignment once someone else's calendar is marked as Travel.
router.get("/travel-calendar/status", requireAuth, async (req, res) => {
  const connection = await getTravelCalendarConnection();
  const [me] = await db
    .select({ isOwner: appUsers.isOwner })
    .from(appUsers)
    .where(eq(appUsers.id, req.session.userId!))
    .limit(1);
  res.json({
    configured: Boolean(connection),
    calendarSummary: connection?.summary ?? null,
    ownerGoogleEmail: connection?.googleEmail ?? null,
    isOwner: me?.isOwner ?? false,
    primaryColor: connection?.primaryColor ?? null,
  });
});

const EventsQuery = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

// GET /travel-calendar/events?start=ISO&end=ISO
router.get("/travel-calendar/events", requireAuth, async (req, res) => {
  const connection = await getTravelCalendarConnection();
  if (!connection) {
    res.status(409).json({ error: "No shared Travel calendar configured." });
    return;
  }
  const parsed = EventsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "start and end query params are required." });
    return;
  }
  const accessToken = await getValidAccessToken(connection.userId);
  if (!accessToken) {
    res.status(502).json({ error: "Could not connect to Google Calendar." });
    return;
  }
  try {
    const events = await listCalendarEvents(
      accessToken,
      connection.googleCalendarId,
      parsed.data.start,
      parsed.data.end,
    );
    res.json(events);
  } catch (err) {
    logger.error({ err }, "travel-calendar: failed to list events");
    res.status(502).json({ error: "Could not reach Google Calendar." });
  }
});

const EventBody = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  location: z.string().nullish(),
  allDay: z.boolean(),
  start: z.string().min(1),
  end: z.string().min(1),
  colorId: z.string().nullish(),
});

// POST /travel-calendar/events
router.post("/travel-calendar/events", requireAuth, async (req, res) => {
  const connection = await getTravelCalendarConnection();
  if (!connection) {
    res.status(409).json({ error: "No shared Travel calendar configured." });
    return;
  }
  const body = EventBody.parse(req.body);
  const accessToken = await getValidAccessToken(connection.userId);
  if (!accessToken) {
    res.status(502).json({ error: "Could not connect to Google Calendar." });
    return;
  }
  try {
    const event = await createCalendarEvent(
      accessToken,
      connection.googleCalendarId,
      body,
    );
    res.status(201).json(event);
  } catch (err) {
    logger.error({ err }, "travel-calendar: failed to create event");
    res.status(502).json({ error: "Could not reach Google Calendar." });
  }
});

// PATCH /travel-calendar/events/:eventId
router.patch(
  "/travel-calendar/events/:eventId",
  requireAuth,
  async (req, res) => {
    const connection = await getTravelCalendarConnection();
    if (!connection) {
      res.status(409).json({ error: "No shared Travel calendar configured." });
      return;
    }
    const eventId = String(req.params["eventId"]);
    const body = EventBody.parse(req.body);
    const accessToken = await getValidAccessToken(connection.userId);
    if (!accessToken) {
      res.status(502).json({ error: "Could not connect to Google Calendar." });
      return;
    }
    try {
      const event = await updateCalendarEvent(
        accessToken,
        connection.googleCalendarId,
        eventId,
        body,
      );
      res.json(event);
      void applyCalendarEventEditToTrip(eventId, body);
    } catch (err) {
      logger.error({ err }, "travel-calendar: failed to update event");
      res.status(502).json({ error: "Could not reach Google Calendar." });
    }
  },
);

// DELETE /travel-calendar/events/:eventId
router.delete(
  "/travel-calendar/events/:eventId",
  requireAuth,
  async (req, res) => {
    const connection = await getTravelCalendarConnection();
    if (!connection) {
      res.status(409).json({ error: "No shared Travel calendar configured." });
      return;
    }
    const eventId = String(req.params["eventId"]);
    const accessToken = await getValidAccessToken(connection.userId);
    if (!accessToken) {
      res.status(502).json({ error: "Could not connect to Google Calendar." });
      return;
    }
    try {
      await deleteCalendarEvent(
        accessToken,
        connection.googleCalendarId,
        eventId,
      );
      res.status(204).send();
    } catch (err) {
      logger.error({ err }, "travel-calendar: failed to delete event");
      res.status(502).json({ error: "Could not reach Google Calendar." });
    }
  },
);

export default router;
