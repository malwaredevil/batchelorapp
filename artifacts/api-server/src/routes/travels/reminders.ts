import { Router, type IRouter } from "express";
import { and, eq, inArray, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsTrips,
  travelsReminders,
  travelsReminderCalendarEvents,
  appUsers,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  createReminderEvent,
  updateReminderEvent,
  deleteReminderEvent,
  getReminderEventAlertDays,
} from "../../lib/google-calendar";
import {
  getValidAccessToken,
  getTravelCalendarConnection,
} from "../../lib/google-calendar-tokens";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const CreateReminderBody = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: z.string().optional(),
  recipientEmails: z.array(z.email()).optional(),
  smsRecipientUserIds: z.array(z.number().int()).optional(),
  syncToCalendar: z.boolean().optional(),
  alertDaysBefore: z.array(z.number().int().min(0)).min(1).optional(),
});

const UpdateReminderBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  recipientEmails: z.array(z.email()).optional(),
  smsRecipientUserIds: z.array(z.number().int()).optional(),
  syncToCalendar: z.boolean().optional(),
  alertDaysBefore: z.array(z.number().int().min(0)).min(1).optional(),
});

// Only household members with a verified phone number can be selected as SMS
// recipients — silently drops any id that isn't verified rather than
// rejecting the whole request, since the set may include a user who
// unverified their phone between selection and save.
async function filterVerifiedPhoneUserIds(userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(inArray(appUsers.id, userIds), eq(appUsers.phoneVerified, true)));
  return rows.map((r) => r.id);
}

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

// Reminder events live on the single shared Travel calendar (not on each
// recipient's own personal calendar), so every recipient sees the same
// event when they view the Travel Calendar overlay. Writes are always
// proxied through the Travel calendar owner's Google token. Returns null
// when no Travel calendar is configured, in which case reminders simply
// don't sync to Google.
export async function getReminderSyncTarget(): Promise<{
  userId: number;
  calendarId: string;
} | null> {
  const connection = await getTravelCalendarConnection();
  if (!connection) return null;
  return { userId: connection.userId, calendarId: connection.googleCalendarId };
}

// Best-effort sync — reminders remain the source of truth even if the
// Travel calendar owner's Google Calendar API call fails (revoked token,
// expired, etc). Reconciles the single Travel-calendar event for this
// reminder: creates it if missing, updates it in place, and deletes it (or
// any stale copy left over from a since-changed Travel calendar owner) when
// sync is off, there's no due date, or no Travel calendar is configured.
export async function syncReminderCalendarEvents(
  reminderId: number,
  tripTitle: string,
  title: string,
  dueDate: string | null,
  target: { userId: number; calendarId: string } | null,
  alertDaysBefore: number[],
): Promise<void> {
  const existing = await db
    .select()
    .from(travelsReminderCalendarEvents)
    .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));

  if (!target || !dueDate) {
    for (const row of existing) {
      const accessToken = await getValidAccessToken(row.userId);
      if (accessToken) {
        await deleteReminderEvent(
          accessToken,
          row.calendarId,
          row.googleEventId,
        );
      }
    }
    if (existing.length > 0) {
      await db
        .delete(travelsReminderCalendarEvents)
        .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));
    }
    return;
  }

  // If the Travel calendar was reassigned to a different owner/calendar
  // since the last sync, drop any stale event(s) tied to the old one first.
  const stale = existing.filter(
    (row) =>
      row.userId !== target.userId || row.calendarId !== target.calendarId,
  );
  for (const row of stale) {
    const staleToken = await getValidAccessToken(row.userId);
    if (staleToken) {
      await deleteReminderEvent(staleToken, row.calendarId, row.googleEventId);
    }
  }
  if (stale.length > 0) {
    await db.delete(travelsReminderCalendarEvents).where(
      inArray(
        travelsReminderCalendarEvents.id,
        stale.map((row) => row.id),
      ),
    );
  }

  const accessToken = await getValidAccessToken(target.userId);
  if (!accessToken) return;

  const current = existing.find(
    (row) =>
      row.userId === target.userId && row.calendarId === target.calendarId,
  );

  try {
    if (current) {
      await updateReminderEvent(
        accessToken,
        current.calendarId,
        current.googleEventId,
        {
          title,
          dueDate,
          description: `Trip reminder: ${tripTitle}`,
          alertDaysBefore,
        },
      );
    } else {
      const event = await createReminderEvent(accessToken, {
        calendarId: target.calendarId,
        title,
        dueDate,
        description: `Trip reminder: ${tripTitle}`,
        alertDaysBefore,
      });
      await db.insert(travelsReminderCalendarEvents).values({
        reminderId,
        userId: target.userId,
        calendarId: target.calendarId,
        googleEventId: event.id,
      });
    }
  } catch (err) {
    logger.warn({ err, reminderId }, "reminders: Travel calendar sync failed");
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
  currentAlertDaysBefore: number[],
): Promise<number[]> {
  try {
    const [row] = await db
      .select()
      .from(travelsReminderCalendarEvents)
      .where(eq(travelsReminderCalendarEvents.reminderId, reminderId));
    if (!row) return currentAlertDaysBefore;

    const accessToken = await getValidAccessToken(row.userId);
    if (!accessToken) return currentAlertDaysBefore;

    const googleDays = await getReminderEventAlertDays(
      accessToken,
      row.calendarId,
      row.googleEventId,
    );
    if (!googleDays || googleDays.length === 0) return currentAlertDaysBefore;

    const sameSet =
      googleDays.length === currentAlertDaysBefore.length &&
      [...googleDays]
        .sort()
        .every((d, i) => d === [...currentAlertDaysBefore].sort()[i]);
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
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

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
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [trip] = await db
    .select({ id: travelsTrips.id, title: travelsTrips.title })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = CreateReminderBody.parse(req.body);
  const syncToCalendar = body.syncToCalendar ?? true;
  const smsRecipientUserIds = body.smsRecipientUserIds
    ? await filterVerifiedPhoneUserIds(body.smsRecipientUserIds)
    : [];
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
      smsRecipientUserIds,
      syncToCalendar,
      ...(body.alertDaysBefore !== undefined
        ? { alertDaysBefore: body.alertDaysBefore }
        : {}),
    })
    .returning();

  if (syncToCalendar && row.dueDate) {
    const target = await getReminderSyncTarget();
    await syncReminderCalendarEvents(
      row.id,
      trip.title,
      row.title,
      row.dueDate,
      target,
      row.alertDaysBefore,
    );
  }

  res.status(201).json(row);
});

// PATCH /trips/:id/reminders/:reminderId
router.patch("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = UpdateReminderBody.parse(req.body);
  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate;
  if (body.done !== undefined) updateData.done = body.done;
  if (body.recipientEmails !== undefined)
    updateData.recipientEmails = body.recipientEmails;
  if (body.smsRecipientUserIds !== undefined)
    updateData.smsRecipientUserIds = await filterVerifiedPhoneUserIds(
      body.smsRecipientUserIds,
    );
  if (body.syncToCalendar !== undefined)
    updateData.syncToCalendar = body.syncToCalendar;
  if (body.alertDaysBefore !== undefined)
    updateData.alertDaysBefore = body.alertDaysBefore;

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

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

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

    const target = updated.syncToCalendar
      ? await getReminderSyncTarget()
      : null;
    await syncReminderCalendarEvents(
      updated.id,
      tripTitle,
      updated.title,
      updated.dueDate,
      target,
      updated.alertDaysBefore,
    );
  }

  res.json(updated);
});

// DELETE /trips/:id/reminders/:reminderId
router.delete("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select({ id: travelsReminders.id })
    .from(travelsReminders)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

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
