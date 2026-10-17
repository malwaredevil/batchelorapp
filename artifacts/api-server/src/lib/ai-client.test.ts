import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./elaine-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./elaine-config")>();
  return { ...actual, getElaineGlobalConfig: vi.fn() };
});
vi.mock("./app-config", () => ({
  getConfig: vi.fn(async (_module, _key, fallback) => fallback),
}));
vi.mock("./logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  DEFAULT_MODELS,
  ELAINE_CONFIG_DEFAULTS,
  getElaineGlobalConfig,
} from "./elaine-config";
import {
  callModel,
  callModelWithAdvisor,
  getModels,
  MODELS,
} from "./ai-client";
import { circuitBreaker, CircuitOpenError } from "./circuit-breaker";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getElaineGlobalConfig).mockResolvedValue(
    structuredClone(ELAINE_CONFIG_DEFAULTS),
  );
});

describe("supporting model routing", () => {
  it("isolates a failed catalog model from interactive work and other models", async () => {
    const model = "test/failed-catalog-model";
    const key = `openrouter:catalog:${model}`;
    circuitBreaker.reset(key);
    const failed = vi.fn(async () => {
      throw new Error("Request timed out.");
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(callModel(model, failed, "catalog")).rejects.toThrow(
        "Request timed out.",
      );
    }
    await expect(callModel(model, failed, "catalog")).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(failed).toHaveBeenCalledTimes(5);
    await expect(callModel(model, async () => "interactive ok")).resolves.toBe(
      "interactive ok",
    );
    await expect(
      callModel("test/embedding-model", async () => "embedding ok", "catalog"),
    ).resolves.toBe("embedding ok");
    circuitBreaker.reset(key);
  });

  it("keeps static recognition defaults aligned with owner-config defaults", () => {
    expect(MODELS.FAST_VISION).toBe(DEFAULT_MODELS.fastVision);
    expect(MODELS.SMART_VISION).toBe(DEFAULT_MODELS.smartVision);
    expect(MODELS.ADVISOR).toBe(DEFAULT_MODELS.advisor);
  });

  it("resolves configured overrides rather than reverting to new defaults", async () => {
    vi.mocked(getElaineGlobalConfig).mockResolvedValue({
      ...ELAINE_CONFIG_DEFAULTS,
      models: {
        ...DEFAULT_MODELS,
        fastVision: "custom/recognizer",
        advisor: "custom/advisor",
        rerank: "rerank-2.5",
        fusionModels: ["custom/panel", "openai/gpt-5.1"],
      },
    });
    expect(await getModels()).toMatchObject({
      fastVision: "custom/recognizer",
      advisor: "custom/advisor",
      rerank: "rerank-2.5",
      fusionModels: ["custom/panel", "openai/gpt-5.1"],
    });
  });

  it("uses the same defaults for emergency resolution and fusion fallback", async () => {
    vi.mocked(getElaineGlobalConfig).mockRejectedValue(
      new Error("unavailable"),
    );
    expect(await getModels()).toMatchObject({
      fastVision: DEFAULT_MODELS.fastVision,
      smartVision: DEFAULT_MODELS.smartVision,
      advisor: DEFAULT_MODELS.advisor,
      rerank: DEFAULT_MODELS.rerank,
      fusionModels: DEFAULT_MODELS.fusionModels,
      fusionJudge: DEFAULT_MODELS.fusionJudge,
      embedding: DEFAULT_MODELS.embedding,
    });
  });

  it("offers the upgraded advisor to the executing model's server tool", async () => {
    const tools = await callModelWithAdvisor(
      DEFAULT_MODELS.fastVision,
      "Review ambiguous attribution.",
      async (_client, _model, serverTools) => serverTools,
    );
    expect(tools).toEqual([
      {
        type: "openrouter:advisor",
        parameters: {
          model: "anthropic/claude-opus-5.5",
          instructions: "Review ambiguous attribution.",
        },
      },
    ]);
  });
});
