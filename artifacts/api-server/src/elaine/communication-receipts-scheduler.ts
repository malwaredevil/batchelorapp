import { logger } from "../lib/logger";
import {
  recordScheduledTaskFailure,
  recordScheduledTaskSuccess,
  shouldRunScheduledTask,
} from "../lib/scheduler-guard";
import { pruneOldCommunicationReceipts } from "./communication-receipts";
import { startSchedulerPoller } from "../lib/scheduler-poller";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startCommunicationReceiptCleanupScheduler(): () => void {
  const run = async (): Promise<void> => {
    if (
      !(await shouldRunScheduledTask(
        "communication-receipt-cleanup",
        CLEANUP_INTERVAL_MS,
      ))
    ) {
      return;
    }
    try {
      await pruneOldCommunicationReceipts();
      await recordScheduledTaskSuccess("communication-receipt-cleanup");
    } catch (err) {
      logger.error({ err }, "communication-receipts: cleanup failed");
      recordScheduledTaskFailure("communication-receipt-cleanup");
    }
  };

  return startSchedulerPoller(
    "communication-receipt-cleanup",
    CLEANUP_INTERVAL_MS,
    run,
  );
}
