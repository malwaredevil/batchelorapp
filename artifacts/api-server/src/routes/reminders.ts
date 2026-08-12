import { Router, type IRouter } from "express";
import { eq, and, or, sql, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { db, appUsers, reminders } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import {
  filterVerifiedPhoneUserIds,
  filterSlackLinkedUserIds,
} from "../lib/reminder-recipients";
import {
  computeNextOccurrenceForReminder,
  occurrenceKeyPrefix,
} from "../lib/reminders-scheduler";

// ---------------------------------------------------------------------------
// Generic, entity-agnostic reminder system (EPIC #511).
//
// POST / — quick-create (issue #522/#523, unchanged).
//
// GET /, PATCH /:id, POST /:id/snooze, DELETE /:id — the central Reminders
// page's data layer (issue #524). This is the ONLY place a reminder
// delivered over SMS/voice/email/Slack can be managed after firing, so
// these endpoints deliberately work across every entityType (including
// none at all — Elaine's own conversational reminders) rather than being
// scoped to one module the way routes/travels/reminders.ts is scoped to
// entityType = 'travels_trip'. That trip-scoped router is left untouched;
// it's a stable wire shape the Travels frontend already depends on.
// ---------------------------------------------------------------------------

const router: IRouter = Router();
router.use(requireAuth);

const CreateReminderBody = z.object({
  entityType: z.string().min(1).max(50),
  entityId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  // ISO datetime string. Omit for a bare reminder with no due date (visible
  // only on the central Reminders page / entity's own reminder list until
  // one is set there).
  dueAt: z.string().datetime().optional(),
});

router.post("/", async (req, res) => {
  const parsed = CreateReminderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const userId = req.session.userId!;
  const { entityType, entityId, title, description, dueAt } = parsed.data;

  const [row] = await db
    .insert(reminders)
    .values({
      entityType,
      entityId,
      createdByUserId: userId,
      title,
      description: description ?? null,
      dueAt: dueAt ? new Date(dueAt) : null,
      leadTimes: dueAt ? [{ value: 0, unit: "minutes" }] : [],
      messengerRecipientUserIds: [userId],
    })
    .returning();

  logger.info(
    { reminderId: row?.id, entityType, entityId, userId },
    "reminders: created entity-scoped reminder",
  );

  return res.status(201).json({ reminder: row });
});

// ---------------------------------------------------------------------------
// entityType -> frontend route resolver, for the central page's "linked
// record" link. Deliberately a static per-type map (not a live title
// lookup across 7+ different tables) — good enough to link back to the
// record; the page shows the reminder's own title as the primary label.
// Extend with one entry per entityType as new modules start creating
// reminders (mirrors the TODO list in reminders-scheduler.ts's
// resolveEntityContextLabel).
// ---------------------------------------------------------------------------
const ENTITY_ROUTES: Record<
  string,
  { path: (id: number) => string; label: string }
> = {
  pottery_item: { path: (id) => `/pottery/piece/${id}`, label: "Pottery item" },
  quilting_fabric: {
    path: (id) => `/quilting/fabrics/${id}`,
    label: "Fabric",
  },
  quilting_pattern: {
    path: (id) => `/quilting/patterns/${id}`,
    label: "Pattern",
  },
  quilting_quilt: { path: (id) => `/quilting/quilts/${id}`, label: "Quilt" },
  ornament: { path: (id) => `/ornaments/ornament/${id}`, label: "Ornament" },
  travels_trip: { path: (id) => `/travels/trips/${id}`, label: "Trip" },
  office_note: { path: () => `/office/notes`, label: "Note" },
  travels_wishlist_item: {
    path: () => `/travels/wishlist`,
    label: "Wishlist item",
  },
};

function buildEntityLink(
  entityType: string | null,
  entityId: number | null,
): { type: string; id: number; url: string; label: string } | null {
  if (!entityType || entityId == null) return null;
  const route = ENTITY_ROUTES[entityType];
  if (!route) return null;
  return { type: entityType, id: entityId, url: route.path(entityId), label: route.label };
}

function channelsForRow(row: {
  emailRecipients: string[];
  smsRecipientUserIds: number[];
  callRecipientUserIds: number[];
  slackRecipientUserIds: number[];
  messengerRecipientUserIds: number[];
}): string[] {
  const channels: string[] = [];
  if (row.emailRecipients.length > 0) channels.push("email");
  if (row.smsRecipientUserIds.length > 0) channels.push("sms");
  if (row.callRecipientUserIds.length > 0) channels.push("call");
  if (row.slackRecipientUserIds.length > 0) channels.push("slack");
  if (row.messengerRecipientUserIds.length > 0) channels.push("messenger");
  return channels;
}

function isRecurring(row: {
  recurrenceIntervalValue: number | null;
  recurrenceWeekday: number | null;
  recurrenceDayOfMonth: number | null;
}): boolean {
  return (
    row.recurrenceIntervalValue != null ||
    row.recurrenceWeekday != null ||
    row.recurrenceDayOfMonth != null
  );
}

// ---------------------------------------------------------------------------
// GET / — list every reminder the current user can manage: one they
// created, or one addressed to them on any channel (they may not be the
// creator — e.g. a household member added them as an SMS recipient). This
// is intentionally broader than "reminders I created" so a reminder fired
// over a channel with no reply-back UI (SMS/voice/Slack/email) can still be
// found and managed here by the person it was actually sent to.
// ---------------------------------------------------------------------------
const ListQuery = z.object({
  status: z.enum(["active", "done", "cancelled", "all"]).default("all"),
  when: z.enum(["upcoming", "overdue", "all"]).default("all"),
});

router.get("/", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const { status, when } = parsed.data;
  const userId = req.session.userId!;

  const [user] = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userEmail = user?.email ?? "";

  const scopeCondition = or(
    eq(reminders.createdByUserId, userId),
    sql`${userId} = ANY(${reminders.smsRecipientUserIds})`,
    sql`${userId} = ANY(${reminders.callRecipientUserIds})`,
    sql`${userId} = ANY(${reminders.slackRecipientUserIds})`,
    sql`${userId} = ANY(${reminders.messengerRecipientUserIds})`,
    sql`${userEmail} = ANY(${reminders.emailRecipients})`,
  );

  const conditions = [scopeCondition, isNull(reminders.deletedAt)];
  if (status !== "all") {
    conditions.push(eq(reminders.status, status));
  }
  if (when === "upcoming") {
    conditions.push(sql`${reminders.dueAt} IS NOT NULL`);
    conditions.push(sql`${reminders.dueAt} >= NOW()`);
  } else if (when === "overdue") {
    conditions.push(sql`${reminders.dueAt} IS NOT NULL`);
    conditions.push(sql`${reminders.dueAt} < NOW()`);
  }

  const rows = await db
    .select()
    .from(reminders)
    .where(and(...conditions))
    .orderBy(
      sql`${reminders.dueAt} IS NULL, ${reminders.dueAt} ASC, ${reminders.id} DESC`,
    );

  const result = rows.map((row) => ({
    ...row,
    entityLink: buildEntityLink(row.entityType, row.entityId),
    channels: channelsForRow(row),
    isRecurring: isRecurring(row),
  }));

  return res.json({ reminders: result });
});

// Scoping shared by PATCH/snooze/DELETE: the reminder must exist,
// not be soft-deleted, and the current user must either have created it or
// be one of its recipients (same scope GET / uses).
async function findManageableReminder(reminderId: number, userId: number) {
  const [user] = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userEmail = user?.email ?? "";

  const [row] = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.id, reminderId),
        isNull(reminders.deletedAt),
        or(
          eq(reminders.createdByUserId, userId),
          sql`${userId} = ANY(${reminders.smsRecipientUserIds})`,
          sql`${userId} = ANY(${reminders.callRecipientUserIds})`,
          sql`${userId} = ANY(${reminders.slackRecipientUserIds})`,
          sql`${userId} = ANY(${reminders.messengerRecipientUserIds})`,
          sql`${userEmail} = ANY(${reminders.emailRecipients})`,
        ),
      ),
    );
  return row ?? null;
}

const LEAD_TIME_UNITS = ["minutes", "hours", "days", "weeks"] as const;
const LeadTimeInput = z.object({
  value: z.number().int().min(0),
  unit: z.enum(LEAD_TIME_UNITS),
});

const RECURRENCE_INTERVAL_UNITS = [
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
] as const;

const UpdateReminderBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  leadTimes: z.array(LeadTimeInput).optional(),
  recurrenceIntervalValue: z.number().int().positive().nullable().optional(),
  recurrenceIntervalUnit: z
    .enum(RECURRENCE_INTERVAL_UNITS)
    .nullable()
    .optional(),
  recurrenceWeekday: z.number().int().min(0).max(6).nullable().optional(),
  recurrenceDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  recurrenceEndDate: z.string().nullable().optional(),
  recurrenceMaxOccurrences: z.number().int().positive().nullable().optional(),
  status: z.enum(["active", "done", "cancelled"]).optional(),
  emailRecipients: z.array(z.email()).optional(),
  smsRecipientUserIds: z.array(z.number().int()).optional(),
  callRecipientUserIds: z.array(z.number().int()).optional(),
  slackRecipientUserIds: z.array(z.number().int()).optional(),
  messengerRecipientUserIds: z.array(z.number().int()).optional(),
});

// PATCH /:id — full edit surface (title/description/dueAt/leadTimes/
// recurrence/channels/status). Mark-done and cancel are just `status`
// writes through this same endpoint rather than a separate route, per the
// household's preference against silent data loss — the row (and its
// delivery history) is always preserved, never removed, until an explicit
// DELETE.
router.patch("/:id", async (req, res) => {
  const reminderId = Number(req.params.id);
  if (!Number.isInteger(reminderId)) {
    return res.status(400).json({ error: "invalid reminder id" });
  }
  const parsed = UpdateReminderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const userId = req.session.userId!;

  const existing = await findManageableReminder(reminderId, userId);
  if (!existing) {
    return res.status(404).json({ error: "reminder not found" });
  }

  const body = parsed.data;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.dueAt !== undefined) {
    updateData.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  }
  if (body.leadTimes !== undefined) updateData.leadTimes = body.leadTimes;
  if (body.recurrenceIntervalValue !== undefined)
    updateData.recurrenceIntervalValue = body.recurrenceIntervalValue;
  if (body.recurrenceIntervalUnit !== undefined)
    updateData.recurrenceIntervalUnit = body.recurrenceIntervalUnit;
  if (body.recurrenceWeekday !== undefined)
    updateData.recurrenceWeekday = body.recurrenceWeekday;
  if (body.recurrenceDayOfMonth !== undefined)
    updateData.recurrenceDayOfMonth = body.recurrenceDayOfMonth;
  if (body.recurrenceEndDate !== undefined)
    updateData.recurrenceEndDate = body.recurrenceEndDate;
  if (body.recurrenceMaxOccurrences !== undefined)
    updateData.recurrenceMaxOccurrences = body.recurrenceMaxOccurrences;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.emailRecipients !== undefined)
    updateData.emailRecipients = body.emailRecipients;
  if (body.smsRecipientUserIds !== undefined) {
    updateData.smsRecipientUserIds = await filterVerifiedPhoneUserIds(
      body.smsRecipientUserIds,
    );
  }
  if (body.callRecipientUserIds !== undefined) {
    updateData.callRecipientUserIds = await filterVerifiedPhoneUserIds(
      body.callRecipientUserIds,
    );
  }
  if (body.slackRecipientUserIds !== undefined) {
    updateData.slackRecipientUserIds = await filterSlackLinkedUserIds(
      body.slackRecipientUserIds,
    );
  }
  if (body.messengerRecipientUserIds !== undefined)
    updateData.messengerRecipientUserIds = body.messengerRecipientUserIds;

  const [row] = await db
    .update(reminders)
    .set(updateData)
    .where(eq(reminders.id, reminderId))
    .returning();

  logger.info(
    { reminderId, userId, fields: Object.keys(body) },
    "reminders: updated via central Reminders page",
  );

  return res.json({ reminder: row });
});

// POST /:id/snooze — either move a plain reminder's due date (`dueAt`), or
// skip just the next occurrence of a recurring one (`skipNext`) without
// touching its title/recipients/recurrence rule. Skipping cancels any
// already-scheduled pending/sending delivery rows for the occurrence being
// skipped so it never fires, then advances due_at + recurrence_fired_count
// the same way the scheduler's own Phase C does for a *completed*
// occurrence — the "skip" is simply treating the current occurrence as
// resolved without ever sending it.
const SnoozeBody = z.union([
  z.object({ dueAt: z.string().datetime() }),
  z.object({ skipNext: z.literal(true) }),
]);

router.post("/:id/snooze", async (req, res) => {
  const reminderId = Number(req.params.id);
  if (!Number.isInteger(reminderId)) {
    return res.status(400).json({ error: "invalid reminder id" });
  }
  const parsed = SnoozeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.prettifyError(parsed.error) });
  }
  const userId = req.session.userId!;

  const existing = await findManageableReminder(reminderId, userId);
  if (!existing) {
    return res.status(404).json({ error: "reminder not found" });
  }

  if ("dueAt" in parsed.data) {
    const [row] = await db
      .update(reminders)
      .set({ dueAt: new Date(parsed.data.dueAt), updatedAt: new Date() })
      .where(eq(reminders.id, reminderId))
      .returning();
    logger.info(
      { reminderId, userId, newDueAt: parsed.data.dueAt },
      "reminders: snoozed to a specific date",
    );
    return res.json({ reminder: row });
  }

  // skipNext: only meaningful for a recurring reminder with a due date.
  if (!isRecurring(existing) || !existing.dueAt) {
    return res
      .status(400)
      .json({ error: "skipNext requires a recurring reminder with a due date" });
  }

  const nextDueAt = computeNextOccurrenceForReminder({
    dueAt: existing.dueAt,
    recurrenceIntervalValue: existing.recurrenceIntervalValue,
    recurrenceIntervalUnit: existing.recurrenceIntervalUnit,
    recurrenceWeekday: existing.recurrenceWeekday,
    recurrenceDayOfMonth: existing.recurrenceDayOfMonth,
    recurrenceEndDate: existing.recurrenceEndDate,
    recurrenceMaxOccurrences: existing.recurrenceMaxOccurrences,
    recurrenceFiredCount: existing.recurrenceFiredCount,
  });

  // Cancel any pending/sending delivery rows already scheduled for the
  // occurrence being skipped so it never actually fires.
  await db.execute(sql`
    UPDATE reminder_deliveries
       SET status = 'failed', error = 'skipped via central Reminders page'
     WHERE reminder_id = ${reminderId}
       AND occurrence_key LIKE ${occurrenceKeyPrefix(existing.recurrenceFiredCount) + "%"}
       AND status IN ('pending', 'sending')
  `);

  if (!nextDueAt) {
    // Reached its end condition — same outcome the scheduler's Phase C
    // would reach on its own, just triggered manually here.
    const [row] = await db
      .update(reminders)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(reminders.id, reminderId))
      .returning();
    logger.info(
      { reminderId, userId },
      "reminders: skipNext reached recurrence end, marked done",
    );
    return res.json({ reminder: row });
  }

  const [row] = await db
    .update(reminders)
    .set({
      dueAt: nextDueAt,
      recurrenceFiredCount: existing.recurrenceFiredCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(reminders.id, reminderId))
    .returning();

  logger.info(
    { reminderId, userId, nextDueAt },
    "reminders: skipped next occurrence",
  );
  return res.json({ reminder: row });
});

// DELETE /:id — soft-delete, matching the rest of the app's convention
// (never a hard delete from a household-facing surface).
router.delete("/:id", async (req, res) => {
  const reminderId = Number(req.params.id);
  if (!Number.isInteger(reminderId)) {
    return res.status(400).json({ error: "invalid reminder id" });
  }
  const userId = req.session.userId!;

  const existing = await findManageableReminder(reminderId, userId);
  if (!existing) {
    return res.status(404).json({ error: "reminder not found" });
  }

  await db
    .update(reminders)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(reminders.id, reminderId));

  logger.info({ reminderId, userId }, "reminders: soft-deleted");

  return res.status(204).send();
});

export default router;
