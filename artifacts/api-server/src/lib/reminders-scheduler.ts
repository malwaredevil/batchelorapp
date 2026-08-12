import {
  pool,
  db,
  travelsTrips,
  travelsConnectedCalendars,
  reminders,
  reminderCalendarSyncState,
  elaineHistoryConversations,
  elaineHistoryMessages,
} from "@workspace/db";
import { inArray, eq, and } from "drizzle-orm";
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
import { getValidAccessToken } from "./google-calendar-tokens";
import { getCalendarEvent } from "./google-calendar";
import {
  fireCallContact,
  fireMessageContact,
} from "../elaine/communication-actions";

/**
 * Unified, entity-agnostic reminder delivery scheduler — replaces the old
 * Travels-only `reminder-scheduler.ts` (which read `travels_reminders` /
 * `travels_reminder_alert_log` directly). Operates purely against the
 * generic `reminders` / `reminder_deliveries` tables, so any module
 * (Travels, Elaine scheduled actions, Office Notes, collection detail pages,
 * etc.) that creates a row in `reminders` gets delivery for free.
 *
 * Handles the full spec (issue #514 shipped the non-recurring
 * email/SMS/call/Slack case; issue #516 adds everything below):
 *
 *   - Recurring reminders (interval, weekly-on-weekday, or monthly-on-day)
 *     advance to their next occurrence once the current one's deliveries
 *     all resolve — see advanceCompletedReminders().
 *   - Calendar-linked reminders (a reminder pointing at an existing event on
 *     a connected Travels calendar) are re-pulled each run so an edit or
 *     deletion made directly on Google Calendar is reflected before
 *     deliveries are computed — see syncCalendarLinkedReminders().
 *   - `elaine_action` reminders dispatch through the same
 *     communication-actions.ts executors (fireCallContact/fireMessageContact)
 *     the immediate (non-scheduled) path uses, via a synthetic
 *     "elaine_action" delivery channel — see the elaine_action branch in
 *     claimAndSendDueDeliveries().
 *   - The "messenger" channel (messengerRecipientUserIds) delivers an
 *     in-app Elaine-chat message, the same way deliverElaineChat() does for
 *     Elaine's own conversational replies.
 *
 * Two-phase design, mirroring the crash-safe pattern documented on the
 * `reminder_deliveries` table:
 *
 *   Phase A (scheduleDueDeliveries) — for every active, non-deleted reminder
 *     with a due date, compute one `reminder_deliveries` row per
 *     (lead time × channel × recipient) and insert it as `pending`.
 *     Idempotent via the table's dedup unique index
 *     (reminder_id, occurrence_key, channel, recipient_ref). The occurrence
 *     key embeds the reminder's current `recurrence_fired_count`, so once a
 *     recurring reminder advances to its next occurrence this phase
 *     naturally schedules a fresh set of delivery rows instead of treating
 *     them as already-delivered duplicates of the prior occurrence.
 *
 *   Phase B (claimAndSendDueDeliveries) — atomically claims any `pending`
 *     row whose `scheduled_for` has arrived (pending -> sending, using
 *     FOR UPDATE SKIP LOCKED so concurrent runs never double-claim), sends
 *     it, and records the outcome (`fired` or `failed`, no auto-retry — a
 *     stuck `sending` row is recovered as `failed` by
 *     recoverStuckSendingDeliveries on the next run, same as the crash
 *     recovery model documented on the table).
 *
 *   Phase C (advanceCompletedReminders) — once every delivery for a
 *     reminder's current occurrence has resolved (fired or failed), either
 *     marks it `done` (one-off reminders), or computes the next occurrence's
 *     `dueAt`, bumps `recurrence_fired_count`, and leaves it `active` for
 *     Phase A to pick up again next run (recurring reminders) — unless
 *     `recurrenceEndDate`/`recurrenceMaxOccurrences` has been reached, in
 *     which case it becomes `done` instead.
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

// Embeds the occurrence index (== the reminder's recurrence_fired_count at
// the time this delivery was scheduled) so a recurring reminder's next
// occurrence naturally gets its own fresh set of delivery rows instead of
// colliding with the dedup index on the prior occurrence's rows. Non-
// recurring reminders are always occurrence 0 for their one and only cycle.
function occurrenceKeyForLeadTime(lead: LeadTime, occurrence: number): string {
  return `occ${occurrence}:lead:${lead.value}${lead.unit}`;
}

// Every occurrence's rows share this "occN:" prefix regardless of which
// lead time or channel they're for — used by advanceCompletedReminders() to
// find all of a specific occurrence's deliveries without needing a separate
// column.
function occurrencePrefix(occurrence: number): string {
  return `occ${occurrence}:`;
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
  messenger_recipient_user_ids: number[];
  recurrence_fired_count: number;
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
              call_recipient_user_ids, slack_recipient_user_ids,
              messenger_recipient_user_ids, recurrence_fired_count
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
      const occurrence = reminder.recurrence_fired_count;

      for (const lead of leadTimes) {
        const scheduledFor = new Date(dueAtMs - leadTimeToMs(lead));
        const occurrenceKey = occurrenceKeyForLeadTime(lead, occurrence);

        const recipients: Array<{ channel: string; recipientRef: string }> =
          reminder.entity_type === "elaine_action"
            ? // elaine_action reminders carry no channel/recipient arrays —
              // #515 writes them empty because "delivery" for this entity
              // type means invoking the stored action itself (see the
              // elaine_action branch in claimAndSendDueDeliveries), not
              // sending to a channel recipient. One synthetic row per lead
              // time is enough to drive that dispatch through the same
              // claim/send/retry machinery every other channel uses.
              [{ channel: "elaine_action", recipientRef: "dispatch" }]
            : [
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
                ...reminder.messenger_recipient_user_ids.map((userId) => ({
                  channel: "messenger",
                  recipientRef: String(userId),
                })),
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

/**
 * "messenger" channel delivery — writes a message directly into the
 * recipient's Elaine conversation history so it appears in their chat
 * widget, the same way deliverElaineChat() in communication-actions.ts
 * delivers Elaine's own conversational replies (that function isn't reused
 * directly because it's keyed on a resolved `ResolvedContact`, not a bare
 * userId, and generic reminders have no such contact-resolution step).
 */
async function deliverGenericMessengerReminder(
  userId: number,
  message: string,
): Promise<void> {
  // Note: `message` is prebuilt by the caller (see the "messenger" branch
  // below), which already appends the calendar link line (issue #519) when
  // present — kept here rather than as a separate param since messenger
  // delivery has no fixed template, just a free-text body.
  let [conv] = await db
    .select({ id: elaineHistoryConversations.id })
    .from(elaineHistoryConversations)
    .where(
      and(
        eq(elaineHistoryConversations.userId, userId),
        eq(elaineHistoryConversations.isWidgetDefault, true),
      ),
    )
    .limit(1);

  if (!conv) {
    const [inserted] = await db
      .insert(elaineHistoryConversations)
      .values({ userId, isWidgetDefault: true, title: "Elaine" })
      .returning({ id: elaineHistoryConversations.id });
    conv = inserted;
  }
  if (!conv) {
    throw new Error(
      "deliverGenericMessengerReminder: could not find or create conversation",
    );
  }

  await db.insert(elaineHistoryMessages).values({
    conversationId: conv.id,
    userId,
    role: "assistant",
    content: message,
    channel: "web",
  });
  await db
    .update(elaineHistoryConversations)
    .set({ updatedAt: new Date() })
    .where(eq(elaineHistoryConversations.id, conv.id));
}

/**
 * Dispatches an `elaine_action` reminder's stored action through the same
 * executors communication-actions.ts uses for immediate (non-scheduled)
 * call_contact/message_contact requests, so scheduled and immediate
 * delivery never diverge in behavior. New elaineActionType values added to
 * communication-actions.ts in the future need a matching case here.
 */
async function dispatchElaineActionReminder(
  actionType: string | null,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (actionType === "call_contact") {
    return fireCallContact(String(p.contactName ?? ""), String(p.message ?? ""));
  }
  if (actionType === "message_contact") {
    const channel = (p.channel ??
      "auto") as "auto" | "sms" | "slack" | "email" | "elaine_chat";
    return fireMessageContact(
      String(p.contactName ?? ""),
      String(p.message ?? ""),
      channel,
    );
  }
  return {
    status: 500,
    body: { error: `unknown elaine_action_type: ${actionType}` },
  };
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
      // Reconstruct the lead time from the occurrence key
      // (`occN:lead:<value><unit>`) purely for the human-readable label —
      // safe to fall back to "now" if parsing ever fails.
      const match = /^occ\d+:lead:(\d+)(minutes|hours|days|weeks)$/.exec(
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
        // keep that query's shape simple. Also grabs google_event_html_link
        // (issue #519) so calendar-linked reminders can include a direct
        // link to the event.
        const [{ due_at: dueAtText, google_event_html_link: calendarEventUrl }] =
          (
            await pool.query<{
              due_at: string;
              google_event_html_link: string | null;
            }>(
              `SELECT due_at::text, google_event_html_link FROM reminders WHERE id = $1`,
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
          calendarEventUrl,
        );
      } else if (delivery.channel === "sms") {
        if (!smsEnabled) throw new Error("sms channel not configured");
        const phone = phoneMap.get(Number(delivery.recipient_ref));
        if (!phone) throw new Error("no verified phone on file");
        const [{ due_at: dueAtText, google_event_html_link: calendarEventUrl }] =
          (
            await pool.query<{
              due_at: string;
              google_event_html_link: string | null;
            }>(
              `SELECT due_at::text, google_event_html_link FROM reminders WHERE id = $1`,
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
          calendarEventUrl,
        );
      } else if (delivery.channel === "call") {
        if (!callsEnabled) throw new Error("call channel not configured");
        const phone = phoneMap.get(Number(delivery.recipient_ref));
        if (!phone) throw new Error("no verified phone on file");
        const [{ due_at: dueAtText, google_event_html_link: calendarEventUrl }] =
          (
            await pool.query<{
              due_at: string;
              google_event_html_link: string | null;
            }>(
              `SELECT due_at::text, google_event_html_link FROM reminders WHERE id = $1`,
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
            // Issue #519: mention the linked event exists, never speak its URL.
            !!calendarEventUrl,
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
            calendarEventUrl,
          );
        }
      } else if (delivery.channel === "slack") {
        if (!slackEnabled) throw new Error("slack channel not configured");
        const slackUserId = slackMap.get(Number(delivery.recipient_ref));
        if (!slackUserId) throw new Error("no slack user id on file");
        const [{ due_at: dueAtText, google_event_html_link: calendarEventUrl }] =
          (
            await pool.query<{
              due_at: string;
              google_event_html_link: string | null;
            }>(
              `SELECT due_at::text, google_event_html_link FROM reminders WHERE id = $1`,
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
          calendarEventUrl,
        );
      } else if (delivery.channel === "messenger") {
        const userId = Number(delivery.recipient_ref);
        const [{ google_event_html_link: calendarEventUrl }] = (
          await pool.query<{ google_event_html_link: string | null }>(
            `SELECT google_event_html_link FROM reminders WHERE id = $1`,
            [delivery.reminder_id],
          )
        ).rows;
        const body = delivery.reminder_description
          ? `${delivery.reminder_title}\n\n${delivery.reminder_description}`
          : delivery.reminder_title;
        const withContext = contextLabel ? `${body}\n\n${contextLabel}` : body;
        const message = calendarEventUrl
          ? `${withContext}\n\nCalendar event: ${calendarEventUrl}`
          : withContext;
        await deliverGenericMessengerReminder(userId, message);
      } else if (delivery.channel === "elaine_action") {
        // entity_type is always 'elaine_action' here (see the synthetic
        // recipients branch in scheduleDueDeliveries) — dispatch through
        // the same executors the immediate (non-scheduled) path uses, so
        // scheduled and immediate call_contact/message_contact behave
        // identically.
        const [{ elaine_action_type: actionType, elaine_action_payload: payload }] =
          (
            await pool.query<{
              elaine_action_type: string | null;
              elaine_action_payload: unknown;
            }>(
              `SELECT elaine_action_type, elaine_action_payload FROM reminders WHERE id = $1`,
              [delivery.reminder_id],
            )
          ).rows;
        const result = await dispatchElaineActionReminder(
          actionType,
          payload,
        );
        if (result.status >= 400) {
          const errBody = result.body as { error?: string } | null;
          throw new Error(
            errBody?.error ?? `elaine_action dispatch failed (${result.status})`,
          );
        }
      } else {
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
  const calendarSync = await syncCalendarLinkedReminders();
  const { remindersChecked, deliveriesScheduled } =
    await scheduleDueDeliveries();
  const { claimed, sent, failed } = await claimAndSendDueDeliveries();
  const { markedDone, advanced } = await advanceCompletedReminders();
  logger.info(
    {
      calendarChecked: calendarSync.checked,
      calendarUpdated: calendarSync.updated,
      calendarCancelled: calendarSync.cancelled,
      remindersChecked,
      deliveriesScheduled,
      claimed,
      sent,
      failed,
      markedDone,
      advanced,
    },
    "reminders-scheduler: run summary",
  );
}

type RecurrenceRow = {
  id: number;
  due_at: string;
  recurrence_interval_value: number | null;
  recurrence_interval_unit: string | null;
  recurrence_weekday: number | null;
  recurrence_day_of_month: number | null;
  recurrence_end_date: string | null;
  recurrence_max_occurrences: number | null;
  recurrence_fired_count: number;
};

/**
 * Computes the next `dueAt` for a recurring reminder, given the occurrence
 * that just completed. Returns null if the reminder isn't recurring, or has
 * reached its end condition (recurrenceEndDate / recurrenceMaxOccurrences)
 * — either case means the reminder should be marked `done` instead of
 * advanced. Only one of interval/weekday/day-of-month is expected to be set
 * per reminder (enforced at creation time, not here); if more than one is
 * present, interval wins, then weekday, then day-of-month.
 */
function computeNextOccurrence(reminder: RecurrenceRow): Date | null {
  const firedCount = reminder.recurrence_fired_count + 1; // this occurrence, about to complete
  if (
    reminder.recurrence_max_occurrences != null &&
    firedCount >= reminder.recurrence_max_occurrences
  ) {
    return null;
  }

  const currentDue = new Date(reminder.due_at);
  let next: Date | null = null;

  if (
    reminder.recurrence_interval_value != null &&
    reminder.recurrence_interval_unit
  ) {
    const unit = reminder.recurrence_interval_unit;
    const value = reminder.recurrence_interval_value;
    next = new Date(currentDue);
    switch (unit) {
      case "minutes":
        next.setMinutes(next.getMinutes() + value);
        break;
      case "hours":
        next.setHours(next.getHours() + value);
        break;
      case "days":
        next.setDate(next.getDate() + value);
        break;
      case "weeks":
        next.setDate(next.getDate() + value * 7);
        break;
      case "months":
        next.setMonth(next.getMonth() + value);
        break;
      case "years":
        next.setFullYear(next.getFullYear() + value);
        break;
      default:
        next = null;
    }
  } else if (reminder.recurrence_weekday != null) {
    // Next occurrence of the given weekday, always strictly in the future
    // relative to the current due date (adds 7 days if today already
    // matches, so a weekly reminder never re-fires the same day).
    next = new Date(currentDue);
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() !== reminder.recurrence_weekday);
  } else if (reminder.recurrence_day_of_month != null) {
    // Next month's occurrence of the given day-of-month. Clamps to the
    // month's last day if the target day doesn't exist (e.g. day 31 in
    // February) rather than overflowing into the following month.
    next = new Date(currentDue);
    next.setMonth(next.getMonth() + 1, 1);
    const daysInTargetMonth = new Date(
      next.getFullYear(),
      next.getMonth() + 1,
      0,
    ).getDate();
    next.setDate(Math.min(reminder.recurrence_day_of_month, daysInTargetMonth));
  }

  if (!next) return null;

  if (reminder.recurrence_end_date) {
    const end = new Date(`${reminder.recurrence_end_date}T23:59:59.999Z`);
    if (next.getTime() > end.getTime()) return null;
  }

  return next;
}

/**
 * Phase C: for every active reminder whose *current* occurrence has fully
 * resolved (every reminder_deliveries row under that occurrence's key
 * prefix is `fired` or `failed` — none still `pending`/`sending`), either
 * marks it `done` (non-recurring, or a recurring reminder that just hit its
 * end condition) or advances it to its next occurrence in place
 * (`due_at` + `recurrence_fired_count`++), leaving it `active` so
 * scheduleDueDeliveries() naturally picks up the new occurrence next run.
 *
 * Reminders with zero delivery rows for their current occurrence (e.g. an
 * elaine_action/channel reminder whose recipient arrays are all empty due
 * to misconfiguration) are treated as already-resolved rather than stuck
 * forever — same "don't hang the whole reminder on one broken row" logic
 * the crash-recovery path uses.
 */
export async function advanceCompletedReminders(): Promise<{
  markedDone: number;
  advanced: number;
}> {
  const { rows: active } = await pool.query<RecurrenceRow>(
    `SELECT id, due_at::text AS due_at, recurrence_interval_value,
            recurrence_interval_unit, recurrence_weekday,
            recurrence_day_of_month, recurrence_end_date::text AS recurrence_end_date,
            recurrence_max_occurrences, recurrence_fired_count
       FROM reminders
      WHERE status = 'active' AND deleted_at IS NULL AND due_at IS NOT NULL`,
  );

  let markedDone = 0;
  let advanced = 0;

  for (const reminder of active) {
    const prefix = occurrencePrefix(reminder.recurrence_fired_count);
    const { rows: pendingRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reminder_deliveries
        WHERE reminder_id = $1 AND occurrence_key LIKE $2 || '%'
          AND status IN ('pending', 'sending')`,
      [reminder.id, prefix],
    );
    if (Number(pendingRows[0]?.count ?? "0") > 0) continue; // still in flight

    const isRecurring =
      (reminder.recurrence_interval_value != null &&
        reminder.recurrence_interval_unit != null) ||
      reminder.recurrence_weekday != null ||
      reminder.recurrence_day_of_month != null;

    if (!isRecurring) {
      await pool.query(
        `UPDATE reminders SET status = 'done', updated_at = NOW() WHERE id = $1`,
        [reminder.id],
      );
      markedDone++;
      continue;
    }

    const nextDueAt = computeNextOccurrence(reminder);
    if (!nextDueAt) {
      await pool.query(
        `UPDATE reminders SET status = 'done', updated_at = NOW() WHERE id = $1`,
        [reminder.id],
      );
      markedDone++;
      continue;
    }

    await pool.query(
      `UPDATE reminders
          SET due_at = $2,
              recurrence_fired_count = recurrence_fired_count + 1,
              updated_at = NOW()
        WHERE id = $1`,
      [reminder.id, nextDueAt],
    );
    advanced++;
  }

  return { markedDone, advanced };
}

type CalendarLinkedReminder = {
  id: number;
  due_at: string;
  google_event_id: string;
  connected_calendar_user_id: number;
  google_calendar_id: string;
  last_synced_event_title: string | null;
  last_synced_event_start: string | null;
};

/**
 * Read-only pull sync for calendar-linked reminders (issue #516). The
 * generic reminders system deliberately never creates/updates/deletes
 * Google Calendar events itself (see the design-intent comment in
 * google-calendar.ts) — a reminder can only *link* to an event the user
 * already created elsewhere (e.g. via the Travels calendar UI). This
 * function re-pulls each linked event and:
 *   - updates `due_at` if the event's start time changed,
 *   - marks the reminder `cancelled` if the event was deleted,
 *   - otherwise just refreshes the sync-state bookkeeping row.
 * Runs before scheduleDueDeliveries() each tick so any change is reflected
 * before delivery rows are computed off the (possibly stale) due date.
 */
export async function syncCalendarLinkedReminders(): Promise<{
  checked: number;
  updated: number;
  cancelled: number;
}> {
  const { rows: linked } = await pool.query<CalendarLinkedReminder>(
    `SELECT r.id, r.due_at::text AS due_at, r.google_event_id,
            tcc.user_id AS connected_calendar_user_id,
            tcc.google_calendar_id,
            s.last_synced_event_title, s.last_synced_event_start::text AS last_synced_event_start
       FROM reminders r
       JOIN travels_connected_calendars tcc ON tcc.id = r.calendar_connection_id
       LEFT JOIN reminder_calendar_sync_state s ON s.reminder_id = r.id
      WHERE r.status = 'active' AND r.deleted_at IS NULL
        AND r.calendar_connection_id IS NOT NULL AND r.google_event_id IS NOT NULL`,
  );

  let updated = 0;
  let cancelled = 0;

  for (const reminder of linked) {
    try {
      const accessToken = await getValidAccessToken(
        reminder.connected_calendar_user_id,
      );
      if (!accessToken) {
        logger.warn(
          { reminderId: reminder.id },
          "reminders-scheduler: calendar-linked reminder has no valid access token, skipping sync",
        );
        continue;
      }

      const event = await getCalendarEvent(
        accessToken,
        reminder.google_calendar_id,
        reminder.google_event_id,
      );

      if (!event) {
        // Deleted on Google Calendar — cancel the reminder rather than
        // leaving it firing against a stale due date forever.
        await pool.query(
          `UPDATE reminders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [reminder.id],
        );
        cancelled++;
        continue;
      }

      const eventStart = event.start ? new Date(event.start) : null;
      const titleChanged = event.title !== reminder.last_synced_event_title;
      const startChanged =
        eventStart &&
        eventStart.getTime() !==
          (reminder.last_synced_event_start
            ? new Date(reminder.last_synced_event_start).getTime()
            : NaN);

      if (startChanged && eventStart) {
        await pool.query(
          `UPDATE reminders SET due_at = $2, updated_at = NOW() WHERE id = $1`,
          [reminder.id, eventStart],
        );
        updated++;
      }

      if (titleChanged || startChanged) {
        await pool.query(
          `INSERT INTO reminder_calendar_sync_state
             (reminder_id, last_synced_event_title, last_synced_event_start, last_checked_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (reminder_id) DO UPDATE
             SET last_synced_event_title = EXCLUDED.last_synced_event_title,
                 last_synced_event_start = EXCLUDED.last_synced_event_start,
                 last_checked_at = NOW()`,
          [reminder.id, event.title, eventStart],
        );
      } else {
        await pool.query(
          `UPDATE reminder_calendar_sync_state SET last_checked_at = NOW() WHERE reminder_id = $1`,
          [reminder.id],
        );
      }
    } catch (err) {
      logger.error(
        { err, reminderId: reminder.id },
        "reminders-scheduler: calendar re-sync failed for linked reminder",
      );
    }
  }

  return { checked: linked.length, updated, cancelled };
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
