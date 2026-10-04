import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPruneOldCommunicationReceipts = vi.hoisted(() => vi.fn());
const mockShouldRunScheduledTask = vi.hoisted(() => vi.fn());
const mockRecordScheduledTaskSuccess = vi.hoisted(() => vi.fn());
const mockRecordScheduledTaskFailure = vi.hoisted(() => vi.fn());

vi.mock("./communication-receipts", () => ({
  pruneOldCommunicationReceipts: mockPruneOldCommunicationReceipts,
}));
vi.mock("../lib/scheduler-guard", () => ({
  recordScheduledTaskFailure: mockRecordScheduledTaskFailure,
  recordScheduledTaskSuccess: mockRecordScheduledTaskSuccess,
  shouldRunScheduledTask: mockShouldRunScheduledTask,
}));
vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn() },
}));

import { startCommunicationReceiptCleanupScheduler } from "./communication-receipts-scheduler";

describe("communication receipt cleanup scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldRunScheduledTask.mockResolvedValue(true);
    mockPruneOldCommunicationReceipts.mockResolvedValue(undefined);
    mockRecordScheduledTaskSuccess.mockResolvedValue(undefined);
  });

  it("runs cleanup only after claiming its scheduled maintenance window", async () => {
    const stop = startCommunicationReceiptCleanupScheduler();
    try {
      await vi.waitFor(() =>
        expect(mockRecordScheduledTaskSuccess).toHaveBeenCalledOnce(),
      );
      expect(mockShouldRunScheduledTask).toHaveBeenCalledWith(
        "communication-receipt-cleanup",
        24 * 60 * 60 * 1000,
      );
      expect(mockPruneOldCommunicationReceipts).toHaveBeenCalledOnce();
      expect(mockRecordScheduledTaskFailure).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("skips cleanup when another instance already claimed the window", async () => {
    mockShouldRunScheduledTask.mockResolvedValue(false);
    const stop = startCommunicationReceiptCleanupScheduler();
    try {
      await vi.waitFor(() =>
        expect(mockShouldRunScheduledTask).toHaveBeenCalledOnce(),
      );
      expect(mockPruneOldCommunicationReceipts).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
