import { afterEach, describe, expect, it, vi } from "vitest";
import {
  averageVectors,
  clearAiScanPipelineCache,
  createScanFingerprint,
  generateMultiPhotoVisualEmbedding,
  getCompletePhotoScanStatus,
  runCompletePhotoScan,
  runAiScanPipeline,
  scheduleCompletePhotoScan,
} from "./ai-scan-pipeline";

describe("AI scan lifecycle", () => {
  afterEach(() => {
    clearAiScanPipelineCache();
    vi.useRealTimers();
  });

  it("fingerprints the complete ordered evidence set and mutable facts", () => {
    const base = {
      facts: { name: "Snowman", year: null },
      lockedFields: [],
      model: "vision-model",
      promptVersion: "v1",
    };
    const first = createScanFingerprint({
      ...base,
      photos: [
        { order: 0, sourceId: "primary", content: "photo-a" },
        { order: 1, sourceId: "side", content: "photo-b" },
      ],
    });
    const reordered = createScanFingerprint({
      ...base,
      photos: [
        { order: 0, sourceId: "side", content: "photo-b" },
        { order: 1, sourceId: "primary", content: "photo-a" },
      ],
    });
    const withSupplemental = createScanFingerprint({
      ...base,
      photos: [
        { order: 0, sourceId: "primary", content: "photo-a" },
        { order: 1, sourceId: "side", content: "photo-b" },
        { order: 2, sourceId: "box", content: "photo-c" },
      ],
    });

    expect(first).not.toBe(reordered);
    expect(first).not.toBe(withSupplemental);
    expect(first).not.toBe(
      createScanFingerprint({
        ...base,
        lockedFields: ["name"],
        photos: [
          { order: 0, sourceId: "primary", content: "photo-a" },
          { order: 1, sourceId: "side", content: "photo-b" },
        ],
      }),
    );
  });

  it("coalesces simultaneous and repeated scans for the same fingerprint", async () => {
    clearAiScanPipelineCache();
    let calls = 0;
    let resolveRun!: (value: { value: string }) => void;
    const pending = new Promise<{ value: string }>((resolve) => {
      resolveRun = resolve;
    });
    const run = () => {
      calls += 1;
      return pending;
    };

    const first = runAiScanPipeline("same-evidence", run);
    const second = runAiScanPipeline("same-evidence", run);
    resolveRun({ value: "complete" });
    const [one, two] = await Promise.all([first, second]);
    const cached = await runAiScanPipeline("same-evidence", run);

    expect(calls).toBe(1);
    expect(one.deduped).toBe(false);
    expect(two.deduped).toBe(true);
    expect(cached.deduped).toBe(true);
    expect(cached.result).toEqual({ value: "complete" });
  });

  it("rejects a completed result when complete evidence changes during analysis", async () => {
    clearAiScanPipelineCache();
    let fingerprint = "before-photo-change";
    let providerCalls = 0;
    const result = await runCompletePhotoScan({
      loadSnapshot: async () => ({
        fingerprint,
        value: { photos: ["front", "back"] },
      }),
      execute: async () => {
        providerCalls += 1;
        fingerprint = "after-photo-change";
        return { name: "old-result" };
      },
    });

    expect(providerCalls).toBe(1);
    expect(result.stale).toBe(true);
    expect(result.result).toEqual({ name: "old-result" });
  });

  it("coalesces providers through the complete-photo lifecycle", async () => {
    clearAiScanPipelineCache();
    let calls = 0;
    const loadSnapshot = async () => ({
      fingerprint: "same-complete-evidence",
      value: { photos: ["front", "back", "mark"] },
    });
    const execute = async () => {
      calls += 1;
      return { complete: true };
    };
    const [one, two] = await Promise.all([
      runCompletePhotoScan({ loadSnapshot, execute }),
      runCompletePhotoScan({ loadSnapshot, execute }),
    ]);

    expect(calls).toBe(1);
    expect(one.stale).toBe(false);
    expect(two.stale).toBe(false);
    expect([one.deduped, two.deduped]).toContain(true);
  });

  it("embeds every ordered photo and averages available visual vectors", async () => {
    const requested: string[] = [];
    const output = await generateMultiPhotoVisualEmbedding(
      ["front", "back", "mark"],
      async (photo) => {
        requested.push(photo);
        return photo === "back" ? null : photo === "front" ? [2, 4] : [4, 8];
      },
    );

    expect(requested).toEqual(["front", "back", "mark"]);
    expect(output.value).toEqual([3, 6]);
    expect(output.failed).toBe(false);
    expect(
      averageVectors([
        [1, 2],
        [3, 6],
      ]),
    ).toEqual([2, 4]);
  });

  it("keeps successful visual evidence when another provider call fails", async () => {
    const output = await generateMultiPhotoVisualEmbedding(
      ["front", "unavailable"],
      async (photo) => {
        if (photo === "unavailable") throw new Error("provider unavailable");
        return [1, 2, 3];
      },
    );

    expect(output.value).toEqual([1, 2, 3]);
    expect(output.failed).toBe(true);
  });

  it("coalesces rapid photo-mutation scheduling into one final scan", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const onError = vi.fn();

    scheduleCompletePhotoScan("fabric:42", run, onError, 100);
    scheduleCompletePhotoScan("fabric:42", run, onError, 100);
    await vi.advanceTimersByTimeAsync(100);

    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows pending and only completes the latest scheduled evidence", async () => {
    vi.useFakeTimers();
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRun = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => firstRun)
      .mockImplementationOnce(() => secondRun);
    const onError = vi.fn();

    scheduleCompletePhotoScan("pottery:42", run, onError, 10);
    expect(getCompletePhotoScanStatus("pottery:42")).toBe("pending");
    await vi.advanceTimersByTimeAsync(10);

    scheduleCompletePhotoScan("pottery:42", run, onError, 10);
    resolveFirst();
    await vi.advanceTimersByTimeAsync(10);
    expect(getCompletePhotoScanStatus("pottery:42")).toBe("pending");

    resolveSecond();
    await Promise.resolve();
    expect(getCompletePhotoScanStatus("pottery:42")).toBe("complete");
    expect(onError).not.toHaveBeenCalled();
  });

  it("expires completed acknowledgement state without clearing newer work", async () => {
    vi.useFakeTimers();
    let resolveSecond!: () => void;
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const onError = vi.fn();

    scheduleCompletePhotoScan("pattern:42", run, onError, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(getCompletePhotoScanStatus("pattern:42")).toBe("complete");

    scheduleCompletePhotoScan("pattern:42", run, onError, 10);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getCompletePhotoScanStatus("pattern:42")).toBe("pending");

    resolveSecond();
    await Promise.resolve();
    expect(getCompletePhotoScanStatus("pattern:42")).toBe("complete");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getCompletePhotoScanStatus("pattern:42")).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});
