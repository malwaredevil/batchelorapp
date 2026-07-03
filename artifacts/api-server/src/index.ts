import app from "./app";
import { logger } from "./lib/logger";
import { runStartupMigration } from "./lib/startup-migrate";
import { startReminderScheduler } from "./lib/reminder-scheduler";
import { startNudgeScheduler } from "./lib/travels-nudges";

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

runStartupMigration()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startReminderScheduler();
      startNudgeScheduler();
    });
  })
  .catch((err) => {
    logger.error(
      { err },
      "Startup migration threw unexpectedly — starting server anyway",
    );
    app.listen(port, (err2) => {
      if (err2) {
        logger.error({ err: err2 }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      startReminderScheduler();
      startNudgeScheduler();
    });
  });
