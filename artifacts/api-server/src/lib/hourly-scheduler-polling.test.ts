import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  pool: { connect: mocks.connect },
  db: { select: mocks.select },
}));
vi.mock("./scheduler-guard", () => ({
  shouldRunScheduledTask: mocks.claim,
  recordScheduledTaskSuccess: mocks.success,
  recordScheduledTaskFailure: mocks.failure,
  getSchedulerPollIntervalMs: (interval: number) => Math.min(interval, 900_000),
}));
vi.mock("./logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("./travels/google-maps", () => ({
  getAirQuality: vi.fn(),
  getPollenForecast: vi.fn(),
}));
vi.mock("./notifications", () => ({
  createNotification: vi.fn(),
  NOTIFICATION_TYPES: {
    TRAVEL_RESERVATION_CHANGE: "travel_reservation_change",
  },
}));

import { computeAndStoreNudges, startNudgeScheduler } from "./travels-nudges";
import { startMonitoringScheduler } from "./monitoring-scheduler";

const HOUR = 3_600_000;
const POLL = 900_000;

describe.each([
  ["travels-nudges", startNudgeScheduler, 0],
  ["monitoring-scheduler", startMonitoringScheduler, 120_000],
] as const)("%s hourly due-work recovery", (name, start, grace) => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.claim.mockResolvedValue(false);
    mocks.success.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.select.mockReturnValue({
      from: () => ({ where: mocks.where }),
    });
    mocks.where.mockResolvedValue([]);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("rechecks a denied claim in fifteen minutes without running work or changing the hourly cooldown", async () => {
    stop = start();
    await vi.advanceTimersByTimeAsync(grace + POLL);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    for (const call of mocks.claim.mock.calls) {
      expect(call).toEqual([name, HOUR, { recoverStuckClaims: false }]);
    }
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("recovers a failed claim on the next poll and does not replay work after denied polls", async () => {
    mocks.claim
      .mockRejectedValueOnce(new Error("connection timeout"))
      .mockResolvedValueOnce(true);
    stop = start();
    await vi.advanceTimersByTimeAsync(grace + 3 * POLL);
    expect(mocks.claim).toHaveBeenCalledTimes(4);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(name);
    expect(mocks.failure).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(mocks.claim).toHaveBeenCalledTimes(4);
  });

  it("records a work failure honestly and continues polling", async () => {
    mocks.claim.mockResolvedValueOnce(true);
    mocks.connect.mockRejectedValueOnce(new Error("database unavailable"));
    mocks.where.mockRejectedValueOnce(new Error("database unavailable"));
    stop = start();
    await vi.advanceTimersByTimeAsync(grace + POLL);
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith(name);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenCalledTimes(2);
  });

  it("cancels before the next scheduled tick", async () => {
    stop = start();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const calls = mocks.claim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(mocks.claim).toHaveBeenCalledTimes(calls);
  });
});

it("does not report a successful nudge computation when connecting to the database fails", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(computeAndStoreNudges()).rejects.toThrow("database unavailable");
});
