import { describe, expect, it, vi } from "vitest";
import { persistElaineTraceBestEffort } from "./trace-store";

describe("persistElaineTraceBestEffort", () => {
  it("marks persistence unavailable without failing the chat path", async () => {
    const onFailure = vi.fn();
    const result = await persistElaineTraceBestEffort(async () => {
      throw new Error("trace table is not available yet");
    }, onFailure);

    expect(result).toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("reports successful persistence", async () => {
    await expect(
      persistElaineTraceBestEffort(async () => undefined),
    ).resolves.toBe(true);
  });
});
