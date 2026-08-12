import { pool, db, travelsTrips } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  sendGenericReminderAlertEmail,
  resendConfigured,
} from "./email";
import { sendGenericReminderAlertSms, smsConfigured } from "./sms";
import { sendGenericReminderAlertSlack, slackConfigured } from "./slack";
import {
  callsConfigured,
  initiateOutboundCall,
  buildGenericReminderCallScript,
} from "./calls";
import {
  shouldRunScheduledTask,
  recordScheduledTaskSuccess,
  recordScheduledTaskFailure,
} from "./scheduler-guard";
import { logger } from "./logger";

/**
 * Unified, entity-agnostic reminder delivery scheduler — replaces the old
 * Travels-only `reminder-scheduler.ts` (which read `travels_reminders` /
 * `travels_reminder_alert_log` directly). Operates purely against the
 * generic `reminders` / `reminder_deliveries` tables, so any module
 * (Travels, Elaine scheduled actions, Office Notes, collection detail pages,
 * etc.) that creates a row in `reminders` gets delivery for free.
 *
 * Scope note (issue #514): this first cut handles the common non-recurring
 * case — one or more fixed lead times before a single `dueAt`, delivered by
 * email/SMS/call/Slack. Recurrence, calendar re-sync, and `elaine_action`
 * entity dispatch are intentionally NOT handled here yet; they're additive
 * extensions of this same module (issue #516), not a rewrite — see the
 * `TODO(#516)` markers below for exactly where each hooks in.
 *
 * Two-phase design, mirroring the crash-safe pattern documented on the
 * `reminder_deliveries` table:
 *
 *   Phase A (scheduleDueDeliveries) — for every active, non-deleted reminder
 *     with a due date, compute one `reminder_deliveries` row per
 *     (lead time × channel × recipient) and insert it as `pending`.
 *     Idempotent via the table's dedup unique index
 *     (reminder_id, occurrence_key, channel, recipient_ref).
 *
 *   Phase B (claimAndSendDueDeliveries) — atomically claims any `pending`
 *     row whose `scheduled_for` has arrived (pending -> sending, using
 *     FOR UPDATE SKIP LOCKED so concurrent runs never double-claim), sends
 *     it, and records the outcome (`fired` or `failed`, no auto-retry — a
 *     stuck `sending` row is recovered as `failed` by
 *     recoverStuckSendingDeliveries on the next run, same as the crash
 *     recovery model documented on the table).
 */

type LeadTime = { value: number; unit: "minutes" | "hours" | "days" | "weeks" };

function leadTimeToMs(lead: LeadTime): number {
  switch (lead.unit) {
    case "minutes":
      return lead.value * 60_000;
    case "hours":
      return lead.value * 3_600_000;
    case "days":
      return lead.value * 86_400_000;
    case "weeks":
      return lead.value * 7 * 86_400_000;
    default:
      return 0;
  }
}

function occurrenceKeyForLeadTime(lead: LeadTime): string {
  return `lead:${lead.value}${lead.unit}`;
}

function alertLabelForLeadTime(lead: LeadTime): string {
  if (lead.value === 0) return "now";
  const unitLabel =
    lead.value === 1 ? lead.unit.replace(/s$/, "") : lead.unit;
  return `${lead.value} ${unitLabel}`;
}

// How far ahead of "now" we're willing to pre-schedule pending delivery
// rows. Bounds the Phase A query/insert volume; re-running it on every tick
// simply re-discovers the same due reminders (cheap, dedup'd by the unique
// index) until their due date actually falls inside this window.
const SCHEDULING_LOOKAHEAD_MS = 95 * 24 * 60 * 60 * 1000; // ~95 days

// A `sending` row older than this with no terminal status is assumed to be
// an orphan from a crashed/restarted process, not an in-flight send — real
// sends (a single Resend/AgentPhone/Slack API call) never take this long.
const STUCK_SENDING_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Best-effort resolver for a short "attached to X" label shown alongside a
 * reminder's alert. Returns undefined for reminders with no entity link, or
 * an entity type this scheduler doesn't yet know how to describe — omitting
 * the context line is always safe. Extend with one `case` per new
 * entityType as later issues wire reminders into more record types
 * (#522/#523).
 */
async function resolveEntityContextLabel(
  entityType: string | null,
  entityId: number | null,
): Promise<string | undefined> {
  if (!entityType || entityId == null) return undefined;
  if (entityType === "travels_trip") {
    const [trip] = await db
      .select({ title: travelsTrips.title, destination: travelsTrips.destination })
      .from(travelsTrips)
      .where(inArray(travelsTrips.id, [entityId]));
    if (!trip) return undefined;
    return `Trip: ${trip.title} → ${trip.destination}`;
  }
  // TODO(#516/#522/#523): add cases for elaine_action, office_note,
  // pottery_item, quilting_fabric, ornaments_item, etc. as those entity
  // types start creating reminders.
  return undefined;
}

type CandidateReminder = {
  id: number;
  entity_type: string | null;
  entity_id: number | null;
  title: string;
  description: string | null;
  due_at: string;
  lead_times: LeadTime[];
  email_recipients: string[];
  sms_recipient_user_ids: number[];
  call_recipient_user_ids: number[];
  slack_recipient_user_ids: number[];
};

/**
 * Phase A: inserts one `pending` reminder_deliveries row per
 * (lead time × channel × recipient) for every active reminder whose due
 * date falls inside the lookahead window. Safe to call repeatedly — the
 * dedup unique index makes re-insertion a no-op.
 */
export async function scheduleDueDeliveries(): Promise<{
  remindersChecked: number;
  deliveriesScheduled: number;
}> {
  const client = await pool.connect();
  let remindersChecked = 0;
  let deliveriesScheduled = 0;
  try {
    const { rows: candidates } = await client.query<CandidateReminder>(
      `SELECT id, entity_type, entity_id, title, description,
              due_at::text AS due_at, lead_times,
              email_recipients, sms_recipient_user_ids,
              call_recipient_user_ids, slack_recipient_user_ids
         FROM reminders
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND due_at IS NOT NULL
          AND due_at <= NOW() + INTERVAL '${SCHEDULING_LOOKAHEAD_MS} milliseconds'`,
    );
    remindersChecked = candidates.length;

    for (const reminder of candidates) {
      const dueAtMs = new Date(reminder.due_at).getTime();
      const leadTimes = Array.isArray(reminder.lead_times)
        ? reminder.lead_times
        : [];

      for (const lead of leadTimes) {
        const scheduledFor = new Date(dueAtMs - leadTimeToMs(lead));
        const occurrenceKey = occurrenceKeyForLeadTime(lead);

        const recipients: Array<{ channel: string; recipientRef: string }> =
          [
            ...reminder.email_recipients.map((email) => ({
              channel: "email",
              recipientRef: email,
            })),
            ...reminder.sms_recipient_user_ids.map((userId) => ({
              channel: "sms",
              recipientRef: String(userId),
            })),
            ...reminder.call_recipient_user_ids.map((userId) => ({
              channel: "call",
              recipientRef: String(userId),
            })),
            ...reminder.slack_recipient_user_ids.map((userId) => ({
              channel: "slack",
              recipientRef: String(userId),
            })),
            // TODO(#516): messenger_recipient_user_ids -> channel "messenger"
            // once an in-app delivery path exists for generic reminders.
          ];

        for (const { channel, recipientRef } of recipients) {
          const result = await client.query(
            `INSERT INTO reminder_deliveries
               (reminder_id, occurrence_key, channel, recipient_ref, scheduled_for, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (reminder_id, occurrence_key, channel, recipient_ref) DO NOTHING`,
            [reminder.id, occurrenceKey, channel, recipientRef, scheduledFor],
          );
          deliveriesScheduled += result.rowCount ?? 0;
        }
      }
    }
  } finally {
    client.release();
  }

  return { remindersChecked, deliveriesScheduled };
}

/**
 * Crash recovery: any delivery stuck in `sending` past
 * STUCK_SENDING_TIMEOUT_MS is assumed orphaned by a killed/restarted process
 * (not an in-flight send) and marked `failed` — no auto-retry, matching the
 * table's documented no-double-send guarantee.
 */
async function recoverStuckSendingDeliveries(): Promise<number> {
  const result = await pool.query(
    `UPDATE reminder_deliveries
        SET status = 'failed',
            error = 'recovered: stuck in sending past timeout (process likely restarted mid-send)'
      WHERE status = 'sending'
        AND created_at < NOW() - INTERVAL '${STUCK_SENDING_TIMEOUT_MS} milliseconds'`,
  );
  return result.rowCount ?? 0;
}

type ClaimedDelivery = {
  id: number;
  reminder_id: number;
  channel: string;
  recipient_ref: string;
  reminder_title: string;
  reminder_description: string | null;
  entity_type: string | null;
  entity_id: number | null;
  occurrence_key: string;
};

const CLAIM_BATCH_SIZE = 200;

/**
 * Phase B: atomically claims due `pending` deliveries (FOR UPDATE SKIP
 * LOCKED so concurrent scheduler ticks/instances never double-claim), sends
 * each one, and records `fired`/`failed`.
 */
export async function claimAndSendDueDeliveries(): Promise<{
  claimed: number;
  sent: number;
  failed: number;
}> {
  await recoverStuckSendingDeliveries();

  const claimClient = await pool.connect();
  let claimed: ClaimedDelivery[] = [];
  try {
    const { rows } = await claimClient.query<ClaimedDelivery>(
      `UPDATE reminder_deliveries d
          SET status = 'sending'
        WHERE d.id IN (
          SELECT id FROM reminder_deliveries
           WHERE status = 'pending' AND scheduled_for <= NOW()
           ORDER BY scheduled_for
           LIMIT ${CLAIM_BATCH_SIZE}
           FOR UPDATE SKIP LOCKED
        )
        RETURNING d.id, d.reminder_id, d.channel, d.recipient_ref,
                  d.occurrence_key,
                  (SELECT r.title FROM reminders r WHERE r.id = d.reminder_id) AS reminder_title,
                  (SELECT r.description FROM reminders r WHERE r.id = d.reminder_id) AS reminder_description,
                  (SELECT r.entity_type FROM reminders r WHERE r.id = d.reminder_id) AS entity_type,
                  (SELECT r.entity_id FROM reminders r WHERE r.id = d.reminder_id) AS entity_id`,
    );
    claimed = rows;
  } finally {
    claimClient.release();
  }

  if (claimed.length === 0) {
    return { claimed: 0, sent: 0, failed: 0 };
  }

  const emailEnabled = resendConfigured();
  const smsEnabled = smsConfigured();
  const slackEnabled = slackConfigured();
  const callsEnabled = callsConfigured();

  // Pre-fetch phone/Slack lookups for all claimed user-id recipients.
  const smsCallUserIds = [
    ...new Set(
      claimed
        .filter((d) => d.channel === "sms" || d.channel === "call")
        .map((d) => Number(d.recipient_ref)),
    ),
  ];
  const slackUserIds = [
    ...new Set(
      claimed
        .filter((d) => d.channel === "slack")
        .map((d) => Number(d.recipient_ref)),
    ),
  ];
  const phoneMap = new Map<number, string>();
  const slackMap = new Map<number, string>();
  if (smsCallUserIds.length > 0) {
    const { rows } = await pool.query<{ id: number; phone_number: string }>(
      `SELECT id, phone_number FROM app_users
        WHERE id = ANY($1::int[]) AND phone_verified = true AND phone_number IS NOT NULL`,
      [smsCallUserIds],
    );
    for (const row of rows) phoneMap.set(row.id, row.phone_number);
  }
  if (slackUserIds.length > 0) {
    const { rows } = await pool.query<{ id: number; slack_user_id: string }>(
      `SELECT id, slack_user_id FROM app_users
        WHERE id = ANY($1::int[]) AND slack_user_id IS NOT NULL`,
      [slackUserIds],
    );
    for (const row of rows) slackMap.set(row.id, row.slack_user_id);
  }

  // Cache one context label per (entityType, entityId) so a reminder with
  // many recipients only resolves it once.
  const contextLabelCache = new Map<string, string | undefined>();
  async function getContextLabel(
    entityType: string | null,
    entityId: number | null,
  ): Promise<string | undefined> {
    const key = `${entityType ?? ""}:${entityId ?? ""}`;
    if (!contextLabelCache.has(key)) {
      contextLabelCache.set(
        key,
        await resolveEntityContextLabel(entityType, entityId),
      );
    }
    return contextLabelCache.get(key);
  }

  let sent = 0;
  let failed = 0;

  for (const delivery of claimed) {
    let outcome: { success: true } | { success: false; error: unknown };
    try {
      // Reconstruct the lead time from the occurrence key (`lead:<value><unit>`)
      // purely for the human-readable label — safe to fall back to "now" if
      // parsing ever fails (e.g. a future occurrence-key scheme from #516).
      const match = /^lead:(\d+)(minutes|hours|days|weeks)$/.exec(
        delivery.occurrence_key,
      );
      const label = match
        ? alertLabelForLeadTime({
            value: Number(match[1]),
            unit: match[2] as LeadTime["unit"],
          })
        : "now";
      const contextLabel = await getContextLabel(
        delivery.entity_type,
        delivery.entity_id,
      );

      if (delivery.channel === "email") {
        if (!emailEnabled) throw new Error("email channel not configured");
        // Need dueAt for the email body's formatted date — re-select it
        // rather than threading it through the claim query's RETURNING to
        // keep that query's shape simple.
        const [{ due_at: dueAtText }] = (
          await pool.query<{ due_at: string }>(
            `SELECT due_at::text FROM reminders WHERE id = $1`,
            [delivery.reminder_id],
          )
        ).rows;
        await sendGenericReminderAlertEmail(
          delivery.recipient_ref,
          delivery.reminder_title,
          delivery.reminder_description,
          new Date(dueAtText),
          label,
          contextLabel,
        );
      } else if (delivery.channel === "sms") {
        if (!smsEnabled) throw new Error("sms channel not configured");
        const phone = phoneMap.get(Number(delivery.recipient_ref));
        if (!phone) throw new Error("no verified phone on file");
        const [{ due_at: dueAtText }] = (
          await pool.query<{ due_at: string }>(
            `SELECT due_at::text FROM reminders WHERE id = $1`,
            [delivery.reminder_id],
          )
        ).rows;
        const formattedDate = new Date(dueAtText).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        await sendGenericReminderAlertSms(
          phone,
          delivery.reminder_title,
          label,
          formattedDate,
          contextLabel,
        );
      } else if (delivery.channel === "call") {
        if (!callsEnabled) throw new Error("call channel not configured");
        const phone = phoneMap.get(Number(delivery.recipient_ref));
        if (!phone) throw new Error("no verified phone on file");
        const [{ due_at: dueAtText }] = (
          await pool.query<{ due_at: string }>(
            `SELECT due_at::text FROM reminders WHERE id = $1`,
            [delivery.reminder_id],
          )
        ).rows;
        const formattedDate = new Date(dueAtText).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        try {
          const initialGreeting = buildGenericReminderCallScript(
            delivery.reminder_title,
            label,
            formattedDate,
            contextLabel ? `, for your ${contextLabel.toLowerCase()}` : "",
          );
          await initiateOutboundCall({
            toNumber: phone,
            initialGreeting,
            callScreeningPurpose: `Reminder: ${delivery.reminder_title}`,
          });
        } catch (callErr) {
          logger.warn(
            { err: callErr, deliveryId: delivery.id },
            "reminders-scheduler: outbound call failed — falling back to SMS",
          );
          await sendGenericReminderAlertSms(
            phone,
            delivery.reminder_title,
            label,
            formattedDate,
            contextLabel,
          );
        }
      } else if (delivery.channel === "slack") {
        if (!slackEnabled) throw new Error("slack channel not configured");
        const slackUserId = slackMap.get(Number(delivery.recipient_ref));
        if (!slackUserId) throw new Error("no slack user id on file");
        const [{ due_at: dueAtText }] = (
          await pool.query<{ due_at: string }>(
            `SELECT due_at::text FROM reminders WHERE id = $1`,
            [delivery.reminder_id],
          )
        ).rows;
        const formattedDate = new Date(dueAtText).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        await sendGenericReminderAlertSlack(
          slackUserId,
          delivery.reminder_title,
          label,
          formattedDate,
          contextLabel,
        );
      } else {
        // TODO(#516): "messenger" channel dispatch.
        throw new Error(`unsupported channel: ${delivery.channel}`);
      }
      outcome = { success: true };
    } catch (err) {
      outcome = { success: false, error: err };
      logger.error(
        { err, deliveryId: delivery.id, channel: delivery.channel },
        "reminders-scheduler: failed to send delivery",
      );
    }

    if (outcome.success) {
      sent++;
      await pool.query(
        `UPDATE reminder_deliveries SET status = 'fired', fired_at = NOW() WHERE id = $1`,
        [delivery.id],
      );
    } else {
      failed++;
      await pool.query(
        `UPDATE reminder_deliveries SET status = 'failed', error = $2 WHERE id = $1`,
        [
          delivery.id,
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error),
        ],
      );
    }
  }

  return { claimed: claimed.length, sent, failed };
}

/**
 * Runs both phases in sequence — the single entry point used by both the
 * in-process fallback timer and the Scheduled Deployment cron script.
 */
export async function runReminderDeliveries(): Promise<void> {
  const { remindersChecked, deliveriesScheduled } =
    await scheduleDueDeliveries();
  const { claimed, sent, failed } = await claimAndSendDueDeliveries();
  logger.info(
    { remindersChecked, deliveriesScheduled, claimed, sent, failed },
    "reminders-scheduler: run summary",
  );
}

const IN_PROCESS_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Best-effort, in-process fallback: runs on startup and every 15 minutes
 * while this server instance happens to be warm. This alone is NOT
 * sufficient to guarantee delivery — on `autoscale` deployments the
 * instance can be fully asleep for long stretches. Reliable delivery is
 * provided by a separate Replit Scheduled Deployment invoking
 * `pnpm run send-reminder-alerts` (see
 * artifacts/api-server/src/scripts/send-reminder-alerts.ts), which runs
 * independently of whether the web server instance is awake. The
 * reminder_deliveries dedup index makes both paths safely idempotent.
 */
export function startRemindersScheduler(): () => void {
  const run = async (): Promise<void> => {
    if (
      !(await shouldRunScheduledTask(
        "reminders-scheduler",
        IN_PROCESS_INTERVAL_MS,
      ))
    ) {
      logger.info(
        "reminders-scheduler: skipped (ran within the last 15 minutes)",
      );
      return;
    }
    const t0 = Date.now();
    logger.info("reminders-scheduler: run starting");
    try {
      await runReminderDeliveries();
      logger.info(
        { durationMs: Date.now() - t0 },
        "reminders-scheduler: run complete",
      );
      await recordScheduledTaskSuccess("reminders-scheduler");
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "reminders-scheduler: run failed",
      );
      recordScheduledTaskFailure("reminders-scheduler");
    }
  };

  void run();

  const interval = setInterval(() => void run(), IN_PROCESS_INTERVAL_MS);
  interval.unref();

  logger.info(
    "reminders-scheduler: started (in-process fallback, runs every 15 minutes)",
  );
  return () => clearInterval(interval);
}
