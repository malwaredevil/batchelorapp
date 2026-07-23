import app from "./app";
import { logger } from "./lib/logger";
import { runStartupMigration } from "./lib/startup-migrate";
import { startReminderScheduler } from "./lib/reminder-scheduler";
import { startNudgeScheduler } from "./lib/travels-nudges";
import { startCalendarTripScanScheduler } from "./lib/travels-calendar-scan";
import { startGmailScanScheduler } from "./lib/gmail-scan";
import { startErrorRateSummary } from "./lib/error-tracker";
import { startBirthdayScheduler } from "./lib/birthday-scheduler";
import { startMonitoringScheduler } from "./lib/monitoring-scheduler";
import { startJobWorker } from "./lib/jobs/worker";

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
    startReminderScheduler();
    startNudgeScheduler();
    startCalendarTripScanScheduler();
    startGmailScanScheduler();
    startErrorRateSummary();
    startBirthdayScheduler();
    startMonitoringScheduler();
    // Dedicated worker for Slack AI turns — keeps Slack processing isolated
    // from other job queues so a burst of DMs cannot starve other work.
    startJobWorker("slack");
  });

  function shutdown(signal: string): void {
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
}

runStartupMigration()
  .then(startListening)
  .catch((err) => {
    logger.error(
      { err },
      "Startup migration threw unexpectedly — starting server anyway",
    );
    startListening();
  });
