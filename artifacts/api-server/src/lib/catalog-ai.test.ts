import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./app-config", () => ({ getConfig: vi.fn() }));
import { getConfig } from "./app-config";
import { CatalogAIBusyError, runCatalogAI } from "./catalog-ai";

let concurrency = 2;
let maxQueued = 10;
let waitMs = 100;

beforeEach(() => {
  vi.useFakeTimers();
  concurrency = 2;
  maxQueued = 10;
  waitMs = 100;
  vi.mocked(getConfig).mockImplementation(async (_module, key, fallback) => {
    const values: Record<string, number> = {
      catalog_concurrency: concurrency,
      catalog_max_queued: maxQueued,
      catalog_queue_wait_ms: waitMs,
    };
    return (values[key] ?? fallback) as unknown as typeof fallback;
  });
});
afterEach(() => vi.useRealTimers());

describe("catalog AI capacity", () => {
  it("bounds active calls across independent batches", async () => {
    let active = 0;
    let peak = 0;
    const run = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return "done";
    };
    const first = Promise.all(
      Array.from({ length: 3 }, () => runCatalogAI(run)),
    );
    const second = Promise.all(
      Array.from({ length: 3 }, () => runCatalogAI(run)),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toEqual(["done", "done", "done"]);
    expect(await second).toEqual(["done", "done", "done"]);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("never starts paid work after its queue deadline expires", async () => {
    concurrency = 1;
    waitMs = 10;
    let finish!: () => void;
    const running = runCatalogAI(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const paidRequest = vi.fn(async () => "late request");
    const expired = expect(runCatalogAI(paidRequest)).rejects.toBeInstanceOf(
      CatalogAIBusyError,
    );
    await vi.advanceTimersByTimeAsync(20);
    await expired;
    finish();
    await running;
    await vi.advanceTimersByTimeAsync(0);
    expect(paidRequest).not.toHaveBeenCalled();
  });

  it("rejects excess queued work before it reaches the model", async () => {
    concurrency = 1;
    maxQueued = 1;
    let finish!: () => void;
    const running = runCatalogAI(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const queued = runCatalogAI(async () => "queued");
    await vi.advanceTimersByTimeAsync(0);
    const excess = vi.fn(async () => "excess");
    await expect(runCatalogAI(excess)).rejects.toMatchObject({ status: 503 });
    expect(excess).not.toHaveBeenCalled();
    finish();
    await running;
    expect(await queued).toBe("queued");
  });

  it("releases capacity on failure without retrying", async () => {
    const run = vi.fn(async () => {
      throw new Error("provider failed");
    });
    await expect(runCatalogAI(run)).rejects.toThrow("provider failed");
    expect(run).toHaveBeenCalledTimes(1);
    await expect(runCatalogAI(async () => "next")).resolves.toBe("next");
  });

  it("does not apply the queue deadline after the request starts", async () => {
    waitMs = 10;
    const running = runCatalogAI(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "completed within SDK timeout";
    });
    await vi.advanceTimersByTimeAsync(35);
    expect(await running).toBe("completed within SDK timeout");
  });

  it("fails explicitly on invalid capacity configuration", async () => {
    concurrency = 0;
    const run = vi.fn();
    await expect(runCatalogAI(run)).rejects.toThrow(
      "Invalid catalog AI capacity configuration.",
    );
    expect(run).not.toHaveBeenCalled();
  });
});
