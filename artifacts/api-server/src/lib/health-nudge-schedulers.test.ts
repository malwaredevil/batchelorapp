import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  checks: vi.fn(),
  owner: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  pool: { connect: mocks.connect },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.owner }),
      }),
    }),
  },
}));
vi.mock("./scheduler-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduler-guard")>()),
  shouldRunScheduledTask: mocks.claim,
  recordScheduledTaskSuccess: mocks.success,
  recordScheduledTaskFailure: mocks.failure,
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./sentry-issues", () => ({
  isSentryIssuesConfigured: () => false,
  listSentryIssues: vi.fn(),
}));
vi.mock("./ai-client", () => ({ callModel: vi.fn(), getModels: vi.fn() }));
vi.mock("../routes/admin/integrations-health", () => ({
  runAllChecks: mocks.checks,
}));

import { startSentryErrorNudgeScheduler } from "./sentry-error-nudges";
import {
  startIntegrationsHealthNudgeScheduler,
  _resetTestState,
} from "./integrations-health-nudges";

const MINUTE = 60_000;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  vi.resetAllMocks();
  _resetTestState();
  mocks.owner.mockResolvedValue([{ id: 1 }]);
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
  mocks.checks.mockResolvedValue({ checks: [] });
  mocks.success.mockResolvedValue(undefined);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe.each([
  ["sentry-error-nudges", startSentryErrorNudgeScheduler],
  ["integrations-health-nudges", startIntegrationsHealthNudgeScheduler],
] as const)("%s persisted due-work polling", (name, start) => {
  it("rechecks a denied startup within 15 minutes without shortening the work cooldown", async () => {
    let lastRun = Date.now() - 20 * MINUTE;
    mocks.claim.mockImplementation(async (_name, interval) => {
      if (Date.now() - lastRun < interval) return false;
      lastRun = Date.now();
      return true;
    });
    stop = start();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(mocks.claim).toHaveBeenCalledWith(name, 30 * MINUTE);
    expect(mocks.success).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(13 * MINUTE);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(name);
    const probesAfterRun = mocks.checks.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.checks).toHaveBeenCalledTimes(probesAfterRun);
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("does no more polling after cleanup", async () => {
    mocks.claim.mockResolvedValue(false);
    stop = start();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    stop();
    stop = undefined;
    const count = mocks.claim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(mocks.claim).toHaveBeenCalledTimes(count);
  });
});

it("retries a wrapped owner-lookup timeout before acquiring a persistence connection", async () => {
  mocks.claim.mockResolvedValue(true);
  mocks.owner.mockRejectedValueOnce(
    new Error("Failed query", {
      cause: new Error("timeout exceeded when trying to connect"),
    }),
  );
  stop = startIntegrationsHealthNudgeScheduler();
  await vi.advanceTimersByTimeAsync(0); // complete the startup priming pass
  mocks.connect.mockClear();
  await vi.advanceTimersByTimeAsync(2 * MINUTE);
  expect(mocks.owner).toHaveBeenCalledTimes(2);
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
    "integrations-health-nudges",
  );
  expect(mocks.failure).not.toHaveBeenCalled();
});
