// Lifecycle tests for Quilting's shared bulk-run hook: per-card statuses,
// sticky outcomes, and the dismiss (generation) guard that keeps a dismissed
// run's late result from writing icons back — including the overlapping
// old-run/new-run race the guard exists to prevent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  getAsyncActionStatus,
  clearSettledAsyncActionStatuses,
  clearAsyncActionStatuses,
  useBulkReanalyzeRun,
} from "@workspace/collection-ui";

const keyFor = (id: number) => `test-bulk:${id}`;

function makeHook(
  mutateAsync: (args: {
    data: { ids: number[] };
  }) => Promise<{ succeeded: number[]; failed: number[] }>,
) {
  const invalidate = vi.fn();
  const onSettled = vi.fn();
  const onFailed = vi.fn();
  const rendered = renderHook(() =>
    useBulkReanalyzeRun({
      mutateAsync,
      keyFor,
      invalidate,
      onSettled,
      onFailed,
    }),
  );
  return { ...rendered, invalidate, onSettled, onFailed };
}

function makeIndividualItemHook(runItem: (id: number) => Promise<unknown>) {
  const invalidate = vi.fn();
  const onSettled = vi.fn();
  const onFailed = vi.fn();
  const rendered = renderHook(() =>
    useBulkReanalyzeRun({
      runItem,
      keyFor,
      invalidate,
      onSettled,
      onFailed,
    }),
  );
  return { ...rendered, invalidate, onSettled, onFailed };
}

beforeEach(() => {
  // Reset the module-scoped status store between tests.
  clearAsyncActionStatuses([1, 2, 3, 7, 8, 9].map(keyFor));
  clearSettledAsyncActionStatuses("test-bulk:");
});

describe("useBulkReanalyzeRun", () => {
  it("marks processing during the run, then sticky success/error per item", async () => {
    let resolveRun!: (v: { succeeded: number[]; failed: number[] }) => void;
    const mutateAsync = vi.fn().mockReturnValue(
      new Promise<{ succeeded: number[]; failed: number[] }>((res) => {
        resolveRun = res;
      }),
    );
    const { result, invalidate, onSettled } = makeHook(mutateAsync);

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run([1, 2]);
    });
    expect(result.current.isPending).toBe(true);
    expect(getAsyncActionStatus(keyFor(1))).toBe("processing");
    expect(getAsyncActionStatus(keyFor(2))).toBe("processing");

    await act(async () => {
      resolveRun({ succeeded: [1], failed: [2] });
      await runPromise;
    });

    expect(getAsyncActionStatus(keyFor(1))).toBe("success");
    expect(getAsyncActionStatus(keyFor(2))).toBe("error");
    expect(result.current.isPending).toBe(false);
    expect(invalidate).toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledWith({ succeeded: [1], failed: [2] });
  });

  it("settles gallery items independently while queued items stay spinner-free", async () => {
    const deferred = new Map<
      number,
      { resolve: () => void; reject: (error: Error) => void }
    >();
    const runItem = vi.fn(
      (id: number) =>
        new Promise<void>((resolve, reject) => {
          deferred.set(id, { resolve, reject });
        }),
    );
    const { result, onSettled } = makeIndividualItemHook(runItem);

    let runPromise!: Promise<unknown>;
    act(() => {
      runPromise = result.current.run([1, 2, 3, 4]);
    });

    // Three requests match the existing bulk concurrency limit. The fourth
    // item is reserved against duplicate actions but has no visible spinner.
    expect(getAsyncActionStatus(keyFor(1))).toBe("processing");
    expect(getAsyncActionStatus(keyFor(2))).toBe("processing");
    expect(getAsyncActionStatus(keyFor(3))).toBe("processing");
    expect(getAsyncActionStatus(keyFor(4))).toBe("queued");

    await act(async () => {
      deferred.get(1)!.resolve();
      await Promise.resolve();
    });
    expect(getAsyncActionStatus(keyFor(1))).toBe("success");
    expect(getAsyncActionStatus(keyFor(2))).toBe("processing");
    expect(getAsyncActionStatus(keyFor(4))).toBe("processing");

    await act(async () => {
      deferred.get(2)!.reject(new Error("AI unavailable"));
      await Promise.resolve();
    });
    expect(getAsyncActionStatus(keyFor(2))).toBe("error");
    expect(getAsyncActionStatus(keyFor(3))).toBe("processing");

    await act(async () => {
      deferred.get(3)!.resolve();
      deferred.get(4)!.resolve();
      await runPromise;
    });

    expect(getAsyncActionStatus(keyFor(3))).toBe("success");
    expect(getAsyncActionStatus(keyFor(4))).toBe("success");
    expect(onSettled).toHaveBeenCalledWith({
      succeeded: [1, 3, 4],
      failed: [2],
    });
    expect(result.current.isPending).toBe(false);
  });

  it("dismiss before success: late result must not write sticky icons", async () => {
    let resolveRun!: (v: { succeeded: number[]; failed: number[] }) => void;
    const mutateAsync = vi.fn().mockReturnValue(
      new Promise<{ succeeded: number[]; failed: number[] }>((res) => {
        resolveRun = res;
      }),
    );
    const { result, invalidate, onSettled } = makeHook(mutateAsync);

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run([1, 2]);
    });
    act(() => result.current.dismiss());

    await act(async () => {
      resolveRun({ succeeded: [1], failed: [2] });
      await runPromise;
    });

    expect(getAsyncActionStatus(keyFor(1))).toBeUndefined();
    expect(getAsyncActionStatus(keyFor(2))).toBeUndefined();
    expect(onSettled).not.toHaveBeenCalled();
    // Server data may still have changed — the list is refreshed regardless.
    expect(invalidate).toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
  });

  it("dismiss before failure: late error must not write sticky icons", async () => {
    let rejectRun!: (e: Error) => void;
    const mutateAsync = vi.fn().mockReturnValue(
      new Promise((_res, rej) => {
        rejectRun = rej;
      }),
    );
    const { result, onFailed } = makeHook(mutateAsync);

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run([7]);
    });
    act(() => result.current.dismiss());

    await act(async () => {
      rejectRun(new Error("timeout"));
      await runPromise;
    });

    expect(getAsyncActionStatus(keyFor(7))).toBeUndefined();
    expect(onFailed).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
  });

  it("dismiss → attempt a new run while the old one is in flight: the new run is refused, the old result is dropped, and a fresh run works after", async () => {
    let resolveFirst!: (v: { succeeded: number[]; failed: number[] }) => void;
    const mutateAsync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ succeeded: number[]; failed: number[] }>((res) => {
            resolveFirst = res;
          }),
      )
      .mockResolvedValue({ succeeded: [8, 9], failed: [] });
    const { result } = makeHook(mutateAsync);

    let firstRun!: Promise<void>;
    act(() => {
      firstRun = result.current.run([1, 2]);
    });
    // User presses Done (dismiss), reopens Select mode, and tries a new run
    // while the first request is still pending.
    act(() => result.current.dismiss());
    await act(async () => {
      await result.current.run([8, 9]);
    });
    // The overlapping run must be refused — no second request, no statuses.
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(getAsyncActionStatus(keyFor(8))).toBeUndefined();
    expect(getAsyncActionStatus(keyFor(9))).toBeUndefined();

    // The old run settles: its stale outcome is dropped entirely.
    await act(async () => {
      resolveFirst({ succeeded: [1], failed: [2] });
      await firstRun;
    });
    expect(getAsyncActionStatus(keyFor(1))).toBeUndefined();
    expect(getAsyncActionStatus(keyFor(2))).toBeUndefined();
    expect(result.current.isPending).toBe(false);

    // Now a fresh run proceeds normally with clean state.
    await act(async () => {
      await result.current.run([8, 9]);
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(getAsyncActionStatus(keyFor(8))).toBe("success");
    expect(getAsyncActionStatus(keyFor(9))).toBe("success");
  });
});
