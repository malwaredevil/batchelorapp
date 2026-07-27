import app from "./app";
import { logger } from "./lib/logger";
import { runStartupMigration } from "./lib/startup-migrate";
import { provisionAllBuckets } from "./lib/bucket-provisioning";
import { startReminderScheduler } from "./lib/reminder-scheduler";
import { startNudgeScheduler } from "./lib/travels-nudges";
import { startCalendarTripScanScheduler } from "./lib/travels-calendar-scan";
import { startGmailScanScheduler } from "./lib/gmail-scan";
import { startErrorRateSummary } from "./lib/error-tracker";
import { startBirthdayScheduler } from "./lib/birthday-scheduler";
import { startMonitoringScheduler } from "./lib/monitoring-scheduler";
import { startJobWorker, stopAllJobWorkers } from "./lib/jobs/worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function startListening(): void {
  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    const stopSchedulers = [
      startReminderScheduler(),
      startNudgeScheduler(),
      startCalendarTripScanScheduler(),
      startGmailScanScheduler(),
      startErrorRateSummary(),
      startBirthdayScheduler(),
      startMonitoringScheduler(),
    ];
    // Dedicated worker for Slack AI turns — keeps Slack processing isolated
    // from other job queues so a burst of DMs cannot starve other work.
    startJobWorker("slack");
    // Maintenance queue: low-priority housekeeping jobs (storage reconcile,
    // retention aggregation, etc.) — separate from Slack so bulk scans don't
    // starve chat responses.
    startJobWorker("maintenance");

    function shutdown(signal: string): void {
      logger.info({ signal }, "shutdown: stopping schedulers and workers...");
      for (const stop of stopSchedulers) stop();
      void stopAllJobWorkers().catch((err) =>
        logger.warn({ err }, "shutdown: error stopping job workers"),
      );
      logger.info({ signal }, "shutdown: draining open connections...");
      server.close(() => {
        logger.info("shutdown: server closed, exiting cleanly");
        process.exit(0);
      });
      // Force exit if connections don't drain within 15 s.
      setTimeout(() => {
        logger.warn(
          "shutdown: force-exit after 15 s drain timeout (connections still open)",
        );
        process.exit(0);
      }, 15_000).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
}

// Open the port immediately so Replit's port-open watchdog does not kill the
// process while startup work is in flight.  Both operations are explicitly
// non-fatal: startup-migrate is idempotent (IF NOT EXISTS DDL) and tables
// already exist after bootstrap; bucket provisioning only affects storage
// write paths.  Running them after listen means a request arriving in the
// first few seconds might hit a missing table, but in practice the scheduler
// guard and job worker already handle that gracefully (they log and skip).
// Waiting for them before listen caused ~30 s delays when connecting to a
// remote Supabase (EU) over a high-latency Replit→EU pooler path, consistently
// exceeding Replit's 60 s port-open watchdog timeout.
startListening();
runStartupMigration().catch((err) => {
  logger.error(
    { err },
    "Startup migration threw unexpectedly — server already listening",
  );
});
provisionAllBuckets().catch((err) => {
  logger.error(
    { err },
    "Bucket provisioning threw unexpectedly — server already listening without guaranteed bucket policies",
  );
});
