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
import { startCommCheckScheduler } from "./lib/comm-check-scheduler";
import { startJobWorker, stopAllJobWorkers } from "./lib/jobs/worker";
import {
  markBucketsReady,
  markMigrationReady,
  markStartupFailed,
  markStartupReady,
} from "./lib/startup-state";

const rawPort = process.env["PORT"];
if (!rawPort)
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const stopSchedulers: Array<() => void> = [];
let shuttingDown = false;

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening; startup initialization in progress");
  void initializeRuntime();
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

async function initializeRuntime(): Promise<void> {
  try {
    await runStartupMigration();
    markMigrationReady();
  } catch (err) {
    markStartupFailed("migration", "migration_failed");
    logger.error(
      { err },
      "startup: migration failed; readiness remains unavailable",
    );
    return;
  }

  try {
    await provisionAllBuckets();
    markBucketsReady();
  } catch (err) {
    markStartupFailed("buckets", "bucket_provisioning_failed");
    logger.error(
      { err },
      "startup: bucket provisioning failed; readiness remains unavailable",
    );
    return;
  }

  markStartupReady();
  stopSchedulers.push(
    startReminderScheduler(),
    startNudgeScheduler(),
    startCalendarTripScanScheduler(),
    startGmailScanScheduler(),
    startErrorRateSummary(),
    startBirthdayScheduler(),
    startMonitoringScheduler(),
    startCommCheckScheduler(),
  );
  startJobWorker("slack");
  startJobWorker("maintenance");
  logger.info("startup: runtime ready; schedulers and workers started");
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutdown: stopping schedulers and workers...");
  for (const stop of stopSchedulers) stop();
  void stopAllJobWorkers().catch((err) =>
    logger.warn({ err }, "shutdown: error stopping job workers"),
  );
  server.close(() => {
    logger.info("shutdown: server closed, exiting cleanly");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("shutdown: force-exit after 15 s drain timeout");
    process.exit(0);
  }, 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
