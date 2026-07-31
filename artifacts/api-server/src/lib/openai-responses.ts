import { createHash } from "node:crypto";
import OpenAI from "openai";
import type {
  EasyInputMessage,
  FunctionTool,
  ResponseCreateParams,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputContent,
  Response,
  ResponseUsage,
  ToolChoiceOptions,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import { circuitBreaker } from "./circuit-breaker";
import {
  type ElaineGlobalConfig,
  getElaineGlobalConfig,
} from "./elaine-config";
import { env } from "./env";
import { logger } from "./logger";

export type OpenAIResponsesRole = "reasoning" | "balanced" | "fast";
export type OpenAIResponsesFallbackCategory =
  | "disabled"
  | "missing_key"
  | "circuit_open"
  | "invalid_state"
  | "timeout"
  | "rate_limit"
  | "provider_error"
  | "invalid_output";

export interface OpenAIResponseFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface OpenAIResponseRoundResult {
  responseId: string;
  model: string;
  text: string;
  functionCalls: OpenAIResponseFunctionCall[];
  usage: ResponseUsage | null;
}

export interface OpenAIResponsesMetrics {
  requests: number;
  successes: number;
  failures: number;
  stateReuses: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  fallbacks: Record<OpenAIResponsesFallbackCategory, number>;
  byRole: Record<OpenAIResponsesRole, number>;
}

const metrics: OpenAIResponsesMetrics = {
  requests: 0,
  successes: 0,
  failures: 0,
  stateReuses: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  fallbacks: {
    disabled: 0,
    missing_key: 0,
    circuit_open: 0,
    invalid_state: 0,
    timeout: 0,
    rate_limit: 0,
    provider_error: 0,
    invalid_output: 0,
  },
  byRole: { reasoning: 0, balanced: 0, fast: 0 },
};

export class OpenAIResponsesUnavailableError extends Error {
  constructor(
    public readonly category: OpenAIResponsesFallbackCategory,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAIResponsesUnavailableError";
  }
}

let directClient: { client: OpenAI; timeoutMs: number; apiKey: string } | null =
  null;

function getDirectClient(config: ElaineGlobalConfig): OpenAI {
  const apiKey = env.openaiApiKey;
  if (!apiKey) {
    throw new OpenAIResponsesUnavailableError(
      "missing_key",
      "OPENAI_API_KEY is not configured",
    );
  }
  const timeoutMs = config.timeouts.openAIResponsesMs;
  if (
    !directClient ||
    directClient.timeoutMs !== timeoutMs ||
    directClient.apiKey !== apiKey
  ) {
    directClient = {
      // openai-direct-ok — sole centralized Responses API client.
      client: new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 }),
      timeoutMs,
      apiKey,
    };
  }
  return directClient.client;
}

export function resolveOpenAIResponsesModel(
  config: ElaineGlobalConfig,
  role: OpenAIResponsesRole,
): string {
  if (role === "reasoning") return config.models.openAIReasoning;
  if (role === "balanced") return config.models.openAIBalanced;
  return config.models.openAIFast;
}

export function isOpenAIResponsesConfigured(
  config: ElaineGlobalConfig,
  scope: "elaine" | "app" = "elaine",
): boolean {
  return Boolean(
    env.openaiApiKey &&
    config.features.enableOpenAIResponses &&
    (scope === "elaine" || config.features.enableOpenAIAppWorkflows),
  );
}

/**
 * Creates stable, provider-safe identifiers without sending an email address,
 * database ID, conversation title, or any other raw household identifier.
 */
export function createOpenAIStableIdentifier(
  purpose: "safety" | "cache",
  value: string | number,
): string {
  return createHash("sha256")
    .update(`batchelor:${purpose}:${String(value)}`)
    .digest("hex");
}

export function chatToolsToResponsesTools(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): FunctionTool[] {
  return tools
    .filter(
      (tool): tool is OpenAI.Chat.Completions.ChatCompletionFunctionTool =>
        tool.type === "function",
    )
    .map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description ?? null,
      parameters: tool.function.parameters ?? null,
      // The existing Elaine schemas predate strict Structured Outputs and a
      // subset contains optional object shapes that are not strict-compatible.
      // Runtime validation remains authoritative.
      strict: false,
    }));
}

function recordUsage(usage: ResponseUsage | null): void {
  if (!usage) return;
  metrics.inputTokens += usage.input_tokens;
  metrics.cachedInputTokens += usage.input_tokens_details.cached_tokens;
  metrics.outputTokens += usage.output_tokens;
  metrics.reasoningTokens += usage.output_tokens_details.reasoning_tokens;
}

export function recordOpenAIResponsesFallback(
  category: OpenAIResponsesFallbackCategory,
): void {
  metrics.fallbacks[category] += 1;
}

export function getOpenAIResponsesMetrics(): OpenAIResponsesMetrics {
  return structuredClone(metrics);
}

function classifyProviderError(err: unknown): OpenAIResponsesFallbackCategory {
  if (err instanceof OpenAIResponsesUnavailableError) return err.category;
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
      ? err.status
      : null;
  const name =
    err instanceof Error ? err.name.toLowerCase() : String(err).toLowerCase();
  if (status === 429) return "rate_limit";
  if (name.includes("timeout") || status === 408) return "timeout";
  if (name.includes("circuit")) return "circuit_open";
  return "provider_error";
}

function providerErrorStatus(err: unknown): number | undefined {
  return typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
    ? err.status
    : undefined;
}

export function isRecoverableOpenAIStateError(err: unknown): boolean {
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
      ? err.status
      : null;
  if (status !== 400 && status !== 404) return false;
  const message =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  return (
    message.includes("previous_response_id") ||
    message.includes("previous response") ||
    message.includes("response id") ||
    message.includes("not found")
  );
}

interface SharedRequestOptions {
  role: OpenAIResponsesRole;
  instructions: string;
  input: string | ResponseInput;
  previousResponseId?: string | null;
  reasoningEffort?: ReasoningEffort;
  verbosity?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  safetyIdentifier?: string;
  promptCacheKey?: string;
  config?: ElaineGlobalConfig;
}

export interface StreamOpenAIResponseRoundOptions extends SharedRequestOptions {
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: ToolChoiceOptions | { type: "function"; name: string };
  onTextDelta?: (delta: string) => void;
}

function createBaseParams(
  options: SharedRequestOptions,
  config: ElaineGlobalConfig,
): ResponseCreateParams {
  return {
    model: resolveOpenAIResponsesModel(config, options.role),
    instructions: options.instructions,
    input: options.input,
    previous_response_id: options.previousResponseId ?? undefined,
    max_output_tokens:
      options.maxOutputTokens ??
      config.thresholds.openAIResponsesMaxOutputTokens,
    reasoning: {
      effort: options.reasoningEffort ?? "low",
      context: "all_turns",
    },
    text: { verbosity: options.verbosity ?? "medium" },
    context_management: [
      {
        type: "compaction",
        compact_threshold: config.thresholds.openAICompactionThresholdTokens,
      },
    ],
    prompt_cache_key: options.promptCacheKey,
    safety_identifier: options.safetyIdentifier,
    store: true,
  };
}

export async function streamOpenAIResponseRound(
  options: StreamOpenAIResponseRoundOptions,
): Promise<OpenAIResponseRoundResult> {
  const config = options.config ?? (await getElaineGlobalConfig());
  if (!config.features.enableOpenAIResponses) {
    throw new OpenAIResponsesUnavailableError(
      "disabled",
      "OpenAI Responses is disabled",
    );
  }

  const client = getDirectClient(config);
  const model = resolveOpenAIResponsesModel(config, options.role);
  const startedAt = Date.now();
  metrics.requests += 1;
  metrics.byRole[options.role] += 1;
  if (options.previousResponseId) metrics.stateReuses += 1;

  try {
    const result = await circuitBreaker.execute(
      "openai-responses",
      async (): Promise<OpenAIResponseRoundResult> => {
        const params = createBaseParams(options, config);
        const stream = await client.responses.create({
          ...params,
          stream: true,
          parallel_tool_calls: true,
          tools: options.tools
            ? chatToolsToResponsesTools(options.tools)
            : undefined,
          tool_choice: options.toolChoice,
          stream_options: { include_obfuscation: false },
        });

        let completedResponse: {
          id: string;
          model: string;
          usage: ResponseUsage | null;
        } | null = null;
        let text = "";
        const functionCalls: OpenAIResponseFunctionCall[] = [];

        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            text += event.delta;
            options.onTextDelta?.(event.delta);
          } else if (
            event.type === "response.output_item.done" &&
            event.item.type === "function_call"
          ) {
            const item = event.item as ResponseFunctionToolCall;
            functionCalls.push({
              callId: item.call_id,
              name: item.name,
              arguments: item.arguments,
            });
          } else if (event.type === "response.completed") {
            completedResponse = {
              id: event.response.id,
              model: event.response.model,
              usage: event.response.usage ?? null,
            };
          } else if (
            event.type === "response.failed" ||
            event.type === "response.incomplete"
          ) {
            throw new Error(
              event.response.error?.message ??
                event.response.incomplete_details?.reason ??
                `OpenAI response ${event.response.status}`,
            );
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (!completedResponse) {
          throw new OpenAIResponsesUnavailableError(
            "invalid_output",
            "OpenAI stream ended without a completed response",
          );
        }
        if (!text.trim() && functionCalls.length === 0) {
          throw new OpenAIResponsesUnavailableError(
            "invalid_output",
            "OpenAI stream completed without text or function calls",
          );
        }
        return {
          responseId: completedResponse.id,
          model: completedResponse.model,
          text,
          functionCalls,
          usage: completedResponse.usage,
        };
      },
    );

    metrics.successes += 1;
    recordUsage(result.usage);
    logger.info(
      {
        provider: "openai-responses",
        model: result.model,
        role: options.role,
        stateReused: Boolean(options.previousResponseId),
        latencyMs: Date.now() - startedAt,
        inputTokens: result.usage?.input_tokens ?? null,
        cachedInputTokens:
          result.usage?.input_tokens_details.cached_tokens ?? null,
        outputTokens: result.usage?.output_tokens ?? null,
        reasoningTokens:
          result.usage?.output_tokens_details.reasoning_tokens ?? null,
      },
      "OpenAI Responses request completed",
    );
    return result;
  } catch (err) {
    metrics.failures += 1;
    const category = classifyProviderError(err);
    logger.warn(
      {
        err,
        provider: "openai-responses",
        model,
        role: options.role,
        stateReused: Boolean(options.previousResponseId),
        category,
        latencyMs: Date.now() - startedAt,
      },
      "OpenAI Responses request failed",
    );
    if (err instanceof OpenAIResponsesUnavailableError) throw err;
    throw new OpenAIResponsesUnavailableError(
      category,
      err instanceof Error ? err.message : "OpenAI Responses request failed",
      providerErrorStatus(err),
    );
  }
}

export interface GenerateOpenAIResponseTextOptions extends SharedRequestOptions {
  scope?: "elaine" | "app";
  jsonSchema?: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAIResponseTextWithFallbackResult {
  text: string;
  provider: "openai-responses" | "openrouter";
  model: string | null;
}

export async function generateOpenAIResponseText(
  options: GenerateOpenAIResponseTextOptions,
): Promise<OpenAIResponseRoundResult> {
  const config = options.config ?? (await getElaineGlobalConfig());
  if (!isOpenAIResponsesConfigured(config, options.scope ?? "app")) {
    const category: OpenAIResponsesFallbackCategory = env.openaiApiKey
      ? "disabled"
      : "missing_key";
    throw new OpenAIResponsesUnavailableError(
      category,
      "OpenAI Responses is unavailable for this workflow",
    );
  }

  const client = getDirectClient(config);
  const model = resolveOpenAIResponsesModel(config, options.role);
  const startedAt = Date.now();
  metrics.requests += 1;
  metrics.byRole[options.role] += 1;

  try {
    const response = (await circuitBreaker.execute(
      "openai-responses",
      async () =>
        client.responses.create({
          ...createBaseParams(options, config),
          stream: false,
          text: {
            verbosity: options.verbosity ?? "medium",
            format: options.jsonSchema
              ? {
                  type: "json_schema",
                  name: options.jsonSchema.name,
                  description: options.jsonSchema.description,
                  schema: options.jsonSchema.schema,
                  strict: options.jsonSchema.strict ?? true,
                }
              : undefined,
          },
        }),
    )) as Response;
    if (response.status !== "completed") {
      throw new OpenAIResponsesUnavailableError(
        "invalid_output",
        response.error?.message ??
          response.incomplete_details?.reason ??
          `OpenAI response ${response.status}`,
      );
    }
    if (!response.output_text.trim()) {
      throw new OpenAIResponsesUnavailableError(
        "invalid_output",
        "OpenAI response completed without text",
      );
    }

    metrics.successes += 1;
    recordUsage(response.usage ?? null);
    logger.info(
      {
        provider: "openai-responses",
        model: response.model,
        role: options.role,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage?.input_tokens ?? null,
        cachedInputTokens:
          response.usage?.input_tokens_details.cached_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        reasoningTokens:
          response.usage?.output_tokens_details.reasoning_tokens ?? null,
      },
      "OpenAI Responses request completed",
    );
    return {
      responseId: response.id,
      model: response.model,
      text: response.output_text,
      functionCalls: [],
      usage: response.usage ?? null,
    };
  } catch (err) {
    metrics.failures += 1;
    const category = classifyProviderError(err);
    logger.warn(
      {
        err,
        provider: "openai-responses",
        model,
        role: options.role,
        category,
        latencyMs: Date.now() - startedAt,
      },
      "OpenAI Responses request failed",
    );
    if (err instanceof OpenAIResponsesUnavailableError) throw err;
    throw new OpenAIResponsesUnavailableError(
      category,
      err instanceof Error ? err.message : "OpenAI Responses request failed",
      providerErrorStatus(err),
    );
  }
}

/**
 * Preferred app-workflow entry point. A disabled rollout flag selects the
 * existing implementation directly; a live provider failure falls back only
 * when the owner-controlled resilience toggle permits it.
 */
export async function generateOpenAIResponseTextWithFallback(
  options: GenerateOpenAIResponseTextOptions,
  fallback: () => Promise<string>,
): Promise<OpenAIResponseTextWithFallbackResult> {
  const config = options.config ?? (await getElaineGlobalConfig());
  if (isOpenAIResponsesConfigured(config, options.scope ?? "app")) {
    try {
      const result = await generateOpenAIResponseText({ ...options, config });
      return {
        text: result.text,
        provider: "openai-responses",
        model: result.model,
      };
    } catch (err) {
      if (!config.features.enableOpenAIResponsesFallback) throw err;
      const category =
        err instanceof OpenAIResponsesUnavailableError
          ? err.category
          : "provider_error";
      recordOpenAIResponsesFallback(category);
    }
  }
  return { text: await fallback(), provider: "openrouter", model: null };
}

export function chatUserContentToResponseInput(
  content: string | OpenAI.Chat.Completions.ChatCompletionContentPart[],
  imageDetail: "low" | "high" | "auto" | "original" = "high",
): ResponseInput {
  if (typeof content === "string") {
    return [{ type: "message", role: "user", content }];
  }
  const converted = content.flatMap((part): ResponseInputContent[] => {
    if (part.type === "text") {
      return [{ type: "input_text", text: part.text }];
    }
    if (part.type === "image_url") {
      return [
        {
          type: "input_image",
          image_url: part.image_url.url,
          detail: imageDetail,
        },
      ];
    }
    return [];
  });
  return [{ type: "message", role: "user", content: converted }];
}

export function messagesToResponseInput(
  messages: Array<{
    role: "user" | "assistant" | "system" | "developer";
    content: string;
  }>,
): ResponseInput {
  return messages.map(
    (message): EasyInputMessage => ({
      type: "message",
      role: message.role,
      content: message.content,
      ...(message.role === "assistant" ? { phase: "final_answer" } : {}),
    }),
  );
}
