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
