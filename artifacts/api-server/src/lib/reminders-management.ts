import { eq, and, or, sql, isNull } from "drizzle-orm";
import { db, appUsers, reminders } from "@workspace/db";
import {
  computeNextOccurrenceForReminder,
  occurrenceKeyPrefix,
} from "./reminders-scheduler";

// ---------------------------------------------------------------------------
// Shared "central Reminders" data layer (issue #524), used by BOTH the REST
// router (routes/reminders.ts) and Elaine's list_reminders/snooze_reminder
// tools (elaine/reminder-actions.ts) so the two surfaces can never drift on
// scoping or recurrence math — one place computes "which reminders can this
// user manage" and "what does skipping/snoozing actually do to the row".
// ---------------------------------------------------------------------------

// entityType -> frontend route resolver, for the "linked record" link shown
// on both the web page and in Elaine's tool output. Deliberately a static
// per-type map (not a live title lookup across 7+ different tables) — good
// enough to link back to the record; the reminder's own title is the
// primary label. Extend with one entry per entityType as new modules start
// creating reminders (mirrors the TODO list in reminders-scheduler.ts's
// resolveEntityContextLabel).
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

export function buildEntityLink(
  entityType: string | null,
  entityId: number | null,
): { type: string; id: number; url: string; label: string } | null {
  if (!entityType || entityId == null) return null;
  const route = ENTITY_ROUTES[entityType];
  if (!route) return null;
  return {
    type: entityType,
    id: entityId,
    url: route.path(entityId),
    label: route.label,
  };
}

export function channelsForRow(row: {
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

export function isRecurring(row: {
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

/** Every reminder the given user can manage: one they created, or one
 * addressed to them on any channel. Intentionally broader than "created by
 * me" so a reminder fired over a reply-less channel (SMS/voice/Slack/email)
 * can still be found by the person it was actually sent to. */
async function scopeConditionFor(userId: number) {
  const [user] = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userEmail = user?.email ?? "";

  return or(
    eq(reminders.createdByUserId, userId),
    sql`${userId} = ANY(${reminders.smsRecipientUserIds})`,
    sql`${userId} = ANY(${reminders.callRecipientUserIds})`,
    sql`${userId} = ANY(${reminders.slackRecipientUserIds})`,
    sql`${userId} = ANY(${reminders.messengerRecipientUserIds})`,
    sql`${userEmail} = ANY(${reminders.emailRecipients})`,
  );
}

export type ReminderListFilter = {
  status?: "active" | "done" | "cancelled" | "all";
  when?: "upcoming" | "overdue" | "all";
};

export async function listManageableReminders(
  userId: number,
  filter: ReminderListFilter = {},
) {
  const status = filter.status ?? "all";
  const when = filter.when ?? "all";

  const conditions = [
    await scopeConditionFor(userId),
    isNull(reminders.deletedAt),
  ];
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

  return rows.map((row) => ({
    ...row,
    entityLink: buildEntityLink(row.entityType, row.entityId),
    channels: channelsForRow(row),
    isRecurring: isRecurring(row),
  }));
}

/** Scoping shared by PATCH/snooze/DELETE: the reminder must exist, not be
 * soft-deleted, and the current user must either have created it or be one
 * of its recipients (same scope listManageableReminders uses). */
export async function findManageableReminder(
  reminderId: number,
  userId: number,
) {
  const [row] = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.id, reminderId),
        isNull(reminders.deletedAt),
        await scopeConditionFor(userId),
      ),
    );
  return row ?? null;
}

export type SnoozeInput = { dueAt: string } | { skipNext: true };

export type SnoozeResult =
  | { ok: true; reminder: typeof reminders.$inferSelect }
  | { ok: false; status: number; error: string };

/** Either move a plain reminder's due date (`dueAt`), or skip just the next
 * occurrence of a recurring one (`skipNext`) without touching its
 * title/recipients/recurrence rule. Skipping cancels any already-scheduled
 * pending/sending delivery rows for the occurrence being skipped so it
 * never fires, then advances due_at + recurrence_fired_count the same way
 * the scheduler's own Phase C does for a *completed* occurrence — the
 * "skip" is simply treating the current occurrence as resolved without
 * ever sending it. */
export async function snoozeReminder(
  reminderId: number,
  userId: number,
  input: SnoozeInput,
): Promise<SnoozeResult> {
  const existing = await findManageableReminder(reminderId, userId);
  if (!existing) {
    return { ok: false, status: 404, error: "reminder not found" };
  }

  if ("dueAt" in input) {
    const [row] = await db
      .update(reminders)
      .set({ dueAt: new Date(input.dueAt), updatedAt: new Date() })
      .where(eq(reminders.id, reminderId))
      .returning();
    return { ok: true, reminder: row! };
  }

  if (!isRecurring(existing) || !existing.dueAt) {
    return {
      ok: false,
      status: 400,
      error: "skipNext requires a recurring reminder with a due date",
    };
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

  await db.execute(sql`
    UPDATE reminder_deliveries
       SET status = 'failed', error = 'skipped via central Reminders page'
     WHERE reminder_id = ${reminderId}
       AND occurrence_key LIKE ${occurrenceKeyPrefix(existing.recurrenceFiredCount) + "%"}
       AND status IN ('pending', 'sending')
  `);

  if (!nextDueAt) {
    const [row] = await db
      .update(reminders)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(reminders.id, reminderId))
      .returning();
    return { ok: true, reminder: row! };
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

  return { ok: true, reminder: row! };
}
