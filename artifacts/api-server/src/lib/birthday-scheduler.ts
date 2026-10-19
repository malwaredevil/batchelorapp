/**
 * Daily birthday check scheduler.
 *
 * Runs once per calendar day. For every app_users row where birthday matches
 * today's MM-DD, it sends a birthday email from Elaine. Uses the
 * shouldRunScheduledTask guard so it only fires once per day regardless of
 * how many times the server restarts.
 */
import { db, appUsers } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { sendBirthdayEmail, resendConfigured } from "./email";
import {
  shouldRunScheduledTask,
  recordScheduledTaskSuccess,
  recordScheduledTaskFailure,
} from "./scheduler-guard";
import { logger } from "./logger";
import { startSchedulerPoller } from "./scheduler-poller";
import {
  claimWebhookSideEffect,
  markWebhookSideEffectCompleted,
} from "./webhook-side-effect-idempotency";

const TASK_NAME = "birthday-emails";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function runBirthdayEmails(
  utcDate = new Date().toISOString().slice(0, 10),
): Promise<void> {
  if (!resendConfigured()) return;

  const today = utcDate.slice(5);

  const users = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      displayName: appUsers.displayName,
      birthday: appUsers.birthday,
    })
    .from(appUsers)
    .where(isNotNull(appUsers.birthday));

  const birthdayUsers = users.filter((u) => u.birthday === today);

  for (const user of birthdayUsers) {
    const effectKey = `birthday-email:${utcDate}:${user.id}`;
    let providerAccepted = false;
    try {
      // Reuse the durable send ledger, but never reclaim uncertain sends.
      // The key contains only the recipient ID and send date, never their email.
      if (
        !(await claimWebhookSideEffect({
          effectKey,
          provider: "resend",
          channel: "email",
          allowRetry: false,
        }))
      )
        continue;
      await sendBirthdayEmail(user.email, user.displayName ?? null);
      providerAccepted = true;
      await markWebhookSideEffectCompleted(effectKey);
      logger.info(
        { userId: user.id },
        "birthday-scheduler: provider accepted birthday email",
      );
    } catch (err) {
      logger.error(
        { err, userId: user.id, providerAccepted },
        "birthday-scheduler: birthday email attempt did not complete",
      );
    }
  }
}

export function startBirthdayScheduler(): () => void {
  async function tick() {
    try {
      const utcDate = new Date().toISOString().slice(0, 10);
      // One atomic claim per UTC date, not a rolling 24-hour delay. Freeze the
      // work date across awaits and never replay an ambiguous same-day attempt.
      const ok = await shouldRunScheduledTask(TASK_NAME, ONE_DAY_MS, {
        recoverStuckClaims: false,
        utcDate,
      });
      if (ok) {
        try {
          await runBirthdayEmails(utcDate);
          // Architecture hardening (#754): this call was previously missing,
          // so last_success_at for this task stayed NULL forever — the
          // heartbeat's crash-recovery check (which requires a non-null
          // last_success_at) could never apply to this task, silently
          // hiding a real failure from monitoring.
          await recordScheduledTaskSuccess(TASK_NAME);
        } catch (err) {
          recordScheduledTaskFailure(TASK_NAME);
          throw err;
        }
      }
    } catch (err) {
      logger.error({ err }, "birthday-scheduler: tick error");
    }
  }

  return startSchedulerPoller(TASK_NAME, ONE_DAY_MS, tick);
}
