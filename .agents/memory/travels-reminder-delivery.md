---
name: Travels reminder email delivery
description: How reliable delivery for scheduled reminder alerts is guaranteed, and the Resend sandbox restriction that blocks multi-recipient delivery.
---

# Travels reminder email delivery

## Resend sandbox mode blocks non-owner recipients
This project's Resend account has no verified sending domain, so it runs in
Resend's default sandbox mode: `resend.emails.send()` only succeeds when
`to` is the account owner's own signup address. Sends to any other address
(e.g. a second household member's email) fail with a 403
`validation_error` ("You can only send testing emails to your own email
address ... verify a domain at resend.com/domains").

**Why:** discovered while wiring multi-recipient reminder alerts — one
recipient (the account owner) received the email, the other silently did
not, even though the code was correct.

**How to apply:** any feature that emails more than one address (or an
address that isn't the Resend account owner) will silently fail for those
other recipients until a domain is verified in the Resend dashboard (DNS
records under the user's own domain) and `RESEND_FROM_EMAIL` is switched to
use it. This requires the user's own domain/DNS access — not something the
agent can complete unilaterally. Until verified, treat any "email delivered
to a non-owner address" claim as unverified.

## Sender addresses / env vars
Reminder alerts send from `RESEND_REMINDER_FROM_EMAIL` (default
`Batchelor Travels <travel.alert@app.batchelor.app>`); password-reset emails
send from `RESEND_FROM_EMAIL` (`Batchelor <noreply@app.batchelor.app>`). Both
require the `app.batchelor.app` domain to be **verified** in Resend.

**Verification is not automatic.** Adding a domain in Resend only registers it
(`status: not_started`); it does NOT deliver until the DNS records are added at
the registrar (GoDaddy) and Resend detects them. Check status any time with
`curl -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains`.
Required records for `app.batchelor.app` (host names are relative to the
`batchelor.app` zone): DKIM TXT `resend._domainkey.app`, SPF MX `send.app` →
`feedback-smtp.us-east-1.amazonses.com` (priority 10), SPF TXT `send.app` →
`v=spf1 include:amazonses.com ~all`. Region is us-east-1.

## Delivery must not depend on the web server staying awake
The Travels app deploys as an `autoscale` deployment, which can be fully
asleep for long stretches. An in-process `setInterval` scheduler inside the
API server is not sufficient on its own to guarantee a reminder fires on
time — it only runs while that instance happens to be warm.

**How to apply:** pair the in-process scheduler (kept as a low-latency
best-effort fallback, runs hourly) with a separate Replit **Scheduled
Deployment** that invokes a one-shot script
(`pnpm --filter @workspace/api-server run send-reminder-alerts`) on a real
cron schedule, independent of the main app's uptime. Both paths share the
same idempotent `travels_reminder_alert_log` dedupe table, and the SQL
check uses a catch-up range (`due_date BETWEEN CURRENT_DATE AND
CURRENT_DATE + N days`, not an exact-day match) so a missed run still fires
next time instead of silently skipping the reminder. A per-recipient retry
loop only marks an alert as sent once *every* recipient succeeds, so one
failing address doesn't block delivery being retried for the rest, and
vice versa doesn't get marked done if partially failed.
