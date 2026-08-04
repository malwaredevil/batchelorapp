import { Resend } from "resend";
import { eq } from "drizzle-orm";
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
const TIMEZONE_CACHE_MS = 5 * 60 * 1000;

let _tzCache: { value: string; expiresAt: number } | null = null;

// Resolves the timezone the comm-check schedule should run in: the owner
// account's `timezone` field if set and valid, otherwise DEFAULT_TIMEZONE.
// Cached briefly since this is called on every inbound webhook message via
// markCommCheckVerified, not just the 5-minute scheduler tick.
export async function getEffectiveTimezone(): Promise<string> {
  if (_tzCache && _tzCache.expiresAt > Date.now()) {
    return _tzCache.value;
  }
  const [owner] = await db
    .select({ timezone: appUsers.timezone })
    .from(appUsers)
    .where(eq(appUsers.isOwner, true))
    .limit(1);
  const tz =
    owner?.timezone && isValidIanaTimeZone(owner.timezone)
      ? owner.timezone
      : DEFAULT_TIMEZONE;
  _tzCache = { value: tz, expiresAt: Date.now() + TIMEZONE_CACHE_MS };
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
    hour12: false,
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

// ── Core run function (email / SMS / Slack — fires at 00:01) ─────────────────
// Attempts to atomically INSERT a new row for today (Stuttgart date).
// If the row already exists the INSERT is a no-op and nothing is sent.
// If newly inserted, sends all three channels independently and records each
// channel's outcome.

export interface CommCheckResult {
  alreadyRan: boolean;
  date: string;
  email: string;
  sms: string;
  slack: string;
}

export async function runDailyCommCheck(): Promise<CommCheckResult> {
  const today = await getEffectiveDateString();

  const claimResult = await pool.query<{ check_date: string }>(
    `INSERT INTO comm_checks (check_date)
     VALUES ($1)
     ON CONFLICT (check_date) DO NOTHING
     RETURNING check_date`,
    [today],
  );

  if ((claimResult.rowCount ?? 0) === 0) {
    return {
      alreadyRan: true,
      date: today,
      email: "n/a",
      sms: "n/a",
      slack: "n/a",
    };
  }

  const owner = await getOwner();
  if (!owner) {
    logger.warn("comm-check: no owner account found, cannot send checks");
    await pool.query(
      `UPDATE comm_checks
       SET email_status = 'error', email_error = 'No owner account',
           sms_status   = 'error', sms_error   = 'No owner account',
           slack_status = 'error', slack_error = 'No owner account'
       WHERE check_date = $1`,
      [today],
    );
    return {
      alreadyRan: false,
      date: today,
      email: "error: no owner",
      sms: "error: no owner",
      slack: "error: no owner",
    };
  }

  const results = { email: "skipped", sms: "skipped", slack: "skipped" };

  // --- Email ---
  if (owner.email) {
    try {
      await sendCommCheckEmail(owner.email, today);
      await pool.query(
        `UPDATE comm_checks SET email_status = 'sent', email_sent_at = NOW() WHERE check_date = $1`,
        [today],
      );
      results.email = "sent";
      logger.info({ date: today }, "comm-check: email sent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE comm_checks SET email_status = 'error', email_error = $2 WHERE check_date = $1`,
        [today, msg],
      );
      results.email = `error: ${msg}`;
      logger.error({ err, date: today }, "comm-check: email send failed");
    }
  } else {
    await pool.query(
      `UPDATE comm_checks SET email_status = 'error', email_error = 'No email on owner account' WHERE check_date = $1`,
      [today],
    );
    results.email = "error: no owner email";
  }

  // --- SMS ---
  if (owner.phoneNumber) {
    try {
      await sendCommCheckSms(owner.phoneNumber, today);
      await pool.query(
        `UPDATE comm_checks SET sms_status = 'sent', sms_sent_at = NOW() WHERE check_date = $1`,
        [today],
      );
      results.sms = "sent";
      logger.info({ date: today }, "comm-check: SMS sent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE comm_checks SET sms_status = 'error', sms_error = $2 WHERE check_date = $1`,
        [today, msg],
      );
      results.sms = `error: ${msg}`;
      logger.error({ err, date: today }, "comm-check: SMS send failed");
    }
  } else {
    await pool.query(
      `UPDATE comm_checks SET sms_status = 'error', sms_error = 'No phone number on owner account' WHERE check_date = $1`,
      [today],
    );
    results.sms = "error: no owner phone";
  }

  // --- Slack ---
  if (owner.slackUserId) {
    try {
      await sendCommCheckSlack(owner.slackUserId, today);
      await pool.query(
        `UPDATE comm_checks SET slack_status = 'sent', slack_sent_at = NOW() WHERE check_date = $1`,
        [today],
      );
      results.slack = "sent";
      logger.info({ date: today }, "comm-check: Slack DM sent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE comm_checks SET slack_status = 'error', slack_error = $2 WHERE check_date = $1`,
        [today, msg],
      );
      results.slack = `error: ${msg}`;
      logger.error({ err, date: today }, "comm-check: Slack send failed");
    }
  } else {
    await pool.query(
      `UPDATE comm_checks SET slack_status = 'error', slack_error = 'No Slack user ID on owner account' WHERE check_date = $1`,
      [today],
    );
    results.slack = "error: no owner slack ID";
  }

  return { alreadyRan: false, date: today, ...results };
}

// ── Phone-only run function (fires at 19:00) ──────────────────────────────────
// Ensures today's row exists, then atomically claims the phone slot by
// updating from 'pending' → 'sent' (or records an error). Safe to call
// repeatedly — returns alreadySent: true if the row was already claimed.

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

  const owner = await getOwner();
  if (!owner || !owner.phoneNumber) {
    const msg = owner ? "No phone number on owner account" : "No owner account";
    await pool.query(
      `UPDATE comm_checks SET phone_status = 'error', phone_error = $2 WHERE check_date = $1`,
      [today, msg],
    );
    logger.warn({ date: today }, `comm-check: phone skipped — ${msg}`);
    return { alreadySent: false, date: today, phone: `error: ${msg}` };
  }

  // Atomic two-phase claim:
  //   1. Optimistically flip pending → sent in a single UPDATE (the idempotency
  //      guard). If 0 rows touched, another process already claimed this slot.
  //   2. If the outbound call subsequently fails, overwrite to error.
  //
  // This avoids any intermediate "calling" state that could stick forever on
  // crash or network hang. In the rare case of a crash between steps 1 and 2
  // the row remains "sent" (a false positive); that is preferable to a broken
  // state that blocks every future scheduler tick.
  const claim = await pool.query<{ check_date: string }>(
    `UPDATE comm_checks
     SET phone_status = 'sent', phone_sent_at = NOW(), phone_error = NULL
     WHERE check_date = $1 AND phone_status = 'pending'
     RETURNING check_date`,
    [today],
  );

  if ((claim.rowCount ?? 0) === 0) {
    return { alreadySent: true, date: today, phone: "n/a" };
  }

  try {
    const { callId } = await sendCommCheckPhone(owner.phoneNumber, today);
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
    logger.info({ date: today }, "comm-check: phone call placed");
    return { alreadySent: false, date: today, phone: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Roll the status back to error — the row is no longer "sent".
    await pool.query(
      `UPDATE comm_checks SET phone_status = 'error', phone_sent_at = NULL, phone_error = $2 WHERE check_date = $1`,
      [today, msg],
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

export function startCommCheckScheduler(): () => void {
  const tick = async (): Promise<void> => {
    try {
      const tz = await getEffectiveTimezone();
      const minuteOfDay = getMinuteOfDayInTz(tz);
      const weekday = getWeekdayCodeInTz(tz);

      // Fallbacks below mirror the APP_CONFIG_DEFAULTS values in app-config.ts
      // (kept as inline literals, not named constants, so the app-config
      // drift guard can statically verify their JS type against the
      // declared "time"/"day-list" config type).
      const dailyTime = await getConfig("comm_check", "daily_time", "00:01");
      const dailyDays = await getConfig(
        "comm_check",
        "daily_days",
        "sun,mon,tue,wed,thu,fri,sat",
      );
      const phoneTime = await getConfig("comm_check", "phone_time", "19:00");
      const phoneDays = await getConfig(
        "comm_check",
        "phone_days",
        "sun,mon,tue,wed,thu,fri,sat",
      );

      // Email / SMS / Slack
      if (
        parseDayList(dailyDays).has(weekday) &&
        minuteOfDay >= parseTimeToMinutes(dailyTime)
      ) {
        const result = await runDailyCommCheck();
        if (!result.alreadyRan) {
          logger.info(
            {
              date: result.date,
              email: result.email,
              sms: result.sms,
              slack: result.slack,
            },
            "comm-check: daily check completed",
          );
        }
      }

      // Phone call
      if (
        parseDayList(phoneDays).has(weekday) &&
        minuteOfDay >= parseTimeToMinutes(phoneTime)
      ) {
        const phoneResult = await runPhoneCommCheck();
        if (!phoneResult.alreadySent) {
          logger.info(
            { date: phoneResult.date, phone: phoneResult.phone },
            "comm-check: phone check completed",
          );
        }
      }
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
