import { Router, type IRouter } from "express";
import { and, eq, inArray, asc, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/soft-delete";
import { z } from "zod/v4";
import {
  db,
  travelsTrips,
  travelsConnectedCalendars,
  reminders,
  appUsers,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { tripExists } from "../../lib/travels/db-helpers";
import { getValidAccessToken } from "../../lib/google-calendar-tokens";
import { getCalendarEvent } from "../../lib/google-calendar";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

// Travels reminders are one entity type ('travels_trip') within the generic
// cross-app `reminders` table (see lib/db/src/schema/reminders.ts and the
// reminder-system programme). This route intentionally keeps its external
// wire shape stable (`dueDate` as a plain date string, `alertDaysBefore` as
// a number array) so the frontend and lib/api-client-react/src/travels.ts
// never needed to change for the pre-existing fields — only the storage
// underneath did. New optional fields (`leadTimes`, `calendarConnectionId`,
// `googleEventId`) are additive.
//
// Google Calendar sync (create/update/delete an event) was retired along
// with the migration: the generic system never writes a new calendar event
// for a reminder — reminders.calendarConnectionId/googleEventId only ever
// store a read-only *link* to an already-existing event on one of the
// user's own connected calendars (issue #518). The unified scheduler
// (reminders-scheduler.ts's syncCalendarLinkedReminders, issue #516) keeps
// dueAt in sync with that event's start time going forward.
const ENTITY_TYPE = "travels_trip" as const;

const LEAD_TIME_UNITS = ["minutes", "hours", "days", "weeks"] as const;
const LeadTimeInput = z.object({
  value: z.number().int().min(0),
  unit: z.enum(LEAD_TIME_UNITS),
});
type LeadTimeInput = z.infer<typeof LeadTimeInput>;

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
  // New (issue #518): arbitrary-unit, arbitrary-count lead times, superseding
  // alertDaysBefore when present. Both are accepted so existing callers keep
  // working unchanged.
  leadTimes: z.array(LeadTimeInput).min(1).optional(),
  // New (issue #518): attach this reminder to an event on one of the user's
  // OWN already-connected calendars. Both fields must be provided together
  // to link; dueDate is ignored in favor of the event's start time when set.
  calendarConnectionId: z.number().int().positive().nullable().optional(),
  googleEventId: z.string().min(1).nullable().optional(),
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
  leadTimes: z.array(LeadTimeInput).min(1).optional(),
  // Pass null for either to detach the calendar link entirely.
  calendarConnectionId: z.number().int().positive().nullable().optional(),
  googleEventId: z.string().min(1).nullable().optional(),
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

function normalizeLeadTimes(leadTimes: unknown): LeadTimeInput[] {
  if (!Array.isArray(leadTimes)) return [];
  return leadTimes
    .map((lt) => LeadTimeInput.safeParse(lt))
    .filter((r): r is { success: true; data: LeadTimeInput } => r.success)
    .map((r) => r.data);
}

class CalendarLinkError extends Error {}

interface ResolvedCalendarLink {
  dueAt: Date;
  // Google Calendar's own event.htmlLink — denormalized onto the reminder
  // row so every reminder UI surface can render a "view event" link without
  // a live Calendar API call per render (issue #519). null if Google didn't
  // return one (shouldn't normally happen, but the schema tolerates it).
  htmlLink: string | null;
}

// Resolves and validates a calendarConnectionId/googleEventId pair: the
// calendar must belong to the requesting user (never another household
// member's), and the event must still exist. Returns the event's start time
// to use as the reminder's dueAt, plus its htmlLink. Throws CalendarLinkError
// with a user-facing message on any failure — callers turn that into a 400.
async function resolveCalendarLink(
  userId: number,
  calendarConnectionId: number,
  googleEventId: string,
): Promise<ResolvedCalendarLink> {
  const [calendar] = await db
    .select()
    .from(travelsConnectedCalendars)
    .where(
      and(
        eq(travelsConnectedCalendars.id, calendarConnectionId),
        eq(travelsConnectedCalendars.userId, userId),
      ),
    )
    .limit(1);
  if (!calendar) {
    throw new CalendarLinkError("Connected calendar not found.");
  }

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new CalendarLinkError("Could not connect to Google Calendar.");
  }

  let event;
  try {
    event = await getCalendarEvent(
      accessToken,
      calendar.googleCalendarId,
      googleEventId,
    );
  } catch (err) {
    logger.error(
      { err, calendarConnectionId, googleEventId },
      "reminders: failed to look up linked calendar event",
    );
    throw new CalendarLinkError("Could not reach Google Calendar.");
  }
  if (!event) {
    throw new CalendarLinkError(
      "That calendar event no longer exists. Pick another one.",
    );
  }
  return { dueAt: new Date(event.start), htmlLink: event.htmlLink ?? null };
}

// Maps a generic `reminders` row (for a travels_trip entity) back to the
// travels_reminders-shaped object the frontend expects, extended (issue
// #518) with the full leadTimes array and calendar-link fields.
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
    leadTimes: normalizeLeadTimes(row.leadTimes),
    calendarConnectionId: row.calendarConnectionId,
    googleEventId: row.googleEventId,
    googleEventHtmlLink: row.googleEventHtmlLink,
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

  // Calendar-linked reminders (issue #518): the event's own start time wins
  // over any dueDate the client also sent.
  let dueAt = dueDateToDueAt(body.dueDate);
  let googleEventHtmlLink: string | null = null;
  if (body.calendarConnectionId && body.googleEventId) {
    try {
      const resolved = await resolveCalendarLink(
        userId,
        body.calendarConnectionId,
        body.googleEventId,
      );
      dueAt = resolved.dueAt;
      googleEventHtmlLink = resolved.htmlLink;
    } catch (err) {
      if (err instanceof CalendarLinkError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  const leadTimes = body.leadTimes
    ? body.leadTimes
    : alertDaysBeforeToLeadTimes(
        body.alertDaysBefore ?? DEFAULT_ALERT_DAYS_BEFORE,
      );

  const [row] = await db
    .insert(reminders)
    .values({
      entityType: ENTITY_TYPE,
      entityId: tripId,
      createdByUserId: userId,
      title: body.title,
      description: body.description ?? null,
      dueAt,
      status: "active",
      emailRecipients: body.recipientEmails ?? [],
      smsRecipientUserIds,
      callRecipientUserIds,
      leadTimes,
      calendarConnectionId:
        body.calendarConnectionId && body.googleEventId
          ? body.calendarConnectionId
          : null,
      googleEventId:
        body.calendarConnectionId && body.googleEventId
          ? body.googleEventId
          : null,
      googleEventHtmlLink:
        body.calendarConnectionId && body.googleEventId
          ? googleEventHtmlLink
          : null,
    })
    .returning();

  res.status(201).json(toWireShape(row));
});

// PATCH /trips/:id/reminders/:reminderId
router.patch("/trips/:id/reminders/:reminderId", async (req, res) => {
  const userId = req.session.userId!;
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
  if (body.leadTimes !== undefined) {
    updateData.leadTimes = body.leadTimes;
  } else if (body.alertDaysBefore !== undefined) {
    updateData.leadTimes = alertDaysBeforeToLeadTimes(body.alertDaysBefore);
  }

  // Calendar link (issue #518): either field present (including explicit
  // null) touches the link. Both null clears it; both set re-links (and
  // re-anchors dueAt to the new event's start, overriding any dueDate also
  // sent in this same request).
  if (
    body.calendarConnectionId !== undefined ||
    body.googleEventId !== undefined
  ) {
    if (body.calendarConnectionId && body.googleEventId) {
      try {
        const resolved = await resolveCalendarLink(
          userId,
          body.calendarConnectionId,
          body.googleEventId,
        );
        updateData.dueAt = resolved.dueAt;
        updateData.googleEventHtmlLink = resolved.htmlLink;
      } catch (err) {
        if (err instanceof CalendarLinkError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
      updateData.calendarConnectionId = body.calendarConnectionId;
      updateData.googleEventId = body.googleEventId;
    } else {
      updateData.calendarConnectionId = null;
      updateData.googleEventId = null;
      updateData.googleEventHtmlLink = null;
    }
  }
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
