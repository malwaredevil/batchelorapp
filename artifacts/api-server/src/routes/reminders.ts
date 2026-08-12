import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, reminders } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import {
  filterVerifiedPhoneUserIds,
  filterSlackLinkedUserIds,
} from "../lib/reminder-recipients";
import {
  listManageableReminders,
  findManageableReminder,
  snoozeReminder,
} from "../lib/reminders-management";

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
// GET / — list every reminder the current user can manage: one they
// created, or one addressed to them on any channel (they may not be the
// creator — e.g. a household member added them as an SMS recipient). This
// is intentionally broader than "reminders I created" so a reminder fired
// over a channel with no reply-back UI (SMS/voice/Slack/email) can still be
// found and managed here by the person it was actually sent to.
//
// Scoping/annotation logic (and the PATCH/snooze/DELETE scoping helper) is
// shared with Elaine's list_reminders/snooze_reminder tools via
// lib/reminders-management.ts — see that module for the single source of
// truth.
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
  const userId = req.session.userId!;
  const result = await listManageableReminders(userId, parsed.data);
  return res.json({ reminders: result });
});

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
// touching its title/recipients/recurrence rule. See
// lib/reminders-management.ts's snoozeReminder for the shared
// implementation (also used by Elaine's snooze_reminder tool).
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

  const result = await snoozeReminder(reminderId, userId, parsed.data);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  logger.info(
    { reminderId, userId, input: parsed.data },
    "reminders: snoozed via central Reminders page",
  );
  return res.json({ reminder: result.reminder });
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
