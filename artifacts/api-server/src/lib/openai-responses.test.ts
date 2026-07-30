import { describe, expect, it, vi } from "vitest";

vi.mock("./elaine-config", () => ({
  getElaineGlobalConfig: vi.fn(),
}));
vi.mock("./env", () => ({ env: { openaiApiKey: undefined } }));

import {
  chatUserContentToResponseInput,
  chatToolsToResponsesTools,
  createOpenAIStableIdentifier,
  isRecoverableOpenAIStateError,
  messagesToResponseInput,
  resolveOpenAIResponsesModel,
} from "./openai-responses";
import type { ElaineGlobalConfig } from "./elaine-config";

const config: ElaineGlobalConfig = {
  chatModel: "chat",
  subagentModel: "subagent",
  requestTimeoutMs: 12_000,
  maxResponseTokens: 700,
  models: {
    fastVision: "fast-vision",
    smartVision: "smart-vision",
    advisor: "advisor",
    research: "research",
    expertPanelAlt: "expert-panel-alt",
    embedding: "embedding",
    openAIReasoning: "gpt-5.6-sol",
    openAIBalanced: "gpt-5.6-terra",
    openAIFast: "gpt-5.6-luna",
    rerank: "rerank",
    visualEmbed: "visual-embed",
    fusionModels: ["fusion"],
    fusionJudge: "fusion-judge",
  },
  timeouts: {
    expertConsultMs: 15_000,
    rerankerMs: 10_000,
    geocodingMs: 5_000,
    fusionMs: 20_000,
    openAIResponsesMs: 60_000,
  },
  features: {
    enableAdvisor: true,
    enableSubagent: true,
    enableFusionPotteryExpert: false,
    enableFusionTravelDocFallback: false,
    enableOpenAIResponses: true,
    enableOpenAIAppWorkflows: true,
    enableOpenAIResponsesFallback: true,
  },
  thresholds: {
    potterySimilarityYes: 0.9,
    potterySimilarityMaybe: 0.78,
    potterySimilarityNo: 0,
    visualEmbedCropTop: 0.15,
    visualEmbedCropHeight: 0.7,
    aiJpegQuality: 88,
    potteryZoneAnalysisMaxTokens: 1024,
    potteryBackstampMaxTokens: 512,
    travelDocExtractionMaxTokens: 1000,
    openAIResponsesMaxOutputTokens: 6_000,
    openAICompactionThresholdTokens: 80_000,
    openAIStateMaxAgeDays: 29,
  },
  updatedAt: null,
};

describe("OpenAI Responses provider helpers", () => {
  it("maps semantic roles to direct OpenAI model identifiers", () => {
    expect(resolveOpenAIResponsesModel(config, "reasoning")).toBe(
      "gpt-5.6-sol",
    );
    expect(resolveOpenAIResponsesModel(config, "balanced")).toBe(
      "gpt-5.6-terra",
    );
    expect(resolveOpenAIResponsesModel(config, "fast")).toBe("gpt-5.6-luna");
  });

  it("hashes safety and cache identifiers without exposing raw IDs", () => {
    const safety = createOpenAIStableIdentifier("safety", "person@example.com");
    const cache = createOpenAIStableIdentifier("cache", "person@example.com");
    expect(safety).toMatch(/^[a-f0-9]{64}$/);
    expect(cache).toMatch(/^[a-f0-9]{64}$/);
    expect(safety).not.toContain("person");
    expect(safety).not.toBe(cache);
    expect(createOpenAIStableIdentifier("safety", "person@example.com")).toBe(
      safety,
    );
  });

  it("converts existing Chat function tools without enabling strict mode", () => {
    expect(
      chatToolsToResponsesTools([
        {
          type: "function",
          function: {
            name: "find_trip",
            description: "Find a trip",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        },
      ]),
    ).toEqual([
      {
        type: "function",
        name: "find_trip",
        description: "Find a trip",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        strict: false,
      },
    ]);
  });

  it("converts multimodal Chat input to Responses input", () => {
    expect(
      chatUserContentToResponseInput(
        [
          { type: "text", text: "Inspect this" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc" },
          },
        ],
        "original",
      ),
    ).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Inspect this" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,abc",
            detail: "original",
          },
        ],
      },
    ]);
  });

  it("only retries stateless for missing/expired previous response state", () => {
    expect(
      isRecoverableOpenAIStateError(
        Object.assign(new Error("previous_response_id was not found"), {
          status: 404,
        }),
      ),
    ).toBe(true);
    expect(
      isRecoverableOpenAIStateError(
        Object.assign(new Error("invalid model"), { status: 400 }),
      ),
    ).toBe(false);
    expect(
      isRecoverableOpenAIStateError(
        Object.assign(new Error("service unavailable"), { status: 503 }),
      ),
    ).toBe(false);
  });

  it("marks durable assistant history as final answers", () => {
    expect(
      messagesToResponseInput([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]),
    ).toEqual([
      { type: "message", role: "user", content: "Hello" },
      {
        type: "message",
        role: "assistant",
        content: "Hi",
        phase: "final_answer",
      },
    ]);
  });
});
