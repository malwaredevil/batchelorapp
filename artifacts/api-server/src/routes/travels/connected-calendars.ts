// CRUD for a user's connected Google calendars (travels_connected_calendars).
// Each app_user can connect an unlimited number of their own Google
// calendars, each with a user-chosen primary color for the Outlook-style
// overlay UI. Exactly one row across the whole table may be the shared
// "Travel" calendar (isTravelCalendar) — only the app owner (app_users.is_owner)
// may assign/reassign that flag.
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, appUsers, travelsConnectedCalendars } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { getValidAccessToken } from "../../lib/google-calendar-tokens";
import {
  listCalendarEvents,
  createCalendarEvent,
} from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

async function isOwnerUser(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ isOwner: appUsers.isOwner })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return row?.isOwner ?? false;
}

// GET /connected-calendars — the current user's own connected calendars
router.get("/connected-calendars", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(travelsConnectedCalendars)
    .where(eq(travelsConnectedCalendars.userId, userId))
    .orderBy(travelsConnectedCalendars.id);
  res.json(rows);
});

const CreateBody = z.object({
  googleCalendarId: z.string().min(1),
  summary: z.string().min(1),
  source: z.enum(["picked", "manual"]).default("picked"),
  primaryColor: z.string().min(1).default("#4285f4"),
});

// POST /connected-calendars — connect one of the current user's Google
// calendars (picked from their list, or entered manually) for the overlay UI.
router.post("/connected-calendars", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateBody.parse(req.body);

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    res.status(409).json({ error: "Connect Google Calendar first." });
    return;
  }

  try {
    const [row] = await db
      .insert(travelsConnectedCalendars)
      .values({
        userId,
        googleCalendarId: body.googleCalendarId,
        summary: body.summary,
        source: body.source,
        primaryColor: body.primaryColor,
      })
      .onConflictDoUpdate({
        target: [
          travelsConnectedCalendars.userId,
          travelsConnectedCalendars.googleCalendarId,
        ],
        set: { summary: body.summary, updatedAt: new Date() },
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error(
      { err, userId },
      "connected-calendars: failed to add calendar",
    );
    res.status(500).json({ error: "Could not connect calendar." });
  }
});

const PatchBody = z.object({
  primaryColor: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
});

// PATCH /connected-calendars/:id — update this calendar's overlay color/name.
// Only the owning user may edit their own connected-calendar row.
router.patch("/connected-calendars/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params["id"]);
  const body = PatchBody.parse(req.body);

  const [updated] = await db
    .update(travelsConnectedCalendars)
    .set({ ...body, updatedAt: new Date() })
    .where(
      and(
        eq(travelsConnectedCalendars.id, id),
        eq(travelsConnectedCalendars.userId, userId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Connected calendar not found." });
    return;
  }
  res.json(updated);
});

// DELETE /connected-calendars/:id — disconnect this calendar from the overlay
// UI. Only the owning user may remove their own connected-calendar row; the
// shared Travel calendar cannot be removed this way (unassign it first).
router.delete("/connected-calendars/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params["id"]);

  const [row] = await db
    .select()
    .from(travelsConnectedCalendars)
    .where(
      and(
        eq(travelsConnectedCalendars.id, id),
        eq(travelsConnectedCalendars.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Connected calendar not found." });
    return;
  }
  if (row.isTravelCalendar) {
    res.status(409).json({
      error:
        "This calendar is the shared Travel calendar. Reassign it before disconnecting.",
    });
    return;
  }

  await db
    .delete(travelsConnectedCalendars)
    .where(eq(travelsConnectedCalendars.id, id));
  res.status(204).send();
});

// PUT /connected-calendars/:id/travel — assign this calendar as the shared
// "Travel" calendar (unassigning whichever one previously held the flag).
// Owner-only (app_users.is_owner), since this affects every user's app.
router.put("/connected-calendars/:id/travel", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params["id"]);

  if (!(await isOwnerUser(userId))) {
    res
      .status(403)
      .json({ error: "Only the app owner can assign the Travel calendar." });
    return;
  }

  const [target] = await db
    .select()
    .from(travelsConnectedCalendars)
    .where(eq(travelsConnectedCalendars.id, id))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Connected calendar not found." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(travelsConnectedCalendars)
      .set({ isTravelCalendar: false, updatedAt: new Date() })
      .where(eq(travelsConnectedCalendars.isTravelCalendar, true));
    await tx
      .update(travelsConnectedCalendars)
      .set({ isTravelCalendar: true, updatedAt: new Date() })
      .where(eq(travelsConnectedCalendars.id, id));
  });

  res.json({ id, isTravelCalendar: true });
});

// PUT /connected-calendars/:id/hallmark — assign this calendar as the shared
// "Hallmark" calendar used by the Ornaments app's event countdown/calendar
// feature (unassigning whichever one previously held the flag). Mirrors
// /travel above; owner-only since it affects every user's app.
router.put(
  "/connected-calendars/:id/hallmark",
  requireAuth,
  async (req, res) => {
    const userId = req.session.userId!;
    const id = Number(req.params["id"]);

    if (!(await isOwnerUser(userId))) {
      res.status(403).json({
        error: "Only the app owner can assign the Hallmark calendar.",
      });
      return;
    }

    const [target] = await db
      .select()
      .from(travelsConnectedCalendars)
      .where(eq(travelsConnectedCalendars.id, id))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Connected calendar not found." });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(travelsConnectedCalendars)
        .set({ isHallmarkCalendar: false, updatedAt: new Date() })
        .where(eq(travelsConnectedCalendars.isHallmarkCalendar, true));
      await tx
        .update(travelsConnectedCalendars)
        .set({ isHallmarkCalendar: true, updatedAt: new Date() })
        .where(eq(travelsConnectedCalendars.id, id));
    });

    res.json({ id, isHallmarkCalendar: true });
  },
);

const EventsQuery = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

// GET /connected-calendars/:id/events?start=ISO&end=ISO — events on one of
// the current user's own connected calendars, for the overlay UI. (The
// shared Travel calendar's events are served separately by
// /travel-calendar/events, which every app_user — not just its owner — may
// read/write.)
router.get("/connected-calendars/:id/events", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params["id"]);
  const parsed = EventsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "start and end query params are required." });
    return;
  }

  const [row] = await db
    .select()
    .from(travelsConnectedCalendars)
    .where(
      and(
        eq(travelsConnectedCalendars.id, id),
        eq(travelsConnectedCalendars.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Connected calendar not found." });
    return;
  }

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    res.status(502).json({ error: "Could not connect to Google Calendar." });
    return;
  }

  try {
    const events = await listCalendarEvents(
      accessToken,
      row.googleCalendarId,
      parsed.data.start,
      parsed.data.end,
    );
    res.json(events);
  } catch (err) {
    logger.error(
      { err, calendarId: row.googleCalendarId },
      "connected-calendars: failed to list events",
    );
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

// POST /connected-calendars/:id/events — create an event directly on one of
// the current user's own connected Google calendars. Ownership-scoped the
// same way as the GET .../events route above; never accepts another user's
// connected-calendar id.
router.post(
  "/connected-calendars/:id/events",
  requireAuth,
  async (req, res) => {
    const userId = req.session.userId!;
    const id = Number(req.params["id"]);
    const body = EventBody.parse(req.body);

    const [row] = await db
      .select()
      .from(travelsConnectedCalendars)
      .where(
        and(
          eq(travelsConnectedCalendars.id, id),
          eq(travelsConnectedCalendars.userId, userId),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Connected calendar not found." });
      return;
    }

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      res.status(502).json({ error: "Could not connect to Google Calendar." });
      return;
    }

    try {
      const event = await createCalendarEvent(
        accessToken,
        row.googleCalendarId,
        body,
      );
      res.status(201).json(event);
    } catch (err) {
      logger.error(
        { err, calendarId: row.googleCalendarId },
        "connected-calendars: failed to create event",
      );
      res.status(502).json({ error: "Could not reach Google Calendar." });
    }
  },
);

export default router;
