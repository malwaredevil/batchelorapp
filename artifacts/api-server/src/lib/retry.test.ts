import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";

vi.mock("./logger", () => ({
  logger: { warn: vi.fn() },
}));

afterEach(() => vi.useRealTimers());

describe("withRetry database causes", () => {
  it.each([
    "timeout exceeded when trying to connect",
    "Connection terminated due to connection timeout",
    "ECONNRESET",
  ])("retries a wrapped pg error: %s", async (message) => {
    const failure = new Error("Failed query: select owner", {
      cause: new Error(message),
    });
    const work = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue("ok");
    expect(
      await withRetry(work, {
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent database error", async () => {
    const failure = new Error("Failed query", {
      cause: new Error("column missing"),
    });
    const work = vi.fn().mockRejectedValue(failure);
    await expect(withRetry(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("stops at the configured retry limit and preserves the original error", async () => {
    const failure = new Error("Failed query", {
      cause: new Error("timeout exceeded when trying to connect"),
    });
    const work = vi.fn().mockRejectedValue(failure);
    await expect(
      withRetry(work, { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 }),
    ).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("handles cyclic error causes without looping or retrying", async () => {
    const failure = new Error("permanent failure");
    failure.cause = failure;
    const work = vi.fn().mockRejectedValue(failure);
    await expect(withRetry(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("does not retry an explicit HTTP 4xx response", async () => {
    const failure = new Error("HTTP 401", { cause: new Error("network") });
    const work = vi.fn().mockRejectedValue(failure);
    await expect(withRetry(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
