import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElaineGlobalConfig } from "./elaine-config";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  return {
    ...actual,
    default: class extends actual.default {
      constructor(options: ConstructorParameters<typeof actual.default>[0]) {
        super(options);
        this.responses.create = mocks.create;
      }
    },
  };
});
vi.mock("./env", () => ({ env: { openaiApiKey: "test-only-placeholder" } }));
vi.mock("./elaine-config", () => ({ getElaineGlobalConfig: vi.fn() }));
vi.mock("./circuit-breaker", () => ({
  circuitBreaker: { execute: (_key: string, fn: () => unknown) => fn() },
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { Sentry } from "./sentry";
import {
  generateOpenAIResponseTextWithFallback,
  OpenAIResponsesUnavailableError,
} from "./openai-responses";

const config = {
  features: {
    enableOpenAIResponses: true,
    enableOpenAIAppWorkflows: true,
    enableOpenAIResponsesFallback: true,
    openAIStoreEnabledDefault: false,
    openAIStoreScopeOverrides: {},
    openAIStoreRoleOverrides: {},
  },
  models: { openAIBalanced: "test-model" },
  timeouts: { openAIResponsesMs: 1000 },
  thresholds: { openAIResponsesMaxOutputTokens: 100 },
} as ElaineGlobalConfig;

const timeoutEvent: Sentry.Event = {
  level: "error",
  exception: {
    values: [
      {
        value: "Request timed out.",
        mechanism: { type: "auto.ai.openai", handled: false },
      },
    ],
  },
};
let captured: Promise<Sentry.Event | null>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockImplementation(async () => {
    const error = new OpenAI.APIConnectionTimeoutError();
    const processors = Sentry.getCurrentScope().getScopeData().eventProcessors;
    captured = Promise.resolve(
      processors.at(-1)!(timeoutEvent, {
        originalException: error,
      }),
    );
    throw error;
  });
});

describe("confirmed Responses fallback telemetry", () => {
  const options = {
    scope: "app" as const,
    role: "balanced" as const,
    instructions: "Return a short test analysis.",
    input: "test",
    config,
  };

  it("uses the existing fallback once and downgrades only after it succeeds", async () => {
    const fallback = vi.fn(async () => "analysis");
    await expect(
      generateOpenAIResponseTextWithFallback(options, fallback),
    ).resolves.toEqual({
      text: "analysis",
      provider: "openrouter",
      model: null,
    });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
    await expect(captured).resolves.toMatchObject({ level: "warning" });
  });

  it("keeps an error if the fallback also fails", async () => {
    const error = new Error("fallback failed");
    const fallback = vi.fn(async () => {
      throw error;
    });
    await expect(
      generateOpenAIResponseTextWithFallback(options, fallback),
    ).rejects.toBe(error);
    await expect(captured).resolves.toBe(timeoutEvent);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("respects the owner's disabled fallback setting and preserves the error", async () => {
    const fallback = vi.fn();
    const disabled = {
      ...config,
      features: { ...config.features, enableOpenAIResponsesFallback: false },
    };
    await expect(
      generateOpenAIResponseTextWithFallback(
        { ...options, config: disabled },
        fallback,
      ),
    ).rejects.toBeInstanceOf(OpenAIResponsesUnavailableError);
    expect(fallback).not.toHaveBeenCalled();
    await expect(captured).resolves.toBe(timeoutEvent);
  });
});
