import { describe, expect, it, vi } from "vitest";

vi.mock("./elaine-config", () => ({
  getElaineGlobalConfig: vi.fn(),
}));
vi.mock("./env", () => ({ env: { openaiApiKey: undefined } }));

import {
  buildResponsesToolsParam,
  chatUserContentToResponseInput,
  chatToolsToResponsesTools,
  createOpenAIStableIdentifier,
  extractWebSearchCallSources,
  isRecoverableOpenAIStateError,
  messagesToResponseInput,
  resolveOpenAIResponsesModel,
  resolveOpenAIResponsesStore,
} from "./openai-responses";
import type { ResponseFunctionWebSearch } from "openai/resources/responses/responses";
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
    restrictedTextModel: "restricted-text",
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
    enableBuiltinWebSearch: true,
    showReasoningSummary: true,
    openAIStoreEnabledDefault: false,
    openAIStoreScopeOverrides: {},
    openAIStoreRoleOverrides: {},
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
    codeDiagnosisRecurrenceThreshold: 3,
    broadcastHourlyLimit: 3,
  },
  runtimeBudget: {
    maxModelRounds: 8,
    maxToolCalls: 24,
    maxReplans: 10,
    maxElapsedMs: 240_000,
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

  it("resolves response storage policy from role, scope, then default", () => {
    expect(resolveOpenAIResponsesStore(config, "reasoning", "elaine")).toBe(
      false,
    );

    const withScopeOverride: ElaineGlobalConfig = {
      ...config,
      features: {
        ...config.features,
        openAIStoreScopeOverrides: { elaine: true },
      },
    };
    expect(
      resolveOpenAIResponsesStore(withScopeOverride, "balanced", "elaine"),
    ).toBe(true);

    const withRoleOverride: ElaineGlobalConfig = {
      ...config,
      features: {
        ...config.features,
        openAIStoreScopeOverrides: { elaine: false },
        openAIStoreRoleOverrides: { balanced: true },
      },
    };
    expect(
      resolveOpenAIResponsesStore(withRoleOverride, "balanced", "elaine"),
    ).toBe(true);
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

const SAMPLE_FUNCTION_TOOL = {
  type: "function" as const,
  function: {
    name: "navigate",
    description: "Navigate to a page",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

import {
  buildReasoningParam,
  accumulateReasoningSummaryEvent,
  finalizeReasoningSummary,
} from "./openai-responses";

// ─── buildReasoningParam ─────────────────────────────────────────────────────

describe("buildReasoningParam", () => {
  it("defaults effort to 'low' and context to 'all_turns'", () => {
    const p = buildReasoningParam({});
    expect(p.effort).toBe("low");
    expect(p.context).toBe("all_turns");
    expect(p.summary).toBeUndefined();
  });

  it("includes summary:'detailed' when showReasoningSummary is true", () => {
    const p = buildReasoningParam({ showReasoningSummary: true });
    expect(p.summary).toBe("detailed");
  });

  it("omits summary when showReasoningSummary is false", () => {
    const p = buildReasoningParam({ showReasoningSummary: false });
    expect(p.summary).toBeUndefined();
  });

  it("omits summary when showReasoningSummary is undefined", () => {
    const p = buildReasoningParam({ reasoningEffort: "high" });
    expect(p.summary).toBeUndefined();
  });

  it("passes through the caller's reasoningEffort", () => {
    const p = buildReasoningParam({ reasoningEffort: "medium" });
    expect(p.effort).toBe("medium");
  });
});

// ─── accumulateReasoningSummaryEvent ─────────────────────────────────────────

describe("accumulateReasoningSummaryEvent", () => {
  it("returns null and ignores non-summary events", () => {
    const parts = new Map<number, string>();
    expect(
      accumulateReasoningSummaryEvent(parts, {
        type: "response.output_text.delta",
        delta: "hello",
      }),
    ).toBeNull();
    expect(parts.size).toBe(0);
  });

  it("accumulates delta events into the correct index and returns the delta", () => {
    const parts = new Map<number, string>();
    expect(
      accumulateReasoningSummaryEvent(parts, {
        type: "response.reasoning_summary_text.delta",
        summary_index: 0,
        delta: "The",
      }),
    ).toBe("The");
    expect(
      accumulateReasoningSummaryEvent(parts, {
        type: "response.reasoning_summary_text.delta",
        summary_index: 0,
        delta: " user",
      }),
    ).toBe(" user");
    expect(parts.get(0)).toBe("The user");
  });

  it("defaults summary_index to 0 when absent", () => {
    const parts = new Map<number, string>();
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      delta: "hi",
    });
    expect(parts.get(0)).toBe("hi");
  });

  it("replaces a partial delta buffer when done event arrives for the same index", () => {
    const parts = new Map<number, string>();
    // Two deltas
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      summary_index: 0,
      delta: "Th",
    });
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      summary_index: 0,
      delta: "e",
    });
    // Done event provides the authoritative full text for this index
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.done",
      summary_index: 0,
      text: "The authoritative text",
    });
    expect(parts.get(0)).toBe("The authoritative text");
  });

  it("keeps multiple parts isolated by summary_index", () => {
    const parts = new Map<number, string>();
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      summary_index: 0,
      delta: "Part A",
    });
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      summary_index: 1,
      delta: "Part B",
    });
    expect(parts.get(0)).toBe("Part A");
    expect(parts.get(1)).toBe("Part B");
  });

  it("done event for one index does not overwrite another index", () => {
    const parts = new Map<number, string>();
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      summary_index: 0,
      delta: "Part A delta",
    });
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.delta",
      summary_index: 1,
      delta: "Part B delta",
    });
    // Done arrives only for index 1
    accumulateReasoningSummaryEvent(parts, {
      type: "response.reasoning_summary_text.done",
      summary_index: 1,
      text: "Part B final",
    });
    expect(parts.get(0)).toBe("Part A delta"); // untouched
    expect(parts.get(1)).toBe("Part B final"); // replaced by done
  });
});

// ─── finalizeReasoningSummary ─────────────────────────────────────────────────

describe("finalizeReasoningSummary", () => {
  it("returns undefined for an empty parts map", () => {
    expect(finalizeReasoningSummary(new Map())).toBeUndefined();
  });

  it("returns undefined when all parts are whitespace-only", () => {
    const parts = new Map([
      [0, "   "],
      [1, "\n\n"],
    ]);
    expect(finalizeReasoningSummary(parts)).toBeUndefined();
  });

  it("returns the single part's text", () => {
    const parts = new Map([[0, "I reasoned carefully."]]);
    expect(finalizeReasoningSummary(parts)).toBe("I reasoned carefully.");
  });

  it("joins multiple parts in summary_index order regardless of insertion order", () => {
    const parts = new Map<number, string>();
    parts.set(1, "Second paragraph.");
    parts.set(0, "First paragraph.");
    const result = finalizeReasoningSummary(parts);
    expect(result).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("trims leading/trailing whitespace from the final joined string", () => {
    const parts = new Map([[0, "  hello  "]]);
    expect(finalizeReasoningSummary(parts)).toBe("hello");
  });

  it("correctly handles a three-part summary out of order", () => {
    const parts = new Map<number, string>();
    parts.set(2, "C");
    parts.set(0, "A");
    parts.set(1, "B");
    expect(finalizeReasoningSummary(parts)).toBe("A\n\nB\n\nC");
  });
});

describe("buildResponsesToolsParam", () => {
  it("returns undefined when there are no tools and built-in is off", () => {
    expect(buildResponsesToolsParam(undefined, false)).toBeUndefined();
    expect(buildResponsesToolsParam([], false)).toBeUndefined();
  });

  it("returns undefined when there are no function tools and built-in is off", () => {
    expect(buildResponsesToolsParam([], false)).toBeUndefined();
  });

  it("returns only converted function tools when built-in is off", () => {
    const result = buildResponsesToolsParam([SAMPLE_FUNCTION_TOOL], false);
    expect(result).toHaveLength(1);
    expect((result as { type: string }[])[0].type).toBe("function");
  });

  it("appends web_search built-in when flag is on with no function tools", () => {
    const result = buildResponsesToolsParam(undefined, true) as {
      type: string;
      search_context_size?: string;
    }[];
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("web_search");
    expect(result[0].search_context_size).toBe("medium");
  });

  it("appends web_search built-in after function tools when flag is on", () => {
    const result = buildResponsesToolsParam([SAMPLE_FUNCTION_TOOL], true) as {
      type: string;
      name?: string;
    }[];
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("function");
    expect(result[1].type).toBe("web_search");
  });

  it("does NOT include built-in when flag is off even with function tools present", () => {
    const result = buildResponsesToolsParam([SAMPLE_FUNCTION_TOOL], false) as {
      type: string;
    }[];
    expect(result.every((t) => t.type !== "web_search")).toBe(true);
  });
});

describe("extractWebSearchCallSources", () => {
  it("returns empty array for non-Search action types", () => {
    const item = {
      id: "ws_1",
      type: "web_search_call" as const,
      status: "completed" as const,
      action: { type: "open_page" as const, url: "https://example.com" },
    } satisfies ResponseFunctionWebSearch;
    expect(extractWebSearchCallSources(item)).toEqual([]);
  });

  it("returns empty array when sources are absent on a Search action", () => {
    const item = {
      id: "ws_1",
      type: "web_search_call" as const,
      status: "completed" as const,
      action: { type: "search" as const, queries: ["paris weather"] },
    } satisfies ResponseFunctionWebSearch;
    expect(extractWebSearchCallSources(item)).toEqual([]);
  });

  it("extracts url-type sources from a completed Search action", () => {
    const item = {
      id: "ws_1",
      type: "web_search_call" as const,
      status: "completed" as const,
      action: {
        type: "search" as const,
        queries: ["paris weather"],
        sources: [
          { type: "url" as const, url: "https://weather.com/paris" },
          { type: "url" as const, url: "https://bbc.com/weather" },
        ],
      },
    } satisfies ResponseFunctionWebSearch;
    expect(extractWebSearchCallSources(item)).toEqual([
      "https://weather.com/paris",
      "https://bbc.com/weather",
    ]);
  });

  it("skips sources with empty or missing urls", () => {
    const item = {
      id: "ws_1",
      type: "web_search_call" as const,
      status: "completed" as const,
      action: {
        type: "search" as const,
        sources: [
          { type: "url" as const, url: "https://good.example.com" },
          { type: "url" as const, url: "" },
        ],
      },
    } satisfies ResponseFunctionWebSearch;
    expect(extractWebSearchCallSources(item)).toEqual([
      "https://good.example.com",
    ]);
  });
});
