import { Router, type IRouter } from "express";
import { and, eq, inArray, asc, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/soft-delete";
import { z } from "zod/v4";
import { db, travelsTrips, reminders, appUsers } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { tripExists } from "../../lib/travels/db-helpers";

const router: IRouter = Router();
router.use(requireAuth);

// Travels reminders are one entity type ('travels_trip') within the generic
// cross-app `reminders` table (see lib/db/src/schema/reminders.ts and the
// reminder-system programme). This route intentionally keeps its external
// wire shape stable (`dueDate` as a plain date string, `alertDaysBefore` as
// a number array) so the frontend and lib/api-client-react/src/travels.ts
// never needed to change — only the storage underneath did.
//
// Google Calendar sync (create/update/delete an event) was retired along
// with the migration: the generic system never writes a new calendar event
// for a reminder — see reminders.calendarConnectionId/googleEventId, which
// only ever store a read-only *link* to an already-existing event (issue
// #518/#519, not yet surfaced on this route).
const ENTITY_TYPE = "travels_trip" as const;

// Same default day-offsets the old travels_reminders.alert_days_before
// column used.
const DEFAULT_ALERT_DAYS_BEFORE = [14, 7, 3];

// Fixed time-of-day for a bare due-date with no explicit time, matching the
// convention used by the one-time travels_reminders backfill and (later)
// issue #525's relative-time resolver.
const DEFAULT_DUE_TIME_UTC = "T00:01:00.000Z";

const CreateReminderBody = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: z.string().optional(),
  recipientEmails: z.array(z.email()).optional(),
  smsRecipientUserIds: z.array(z.number().int()).optional(),
  callRecipientUserIds: z.array(z.number().int()).optional(),
  alertDaysBefore: z.array(z.number().int().min(0)).min(1).optional(),
});

const UpdateReminderBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  recipientEmails: z.array(z.email()).optional(),
  smsRecipientUserIds: z.array(z.number().int()).optional(),
  callRecipientUserIds: z.array(z.number().int()).optional(),
  alertDaysBefore: z.array(z.number().int().min(0)).min(1).optional(),
});

// Only household members with a verified phone number can be selected as SMS
// recipients — silently drops any id that isn't verified rather than
// rejecting the whole request, since the set may include a user who
// unverified their phone between selection and save.
async function filterVerifiedPhoneUserIds(
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(inArray(appUsers.id, userIds), eq(appUsers.phoneVerified, true)),
    );
  return rows.map((r) => r.id);
}

function dueDateToDueAt(dueDate: string | null | undefined): Date | null {
  if (!dueDate) return null;
  return new Date(dueDate + DEFAULT_DUE_TIME_UTC);
}

function dueAtToDueDate(dueAt: Date | string | null): string | null {
  if (!dueAt) return null;
  const iso = dueAt instanceof Date ? dueAt.toISOString() : dueAt;
  return iso.slice(0, 10);
}

function alertDaysBeforeToLeadTimes(
  days: number[],
): { value: number; unit: "days" }[] {
  return days.map((value) => ({ value, unit: "days" as const }));
}

function leadTimesToAlertDaysBefore(
  leadTimes: unknown,
): number[] {
  if (!Array.isArray(leadTimes)) return DEFAULT_ALERT_DAYS_BEFORE;
  return leadTimes
    .filter(
      (lt): lt is { value: number; unit: string } =>
        lt && typeof lt === "object" && lt.unit === "days",
    )
    .map((lt) => lt.value);
}

// Maps a generic `reminders` row (for a travels_trip entity) back to the
// travels_reminders-shaped object the frontend expects.
function toWireShape(row: typeof reminders.$inferSelect) {
  return {
    id: row.id,
    tripId: row.entityId,
    userId: row.createdByUserId,
    title: row.title,
    description: row.description,
    dueDate: dueAtToDueDate(row.dueAt),
    done: row.status === "done",
    recipientEmails: row.emailRecipients,
    smsRecipientUserIds: row.smsRecipientUserIds,
    callRecipientUserIds: row.callRecipientUserIds,
    alertDaysBefore: leadTimesToAlertDaysBefore(row.leadTimes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

// GET /reminders — all pending (or all) reminders across all trips (for Dashboard)
router.get("/reminders", async (req, res) => {
  const pending = req.query.pending === "true";

  const rows = await db
    .select()
    .from(reminders)
    .where(
      pending
        ? and(
            eq(reminders.entityType, ENTITY_TYPE),
            eq(reminders.status, "active"),
            isNull(reminders.deletedAt),
          )
        : and(eq(reminders.entityType, ENTITY_TYPE), isNull(reminders.deletedAt)),
    )
    .orderBy(asc(reminders.dueAt), asc(reminders.createdAt));

  res.json(rows.map(toWireShape));
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
    .from(reminders)
    .where(
      and(
        eq(reminders.entityType, ENTITY_TYPE),
        eq(reminders.entityId, tripId),
        isNull(reminders.deletedAt),
      ),
    )
    .orderBy(asc(reminders.dueAt), asc(reminders.createdAt));

  res.json(rows.map(toWireShape));
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
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = CreateReminderBody.parse(req.body);
  const smsRecipientUserIds = body.smsRecipientUserIds
    ? await filterVerifiedPhoneUserIds(body.smsRecipientUserIds)
    : [];
  const callRecipientUserIds = body.callRecipientUserIds
    ? await filterVerifiedPhoneUserIds(body.callRecipientUserIds)
    : [];
  const [row] = await db
    .insert(reminders)
    .values({
      entityType: ENTITY_TYPE,
      entityId: tripId,
      createdByUserId: userId,
      title: body.title,
      description: body.description ?? null,
      dueAt: dueDateToDueAt(body.dueDate),
      status: "active",
      emailRecipients: body.recipientEmails ?? [],
      smsRecipientUserIds,
      callRecipientUserIds,
      leadTimes: alertDaysBeforeToLeadTimes(
        body.alertDaysBefore ?? DEFAULT_ALERT_DAYS_BEFORE,
      ),
    })
    .returning();

  res.status(201).json(toWireShape(row));
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
  if (body.dueDate !== undefined)
    updateData.dueAt = dueDateToDueAt(body.dueDate);
  if (body.done !== undefined) updateData.status = body.done ? "done" : "active";
  if (body.recipientEmails !== undefined)
    updateData.emailRecipients = body.recipientEmails;
  if (body.smsRecipientUserIds !== undefined)
    updateData.smsRecipientUserIds = await filterVerifiedPhoneUserIds(
      body.smsRecipientUserIds,
    );
  if (body.callRecipientUserIds !== undefined)
    updateData.callRecipientUserIds = await filterVerifiedPhoneUserIds(
      body.callRecipientUserIds,
    );
  if (body.alertDaysBefore !== undefined)
    updateData.leadTimes = alertDaysBeforeToLeadTimes(body.alertDaysBefore);
  updateData.updatedAt = new Date();

  const [updated] = await db
    .update(reminders)
    .set(updateData)
    .where(
      and(
        eq(reminders.id, reminderId),
        eq(reminders.entityType, ENTITY_TYPE),
        eq(reminders.entityId, tripId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(toWireShape(updated));
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
    .select({ id: reminders.id, title: reminders.title })
    .from(reminders)
    .where(
      and(
        eq(reminders.id, reminderId),
        eq(reminders.entityType, ENTITY_TYPE),
        eq(reminders.entityId, tripId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .update(reminders)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(reminders.id, reminderId),
        eq(reminders.entityType, ENTITY_TYPE),
        eq(reminders.entityId, tripId),
      ),
    );
  res.status(200).json({ ok: true });
  void logActivity({
    actorUserId: req.session.userId!,
    actorChannel: "web",
    actionType: "delete_reminder",
    entityType: "reminder",
    entityId: reminderId,
    entityLabel: existing.title,
    reversible: true,
  });
});

export default router;
