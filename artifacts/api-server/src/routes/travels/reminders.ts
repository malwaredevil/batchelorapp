import { Router, type IRouter } from "express";
import { and, eq, inArray, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsTrips,
  travelsReminders,
  travelsReminderCalendarEvents,
  travelsConnectedCalendars,
  appUsers,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createReminderEvent,
  updateReminderEvent,
  deleteReminderEvent,
  getReminderEventAlertDays,
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
  alertDaysBefore: z.array(z.number().int().min(0)).min(1).optional(),
});

const UpdateReminderBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  recipientEmails: z.array(z.email()).optional(),
  syncToCalendar: z.boolean().optional(),
  alertDaysBefore: z.array(z.number().int().min(0)).min(1).optional(),
});

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

// Every family member who has connected at least one Google calendar, and
// selected recipients who have an app account, gets their own copy of the
// event on their oldest (first-added) connected calendar — their reminder's
// creator, plus anyone listed in recipientEmails.
export async function getConnectedTargetUserIds(
  creatorUserId: number,
  recipientEmails: string[],
): Promise<{ userId: number; calendarId: string }[]> {
  const candidateUserIds = new Set<number>([creatorUserId]);
  if (recipientEmails.length > 0) {
    const recipients = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(inArray(appUsers.email, recipientEmails));
    for (const r of recipients) candidateUserIds.add(r.id);
  }

  const rows = await db
    .select({
      userId: travelsConnectedCalendars.userId,
      calendarId: travelsConnectedCalendars.googleCalendarId,
      id: travelsConnectedCalendars.id,
    })
    .from(travelsConnectedCalendars)
    .where(inArray(travelsConnectedCalendars.userId, [...candidateUserIds]))
    .orderBy(travelsConnectedCalendars.id);

  const firstByUser = new Map<number, string>();
  for (const row of rows) {
    if (!firstByUser.has(row.userId)) firstByUser.set(row.userId, row.calendarId);
  }
  return [...firstByUser.entries()].map(([userId, calendarId]) => ({ userId, calendarId }));
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
  targets: { userId: number; calendarId: string }[],
  alertDaysBefore: number[],
): Promise<void> {
  const existing = await db
    .select()
    .from(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));
  const existingByUser = new Map(existing.map((e) => [e.userId, e]));
  const targetByUser = new Map(targets.map((t) => [t.userId, t.calendarId]));
  const targetSet = new Set(dueDate ? [...targetByUser.keys()] : []);

  for (const row of existing) {
    if (!targetSet.has(row.userId)) {
      const accessToken = await getValidAccessToken(row.userId);
      if (accessToken) {
        await deleteReminderEvent(accessToken, row.calendarId, row.googleEventId);
      }
      await db
        .delete(travelsReminderCalendarEvents)
        .where(eq(travelsReminderCalendarEvents.id, row.id));
    }
  }

  if (!dueDate) return;

  for (const [userId, calendarId] of targetByUser) {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) continue;

    try {
      const existingRow = existingByUser.get(userId);
      if (existingRow) {
        await updateReminderEvent(accessToken, existingRow.calendarId, existingRow.googleEventId, {
          title,
          dueDate,
          description: `Trip reminder: ${tripTitle}`,
          alertDaysBefore,
        });
      } else {
        const event = await createReminderEvent(accessToken, {
          calendarId,
          title,
          dueDate,
          description: `Trip reminder: ${tripTitle}`,
          alertDaysBefore,
        });
        await db.insert(travelsReminderCalendarEvents).values({
          reminderId,
          userId,
          calendarId,
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

export async function deleteAllReminderCalendarEvents(
  reminderId: number,
): Promise<void> {
  const existing = await db
    .select()
    .from(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));

  for (const row of existing) {
    const accessToken = await getValidAccessToken(row.userId);
    if (accessToken) {
      await deleteReminderEvent(accessToken, row.calendarId, row.googleEventId);
    }
  }

  await db
    .delete(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));
}

/**
 * Pull-side of the bidirectional reminder-interval sync: reads the
 * creator's own copy of the reminder's calendar event and, if its popup
 * overrides imply a different set of day-offsets than what's stored, treats
 * Google as the source of truth and updates travels_reminders. Called
 * lazily whenever a reminder's events are read/listed, and periodically
 * from the reminder scheduler. Best-effort — never throws.
 */
export async function pullReminderAlertDaysFromCalendar(
  reminderId: number,
  creatorUserId: number,
  currentAlertDaysBefore: number[],
): Promise<number[]> {
  try {
    const [row] = await db
      .select()
      .from(travelsReminderCalendarEvents)
      .where(
        and(
          eq(travelsReminderCalendarEvents.reminderId, reminderId),
          eq(travelsReminderCalendarEvents.userId, creatorUserId),
        ),
      );
    if (!row) return currentAlertDaysBefore;

    const accessToken = await getValidAccessToken(creatorUserId);
    if (!accessToken) return currentAlertDaysBefore;

    const googleDays = await getReminderEventAlertDays(accessToken, row.calendarId, row.googleEventId);
    if (!googleDays || googleDays.length === 0) return currentAlertDaysBefore;

    const sameSet =
      googleDays.length === currentAlertDaysBefore.length &&
      [...googleDays].sort().every((d, i) => d === [...currentAlertDaysBefore].sort()[i]);
    if (sameSet) return currentAlertDaysBefore;

    await db
      .update(travelsReminders)
      .set({ alertDaysBefore: googleDays })
      .where(eq(travelsReminders.id, reminderId));
    logger.info(
      { reminderId, googleDays },
      "reminders: pulled alert-day overrides from Google Calendar edit",
    );
    return googleDays;
  } catch (err) {
    logger.warn({ err, reminderId }, "reminders: pull-alert-days failed");
    return currentAlertDaysBefore;
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
      description: body.description ?? null,
      dueDate: body.dueDate ?? null,
      done: false,
      recipientEmails: body.recipientEmails ?? [],
      syncToCalendar,
      ...(body.alertDaysBefore !== undefined ? { alertDaysBefore: body.alertDaysBefore } : {}),
    })
    .returning();

  if (syncToCalendar && row.dueDate) {
    const targets = await getConnectedTargetUserIds(userId, row.recipientEmails);
    await syncReminderCalendarEvents(
      row.id,
      trip.title,
      row.title,
      row.dueDate,
      targets,
      row.alertDaysBefore,
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
  if (body.alertDaysBefore !== undefined) updateData.alertDaysBefore = body.alertDaysBefore;

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
    body.syncToCalendar !== undefined ||
    body.alertDaysBefore !== undefined
  ) {
    const [trip] = await db
      .select({ title: travelsTrips.title })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, tripId));
    const tripTitle = trip?.title ?? "Trip";

    const targets = updated.syncToCalendar
      ? await getConnectedTargetUserIds(updated.userId, updated.recipientEmails)
      : [];
    await syncReminderCalendarEvents(
      updated.id,
      tripTitle,
      updated.title,
      updated.dueDate,
      targets,
      updated.alertDaysBefore,
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
