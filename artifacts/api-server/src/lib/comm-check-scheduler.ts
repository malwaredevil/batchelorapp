import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { db, pool, appUsers } from "@workspace/db";
import { sendSms } from "./sms";
import { openDmChannel, postSlackMessage, slackConfigured } from "./slack";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Daily comms check scheduler.
//
// Sends one email, one SMS, and one Slack DM to the owner at 00:01
// Stuttgart time (Europe/Berlin) every calendar day. Any reply from the
// owner on that channel within the same day marks it "verified".
//
// Response detection is handled by the inbound webhook handlers:
//   - routes/agentphone.ts  → markCommCheckVerified("sms")
//   - routes/elaine-email.ts → markCommCheckVerified("email")
//   - routes/slack.ts        → markCommCheckVerified("slack")
// ---------------------------------------------------------------------------

// ── Stuttgart date / time helpers ────────────────────────────────────────────

// Returns today's date string in Europe/Berlin as "YYYY-MM-DD".
// sv-SE locale natively formats to ISO date order.
export function getStuttgartDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Returns minutes since midnight in Europe/Berlin (0–1439).
function getStuttgartMinuteOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
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

// ── Response verification ─────────────────────────────────────────────────────
// Called by inbound webhook handlers (agentphone / elaine-email / slack).
// Marks today's comm check for the given channel as 'verified' if it is
// currently in 'sent' state. Safe to call on every inbound message — it is
// a no-op when the check has not been sent yet or is already verified.
export async function markCommCheckVerified(
  channel: "email" | "sms" | "slack",
): Promise<void> {
  const today = getStuttgartDateString();
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
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Batchelor App <elaine@app.batchelor.app>";
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

// ── Core run function ─────────────────────────────────────────────────────────
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
  const today = getStuttgartDateString();

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

// ── Single-channel send ───────────────────────────────────────────────────────
// Ensures today's row exists, then (re)sends a single channel regardless of
// its current status. Intended for manual "Send now" triggers from the UI.

export interface ChannelCheckResult {
  date: string;
  channel: "email" | "sms" | "slack";
  result: string;
}

export async function runChannelCheck(
  channel: "email" | "sms" | "slack",
): Promise<ChannelCheckResult> {
  const today = getStuttgartDateString();

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
    } else {
      if (!owner.slackUserId)
        throw new Error("No Slack user ID on owner account");
      await sendCommCheckSlack(owner.slackUserId, today);
    }

    const statusCol = `${channel}_status`;
    const sentAtCol = `${channel}_sent_at`;
    const verifiedAtCol = `${channel}_verified_at`;
    const errorCol = `${channel}_error`;
    // Re-open the verified state — a manual resend clears prior verification.
    await pool.query(
      `UPDATE comm_checks
       SET ${statusCol} = 'sent', ${sentAtCol} = NOW(),
           ${verifiedAtCol} = NULL, ${errorCol} = NULL
       WHERE check_date = $1`,
      [today],
    );
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
// Polls every 5 minutes. Fires the check once per Stuttgart calendar day,
// starting from 00:01. If the server was down at midnight it catches up on
// the first poll run after 00:01.

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const SEND_AFTER_MINUTE = 1; // 00:01 Stuttgart

export function startCommCheckScheduler(): () => void {
  const tick = async (): Promise<void> => {
    try {
      if (getStuttgartMinuteOfDay() < SEND_AFTER_MINUTE) return;
      const result = await runDailyCommCheck();
      if (result.alreadyRan) return;
      logger.info(
        {
          date: result.date,
          email: result.email,
          sms: result.sms,
          slack: result.slack,
        },
        "comm-check: daily check completed",
      );
    } catch (err) {
      logger.error({ err }, "comm-check: scheduler tick failed");
    }
  };

  void tick();

  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
  interval.unref();

  logger.info(
    "comm-check-scheduler: started (polls every 5 min, sends at 00:01 Stuttgart)",
  );
  return () => clearInterval(interval);
}
