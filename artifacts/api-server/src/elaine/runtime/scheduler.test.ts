import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./scheduler";

describe("mapWithConcurrency", () => {
  it("bounds independent reads and preserves deterministic result order", async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    const results = await mapWithConcurrency([40, 5, 20, 1], 2, async (ms) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active -= 1;
      completed.push(ms);
      return `result-${ms}`;
    });

    expect(peak).toBe(2);
    expect(completed).not.toEqual([40, 5, 20, 1]);
    expect(results).toEqual(["result-40", "result-5", "result-20", "result-1"]);
  });

  it("rejects an invalid concurrency limit", async () => {
    await expect(
      mapWithConcurrency([1], 0, async (value) => value),
    ).rejects.toThrow("positive integer");
  });
});
