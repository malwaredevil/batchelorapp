import { Resend } from "resend";
import { logger } from "./logger";
import { getConfig } from "./app-config";

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

// Requires only RESEND_API_KEY; sender addresses are now configurable via the
// Control Panel (email module) and fall back to defaults, so the legacy
// RESEND_FROM_EMAIL env var is no longer a prerequisite for email to function.
export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

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
  const from = await getConfig(
    "email",
    "reminder_from_email",
    "Batchelor Travels <travel.alert@app.batchelor.app>",
  );

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

// Entity-agnostic version of sendReminderAlertEmail, used by the generic
// cross-app reminders-scheduler (reminders/reminder_deliveries tables) so any
// reminder — Travels trip, Elaine scheduled action, Office note, etc. — can
// send an alert without a hardcoded trip title/destination. `contextLabel`
// is an optional short line describing what the reminder is attached to
// (e.g. "Trip: Paris"); omit it for reminders with no parent entity.
export async function sendGenericReminderAlertEmail(
  toEmail: string,
  reminderTitle: string,
  description: string | null,
  dueAt: Date,
  label: string,
  contextLabel?: string,
  // Issue #519: the linked Google Calendar event's own link, rendered as a
  // real hyperlink in the HTML body and a plain URL in the text fallback.
  calendarEventUrl?: string | null,
): Promise<void> {
  const from = await getConfig(
    "email",
    "reminder_from_email",
    "Batchelor Reminders <reminders@app.batchelor.app>",
  );

  const formatted = dueAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const { error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject: `Reminder in ${label}: ${reminderTitle}`,
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
                  Reminder — ${label} to go
                </p>
                <h2 style="margin: 0 0 8px; font-size: 22px; color: #111;">
                  ${reminderTitle}
                </h2>
                <p style="margin: 0 0 24px; font-size: 14px; color: #555;">
                  This reminder is due on <strong>${formatted}</strong>, which is
                  <strong>${label}</strong> away.${contextLabel ? ` ${contextLabel}.` : ""}
                  ${description ? `<br /><br />${description}` : ""}
                  ${calendarEventUrl ? `<br /><br /><a href="${calendarEventUrl}" style="color: #0ea5e9;">View calendar event</a>` : ""}
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Batchelor &mdash; reminder alerts
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Reminder — ${label} to go\n\n${reminderTitle}\n\nDue: ${formatted}${contextLabel ? `\n${contextLabel}` : ""}${description ? `\n\n${description}` : ""}${calendarEventUrl ? `\n\nCalendar event: ${calendarEventUrl}` : ""}\n\nBatchelor`,
  });

  if (error) {
    logger.error({ err: error }, "resend generic reminder alert send failed");
    throw new Error(`Failed to send reminder alert: ${error.message}`);
  }
}

// Notifies a trip's household after a forwarded booking document (flight,
// hotel, car rental, airport transfer, parking, etc.) is synced into the
// trip's itinerary — either newly added or updated with richer data. Skipping
// when there's nothing to report is the caller's responsibility
// (syncItineraryFromDocument in routes/travels/documents.ts).
export async function sendItinerarySyncEmail(
  toEmails: string[],
  tripTitle: string,
  tripDestination: string,
  changes: string[],
): Promise<void> {
  if (toEmails.length === 0 || changes.length === 0) return;

  const from = await getConfig(
    "email",
    "reminder_from_email",
    "Batchelor Travels <travel.alert@app.batchelor.app>",
  );

  const itemsHtml = changes
    .map(
      (c) =>
        `<li style="margin: 0 0 10px; font-size: 14px; color: #333;">${escapeHtml(c)}</li>`,
    )
    .join("");
  const itemsText = changes.map((c) => `• ${c}`).join("\n");

  const { error } = await getResend().emails.send({
    from,
    to: toEmails,
    subject: `New itinerary items added — ${tripTitle}`,
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
                  Itinerary updated
                </p>
                <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">
                  ${escapeHtml(tripTitle)}${tripDestination ? ` — ${escapeHtml(tripDestination)}` : ""}
                </h2>
                <p style="margin: 0 0 16px; font-size: 14px; color: #555;">
                  A forwarded booking document was just processed and added
                  the following to your itinerary:
                </p>
                <ul style="margin: 0 0 24px; padding-left: 20px;">
                  ${itemsHtml}
                </ul>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Batchelor Travels &mdash; itinerary sync
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `New itinerary items added to your ${tripTitle} trip${tripDestination ? ` (${tripDestination})` : ""}:\n\n${itemsText}\n\nBatchelor Travels`,
  });

  if (error) {
    logger.error({ err: error }, "resend itinerary sync email send failed");
    throw new Error(`Failed to send itinerary sync email: ${error.message}`);
  }
}

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
  const from = await getConfig(
    "email",
    "elaine_from_email",
    "Elaine <elaine@app.batchelor.app>",
  );

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

// Sends Elaine's reply to an inbound household email (elaine@app.batchelor.app).
// Threaded via In-Reply-To/References when we have the inbound Message-ID, so
// mail clients group it with the original thread. `body` is plain text
// composed by the restricted email-turn — same escaping/paragraph treatment
// as sendAssistantEmail.
export async function sendElaineEmailReply(
  toEmail: string,
  subject: string,
  body: string,
  inReplyToMessageId?: string | null,
): Promise<string | undefined> {
  const from = await getConfig(
    "email",
    "elaine_from_email",
    "Elaine <elaine@app.batchelor.app>",
  );

  const paragraphsHtml = body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-size: 14px; color: #333; white-space: pre-line;">${escapeHtml(p.trim())}</p>`,
    )
    .join("");

  const headers = inReplyToMessageId
    ? {
        "In-Reply-To": inReplyToMessageId,
        References: inReplyToMessageId,
      }
    : undefined;

  const { data, error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    headers,
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
                ${paragraphsHtml}
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Elaine, your Batchelor household assistant
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `${body}\n\n— Elaine`,
  });

  if (error) {
    logger.error({ err: error }, "resend elaine email reply send failed");
    throw new Error(`Failed to send email reply: ${error.message}`);
  }
  return data?.id;
}

// Birthday email sent from Elaine on the household member's birthday.
export async function sendBirthdayEmail(
  toEmail: string,
  displayName: string | null,
): Promise<void> {
  const from = await getConfig(
    "email",
    "elaine_from_email",
    "Elaine <elaine@app.batchelor.app>",
  );
  const name = displayName ?? toEmail.split("@")[0];

  const { error } = await getResend().emails.send({
    from,
    to: toEmail,
    subject: `Happy Birthday, ${name}! 🎂`,
    html: `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: sans-serif; background: #f9f9f9; padding: 40px 0; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0"
            style="background: #ffffff; border-radius: 8px; padding: 48px 40px;
                   box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center;">
            <tr>
              <td>
                <div style="font-size: 56px; line-height: 1; margin-bottom: 16px;">🎂</div>
                <h2 style="margin: 0 0 12px; font-size: 26px; color: #111;">
                  Happy Birthday, ${escapeHtml(name)}!
                </h2>
                <p style="margin: 0 0 24px; font-size: 16px; color: #555; line-height: 1.6;">
                  Wishing you a wonderful day filled with joy and celebration.
                  Hope this birthday is the best one yet! 🎉
                </p>
                <p style="margin: 0 0 24px; font-size: 14px; color: #888;">
                  With love from the whole Batchelor household 💛
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="margin: 0; font-size: 11px; color: #bbb;">
                  Elaine, your Batchelor household assistant
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Happy Birthday, ${name}! 🎂\n\nWishing you a wonderful day filled with joy and celebration. Hope this birthday is the best one yet! 🎉\n\nWith love from the whole Batchelor household 💛\n\n— Elaine, your Batchelor household assistant`,
  });

  if (error) {
    logger.error({ err: error }, "resend birthday email send failed");
    throw new Error(`Failed to send birthday email: ${error.message}`);
  }
}

// Simple connectivity-check email used by the account settings "Send test
// email" button. Uses the same sender as password-reset emails since that's
// the one guaranteed to be configured whenever resendConfigured() is true.
export async function sendTestEmail(toEmail: string): Promise<void> {
  const from = await getConfig(
    "email",
    "general_from_email",
    "Batchelor App <elaine@app.batchelor.app>",
  );

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
  const from = await getConfig(
    "email",
    "general_from_email",
    "Batchelor App <elaine@app.batchelor.app>",
  );

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
