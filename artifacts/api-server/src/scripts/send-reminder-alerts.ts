/**
 * One-shot entry point for sending due Travels reminder alert emails AND
 * computing proactive elAIne nudges.
 *
 * Intended to be run by a Replit Scheduled Deployment (real cron), so
 * delivery does not depend on the main `autoscale` web server instance
 * being awake. Runs the same idempotent checks as the in-process fallback
 * schedulers (`lib/reminder-scheduler.ts`, `lib/travels-nudges.ts`) and
 * exits. Both are additive/idempotent, so running them together here is
 * safe even though the in-process schedulers also run on their own hourly
 * timers whenever a server instance happens to be warm.
 */
import { pool } from "@workspace/db";
import { runReminderAlerts } from "../lib/reminder-scheduler";
import { computeAndStoreNudges } from "../lib/travels-nudges";
import { logger } from "../lib/logger";

Promise.all([runReminderAlerts(), computeAndStoreNudges()])
  .then(async () => {
    logger.info("send-reminder-alerts: run complete");
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logger.error({ err }, "send-reminder-alerts: run failed");
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
