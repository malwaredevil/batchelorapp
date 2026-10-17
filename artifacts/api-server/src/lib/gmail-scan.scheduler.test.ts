import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  connections: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {},
}));

vi.mock("./scheduler-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduler-guard")>()),
  shouldRunScheduledTask: mocks.claim,
  recordScheduledTaskSuccess: mocks.success,
  recordScheduledTaskFailure: mocks.failure,
}));

vi.mock("./gmail-tokens", () => ({
  getAllGmailConnections: mocks.connections,
  getValidGmailAccessToken: vi.fn(),
}));

vi.mock("./gmail-api", () => ({
  searchMessages: vi.fn(),
  getMessage: vi.fn(),
  parseGmailMessage: vi.fn(),
}));

vi.mock("./travel-document-extraction", () => ({
  extractFromEmailText: vi.fn(),
}));

vi.mock("./gmail-labels", () => ({ TRAVEL_LABEL_NAME: "Travel" }));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { startGmailScanScheduler } from "./gmail-scan";
import { getSchedulerPollIntervalMs } from "./scheduler-guard";

const HOUR_MS = 60 * 60 * 1000;
const SCAN_INTERVAL_MS = 6 * HOUR_MS;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T11:00:00Z"));
  vi.clearAllMocks();
  mocks.connections.mockResolvedValue([]);
  mocks.success.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe("Gmail scheduler due-work polling", () => {
  it("catches up when a startup claim is denied instead of waiting six more hours", async () => {
    let lastRunAt = Date.now() - 5 * HOUR_MS;
    mocks.claim.mockImplementation(async (_name, intervalMs) => {
      if (Date.now() - lastRunAt < intervalMs) return false;
      lastRunAt = Date.now();
      return true;
    });

    stop = startGmailScanScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.connections).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR_MS - 1);
    expect(mocks.connections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.connections).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith("gmail-scan");
    expect(
      mocks.claim.mock.calls.every(
        ([name, intervalMs, options]) =>
          name === "gmail-scan" &&
          intervalMs === SCAN_INTERVAL_MS &&
          options.recoverStuckClaims === false,
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(mocks.connections).toHaveBeenCalledTimes(1);
  });

  it("does not scan or acknowledge success without a granted claim", async () => {
    mocks.claim.mockResolvedValue(false);
    stop = startGmailScanScheduler();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);

    expect(mocks.claim.mock.calls.length).toBeGreaterThan(2);
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("does not overlap a long scan when another polling tick arrives", async () => {
    mocks.claim.mockResolvedValue(true);
    let finishScan!: (connections: []) => void;
    mocks.connections.mockReturnValueOnce(
      new Promise<[]>((resolve) => {
        finishScan = resolve;
      }),
    );
    stop = startGmailScanScheduler();
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.connections).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();

    finishScan([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith("gmail-scan");
  });

  it("stops polling when the scheduler is stopped", async () => {
    mocks.claim.mockResolvedValue(false);
    stop = startGmailScanScheduler();
    await vi.advanceTimersByTimeAsync(0);
    const calls = mocks.claim.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(mocks.claim).toHaveBeenCalledTimes(calls);
  });

  it("polls no slower than the heartbeat or faster than a shorter task interval", () => {
    expect(getSchedulerPollIntervalMs(SCAN_INTERVAL_MS)).toBe(15 * 60 * 1000);
    expect(getSchedulerPollIntervalMs(60 * 1000)).toBe(60 * 1000);
  });
});
