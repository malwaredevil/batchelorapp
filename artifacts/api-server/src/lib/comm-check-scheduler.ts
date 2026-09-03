import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, pool, appUsers } from "@workspace/db";
import { sendSms } from "./sms";
import { openDmChannel, postSlackMessage, slackConfigured } from "./slack";
import { logger } from "./logger";
import { getConfig, type DayListCode } from "./app-config";
import { isValidIanaTimeZone } from "./timezone";
import {
  initiateOutboundCall,
  callsConfigured,
  waitForCallOutcome,
} from "./calls";

// ---------------------------------------------------------------------------
// Daily comms check scheduler.
//
// Email, SMS, and Slack fire once per day at a configurable time + set of
// weekdays. Phone call fires separately on its own configurable time + days.
// Both schedules are interpreted in the owner account's timezone
// (app_users.timezone), falling back to Europe/Berlin when unset — see
// getEffectiveTimezone(). The schedule itself lives in app_config under the
// "comm_check" module (daily_time/daily_days/phone_time/phone_days),
// editable from the owner panel.
//
// Any reply from the owner on email/SMS/Slack marks that channel "verified".
// Phone has no reply-based verification — call placed = success (sent).
//
// Response detection is handled by the inbound webhook handlers:
//   - routes/agentphone.ts  → markCommCheckVerified("sms")
//   - routes/elaine-email.ts → markCommCheckVerified("email")
//   - routes/slack.ts        → markCommCheckVerified("slack")
// ---------------------------------------------------------------------------

// ── Timezone / date / time helpers ──────────────────────────────────────────

const DEFAULT_TIMEZONE = "Europe/Berlin";

// Resolves the timezone the comm-check schedule should run in: the owner
// account's `timezone` field if set and valid, otherwise DEFAULT_TIMEZONE.
// Read it fresh so an owner timezone change takes effect on the next poll.
export async function getEffectiveTimezone(): Promise<string> {
  const [owner] = await db
    .select({ timezone: appUsers.timezone })
    .from(appUsers)
    .where(eq(appUsers.isOwner, true))
    .limit(1);
  const tz =
    owner?.timezone && isValidIanaTimeZone(owner.timezone)
      ? owner.timezone
      : DEFAULT_TIMEZONE;
  return tz;
}

// Returns today's date string in the given timezone as "YYYY-MM-DD".
// sv-SE locale natively formats to ISO date order.
function getDateStringInTz(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Returns minutes since midnight in the given timezone (0–1439).
function getMinuteOfDayInTz(tz: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(
    parts.find((p) => p.type === "minute")?.value ?? "0",
    10,
  );
  return hour * 60 + minute;
}

const WEEKDAY_TO_CODE: Record<string, DayListCode> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

// Returns today's weekday code ("sun".."sat") in the given timezone.
function getWeekdayCodeInTz(tz: string, now: Date = new Date()): DayListCode {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(now);
  return WEEKDAY_TO_CODE[short] ?? "sun";
}

// Parses an "HH:MM" string into minutes since midnight. Falls back to 0 for
// malformed input (should not happen — values are validated on write via
// validateConfigValue's "time" case).
function parseTimeToMinutes(hhmm: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return 0;
  return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
}

// Parses a comma-separated day-list config value into a Set of day codes.
function parseDayList(csv: string): Set<string> {
  return new Set(
    csv
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0),
  );
}

export interface CommCheckSchedule {
  dailyTime: string;
  dailyDays: string;
  phoneTime: string;
  phoneDays: string;
}

export interface CommCheckScheduleDecision {
  date: string;
  weekday: DayListCode;
  minuteOfDay: number;
  dailyDue: boolean;
  phoneDue: boolean;
}

export function getCommCheckScheduleDecision(
  now: Date,
  timezone: string,
  schedule: CommCheckSchedule,
): CommCheckScheduleDecision {
  const weekday = getWeekdayCodeInTz(timezone, now);
  const minuteOfDay = getMinuteOfDayInTz(timezone, now);
  return {
    date: getDateStringInTz(timezone, now),
    weekday,
    minuteOfDay,
    dailyDue:
      parseDayList(schedule.dailyDays).has(weekday) &&
      minuteOfDay >= parseTimeToMinutes(schedule.dailyTime),
    phoneDue:
      parseDayList(schedule.phoneDays).has(weekday) &&
      minuteOfDay >= parseTimeToMinutes(schedule.phoneTime),
  };
}

// Resolves today's date string using the effective (owner) timezone.
export async function getEffectiveDateString(now?: Date): Promise<string> {
  const tz = await getEffectiveTimezone();
  return getDateStringInTz(tz, now);
}

// ── Response verification ─────────────────────────────────────────────────────
// Called by inbound webhook handlers (agentphone / elaine-email / slack).
// Marks today's comm check for the given channel as 'verified' if it is
// currently in 'sent' state. Safe to call on every inbound message — it is
// a no-op when the check has not been sent yet or is already verified.
export async function markCommCheckVerified(
  channel: "email" | "sms" | "slack",
): Promise<void> {
  const today = await getEffectiveDateString();
  // Column names are constructed from a safe typed enum — not user input.
  const statusCol = `${channel}_status`;
  const verifiedAtCol = `${channel}_verified_at`;
  await pool.query(
    `UPDATE comm_checks
     SET ${statusCol} = 'verified', ${verifiedAtCol} = NOW()
     WHERE check_date = $1 AND ${statusCol} = 'sent'`,
    [today],
  );
}

// ── Owner lookup ──────────────────────────────────────────────────────────────

interface OwnerInfo {
  id: number;
  email: string | null;
  phoneNumber: string | null;
  slackUserId: string | null;
}

async function getOwner(): Promise<OwnerInfo | null> {
  const [owner] = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      phoneNumber: appUsers.phoneNumber,
      slackUserId: appUsers.slackUserId,
    })
    .from(appUsers)
    .where(eq(appUsers.isOwner, true))
    .limit(1);
  return owner ?? null;
}

// ── Per-channel senders ───────────────────────────────────────────────────────

async function sendCommCheckEmail(
  toEmail: string,
  date: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const from = await getConfig(
    "email",
    "general_from_email",
    "Batchelor App <elaine@app.batchelor.app>",
  );
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: toEmail,
    subject: `Batchelor App comms check — ${date}`,
    text: [
      `Daily comms check for ${date}.`,
      ``,
      `Reply to this email with anything to confirm this channel is working.`,
      ``,
      `— Batchelor App`,
    ].join("\n"),
  });
  if (error)
    throw new Error(
      `Resend error: ${(error as { message?: string }).message ?? String(error)}`,
    );
}

async function sendCommCheckSms(toNumber: string, date: string): Promise<void> {
  await sendSms(
    toNumber,
    `Batchelor App daily comms check — ${date}. Reply with anything to confirm this channel is working.`,
  );
}

async function sendCommCheckSlack(
  slackUserId: string,
  date: string,
): Promise<void> {
  if (!slackConfigured()) {
    throw new Error(
      "Slack not configured (SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET missing)",
    );
  }
  const channelId = await openDmChannel(slackUserId);
  await postSlackMessage(
    channelId,
    `📡 *Batchelor App daily comms check — ${date}*\nReply with anything to confirm this Slack channel is working.`,
  );
}

// Returns a time-of-day-appropriate sign-off ("Have a great morning/
// afternoon/evening!") based on the actual clock time in the owner's
// effective timezone at the moment the call is placed — not the time the
// check happened to be scheduled for.
async function getTimeOfDaySignoff(now: Date = new Date()): Promise<string> {
  const tz = await getEffectiveTimezone();
  const minuteOfDay = getMinuteOfDayInTz(tz, now);
  const hour = Math.floor(minuteOfDay / 60);
  if (hour < 12) return "Have a great morning!";
  if (hour < 18) return "Have a great afternoon!";
  return "Have a great evening!";
}

// Phone comms check — places the call and returns the AgentPhone call ID so
// callers can verify the call actually connected (duration > 0).
async function sendCommCheckPhone(
  toNumber: string,
  date: string,
): Promise<{ callId: string }> {
  if (!callsConfigured()) {
    throw new Error("AgentPhone connector not configured");
  }
  const signoff = await getTimeOfDaySignoff();
  return initiateOutboundCall({
    toNumber,
    initialGreeting: `Hi! This is your daily Batchelor App communications check for ${date}. The phone lane is working correctly. ${signoff}`,
    callScreeningIdentity: "Elaine from Batchelor App",
    callScreeningPurpose: "daily communications test",
  });
}

// ── Core run function (email / SMS / Slack) ──────────────────────────────────
// The date row is only a ledger. Each channel claims and records its own state,
// so a phone attempt or successful sibling channel cannot consume the day.

export interface CommCheckResult {
  alreadyRan: boolean;
  date: string;
  email: string;
  sms: string;
  slack: string;
}

type DailyChannel = "email" | "sms" | "slack";
const STALE_CHANNEL_ATTEMPT_MINUTES = 15;
const CHANNEL_DELIVERY_TIMEOUT_MS = 60_000;

async function withDeliveryTimeout<T>(
  operation: Promise<T>,
  channel: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `${channel} delivery timed out after ${CHANNEL_DELIVERY_TIMEOUT_MS / 1_000} seconds`,
              ),
            ),
          CHANNEL_DELIVERY_TIMEOUT_MS,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runDailyChannel(
  channel: DailyChannel,
  today: string,
  owner: OwnerInfo | null,
): Promise<{ attempted: boolean; result: string }> {
  const statusCol = `${channel}_status`;
  const sentAtCol = `${channel}_sent_at`;
  const errorCol = `${channel}_error`;
  const attemptId = randomUUID();
  const claim = await pool.query<{ check_date: string }>(
    `UPDATE comm_checks
     SET ${statusCol} = 'sending', ${sentAtCol} = NOW(), ${errorCol} = $2
     WHERE check_date = $1
       AND (
         ${statusCol} IN ('pending', 'error')
         OR (
           ${statusCol} = 'sending'
           AND (${sentAtCol} IS NULL OR ${sentAtCol} < NOW() - INTERVAL '${STALE_CHANNEL_ATTEMPT_MINUTES} minutes')
         )
       )
     RETURNING check_date`,
    [today, attemptId],
  );
  if ((claim.rowCount ?? 0) === 0) {
    return { attempted: false, result: "already sent" };
  }

  try {
    if (!owner) throw new Error("No owner account");
    if (channel === "email") {
      if (!owner.email) throw new Error("No email on owner account");
      await withDeliveryTimeout(
        sendCommCheckEmail(owner.email, today),
        channel,
      );
    } else if (channel === "sms") {
      if (!owner.phoneNumber)
        throw new Error("No phone number on owner account");
      await withDeliveryTimeout(
        sendCommCheckSms(owner.phoneNumber, today),
        channel,
      );
    } else {
      if (!owner.slackUserId)
        throw new Error("No Slack user ID on owner account");
      await withDeliveryTimeout(
        sendCommCheckSlack(owner.slackUserId, today),
        channel,
      );
    }
    await pool.query(
      `UPDATE comm_checks
       SET ${statusCol} = 'sent', ${sentAtCol} = NOW(), ${errorCol} = NULL
       WHERE check_date = $1
         AND ${statusCol} = 'sending'
         AND ${errorCol} = $2`,
      [today, attemptId],
    );
    logger.info({ date: today, channel }, "comm-check: channel sent");
    return { attempted: true, result: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE comm_checks
       SET ${statusCol} = 'error', ${sentAtCol} = NULL, ${errorCol} = $2
       WHERE check_date = $1
         AND ${statusCol} = 'sending'
         AND ${errorCol} = $3`,
      [today, msg, attemptId],
    );
    logger.error(
      { err, date: today, channel },
      "comm-check: channel send failed",
    );
    return { attempted: true, result: `error: ${msg}` };
  }
}

export async function runDailyCommCheck(): Promise<CommCheckResult> {
  const today = await getEffectiveDateString();

  await pool.query(
    `INSERT INTO comm_checks (check_date)
     VALUES ($1)
     ON CONFLICT (check_date) DO NOTHING`,
    [today],
  );

  const owner = await getOwner();
  if (!owner) {
    logger.warn("comm-check: no owner account found, cannot send checks");
  }

  const email = await runDailyChannel("email", today, owner);
  const sms = await runDailyChannel("sms", today, owner);
  const slack = await runDailyChannel("slack", today, owner);
  return {
    alreadyRan: !email.attempted && !sms.attempted && !slack.attempted,
    date: today,
    email: email.result,
    sms: sms.result,
    slack: slack.result,
  };
}

// ── Phone-only run function (fires at 19:00) ──────────────────────────────────
// Ensures today's row exists, then atomically claims the phone slot. Failed or
// stale in-progress attempts are retryable; confirmed sent attempts are not.

export interface PhoneCheckResult {
  alreadySent: boolean;
  date: string;
  phone: string;
}

export async function runPhoneCommCheck(): Promise<PhoneCheckResult> {
  const today = await getEffectiveDateString();

  // Ensure today's row exists (may have been inserted at 00:01 already).
  await pool.query(
    `INSERT INTO comm_checks (check_date) VALUES ($1) ON CONFLICT (check_date) DO NOTHING`,
    [today],
  );

  const attemptId = randomUUID();
  const claim = await pool.query<{ check_date: string }>(
    `UPDATE comm_checks
     SET phone_status = 'sending', phone_sent_at = NOW(), phone_error = $2
     WHERE check_date = $1
       AND (
         phone_status IN ('pending', 'error')
         OR (
           phone_status = 'sending'
           AND (phone_sent_at IS NULL OR phone_sent_at < NOW() - INTERVAL '${STALE_CHANNEL_ATTEMPT_MINUTES} minutes')
         )
       )
     RETURNING check_date`,
    [today, attemptId],
  );

  if ((claim.rowCount ?? 0) === 0) {
    return { alreadySent: true, date: today, phone: "n/a" };
  }

  try {
    const owner = await getOwner();
    if (!owner || !owner.phoneNumber) {
      throw new Error(
        owner ? "No phone number on owner account" : "No owner account",
      );
    }
    const { callId } = await withDeliveryTimeout(
      sendCommCheckPhone(owner.phoneNumber, today),
      "phone",
    );
    // Confirm the call actually connected (AgentPhone marks blocked/screened
    // calls as "completed" with durationSeconds: 0). If no-answer, roll the
    // status back to error so the scheduler catches it on the next daily run.
    const outcome = await waitForCallOutcome(callId, 30_000);
    if (outcome === "no-answer") {
      throw new Error(
        "Call placed but not answered (0 s — likely blocked by call screening). " +
          "Add Elaine's number to your contacts to allow it through.",
      );
    }
    await pool.query(
      `UPDATE comm_checks
       SET phone_status = 'sent', phone_sent_at = NOW(), phone_error = NULL
       WHERE check_date = $1
         AND phone_status = 'sending'
         AND phone_error = $2`,
      [today, attemptId],
    );
    logger.info({ date: today }, "comm-check: phone call placed");
    return { alreadySent: false, date: today, phone: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE comm_checks
       SET phone_status = 'error', phone_sent_at = NULL, phone_error = $2
       WHERE check_date = $1
         AND phone_status = 'sending'
         AND phone_error = $3`,
      [today, msg, attemptId],
    );
    logger.error({ err, date: today }, "comm-check: phone call failed");
    return { alreadySent: false, date: today, phone: `error: ${msg}` };
  }
}

// ── Single-channel send ───────────────────────────────────────────────────────
// Ensures today's row exists, then (re)sends a single channel regardless of
// its current status. Intended for manual "Send now" triggers from the UI.

export interface ChannelCheckResult {
  date: string;
  channel: "email" | "sms" | "slack" | "phone";
  result: string;
}

export async function runChannelCheck(
  channel: "email" | "sms" | "slack" | "phone",
): Promise<ChannelCheckResult> {
  const today = await getEffectiveDateString();

  // Ensure today's row exists (insert if not already present).
  await pool.query(
    `INSERT INTO comm_checks (check_date) VALUES ($1) ON CONFLICT (check_date) DO NOTHING`,
    [today],
  );

  const owner = await getOwner();
  if (!owner) {
    const msg = "No owner account";
    const statusCol = `${channel}_status`;
    const errorCol = `${channel}_error`;
    await pool.query(
      `UPDATE comm_checks SET ${statusCol} = 'error', ${errorCol} = $2 WHERE check_date = $1`,
      [today, msg],
    );
    return { date: today, channel, result: `error: ${msg}` };
  }

  try {
    if (channel === "email") {
      if (!owner.email) throw new Error("No email on owner account");
      await sendCommCheckEmail(owner.email, today);
    } else if (channel === "sms") {
      if (!owner.phoneNumber)
        throw new Error("No phone number on owner account");
      await sendCommCheckSms(owner.phoneNumber, today);
    } else if (channel === "slack") {
      if (!owner.slackUserId)
        throw new Error("No Slack user ID on owner account");
      await sendCommCheckSlack(owner.slackUserId, today);
    } else {
      // phone
      if (!owner.phoneNumber)
        throw new Error("No phone number on owner account");
      const { callId } = await sendCommCheckPhone(owner.phoneNumber, today);
      // Wait up to 30 s to confirm the call actually connected (duration > 0).
      // A 0-second "completed" call means it was silently blocked — likely call
      // screening or a carrier STIR/SHAKEN rejection. Report it as an error so
      // the owner knows the channel isn't working, rather than silently marking
      // it verified.
      const outcome = await waitForCallOutcome(callId, 30_000);
      if (outcome === "no-answer") {
        throw new Error(
          "Call placed but not answered (0 s — likely blocked by call screening). " +
            "Add Elaine's number to your contacts to allow it through.",
        );
      }
    }

    const statusCol = `${channel}_status`;
    const sentAtCol = `${channel}_sent_at`;
    const errorCol = `${channel}_error`;

    if (channel === "phone") {
      // Phone has no verified_at — just reset to sent.
      await pool.query(
        `UPDATE comm_checks
         SET ${statusCol} = 'sent', ${sentAtCol} = NOW(),
             ${errorCol} = NULL
         WHERE check_date = $1`,
        [today],
      );
    } else {
      const verifiedAtCol = `${channel}_verified_at`;
      // Re-open the verified state — a manual resend clears prior verification.
      await pool.query(
        `UPDATE comm_checks
         SET ${statusCol} = 'sent', ${sentAtCol} = NOW(),
             ${verifiedAtCol} = NULL, ${errorCol} = NULL
         WHERE check_date = $1`,
        [today],
      );
    }

    logger.info({ date: today, channel }, "comm-check: manual channel send");
    return { date: today, channel, result: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCol = `${channel}_status`;
    const errorCol = `${channel}_error`;
    await pool.query(
      `UPDATE comm_checks SET ${statusCol} = 'error', ${errorCol} = $2 WHERE check_date = $1`,
      [today, msg],
    );
    logger.error(
      { err, date: today, channel },
      "comm-check: manual channel send failed",
    );
    return { date: today, channel, result: `error: ${msg}` };
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Polls every 5 minutes.
//   • Email / SMS / Slack fire once per day, on the configured days, at or
//     after the configured time ("comm_check"/"daily_days"+"daily_time").
//   • Phone call fires once per day, on its own configured days/time
//     ("comm_check"/"phone_days"+"phone_time").
// All times/days are interpreted in the owner's effective timezone (see
// getEffectiveTimezone()). If the server was down at the trigger time, or the
// schedule was reconfigured after the trigger time already passed today, it
// catches up on the first poll run after the threshold — as long as today is
// still a scheduled day.

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export async function runCommCheckSchedulerTick(
  now: Date = new Date(),
): Promise<CommCheckScheduleDecision> {
  const tz = await getEffectiveTimezone();
  const schedule: CommCheckSchedule = {
    dailyTime: await getConfig("comm_check", "daily_time", "00:01"),
    dailyDays: await getConfig(
      "comm_check",
      "daily_days",
      "sun,mon,tue,wed,thu,fri,sat",
    ),
    phoneTime: await getConfig("comm_check", "phone_time", "19:00"),
    phoneDays: await getConfig(
      "comm_check",
      "phone_days",
      "sun,mon,tue,wed,thu,fri,sat",
    ),
  };
  const decision = getCommCheckScheduleDecision(now, tz, schedule);

  if (decision.dailyDue) {
    const result = await runDailyCommCheck();
    logger.info(
      {
        date: result.date,
        email: result.email,
        sms: result.sms,
        slack: result.slack,
        alreadyComplete: result.alreadyRan,
      },
      "comm-check: daily scheduled check evaluated",
    );
  }

  if (decision.phoneDue) {
    const phoneResult = await runPhoneCommCheck();
    logger.info(
      {
        date: phoneResult.date,
        phone: phoneResult.phone,
        alreadyComplete: phoneResult.alreadySent,
      },
      "comm-check: phone scheduled check evaluated",
    );
  }

  return decision;
}

export function startCommCheckScheduler(): () => void {
  const tick = async (): Promise<void> => {
    try {
      await runCommCheckSchedulerTick();
    } catch (err) {
      logger.error({ err }, "comm-check: scheduler tick failed");
    }
  };

  void tick();

  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
  interval.unref();

  logger.info(
    "comm-check-scheduler: started (polls every 5 min; schedule is configurable via app config module 'comm_check')",
  );
  return () => clearInterval(interval);
}
