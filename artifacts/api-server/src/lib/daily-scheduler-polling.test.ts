import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  execute: vi.fn(),
  users: vi.fn(),
  calendars: vi.fn(),
  prune: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {
    execute: mocks.execute,
    select: () => ({ from: () => ({ where: mocks.users }) }),
  },
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
vi.mock("./email", () => ({
  resendConfigured: () => true,
  sendBirthdayEmail: vi.fn(),
}));
vi.mock("./google-calendar-tokens", () => ({
  getAllConnectedCalendars: mocks.calendars,
  getValidAccessToken: vi.fn(),
}));
vi.mock("./google-calendar", () => ({ listCalendarEvents: vi.fn() }));
vi.mock("./ai-client", () => ({ callModel: vi.fn(), getModels: vi.fn() }));
vi.mock("../elaine/communication-receipts", () => ({
  pruneOldCommunicationReceipts: mocks.prune,
}));

import { startBirthdayScheduler } from "./birthday-scheduler";
import { startCalendarTripScanScheduler } from "./travels-calendar-scan";
import { startWebhookSideEffectCleanupScheduler } from "./webhook-side-effect-idempotency";
import { startCommunicationReceiptCleanupScheduler } from "../elaine/communication-receipts-scheduler";

const DAY = 86_400_000;
const POLL = 900_000;
describe.each([
  [
    "birthday-emails",
    startBirthdayScheduler,
    { recoverStuckClaims: false, utcDate: expect.any(String) },
  ],
  [
    "travels-calendar-scan",
    startCalendarTripScanScheduler,
    { recoverStuckClaims: false, incompleteRetryIntervalMs: 3_600_000 },
  ],
  [
    "webhook-side-effect-cleanup",
    startWebhookSideEffectCleanupScheduler,
    undefined,
  ],
  [
    "communication-receipt-cleanup",
    startCommunicationReceiptCleanupScheduler,
    undefined,
  ],
] as const)("%s due-work integration", (name, start, options) => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.claim.mockResolvedValue(false);
    mocks.success.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.users.mockResolvedValue([]);
    mocks.calendars.mockResolvedValue([]);
    mocks.prune.mockResolvedValue(0);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("rechecks a denied startup claim within fifteen minutes, with the full daily cooldown unchanged", async () => {
    stop = start();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    for (const call of mocks.claim.mock.calls) {
      expect(call).toEqual(options ? [name, DAY, options] : [name, DAY]);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.calendars).not.toHaveBeenCalled();
    expect(mocks.prune).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("completes newly due work and does not replay it on subsequent denied polls", async () => {
    mocks.claim.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    stop = start();
    await vi.advanceTimersByTimeAsync(3 * POLL);
    expect(mocks.claim).toHaveBeenCalledTimes(4);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(name);
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("continues after a rejected claim and cancels future polls when stopped", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("DB connection unavailable"));
    stop = start();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
