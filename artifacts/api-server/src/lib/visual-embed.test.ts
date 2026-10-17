import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ env: { jinaApiKey: "test-jina-key" } }));
vi.mock("./ai-client", () => ({ getThresholds: vi.fn() }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn() } }));

import { generateVisualEmbedding } from "./visual-embed";

afterEach(() => vi.unstubAllGlobals());

describe("visual embedding request cancellation", () => {
  it("does not start a paid request when its caller has already disconnected", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateVisualEmbedding("data:image/jpeg;base64,test", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts an in-flight fetch without retrying the abandoned operation", async () => {
    const fetch = vi.fn(
      (_url: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = expect(
      generateVisualEmbedding("data:image/jpeg;base64,test", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
