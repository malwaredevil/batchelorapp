// Shared "Family Calendar" — every app_user (whether or not they have their
// own Google account) can view/add/edit/delete events here. Requests are
// always proxied through whichever connection is marked `isHouseholdShared`,
// using that connection owner's Google token, regardless of who is asking.
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../../middleware/auth";
import {
  getHouseholdCalendarConnection,
  getValidAccessToken,
} from "../../lib/google-calendar-tokens";
import {
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// GET /family-calendar/status — is a shared household calendar configured
router.get("/family-calendar/status", requireAuth, async (req, res) => {
  const connection = await getHouseholdCalendarConnection();
  res.json({
    configured: Boolean(connection?.calendarId),
    calendarSummary: connection?.calendarSummary ?? null,
    ownerGoogleEmail: connection?.googleEmail ?? null,
    isOwner: connection?.userId === req.session.userId,
  });
});

const EventsQuery = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

// GET /family-calendar/events?start=ISO&end=ISO
router.get("/family-calendar/events", requireAuth, async (req, res) => {
  const connection = await getHouseholdCalendarConnection();
  if (!connection?.calendarId) {
    res.status(409).json({ error: "No shared family calendar configured." });
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
      connection.calendarId,
      parsed.data.start,
      parsed.data.end,
    );
    res.json(events);
  } catch (err) {
    logger.error({ err }, "family-calendar: failed to list events");
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
});

// POST /family-calendar/events
router.post("/family-calendar/events", requireAuth, async (req, res) => {
  const connection = await getHouseholdCalendarConnection();
  if (!connection?.calendarId) {
    res.status(409).json({ error: "No shared family calendar configured." });
    return;
  }
  const body = EventBody.parse(req.body);
  const accessToken = await getValidAccessToken(connection.userId);
  if (!accessToken) {
    res.status(502).json({ error: "Could not connect to Google Calendar." });
    return;
  }
  try {
    const event = await createCalendarEvent(accessToken, connection.calendarId, body);
    res.status(201).json(event);
  } catch (err) {
    logger.error({ err }, "family-calendar: failed to create event");
    res.status(502).json({ error: "Could not reach Google Calendar." });
  }
});

// PATCH /family-calendar/events/:eventId
router.patch("/family-calendar/events/:eventId", requireAuth, async (req, res) => {
  const connection = await getHouseholdCalendarConnection();
  if (!connection?.calendarId) {
    res.status(409).json({ error: "No shared family calendar configured." });
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
      connection.calendarId,
      eventId,
      body,
    );
    res.json(event);
  } catch (err) {
    logger.error({ err }, "family-calendar: failed to update event");
    res.status(502).json({ error: "Could not reach Google Calendar." });
  }
});

// DELETE /family-calendar/events/:eventId
router.delete("/family-calendar/events/:eventId", requireAuth, async (req, res) => {
  const connection = await getHouseholdCalendarConnection();
  if (!connection?.calendarId) {
    res.status(409).json({ error: "No shared family calendar configured." });
    return;
  }
  const eventId = String(req.params["eventId"]);
  const accessToken = await getValidAccessToken(connection.userId);
  if (!accessToken) {
    res.status(502).json({ error: "Could not connect to Google Calendar." });
    return;
  }
  try {
    await deleteCalendarEvent(accessToken, connection.calendarId, eventId);
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "family-calendar: failed to delete event");
    res.status(502).json({ error: "Could not reach Google Calendar." });
  }
});

export default router;
