import { pool } from "@workspace/db";
import { sendReminderAlertEmail, resendConfigured, type ReminderAlertType } from "./email";
import { logger } from "./logger";

const ALERT_THRESHOLDS: { type: ReminderAlertType; days: number }[] = [
  { type: "14_day", days: 14 },
  { type: "7_day",  days: 7 },
  { type: "3_day",  days: 3 },
];

async function runReminderAlerts(): Promise<void> {
  if (!resendConfigured()) {
    logger.debug("reminder-scheduler: Resend not configured, skipping");
    return;
  }

  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "reminder-scheduler: could not connect to DB");
    return null;
  });
  if (!client) return;

  try {
    for (const { type, days } of ALERT_THRESHOLDS) {
      const { rows } = await client.query<{
        reminder_id: number;
        user_id: number;
        reminder_title: string;
        trip_title: string;
        trip_destination: string;
        due_date: string;
        reminder_email: string;
      }>(
        `SELECT r.id             AS reminder_id,
                r.user_id,
                r.title          AS reminder_title,
                t.title          AS trip_title,
                t.destination    AS trip_destination,
                r.due_date::text AS due_date,
                u.travels_reminder_email AS reminder_email
           FROM travels_reminders r
           JOIN travels_trips  t ON t.id  = r.trip_id
           JOIN app_users      u ON u.id  = r.user_id
          WHERE r.done = false
            AND r.due_date = CURRENT_DATE + $1::integer
            AND u.travels_reminder_email IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM travels_reminder_alert_log al
               WHERE al.reminder_id = r.id
                 AND al.alert_type  = $2
            )`,
        [days, type],
      );

      for (const row of rows) {
        try {
          await sendReminderAlertEmail(
            row.reminder_email,
            row.reminder_title,
            row.trip_title,
            row.trip_destination,
            type,
            row.due_date,
          );

          await client.query(
            `INSERT INTO travels_reminder_alert_log (reminder_id, user_id, alert_type)
             VALUES ($1, $2, $3)`,
            [row.reminder_id, row.user_id, type],
          );

          logger.info(
            { reminderId: row.reminder_id, alertType: type },
            "reminder-scheduler: alert email sent",
          );
        } catch (err) {
          logger.error(
            { err, reminderId: row.reminder_id, alertType: type },
            "reminder-scheduler: failed to send alert",
          );
        }
      }
    }
  } finally {
    client.release();
  }
}

export function startReminderScheduler(): void {
  runReminderAlerts().catch((err: unknown) =>
    logger.error({ err }, "reminder-scheduler: initial run failed"),
  );

  const interval = setInterval(() => {
    runReminderAlerts().catch((err: unknown) =>
      logger.error({ err }, "reminder-scheduler: scheduled run failed"),
    );
  }, 24 * 60 * 60 * 1000);

  interval.unref();

  logger.info("reminder-scheduler: started (runs every 24 h)");
}
