import { getSchedulerPollIntervalMs } from "./scheduler-guard";
import { logger } from "./logger";

/**
 * Poll persisted due-work claims without changing their execution cooldown.
 * Schedule after settlement so slow claims/work cannot overlap locally.
 * The caller must retain its atomic cross-instance claim.
 */
export function startSchedulerPoller(
  taskName: string,
  executionIntervalMs: number,
  run: () => Promise<void>,
): () => void {
  const pollIntervalMs = getSchedulerPollIntervalMs(executionIntervalMs);
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await run();
    } catch (err) {
      logger.error({ err, taskName }, "scheduler-poller: tick failed");
    } finally {
      if (!stopped) {
        timeout = setTimeout(() => void tick(), pollIntervalMs);
        timeout.unref();
      }
    }
  };
  logger.info(
    { taskName, pollIntervalMs, executionIntervalMs },
    "scheduler-poller: started",
  );
  void tick();
  return () => {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}
