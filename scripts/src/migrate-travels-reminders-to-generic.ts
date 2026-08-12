/**
 * One-time backfill: copies every `travels_reminders` row into the new
 * generic `reminders` table (entityType = 'travels_trip', entityId = tripId)
 * so the Travels reminder routes/scheduler can cut over to the generic
 * system (issue #514, part of the cross-app reminder system programme).
 *
 * Idempotent: every inserted row carries legacySourceTable='travels_reminders'
 * + legacySourceId=<old row id>, and the insert uses
 * ON CONFLICT (legacy_source_table, legacy_source_id) DO NOTHING, so
 * re-running this script after a partial run or after new travels_reminders
 * rows were added simply fills in the gap.
 *
 * Does NOT create, update, or delete anything in Google Calendar, and does
 * NOT touch travels_reminders/travels_reminder_calendar_events/
 * travels_reminder_alert_log/travels_reminder_alert_deliveries — those
 * tables are left exactly as-is for rollback/reference (see issue #517,
 * deferred cleanup, never bundled with this migration).
 *
 * What DOES carry over as a calendar *link* (read-only, display-only —
 * issue #519): if a travels_reminders row had sync_to_calendar = true AND a
 * travels_reminder_calendar_events row whose (userId, calendarId) matches an
 * existing travels_connected_calendars row, the new reminder's
 * calendarConnectionId/googleEventId are populated from that match. This is
 * NOT a live re-sync — the new system never re-writes that Google Calendar
 * event. If no matching travels_connected_calendars row exists (e.g. the
 * event lived on the old household-wide calendar-connection model, or the
 * calendar was since disconnected), the link is left null; the reminder
 * still migrates normally, just without a calendar link to display.
 *
 * Run with: pnpm --filter @workspace/scripts run migrate-travels-reminders
 */
import {
  db,
  travelsReminders,
  travelsReminderCalendarEvents,
  travelsConnectedCalendars,
  reminders,
  type InsertReminder,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

// Fixed time-of-day used when a legacy travels_reminders row has a
// due_date (DATE, no time-of-day) but the new reminders.due_at needs a
// full timestamp. 00:01 UTC mirrors the default used elsewhere in the
// reminder-system programme (issue #525's relative-time resolver) for a
// bare date with no explicit time, so the convention is consistent across
// both migrated and newly-created reminders.
const DEFAULT_DUE_TIME_UTC = "T00:01:00.000Z";

async function main() {
  const legacyRows = await db.select().from(travelsReminders);
  console.log(`Found ${legacyRows.length} travels_reminders row(s) total.`);

  const calendarEventRows = await db
    .select()
    .from(travelsReminderCalendarEvents);
  const connectedCalendarRows = await db
    .select()
    .from(travelsConnectedCalendars);

  let inserted = 0;
  let skippedExisting = 0;
  let noDueDate = 0;
  let calendarLinked = 0;
  let calendarUnresolvable = 0;

  for (const row of legacyRows) {
    const dueAt = row.dueDate ? new Date(row.dueDate + DEFAULT_DUE_TIME_UTC) : null;
    if (!row.dueDate) noDueDate++;

    let calendarConnectionId: number | null = null;
    let googleEventId: string | null = null;
    if (row.syncToCalendar) {
      const eventRow = calendarEventRows.find((e) => e.reminderId === row.id);
      if (eventRow) {
        const connection = connectedCalendarRows.find(
          (c) =>
            c.userId === eventRow.userId &&
            c.googleCalendarId === eventRow.calendarId,
        );
        if (connection) {
          calendarConnectionId = connection.id;
          googleEventId = eventRow.googleEventId;
          calendarLinked++;
        } else {
          calendarUnresolvable++;
        }
      }
    }

    const values: InsertReminder = {
      entityType: "travels_trip",
      entityId: row.tripId,
      createdByUserId: row.userId,
      title: row.title,
      description: row.description,
      dueAt,
      leadTimes: row.alertDaysBefore.map((days) => ({
        value: days,
        unit: "days",
      })),
      calendarConnectionId,
      googleEventId,
      emailRecipients: row.recipientEmails,
      smsRecipientUserIds: row.smsRecipientUserIds,
      callRecipientUserIds: row.callRecipientUserIds,
      slackRecipientUserIds: row.slackRecipientUserIds,
      status: row.done ? "done" : "active",
      legacySourceTable: "travels_reminders",
      legacySourceId: row.id,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
    };

    const [existing] = await db
      .select({ id: reminders.id })
      .from(reminders)
      .where(
        and(
          eq(reminders.legacySourceTable, "travels_reminders"),
          eq(reminders.legacySourceId, row.id),
        ),
      );
    if (existing) {
      skippedExisting++;
      continue;
    }

    await db.insert(reminders).values(values).onConflictDoNothing({
      target: [reminders.legacySourceTable, reminders.legacySourceId],
    });
    inserted++;
  }

  console.log("--- migrate-travels-reminders-to-generic summary ---");
  console.log(`Inserted:                 ${inserted}`);
  console.log(`Already migrated (skip):  ${skippedExisting}`);
  console.log(`No due date (migrated anyway, dueAt=null): ${noDueDate}`);
  console.log(`Calendar link resolved:   ${calendarLinked}`);
  console.log(`Calendar link unresolvable (left null): ${calendarUnresolvable}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("migrate-travels-reminders-to-generic failed:", err);
    process.exit(1);
  });
