import { pool } from "@workspace/db";
import {
  sendReminderAlertEmail,
  resendConfigured,
  alertLabel,
  type ReminderAlertType,
} from "./email";
import { sendReminderAlertSms, smsConfigured } from "./sms";
import { sendReminderAlertSlack, slackConfigured } from "./slack";
import { pullReminderAlertDaysFromCalendar } from "../routes/travels/reminders";
import { shouldRunScheduledTask } from "./scheduler-guard";
import { logger } from "./logger";

/**
 * Returns true only for non-empty strings that look like valid email addresses.
 * Defends against empty strings, whitespace-only values, or other malformed
 * data that could reach the DB via direct edits or legacy import paths.
 */
export function isValidEmailAddress(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
}

/**
 * Returns true only for strings that look like valid E.164 phone numbers.
 * E.164 format: a leading '+' followed by 7–15 digits (ITU-T standard).
 * Defends against empty strings, bare digit strings without a country code
 * prefix, or other malformed values that could reach the DB via direct edits.
 */
export function isValidE164PhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone.trim());
}

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

// ---------------------------------------------------------------------------
// Work-item types
// ---------------------------------------------------------------------------

type EmailWorkItem = {
  channel: "email";
  reminderId: number;
  userId: number;
  alertType: ReminderAlertType;
  toEmail: string;
  reminderTitle: string;
  tripTitle: string;
  tripDestination: string;
  dueDate: string;
};

type SmsWorkItem = {
  channel: "sms";
  reminderId: number;
  userId: number;
  alertType: ReminderAlertType;
  toPhone: string;
  reminderTitle: string;
  tripTitle: string;
  tripDestination: string;
  label: string;
  formattedDate: string;
};

type SlackWorkItem = {
  channel: "slack";
  reminderId: number;
  userId: number;
  alertType: ReminderAlertType;
  toSlackUserId: string;
  reminderTitle: string;
  tripTitle: string;
  tripDestination: string;
  label: string;
  formattedDate: string;
};

type WorkItem = EmailWorkItem | SmsWorkItem | SlackWorkItem;

type WorkResult =
  | { item: WorkItem; success: true }
  | { item: WorkItem; success: false; error: unknown };

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Sends reminder alert emails/SMS/Slack DMs for any (reminder, alert_type)
 * whose alertDaysBefore matches today.
 *
 * Redesigned in three phases so the pool client is never held open during
 * external-I/O operations (Resend, AgentPhone SMS, Slack API):
 *
 *   Phase 1  — short DB hold: query due reminders + pre-fetch phone/Slack
 *              lookups, build a typed work-item list, release the client.
 *
 *   Phase 2  — no DB held: execute each send independently; collect results.
 *
 *   Phase 3  — short DB hold: record per-recipient delivery rows plus the
 *              backwards-compatible channel-level alert_log entry.
 */
export async function runReminderAlerts(): Promise<void> {
  const emailEnabled = resendConfigured();
  const smsEnabled = smsConfigured();
  const slackEnabled = slackConfigured();

  if (!emailEnabled && !smsEnabled && !slackEnabled) {
    logger.debug(
      "reminder-scheduler: no alert channels configured (email/SMS/Slack), skipping",
    );
    return;
  }

  // ── Phase 1: collect work items ──────────────────────────────────────────
  // Acquire the pool client only for the synchronous DB-read phase.  All slow
  // network operations (Resend, SMS gateway, Slack API) happen AFTER release.

  const workItems: WorkItem[] = [];

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
      slack_recipient_user_ids: number[];
      alert_days_before: number[];
    }>(
      `SELECT r.id                       AS reminder_id,
              r.user_id,
              r.title                    AS reminder_title,
              t.title                    AS trip_title,
              t.destination              AS trip_destination,
              r.due_date::text           AS due_date,
              r.recipient_emails         AS recipient_emails,
              r.sms_recipient_user_ids   AS sms_recipient_user_ids,
              r.slack_recipient_user_ids AS slack_recipient_user_ids,
              r.alert_days_before        AS alert_days_before
         FROM travels_reminders r
         JOIN travels_trips  t ON t.id  = r.trip_id
        WHERE r.done = false
          AND r.due_date >= CURRENT_DATE
          AND r.due_date <= CURRENT_DATE + 30
          AND (array_length(r.recipient_emails, 1) > 0
               OR array_length(r.sms_recipient_user_ids, 1) > 0
               OR array_length(r.slack_recipient_user_ids, 1) > 0)`,
    );

    if (candidates.length === 0) return;

    // Pre-fetch ALL alert-log rows for this run's candidates in one query so
    // the inner loop doesn't need a per-(reminder, type) round-trip.
    const candidateIds = candidates.map((c) => c.reminder_id);
    const alertLogMap = new Map<string, Set<string>>();
    {
      const { rows: alertLogRows } = await client.query<{
        reminder_id: number;
        alert_type: string;
        channel: string;
      }>(
        `SELECT reminder_id, alert_type, channel
           FROM travels_reminder_alert_log
          WHERE reminder_id = ANY($1::int[])`,
        [candidateIds],
      );
      for (const row of alertLogRows) {
        const key = `${row.reminder_id}:${row.alert_type}`;
        const set = alertLogMap.get(key) ?? new Set<string>();
        set.add(row.channel);
        alertLogMap.set(key, set);
      }
    }

    // Also read per-recipient delivery rows so already-sent individual
    // addresses are skipped even when the channel-level log row is absent
    // (e.g., partial failure on a previous run left some sent, some unsent).
    const deliveredKeys = new Set<string>(); // `${reminderId}:${alertType}:${channel}:${recipientKey}`
    {
      const { rows: deliveryRows } = await client.query<{
        reminder_id: number;
        alert_type: string;
        channel: string;
        recipient_key: string;
      }>(
        `SELECT reminder_id, alert_type, channel, recipient_key
           FROM travels_reminder_alert_deliveries
          WHERE reminder_id = ANY($1::int[]) AND status = 'sent'`,
        [candidateIds],
      );
      for (const row of deliveryRows) {
        deliveredKeys.add(
          `${row.reminder_id}:${row.alert_type}:${row.channel}:${row.recipient_key}`,
        );
      }
    }

    // Pre-fetch phone numbers for ALL SMS candidates in one batch query.
    const allSmsUserIds = [
      ...new Set(candidates.flatMap((c) => c.sms_recipient_user_ids)),
    ];
    const phoneMap = new Map<number, string>(); // userId → E.164 phone
    if (smsEnabled && allSmsUserIds.length > 0) {
      const { rows: phoneRows } = await client.query<{
        id: number;
        phone_number: string;
      }>(
        `SELECT id, phone_number FROM app_users
          WHERE id = ANY($1::int[]) AND phone_verified = true AND phone_number IS NOT NULL`,
        [allSmsUserIds],
      );
      for (const row of phoneRows) {
        phoneMap.set(row.id, row.phone_number);
      }
    }

    // Pre-fetch Slack user IDs for ALL Slack candidates in one batch query.
    const allSlackUserIds = [
      ...new Set(candidates.flatMap((c) => c.slack_recipient_user_ids)),
    ];
    const slackMap = new Map<number, string>(); // userId → slack_user_id
    if (slackEnabled && allSlackUserIds.length > 0) {
      const { rows: slackRows } = await client.query<{
        id: number;
        slack_user_id: string;
      }>(
        `SELECT id, slack_user_id FROM app_users
          WHERE id = ANY($1::int[]) AND slack_user_id IS NOT NULL`,
        [allSlackUserIds],
      );
      for (const row of slackRows) {
        slackMap.set(row.id, row.slack_user_id);
      }
    }

    // Build the flat work-item list.  pullReminderAlertDaysFromCalendar may
    // acquire its own DB connection internally; calling it here (while this
    // client is still held) is intentional — it avoids holding the client
    // open during the later external-I/O phase while still letting the
    // calendar pull happen before we decide what alerts are needed.
    for (const candidate of candidates) {
      const alertDaysBefore = await pullReminderAlertDaysFromCalendar(
        candidate.reminder_id,
        candidate.alert_days_before,
      );

      const dueInDays = daysUntilDue(candidate.due_date);

      for (const days of alertDaysBefore) {
        if (dueInDays !== days) continue;

        const type =
          alertTypeForDays(days) ?? (`${days}_day` as ReminderAlertType);

        const alreadySentChannels =
          alertLogMap.get(`${candidate.reminder_id}:${type}`) ??
          new Set<string>();

        const label = alertLabel(days);
        const formattedDate = new Date(
          `${candidate.due_date}T12:00:00Z`,
        ).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });

        // --- Email work items ---
        if (emailEnabled && !alreadySentChannels.has("email")) {
          for (const toEmail of candidate.recipient_emails) {
            if (!isValidEmailAddress(toEmail)) {
              logger.warn(
                {
                  reminderId: candidate.reminder_id,
                  alertType: type,
                  toEmail,
                },
                "reminder-scheduler: skipping malformed recipient email address",
              );
              continue;
            }
            const deliveryKey = `${candidate.reminder_id}:${type}:email:${toEmail}`;
            if (deliveredKeys.has(deliveryKey)) continue;
            workItems.push({
              channel: "email",
              reminderId: candidate.reminder_id,
              userId: candidate.user_id,
              alertType: type,
              toEmail,
              reminderTitle: candidate.reminder_title,
              tripTitle: candidate.trip_title,
              tripDestination: candidate.trip_destination,
              dueDate: candidate.due_date,
            });
          }
        }

        // --- SMS work items ---
        if (smsEnabled && !alreadySentChannels.has("sms")) {
          for (const userId of candidate.sms_recipient_user_ids) {
            const phone = phoneMap.get(userId);
            if (!phone) continue;
            if (!isValidE164PhoneNumber(phone)) {
              logger.warn(
                {
                  reminderId: candidate.reminder_id,
                  alertType: type,
                  userId,
                },
                "reminder-scheduler: skipping malformed phone number for sms alert",
              );
              continue;
            }
            const deliveryKey = `${candidate.reminder_id}:${type}:sms:${phone}`;
            if (deliveredKeys.has(deliveryKey)) continue;
            workItems.push({
              channel: "sms",
              reminderId: candidate.reminder_id,
              userId: candidate.user_id,
              alertType: type,
              toPhone: phone,
              reminderTitle: candidate.reminder_title,
              tripTitle: candidate.trip_title,
              tripDestination: candidate.trip_destination,
              label,
              formattedDate,
            });
          }
        }

        // --- Slack work items ---
        if (slackEnabled && !alreadySentChannels.has("slack")) {
          for (const userId of candidate.slack_recipient_user_ids) {
            const slackUserId = slackMap.get(userId);
            if (!slackUserId) continue;
            const deliveryKey = `${candidate.reminder_id}:${type}:slack:${slackUserId}`;
            if (deliveredKeys.has(deliveryKey)) continue;
            workItems.push({
              channel: "slack",
              reminderId: candidate.reminder_id,
              userId: candidate.user_id,
              alertType: type,
              toSlackUserId: slackUserId,
              reminderTitle: candidate.reminder_title,
              tripTitle: candidate.trip_title,
              tripDestination: candidate.trip_destination,
              label,
              formattedDate,
            });
          }
        }
      }
    }
  } finally {
    // IMPORTANT: release BEFORE any external-I/O (Resend, SMS, Slack).
    // The sends in Phase 2 can take seconds each; holding a pool connection
    // during that time starves concurrent requests (issue #312).
    client.release();
  }

  if (workItems.length === 0) return;

  // ── Phase 2: execute sends (no DB connection held) ───────────────────────

  const results: WorkResult[] = [];

  for (const item of workItems) {
    try {
      if (item.channel === "email") {
        await sendReminderAlertEmail(
          item.toEmail,
          item.reminderTitle,
          item.tripTitle,
          item.tripDestination,
          item.alertType,
          item.dueDate,
        );
      } else if (item.channel === "sms") {
        await sendReminderAlertSms(
          item.toPhone,
          item.reminderTitle,
          item.tripTitle,
          item.tripDestination,
          item.label,
          item.formattedDate,
        );
      } else {
        await sendReminderAlertSlack(
          item.toSlackUserId,
          item.reminderTitle,
          item.tripTitle,
          item.tripDestination,
          item.label,
          item.formattedDate,
        );
      }
      results.push({ item, success: true });
    } catch (err) {
      results.push({ item, success: false, error: err });
      logger.error(
        {
          err,
          reminderId: item.reminderId,
          alertType: item.alertType,
          channel: item.channel,
        },
        "reminder-scheduler: failed to send alert to recipient",
      );
    }
  }

  const anySucceeded = results.some((r) => r.success);
  if (!anySucceeded) return;

  // ── Phase 3: record results (short new DB connection) ────────────────────
  // Write per-recipient rows into travels_reminder_alert_deliveries so
  // future runs skip already-sent recipients without needing a full channel
  // retry.  Also write the backwards-compatible channel-level alert_log row
  // when every recipient in the channel succeeded (preserving the existing
  // behaviour that the log row is absent on partial failure, triggering a
  // full channel retry next run).

  const recordClient = await pool.connect().catch((err: unknown) => {
    logger.warn(
      { err },
      "reminder-scheduler: could not connect to DB for results recording",
    );
    return null;
  });
  if (!recordClient) return;

  try {
    // Write per-recipient delivery rows.
    for (const result of results) {
      const recipientKey =
        result.item.channel === "email"
          ? (result.item as EmailWorkItem).toEmail
          : result.item.channel === "sms"
            ? (result.item as SmsWorkItem).toPhone
            : (result.item as SlackWorkItem).toSlackUserId;

      await recordClient
        .query(
          `INSERT INTO travels_reminder_alert_deliveries
             (reminder_id, user_id, alert_type, channel, recipient_key,
              status, attempt_count, sent_at, last_error, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, NOW())
           ON CONFLICT (reminder_id, alert_type, channel, recipient_key) DO UPDATE
             SET status        = EXCLUDED.status,
                 attempt_count = travels_reminder_alert_deliveries.attempt_count + 1,
                 sent_at       = EXCLUDED.sent_at,
                 last_error    = EXCLUDED.last_error,
                 updated_at    = NOW()`,
          [
            result.item.reminderId,
            result.item.userId,
            result.item.alertType,
            result.item.channel,
            recipientKey,
            result.success ? "sent" : "retryable",
            result.success ? new Date() : null,
            result.success
              ? null
              : result.error instanceof Error
                ? result.error.message
                : String(result.error),
          ],
        )
        .catch((err: unknown) => {
          logger.warn(
            { err, reminderId: result.item.reminderId },
            "reminder-scheduler: failed to record per-recipient delivery row",
          );
        });
    }

    // Write backwards-compatible channel-level log rows.
    // Group results by (reminderId, alertType, channel).
    type ChannelKey = `${number}:${string}:${string}`;
    const byChannel = new Map<
      ChannelKey,
      { successes: number; failures: number; userId: number }
    >();
    for (const result of results) {
      const key: ChannelKey = `${result.item.reminderId}:${result.item.alertType}:${result.item.channel}`;
      const existing = byChannel.get(key) ?? {
        successes: 0,
        failures: 0,
        userId: result.item.userId,
      };
      if (result.success) existing.successes++;
      else existing.failures++;
      byChannel.set(key, existing);
    }

    for (const [key, counts] of byChannel) {
      const [remidStr, alertType, channel] = key.split(":") as [
        string,
        string,
        string,
      ];
      const reminderId = Number(remidStr);
      if (counts.failures > 0) {
        logger.warn(
          { reminderId, alertType, channel, ...counts },
          "reminder-scheduler: partial channel delivery — will retry failed recipients next run",
        );
        continue;
      }
      // All sends for this channel succeeded: mark channel as done.
      await recordClient
        .query(
          `INSERT INTO travels_reminder_alert_log (reminder_id, user_id, alert_type, channel)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (reminder_id, alert_type, channel) DO NOTHING`,
          [reminderId, counts.userId, alertType, channel],
        )
        .catch((err: unknown) => {
          logger.warn(
            { err, reminderId, alertType, channel },
            "reminder-scheduler: failed to write channel-level alert log row",
          );
        });

      logger.info(
        { reminderId, alertType, channel, recipientCount: counts.successes },
        "reminder-scheduler: channel alert fully delivered",
      );
    }
  } finally {
    recordClient.release();
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
export function startReminderScheduler(): () => void {
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
  return () => clearInterval(interval);
}
