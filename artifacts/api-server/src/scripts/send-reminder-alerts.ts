/**
 * One-shot entry point for sending due Travels reminder alert emails,
 * computing proactive elAIne nudges, refreshing integrations-health nudges,
 * and running the Gmail travel-document scan.
 *
 * Intended to be run by a Replit Scheduled Deployment (real cron), so
 * delivery does not depend on the main `autoscale` web server instance
 * being awake. Runs the same idempotent checks as the in-process fallback
 * schedulers (`lib/reminders-scheduler.ts`, `lib/travels-nudges.ts`,
 * `lib/integrations-health-nudges.ts`, `lib/gmail-scan.ts`) and exits. All
 * are additive/idempotent (each guarded by `shouldRunScheduledTask`'s
 * per-task interval check), so running them together here is safe even
 * though the in-process schedulers also run on their own timers whenever a
 * server instance happens to be warm.
 */
import { pool } from "@workspace/db";
import { runReminderDeliveries } from "../lib/reminders-scheduler";
import { computeAndStoreNudges } from "../lib/travels-nudges";
import { runScheduledIntegrationsHealthNudges } from "../lib/integrations-health-nudges";
import { computeAndStoreSentryErrorNudges } from "../lib/sentry-error-nudges";
import { scanAllGmailConnections } from "../lib/gmail-scan";
import {
  shouldRunScheduledTask,
  recordScheduledTaskSuccess,
  recordScheduledTaskFailure,
} from "../lib/scheduler-guard";
import { logger } from "../lib/logger";

const GMAIL_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const SENTRY_NUDGE_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
// Must match SENTRY_NUDGE_TASK_NAME in lib/sentry-error-nudges.ts — kept as a
// local literal because check-scheduler-names.ts cannot resolve cross-file
// imports.
const SENTRY_NUDGE_TASK_NAME = "sentry-error-nudges";

async function runSentryErrorNudgesIfDue(): Promise<void> {
  if (
    !(await shouldRunScheduledTask(
      SENTRY_NUDGE_TASK_NAME,
      SENTRY_NUDGE_INTERVAL_MS,
    ))
  ) {
    logger.info(
      "send-reminder-alerts: sentry-error-nudges skipped (ran within the last 30 minutes)",
    );
    return;
  }
  try {
    await computeAndStoreSentryErrorNudges();
    await recordScheduledTaskSuccess(SENTRY_NUDGE_TASK_NAME);
  } catch (err) {
    logger.error({ err }, "send-reminder-alerts: sentry-error-nudges failed");
    recordScheduledTaskFailure(SENTRY_NUDGE_TASK_NAME);
    throw err;
  }
}

async function runGmailScanIfDue(): Promise<void> {
  if (!(await shouldRunScheduledTask("gmail-scan", GMAIL_SCAN_INTERVAL_MS))) {
    logger.info(
      "send-reminder-alerts: gmail-scan skipped (ran within the last 6 hours)",
    );
    return;
  }
  try {
    await scanAllGmailConnections();
    await recordScheduledTaskSuccess("gmail-scan");
  } catch (err) {
    logger.error({ err }, "send-reminder-alerts: gmail-scan failed");
    recordScheduledTaskFailure("gmail-scan");
    throw err;
  }
}

Promise.all([
  runReminderDeliveries(),
  computeAndStoreNudges(),
  // Use the stateless scheduled path: inserts failure nudges for every
  // currently-failing service using stable per-error slug keys, with
  // ON CONFLICT DO NOTHING deduplicating already-known failures.
  runScheduledIntegrationsHealthNudges(),
  runGmailScanIfDue(),
  runSentryErrorNudgesIfDue(),
])
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
