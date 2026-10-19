import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./scheduler-guard", () => ({
  getSchedulerPollIntervalMs: (interval: number) =>
    Math.min(interval, 15 * 60 * 1000),
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
import { startSchedulerPoller } from "./scheduler-poller";
import { logger } from "./logger";

const DAY = 24 * 60 * 60 * 1000;
const POLL = 15 * 60 * 1000;

describe("persisted scheduler due-work polling", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("rechecks a daily task near its persisted deadline after a restart partway through the cooldown", async () => {
    let claimedAt = Date.now() - DAY + 2 * POLL;
    const work = vi.fn();
    const check = vi.fn(async () => {
      if (Date.now() - claimedAt >= DAY) {
        claimedAt = Date.now();
        work();
      }
    });
    stop = startSchedulerPoller("daily", DAY, check);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(work).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4 * POLL);
    expect(check).toHaveBeenCalledTimes(7);
    expect(work).toHaveBeenCalledOnce();
  });

  it("recovers at the next poll after a claim throws, without unhandled rejection", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("DB unavailable"))
      .mockResolvedValue(undefined);
    stop = startSchedulerPoller("daily", DAY, run);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("does not overlap slow claims/work and does not reschedule after stop during a run", async () => {
    let finish!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    stop = startSchedulerPoller("daily", DAY, run);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledOnce();
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledOnce();
  });

  it("cancels an already queued poll", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    stop = startSchedulerPoller("daily", DAY, run);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledOnce();
  });
});
