import { Router, type IRouter } from "express";
import { and, eq, inArray, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsTrips,
  travelsReminders,
  travelsReminderCalendarEvents,
  travelsGoogleCalendarConnections,
  appUsers,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createReminderEvent,
  updateReminderEvent,
  deleteReminderEvent,
} from "../../lib/google-calendar";
import { getValidAccessToken } from "../../lib/google-calendar-tokens";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const CreateReminderBody = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: z.string().optional(),
  recipientEmails: z.array(z.email()).optional(),
  syncToCalendar: z.boolean().optional(),
});

const UpdateReminderBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
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

// Every family member who has connected their own Google Calendar and
// selected a target calendar gets their own copy of the event: the reminder's
// creator, plus anyone listed in recipientEmails who has an app account.
export async function getConnectedTargetUserIds(
  creatorUserId: number,
  recipientEmails: string[],
): Promise<number[]> {
  const candidateUserIds = new Set<number>([creatorUserId]);
  if (recipientEmails.length > 0) {
    const recipients = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(inArray(appUsers.email, recipientEmails));
    for (const r of recipients) candidateUserIds.add(r.id);
  }

  const connections = await db
    .select({
      userId: travelsGoogleCalendarConnections.userId,
      calendarId: travelsGoogleCalendarConnections.calendarId,
    })
    .from(travelsGoogleCalendarConnections)
    .where(inArray(travelsGoogleCalendarConnections.userId, [...candidateUserIds]));

  return connections.filter((c) => c.calendarId).map((c) => c.userId);
}

// Best-effort sync — reminders remain the source of truth even if a
// recipient's Google Calendar API call fails (revoked token, expired, etc).
// Reconciles the desired target user set against travels_reminder_calendar_events:
// creates events for newly-added targets, updates events for existing ones,
// and removes events for targets that dropped off (recipient removed, sync
// turned off, or the reminder was marked done-with-no-due-date... etc).
export async function syncReminderCalendarEvents(
  reminderId: number,
  tripTitle: string,
  title: string,
  dueDate: string | null,
  targetUserIds: number[],
): Promise<void> {
  const existing = await db
    .select()
    .from(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));
  const existingByUser = new Map(existing.map((e) => [e.userId, e]));
  const targetSet = new Set(dueDate ? targetUserIds : []);

  for (const row of existing) {
    if (!targetSet.has(row.userId)) {
      const accessToken = await getValidAccessToken(row.userId);
      const [connection] = await db
        .select({ calendarId: travelsGoogleCalendarConnections.calendarId })
        .from(travelsGoogleCalendarConnections)
        .where(eq(travelsGoogleCalendarConnections.userId, row.userId));
      if (accessToken && connection?.calendarId) {
        await deleteReminderEvent(
          accessToken,
          connection.calendarId,
          row.googleEventId,
        );
      }
      await db
        .delete(travelsReminderCalendarEvents)
        .where(eq(travelsReminderCalendarEvents.id, row.id));
    }
  }

  if (!dueDate) return;

  for (const userId of targetUserIds) {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) continue;
    const [connection] = await db
      .select({ calendarId: travelsGoogleCalendarConnections.calendarId })
      .from(travelsGoogleCalendarConnections)
      .where(eq(travelsGoogleCalendarConnections.userId, userId));
    if (!connection?.calendarId) continue;

    try {
      const existingRow = existingByUser.get(userId);
      if (existingRow) {
        await updateReminderEvent(
          accessToken,
          connection.calendarId,
          existingRow.googleEventId,
          { title, dueDate, description: `Trip reminder: ${tripTitle}` },
        );
      } else {
        const event = await createReminderEvent(accessToken, {
          calendarId: connection.calendarId,
          title,
          dueDate,
          description: `Trip reminder: ${tripTitle}`,
        });
        await db.insert(travelsReminderCalendarEvents).values({
          reminderId,
          userId,
          googleEventId: event.id,
        });
      }
    } catch (err) {
      logger.warn(
        { err, reminderId, userId },
        "reminders: calendar sync failed for user",
      );
    }
  }
}

async function deleteAllReminderCalendarEvents(
  reminderId: number,
): Promise<void> {
  const existing = await db
    .select()
    .from(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));

  for (const row of existing) {
    const accessToken = await getValidAccessToken(row.userId);
    const [connection] = await db
      .select({ calendarId: travelsGoogleCalendarConnections.calendarId })
      .from(travelsGoogleCalendarConnections)
      .where(eq(travelsGoogleCalendarConnections.userId, row.userId));
    if (accessToken && connection?.calendarId) {
      await deleteReminderEvent(
        accessToken,
        connection.calendarId,
        row.googleEventId,
      );
    }
  }

  await db
    .delete(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));
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
      description: body.description ?? null,
      dueDate: body.dueDate ?? null,
      done: false,
      recipientEmails: body.recipientEmails ?? [],
      syncToCalendar,
    })
    .returning();

  if (syncToCalendar && row.dueDate) {
    const targetUserIds = await getConnectedTargetUserIds(
      userId,
      row.recipientEmails,
    );
    await syncReminderCalendarEvents(
      row.id,
      trip.title,
      row.title,
      row.dueDate,
      targetUserIds,
    );
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
  if (body.description !== undefined) updateData.description = body.description;
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
    body.done !== undefined ||
    body.recipientEmails !== undefined ||
    body.syncToCalendar !== undefined
  ) {
    const [trip] = await db
      .select({ title: travelsTrips.title })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, tripId));
    const tripTitle = trip?.title ?? "Trip";

    const targetUserIds = updated.syncToCalendar
      ? await getConnectedTargetUserIds(updated.userId, updated.recipientEmails)
      : [];
    await syncReminderCalendarEvents(
      updated.id,
      tripTitle,
      updated.title,
      updated.dueDate,
      targetUserIds,
    );
  }

  res.json(updated);
});

// DELETE /trips/:id/reminders/:reminderId
router.delete("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select({ id: travelsReminders.id })
    .from(travelsReminders)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    );

  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await deleteAllReminderCalendarEvents(existing.id);

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
