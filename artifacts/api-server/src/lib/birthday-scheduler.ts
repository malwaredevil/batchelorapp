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
import { shouldRunScheduledTask } from "./scheduler-guard";
import { logger } from "./logger";

const TASK_NAME = "birthday-emails";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function todayMMDD(): string {
  const now = new Date();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export async function runBirthdayEmails(): Promise<void> {
  if (!resendConfigured()) return;

  const today = todayMMDD();

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
    try {
      await sendBirthdayEmail(user.email, user.displayName ?? null);
      logger.info(
        { userId: user.id, email: user.email },
        "birthday-scheduler: sent birthday email",
      );
    } catch (err) {
      logger.error(
        { err, userId: user.id },
        "birthday-scheduler: failed to send birthday email",
      );
    }
  }
}

export function startBirthdayScheduler(): () => void {
  let stopped = false;
  async function tick() {
    try {
      const ok = await shouldRunScheduledTask(TASK_NAME, ONE_DAY_MS);
      if (ok) {
        await runBirthdayEmails();
      }
    } catch (err) {
      logger.error({ err }, "birthday-scheduler: tick error");
    }
    if (!stopped) setTimeout(tick, ONE_DAY_MS).unref();
  }

  void tick();
  return () => {
    stopped = true;
  };
}
