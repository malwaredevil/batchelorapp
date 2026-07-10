import { pool } from "@workspace/db";
import {
  sendReminderAlertEmail,
  resendConfigured,
  alertLabel,
  type ReminderAlertType,
} from "./email";
import { sendReminderAlertSms, smsConfigured } from "./sms";
import { pullReminderAlertDaysFromCalendar } from "../routes/travels/reminders";
import { shouldRunScheduledTask } from "./scheduler-guard";
import { logger } from "./logger";

// Gating is driven entirely by each reminder's own alert_days_before array
// (which may itself have been edited directly in the recipient's Google
// Calendar and pulled back here before we decide what to send) — any
// non-negative day count is valid, not just a fixed 14/7/3-day set.
function alertTypeForDays(days: number): ReminderAlertType {
  return `${days}_day` as ReminderAlertType;
}

// Pure calendar-day difference between a `YYYY-MM-DD` due date and "now".
// Both sides are normalized to UTC midnight before diffing, so the result
// only depends on the calendar date — not on what time of day the hourly
// scheduler happens to run or the server's local timezone. Using a raw
// millisecond diff with Math.round (the previous approach) rounded
// inconsistently depending on time-of-day, which could make a reminder due
// "in exactly N days" match its configured alertDaysBefore on the wrong
// run — skipping the alert entirely or firing it a day early/late.
export function daysUntilDue(dueDate: string, now: Date = new Date()): number {
  const dueMidnightUtc = new Date(`${dueDate}T00:00:00Z`).getTime();
  const nowMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((dueMidnightUtc - nowMidnightUtc) / 86_400_000);
}

export async function runReminderAlerts(): Promise<void> {
  const emailEnabled = resendConfigured();
  const smsEnabled = smsConfigured();

  if (!emailEnabled && !smsEnabled) {
    logger.debug(
      "reminder-scheduler: neither Resend nor AgentPhone configured, skipping",
    );
    return;
  }

  const client = await pool.connect().catch((err: unknown) => {
    logger.warn({ err }, "reminder-scheduler: could not connect to DB");
    return null;
  });
  if (!client) return;

  try {
    const { rows: candidates } = await client.query<{
      reminder_id: number;
      user_id: number;
      reminder_title: string;
      trip_title: string;
      trip_destination: string;
      due_date: string;
      recipient_emails: string[];
      sms_recipient_user_ids: number[];
      alert_days_before: number[];
    }>(
      `SELECT r.id                     AS reminder_id,
              r.user_id,
              r.title                  AS reminder_title,
              t.title                  AS trip_title,
              t.destination            AS trip_destination,
              r.due_date::text         AS due_date,
              r.recipient_emails       AS recipient_emails,
              r.sms_recipient_user_ids AS sms_recipient_user_ids,
              r.alert_days_before      AS alert_days_before
         FROM travels_reminders r
         JOIN travels_trips  t ON t.id  = r.trip_id
        WHERE r.done = false
          AND r.due_date >= CURRENT_DATE
          AND r.due_date <= CURRENT_DATE + 30
          AND (array_length(r.recipient_emails, 1) > 0
               OR array_length(r.sms_recipient_user_ids, 1) > 0)`,
    );

    for (const candidate of candidates) {
      // Pull-back: Google Calendar edits to the reminder's own notification
      // overrides win, so a user who nudges the popup time in their Google
      // Calendar app sees that reflected in future alert-day gating here.
      const alertDaysBefore = await pullReminderAlertDaysFromCalendar(
        candidate.reminder_id,
        candidate.alert_days_before,
      );

      const dueInDays = daysUntilDue(candidate.due_date);

      for (const days of alertDaysBefore) {
        if (dueInDays !== days) continue;
        const type =
          alertTypeForDays(days) ?? (`${days}_day` as ReminderAlertType);

        const row = candidate;

        const { rows: alreadySentRows } = await client.query<{
          channel: string;
        }>(
          `SELECT channel FROM travels_reminder_alert_log
            WHERE reminder_id = $1 AND alert_type = $2`,
          [row.reminder_id, type],
        );
        const alreadySent = new Set(alreadySentRows.map((r) => r.channel));

        // --- Email channel ---
        if (
          emailEnabled &&
          row.recipient_emails.length > 0 &&
          !alreadySent.has("email")
        ) {
          const failures: { toEmail: string; err: unknown }[] = [];
          let successCount = 0;

          for (const toEmail of row.recipient_emails) {
            try {
              await sendReminderAlertEmail(
                toEmail,
                row.reminder_title,
                row.trip_title,
                row.trip_destination,
                type,
                row.due_date,
              );
              successCount++;
            } catch (err) {
              failures.push({ toEmail, err });
              logger.error(
                { err, reminderId: row.reminder_id, alertType: type, toEmail },
                "reminder-scheduler: failed to send email alert to recipient",
              );
            }
          }

          // Only mark the alert as sent once every recipient has actually
          // received it. If even one recipient failed (e.g. Resend rejecting
          // an unverified address), leave the log row absent so the next run
          // retries the whole reminder rather than silently dropping it.
          if (failures.length === 0) {
            await client.query(
              `INSERT INTO travels_reminder_alert_log (reminder_id, user_id, alert_type, channel)
               VALUES ($1, $2, $3, 'email')`,
              [row.reminder_id, row.user_id, type],
            );

            logger.info(
              {
                reminderId: row.reminder_id,
                alertType: type,
                recipientCount: successCount,
              },
              "reminder-scheduler: alert email(s) sent",
            );
          } else {
            logger.warn(
              {
                reminderId: row.reminder_id,
                alertType: type,
                successCount,
                failedRecipients: failures.map((f) => f.toEmail),
              },
              "reminder-scheduler: email alert not fully delivered, will retry next run",
            );
          }
        }

        // --- SMS channel ---
        if (
          smsEnabled &&
          row.sms_recipient_user_ids.length > 0 &&
          !alreadySent.has("sms")
        ) {
          const { rows: phoneRows } = await client.query<{
            id: number;
            phone_number: string;
          }>(
            `SELECT id, phone_number FROM app_users
              WHERE id = ANY($1::int[]) AND phone_verified = true AND phone_number IS NOT NULL`,
            [row.sms_recipient_user_ids],
          );

          if (phoneRows.length > 0) {
            const label = alertLabel(days);
            const formatted = new Date(
              `${row.due_date}T12:00:00Z`,
            ).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            });

            const failures: { userId: number; err: unknown }[] = [];
            let successCount = 0;

            for (const recipient of phoneRows) {
              try {
                await sendReminderAlertSms(
                  recipient.phone_number,
                  row.reminder_title,
                  row.trip_title,
                  row.trip_destination,
                  label,
                  formatted,
                );
                successCount++;
              } catch (err) {
                failures.push({ userId: recipient.id, err });
                logger.error(
                  {
                    err,
                    reminderId: row.reminder_id,
                    alertType: type,
                    userId: recipient.id,
                  },
                  "reminder-scheduler: failed to send sms alert to recipient",
                );
              }
            }

            if (failures.length === 0) {
              await client.query(
                `INSERT INTO travels_reminder_alert_log (reminder_id, user_id, alert_type, channel)
                 VALUES ($1, $2, $3, 'sms')`,
                [row.reminder_id, row.user_id, type],
              );

              logger.info(
                {
                  reminderId: row.reminder_id,
                  alertType: type,
                  recipientCount: successCount,
                },
                "reminder-scheduler: alert sms(s) sent",
              );
            } else {
              logger.warn(
                {
                  reminderId: row.reminder_id,
                  alertType: type,
                  successCount,
                  failedRecipients: failures.map((f) => f.userId),
                },
                "reminder-scheduler: sms alert not fully delivered, will retry next run",
              );
            }
          }
        }
      }
    }
  } finally {
    client.release();
  }
}

const IN_PROCESS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Best-effort, in-process fallback: runs on startup and hourly while this
 * server instance happens to be warm. This alone is NOT sufficient to
 * guarantee delivery — on `autoscale` deployments the instance can be fully
 * asleep for long stretches. Reliable delivery is provided by a separate
 * Replit Scheduled Deployment invoking `pnpm run send-reminder-alerts`
 * (see scripts/send-reminder-alerts.ts), which runs independently of
 * whether the web server instance is awake. The alert log table makes both
 * paths safely idempotent, so running them alongside each other is safe.
 */
export function startReminderScheduler(): void {
  const run = async (): Promise<void> => {
    if (
      !(await shouldRunScheduledTask(
        "reminder-scheduler",
        IN_PROCESS_INTERVAL_MS,
      ))
    ) {
      logger.info("reminder-scheduler: skipped (ran within the last hour)");
      return;
    }
    const t0 = Date.now();
    logger.info("reminder-scheduler: run starting");
    try {
      await runReminderAlerts();
      logger.info(
        { durationMs: Date.now() - t0 },
        "reminder-scheduler: run complete",
      );
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "reminder-scheduler: run failed",
      );
    }
  };

  void run();

  const interval = setInterval(() => void run(), IN_PROCESS_INTERVAL_MS);
  interval.unref();

  logger.info("reminder-scheduler: started (in-process fallback, runs hourly)");
}
