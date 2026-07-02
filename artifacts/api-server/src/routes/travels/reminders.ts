import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsTrips,
  travelsReminders,
  travelsCalendarSettings,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createReminderEvent,
  updateReminderEvent,
  deleteReminderEvent,
} from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const CreateReminderBody = z.object({
  title: z.string().min(1),
  dueDate: z.string().optional(),
  recipientEmails: z.array(z.email()).optional(),
  syncToCalendar: z.boolean().optional(),
});

const UpdateReminderBody = z.object({
  title: z.string().min(1).optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  recipientEmails: z.array(z.email()).optional(),
  syncToCalendar: z.boolean().optional(),
});

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

async function getFamilyCalendarId(): Promise<string | null> {
  const [row] = await db
    .select({ calendarId: travelsCalendarSettings.calendarId })
    .from(travelsCalendarSettings)
    .limit(1);
  return row?.calendarId ?? null;
}

// Best-effort sync — reminders remain the source of truth even if the Google
// Calendar API call fails (missing connection, expired token, etc).
async function syncCreateEvent(
  reminderId: number,
  tripTitle: string,
  title: string,
  dueDate: string | null,
): Promise<void> {
  if (!dueDate) return;
  const calendarId = await getFamilyCalendarId();
  if (!calendarId) return;

  try {
    const event = await createReminderEvent({
      calendarId,
      title,
      dueDate,
      description: `Trip reminder: ${tripTitle}`,
    });
    await db
      .update(travelsReminders)
      .set({ googleEventId: event.id })
      .where(eq(travelsReminders.id, reminderId));
  } catch (err) {
    logger.warn({ err, reminderId }, "reminders: calendar sync (create) failed");
  }
}

async function syncUpdateEvent(
  reminderId: number,
  googleEventId: string,
  tripTitle: string,
  title: string,
  dueDate: string | null,
): Promise<void> {
  const calendarId = await getFamilyCalendarId();
  if (!calendarId) return;

  try {
    if (!dueDate) {
      await deleteReminderEvent(calendarId, googleEventId);
      await db
        .update(travelsReminders)
        .set({ googleEventId: null })
        .where(eq(travelsReminders.id, reminderId));
      return;
    }
    await updateReminderEvent(calendarId, googleEventId, {
      title,
      dueDate,
      description: `Trip reminder: ${tripTitle}`,
    });
  } catch (err) {
    logger.warn({ err, reminderId }, "reminders: calendar sync (update) failed");
  }
}

// GET /reminders — all pending (or all) reminders across all trips (for Dashboard)
router.get("/reminders", async (req, res) => {
  const pending = req.query.pending === "true";

  const rows = await db
    .select()
    .from(travelsReminders)
    .where(pending ? eq(travelsReminders.done, false) : undefined)
    .orderBy(asc(travelsReminders.dueDate), asc(travelsReminders.createdAt));

  res.json(rows);
});

// GET /trips/:id/reminders
router.get("/trips/:id/reminders", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await tripExists(tripId))) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db
    .select()
    .from(travelsReminders)
    .where(eq(travelsReminders.tripId, tripId))
    .orderBy(asc(travelsReminders.dueDate), asc(travelsReminders.createdAt));

  res.json(rows);
});

// POST /trips/:id/reminders
router.post("/trips/:id/reminders", async (req, res) => {
  const userId = req.session.userId!;
  const tripId = parseInt(req.params.id, 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [trip] = await db
    .select({ id: travelsTrips.id, title: travelsTrips.title })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (!trip) { res.status(404).json({ error: "Not found" }); return; }

  const body = CreateReminderBody.parse(req.body);
  const syncToCalendar = body.syncToCalendar ?? true;
  const [row] = await db
    .insert(travelsReminders)
    .values({
      tripId,
      userId,
      title: body.title,
      dueDate: body.dueDate ?? null,
      done: false,
      recipientEmails: body.recipientEmails ?? [],
      syncToCalendar,
    })
    .returning();

  if (syncToCalendar) {
    await syncCreateEvent(row.id, trip.title, row.title, row.dueDate);
  }

  res.status(201).json(row);
});

// PATCH /trips/:id/reminders/:reminderId
router.patch("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = UpdateReminderBody.parse(req.body);
  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate;
  if (body.done !== undefined) updateData.done = body.done;
  if (body.recipientEmails !== undefined) updateData.recipientEmails = body.recipientEmails;
  if (body.syncToCalendar !== undefined) updateData.syncToCalendar = body.syncToCalendar;

  const [updated] = await db
    .update(travelsReminders)
    .set(updateData)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    )
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (
    body.title !== undefined ||
    body.dueDate !== undefined ||
    body.syncToCalendar !== undefined
  ) {
    const [trip] = await db
      .select({ title: travelsTrips.title })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, tripId));
    const tripTitle = trip?.title ?? "Trip";

    if (updated.syncToCalendar && updated.googleEventId) {
      await syncUpdateEvent(
        updated.id,
        updated.googleEventId,
        tripTitle,
        updated.title,
        updated.dueDate,
      );
    } else if (updated.syncToCalendar && !updated.googleEventId) {
      await syncCreateEvent(updated.id, tripTitle, updated.title, updated.dueDate);
    } else if (!updated.syncToCalendar && updated.googleEventId) {
      const calendarId = await getFamilyCalendarId();
      if (calendarId) {
        await deleteReminderEvent(calendarId, updated.googleEventId);
      }
      await db
        .update(travelsReminders)
        .set({ googleEventId: null })
        .where(eq(travelsReminders.id, updated.id));
    }
  }

  res.json(updated);
});

// DELETE /trips/:id/reminders/:reminderId
router.delete("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select({ id: travelsReminders.id, googleEventId: travelsReminders.googleEventId })
    .from(travelsReminders)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    );

  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (existing.googleEventId) {
    const calendarId = await getFamilyCalendarId();
    if (calendarId) {
      await deleteReminderEvent(calendarId, existing.googleEventId);
    }
  }

  await db
    .delete(travelsReminders)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    );
  res.status(204).send();
});

export default router;
