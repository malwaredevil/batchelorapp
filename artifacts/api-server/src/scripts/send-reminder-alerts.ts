/**
 * One-shot entry point for sending due Travels reminder alert emails.
 *
 * Intended to be run by a Replit Scheduled Deployment (real cron), so
 * delivery does not depend on the main `autoscale` web server instance
 * being awake. Runs the same idempotent check as the in-process fallback
 * scheduler (`lib/reminder-scheduler.ts`) and exits.
 */
import { pool } from "@workspace/db";
import { runReminderAlerts } from "../lib/reminder-scheduler";
import { logger } from "../lib/logger";

runReminderAlerts()
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
