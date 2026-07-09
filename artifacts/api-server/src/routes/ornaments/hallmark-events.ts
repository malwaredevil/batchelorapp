// CRUD for household-shared major Hallmark collector events
// (ornaments_hallmark_events). Any authenticated user may create/edit/
// delete, per the household-shared model used elsewhere in Ornaments.
// Writes are best-effort mirrored to the shared "Hallmark" Google Calendar
// (travels_connected_calendars, is_hallmark_calendar = true) when one has
// been designated — mirroring is never required for the local CRUD to
// succeed, since the calendar is a convenience mirror, not the source of
// truth.
import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, ornamentsHallmarkEvents } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  getHallmarkCalendarConnection,
  getValidAccessToken,
} from "../../lib/google-calendar-tokens";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

async function syncToGoogle(
  action: "create" | "update" | "delete",
  event: { title: string; description: string | null; startDate: string; endDate: string; googleEventId: string | null },
): Promise<string | null> {
  const calendar = await getHallmarkCalendarConnection();
  if (!calendar) return event.googleEventId;

  const accessToken = await getValidAccessToken(calendar.userId);
  if (!accessToken) return event.googleEventId;

  try {
    if (action === "delete") {
      if (event.googleEventId) {
        await deleteCalendarEvent(
          accessToken,
          calendar.googleCalendarId,
          event.googleEventId,
        );
      }
      return null;
    }

    const input = {
      title: event.title,
      description: event.description,
      location: null,
      allDay: true,
      start: event.startDate,
      end: event.endDate,
      colorId: null,
    };

    if (action === "update" && event.googleEventId) {
      const updated = await updateCalendarEvent(
        accessToken,
        calendar.googleCalendarId,
        event.googleEventId,
        input,
      );
      return updated.id;
    }

    const created = await createCalendarEvent(
      accessToken,
      calendar.googleCalendarId,
      input,
    );
    return created.id;
  } catch (err) {
    logger.error(
      { err, action },
      "hallmark-events: best-effort Google Calendar sync failed",
    );
    return event.googleEventId;
  }
}

router.get("/hallmark-events", async (_req, res) => {
  const rows = await db
    .select()
    .from(ornamentsHallmarkEvents)
    .orderBy(asc(ornamentsHallmarkEvents.startDate));
  res.json(rows);
});

const EventBody = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

router.post("/hallmark-events", async (req, res) => {
  const userId = req.session.userId!;
  const body = EventBody.parse(req.body);

  const [row] = await db
    .insert(ornamentsHallmarkEvents)
    .values({
      userId,
      title: body.title,
      description: body.description ?? null,
      startDate: body.startDate,
      endDate: body.endDate,
    })
    .returning();

  const googleEventId = await syncToGoogle("create", {
    title: row.title,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    googleEventId: null,
  });

  if (googleEventId) {
    const [updated] = await db
      .update(ornamentsHallmarkEvents)
      .set({ googleEventId })
      .where(eq(ornamentsHallmarkEvents.id, row.id))
      .returning();
    res.status(201).json(updated);
    return;
  }
  res.status(201).json(row);
});

const PatchBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
});

router.patch("/hallmark-events/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  const body = PatchBody.parse(req.body);

  const [existing] = await db
    .select()
    .from(ornamentsHallmarkEvents)
    .where(eq(ornamentsHallmarkEvents.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Event not found." });
    return;
  }

  const [row] = await db
    .update(ornamentsHallmarkEvents)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(ornamentsHallmarkEvents.id, id))
    .returning();

  const googleEventId = await syncToGoogle("update", {
    title: row.title,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    googleEventId: row.googleEventId,
  });

  if (googleEventId !== row.googleEventId) {
    const [updated] = await db
      .update(ornamentsHallmarkEvents)
      .set({ googleEventId })
      .where(eq(ornamentsHallmarkEvents.id, id))
      .returning();
    res.json(updated);
    return;
  }
  res.json(row);
});

router.delete("/hallmark-events/:id", async (req, res) => {
  const id = Number(req.params["id"]);

  const [row] = await db
    .delete(ornamentsHallmarkEvents)
    .where(eq(ornamentsHallmarkEvents.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Event not found." });
    return;
  }

  await syncToGoogle("delete", {
    title: row.title,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    googleEventId: row.googleEventId,
  });

  res.status(204).send();
});

export default router;
