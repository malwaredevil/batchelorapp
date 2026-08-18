import { describe, expect, it, vi } from "vitest";
import { runWithSubagentFallback } from "./subagent-fallback";

/** Synthetic 5xx error matching the shape is5xxError() checks. */
const make5xx = (status = 500) =>
  Object.assign(new Error("upstream"), { status });
const make4xx = () => Object.assign(new Error("bad request"), { status: 400 });

describe("runWithSubagentFallback", () => {
  it("returns normally when primary succeeds — fallback is never called", async () => {
    const primary = vi.fn().mockResolvedValue(undefined);
    const onReset = vi.fn();
    const fallback = vi.fn();
    const onDegraded = vi.fn();

    await runWithSubagentFallback({
      primary,
      shouldDegrade: () => false,
      onReset,
      fallback,
      onDegraded,
    });

    expect(primary).toHaveBeenCalledOnce();
    expect(onReset).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it("degrades to fallback after 5xx: calls onReset then fallback", async () => {
    const err = make5xx();
    const callOrder: string[] = [];

    const primary = vi.fn().mockRejectedValue(err);
    const onReset = vi.fn().mockImplementation(() => {
      callOrder.push("reset");
    });
    const fallback = vi.fn().mockImplementation(() => {
      callOrder.push("fallback");
      return Promise.resolve();
    });
    const onDegraded = vi.fn();

    await runWithSubagentFallback({
      primary,
      shouldDegrade: (e) => (e as { status: number }).status >= 500,
      onReset,
      fallback,
      onDegraded,
    });

    expect(onDegraded).toHaveBeenCalledWith(err);
    expect(callOrder).toEqual(["reset", "fallback"]);
  });

  it("propagates non-5xx errors without resetting or retrying", async () => {
    const err = make4xx();
    const onReset = vi.fn();
    const fallback = vi.fn();

    await expect(
      runWithSubagentFallback({
        primary: vi.fn().mockRejectedValue(err),
        shouldDegrade: (e) => (e as { status: number }).status >= 500,
        onReset,
        fallback,
      }),
    ).rejects.toBe(err);

    expect(onReset).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("propagates 5xx without retrying when shouldDegrade returns false", async () => {
    const err = make5xx();
    const onReset = vi.fn();
    const fallback = vi.fn();

    await expect(
      runWithSubagentFallback({
        primary: vi.fn().mockRejectedValue(err),
        shouldDegrade: () => false,
        onReset,
        fallback,
      }),
    ).rejects.toBe(err);

    expect(onReset).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("propagates the fallback error when the degraded retry also fails", async () => {
    const primaryErr = make5xx(503);
    const fallbackErr = make5xx(502);

    await expect(
      runWithSubagentFallback({
        primary: vi.fn().mockRejectedValue(primaryErr),
        shouldDegrade: (e) => (e as { status: number }).status >= 500,
        onReset: vi.fn(),
        fallback: vi.fn().mockRejectedValue(fallbackErr),
      }),
    ).rejects.toBe(fallbackErr);
  });

  it("does not call onDegraded when shouldDegrade returns false", async () => {
    const err = make5xx();
    const onDegraded = vi.fn();

    await expect(
      runWithSubagentFallback({
        primary: vi.fn().mockRejectedValue(err),
        shouldDegrade: () => false,
        onReset: vi.fn(),
        fallback: vi.fn(),
        onDegraded,
      }),
    ).rejects.toBe(err);

    expect(onDegraded).not.toHaveBeenCalled();
  });
});
