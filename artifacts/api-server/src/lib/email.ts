import { Resend } from "resend";
import { logger } from "./logger";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set.");
    }
    resend = new Resend(apiKey);
  }
  return resend;
}

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL;
}

// Dedicated sender for Travels reminder alerts. Defaults to the verified
// app.batchelor.app domain with a friendly display name; can be overridden
// via RESEND_REMINDER_FROM_EMAIL.
const REMINDER_FROM_EMAIL =
  process.env.RESEND_REMINDER_FROM_EMAIL ||
  "Batchelor Travels <travel.alert@app.batchelor.app>";

// Alert type is now derived from the reminder's own configurable
// alert_days_before array rather than a fixed 14/7/3-day set — any
// non-negative day count is a valid alert type, e.g. "10_day".
export type ReminderAlertType = `${number}_day`;

export function alertLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return `${days} days`;
}

export async function sendReminderAlertEmail(
  toEmail: string,
  reminderTitle: string,
  tripTitle: string,
  tripDestination: string,
  alertType: ReminderAlertType,
  dueDate: string,
): Promise<void> {
  const from = REMINDER_FROM_EMAIL;

  const days = parseInt(alertType, 10);
  const label = alertLabel(isNaN(days) ? 0 : days);
  const formatted = new Date(dueDate + "T12:00:00Z").toLocaleDateString(
    "en-GB",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  );

  const { error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject: `Reminder in ${label}: ${reminderTitle} — ${tripTitle}`,
    html: `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: sans-serif; background: #f9f9f9; padding: 40px 0; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0"
            style="background: #ffffff; border-radius: 8px; padding: 40px;
                   box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
            <tr>
              <td>
                <p style="margin: 0 0 4px; font-size: 12px; color: #0ea5e9; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
                  Trip reminder — ${label} to go
                </p>
                <h2 style="margin: 0 0 8px; font-size: 22px; color: #111;">
                  ${reminderTitle}
                </h2>
                <p style="margin: 0 0 24px; font-size: 14px; color: #555;">
                  This reminder is due on <strong>${formatted}</strong>, which is
                  <strong>${label}</strong> away. It's linked to your trip
                  <em>${tripTitle}</em> to <strong>${tripDestination}</strong>.
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Batchelor Travels &mdash; reminder alerts
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Trip reminder — ${label} to go\n\n${reminderTitle}\n\nDue: ${formatted}\nTrip: ${tripTitle} → ${tripDestination}\n\nBatchelor Travels`,
  });

  if (error) {
    logger.error({ err: error }, "resend reminder alert send failed");
    throw new Error(`Failed to send reminder alert: ${error.message}`);
  }
}

// Dedicated sender for Elaine assistant-composed emails (e.g. "email me that
// list of things to do"). Defaults to the verified app.batchelor.app domain;
// can be overridden via ELAINE_FROM_EMAIL.
const ELAINE_FROM_EMAIL =
  process.env.ELAINE_FROM_EMAIL || "Elaine <elAIne@app.batchelor.app>";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sends a plain-text body composed by Elaine to the recipient. The body is
// always the currently-authenticated user's own account email — never a
// model-supplied address — to prevent the assistant from being used to spam
// or phish arbitrary addresses. `body` is escaped and rendered as simple
// paragraphs (blank line = new paragraph) in both html and text form.
export async function sendAssistantEmail(
  toEmail: string,
  subject: string,
  body: string,
): Promise<void> {
  const from = ELAINE_FROM_EMAIL;

  const paragraphsHtml = body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-size: 14px; color: #333; white-space: pre-line;">${escapeHtml(p.trim())}</p>`,
    )
    .join("");

  const { error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject,
    html: `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: sans-serif; background: #f9f9f9; padding: 40px 0; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0"
            style="background: #ffffff; border-radius: 8px; padding: 40px;
                   box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
            <tr>
              <td>
                <p style="margin: 0 0 4px; font-size: 12px; color: #0ea5e9; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
                  From Elaine
                </p>
                <h2 style="margin: 0 0 20px; font-size: 20px; color: #111;">
                  ${escapeHtml(subject)}
                </h2>
                ${paragraphsHtml}
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Sent by Elaine, your Batchelor Travels assistant, at your request.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `${subject}\n\n${body}\n\n— Elaine, your Batchelor Travels assistant`,
  });

  if (error) {
    logger.error({ err: error }, "resend assistant email send failed");
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

// Simple connectivity-check email used by the account settings "Send test
// email" button. Uses the same sender as password-reset emails since that's
// the one guaranteed to be configured whenever resendConfigured() is true.
export async function sendTestEmail(toEmail: string): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL environment variable is not set.");
  }

  const { error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject: "Test email from Batchelor App",
    html: `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: sans-serif; background: #f9f9f9; padding: 40px 0; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0"
            style="background: #ffffff; border-radius: 8px; padding: 40px;
                   box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
            <tr>
              <td>
                <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">
                  It works!
                </h2>
                <p style="margin: 0; font-size: 14px; color: #555;">
                  This is a test email sent from your Batchelor App account
                  settings to confirm email delivery is working for
                  <strong>${toEmail}</strong>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `It works!\n\nThis is a test email sent from your Batchelor App account settings to confirm email delivery is working for ${toEmail}.`,
  });

  if (error) {
    logger.error({ err: error }, "resend test email send failed");
    throw new Error(`Failed to send test email: ${error.message}`);
  }
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string,
): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL environment variable is not set.");
  }

  const { error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject: "Reset your password — Ashley's Quilting Center",
    html: `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: sans-serif; background: #f9f9f9; padding: 40px 0; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0"
            style="background: #ffffff; border-radius: 8px; padding: 40px;
                   box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
            <tr>
              <td>
                <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">
                  Reset your password
                </h2>
                <p style="margin: 0 0 24px; font-size: 14px; color: #555;">
                  We received a request to reset the password for your account
                  (<strong>${toEmail}</strong>). Click the button below to choose a new
                  password. This link expires in <strong>30 minutes</strong>.
                </p>
                <a href="${resetUrl}"
                  style="display: inline-block; padding: 12px 24px;
                         background: #7c3aed; color: #fff; border-radius: 6px;
                         text-decoration: none; font-size: 14px; font-weight: 600;">
                  Reset password
                </a>
                <p style="margin: 24px 0 0; font-size: 12px; color: #999;">
                  If you didn't request this, you can safely ignore this email —
                  your password will not change. The link expires automatically
                  after 30 minutes.
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Ashley's Quilting Center &mdash; private collection
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Reset your password\n\nWe received a request to reset the password for ${toEmail}.\n\nClick this link to reset it (expires in 30 minutes):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
  });

  if (error) {
    logger.error({ err: error }, "resend email send failed");
    throw new Error(`Failed to send reset email: ${error.message}`);
  }
}
