import OpenAI from "openai";
import { env } from "./env";
import { getElaineGlobalConfig } from "./elaine-config";
import { getConfig } from "./app-config";
import { logger } from "./logger";
import { circuitBreaker } from "./circuit-breaker";

/**
 * Every AI call in this app goes through OpenRouter, using OpenRouter's model
 * identifiers (e.g. "google/gemini-2.5-flash"). This keeps token usage and
 * billing in one place instead of split across OpenAI, Gemini, and
 * OpenRouter accounts. There is intentionally no direct-provider fallback —
 * see `lib/reranker.ts` (Voyage) and `lib/visual-embed.ts` (Jina) for the two
 * specialized services OpenRouter can't provide, which remain direct calls.
 *
 * We do NOT use "openrouter/auto": auto routes unpredictably and can land on
 * slow reasoning models, which blows the bulk-reanalyze request past the
 * proxy's hard request timeout (it hangs). Pinning known models keeps
 * latency predictable.
 */
export const MODELS = {
  // NOTE: FAST_VISION and SMART_VISION currently point at the same model.
  // The distinction used to matter for the (now-removed) direct-OpenAI
  // fallback tier (gpt-4o-mini vs gpt-4o). Kept as separate constants so call
  // sites can be re-tiered independently later (e.g. bump SMART_VISION to a
  // stronger OpenRouter model) without touching every caller.
  FAST_VISION: "google/gemini-2.5-flash",
  SMART_VISION: "google/gemini-2.5-flash",
  // Frontier model consulted by the `openrouter:advisor` server tool when a
  // cheap/fast model hits an ambiguous case mid-generation. Only ever reached
  // when the executing model actually decides it's stuck — most requests
  // never invoke it, so normal-case cost stays at the FAST/SMART_VISION rate.
  ADVISOR: "anthropic/claude-opus-4.8",
  // Cheap worker model handed routine sub-tasks by the `openrouter:subagent`
  // server tool (summarizing, extracting, reformatting) so a frontier
  // orchestrator model doesn't burn its own (expensive) tokens on busywork.
  SUBAGENT_WORKER: "z-ai/glm-5.2",
  // Web-search-grounded model used for factual lookups (designer bios, etc).
  RESEARCH: "perplexity/sonar",
  // Second, independent voice for the `consultExperts()` multi-model advice
  // panel (see lib/expert-consult.ts). Deliberately a different vendor from
  // ADVISOR (Anthropic) and FAST/SMART_VISION (Google) so the two opinions
  // reflect genuinely different model families, not just two calls to the
  // same underlying model.
  EXPERT_PANEL_ALT: "openai/gpt-5.1",
  // OpenAI's embedding model, accessed through OpenRouter's unified
  // embeddings endpoint (https://openrouter.ai/docs/api-reference/embeddings)
  // rather than a direct OpenAI API key.
  EMBEDDING: "openai/text-embedding-3-small",
} as const;

/**
 * OpenRouter "server tools" (beta, June 2026): tools executed by OpenRouter
 * itself, not by our code, that the model can invoke mid-generation.
 * - openrouter:advisor  — escalate UP to a stronger model when stuck.
 * - openrouter:subagent — delegate DOWN routine work to a cheaper model.
 * These tool types aren't part of the OpenAI SDK's ChatCompletionTool union
 * (which only knows "function"), so callers pass this type and cast it at
 * the request site.
 */
export type OpenRouterServerTool =
  | {
      type: "openrouter:advisor";
      parameters: {
        model: string;
        instructions?: string;
        forward_transcript?: boolean;
        max_completion_tokens?: number;
      };
    }
  | {
      type: "openrouter:subagent";
      parameters: {
        model: string;
        instructions?: string;
      };
    };

// Default per-request timeout (ms). Gemini 2.5 Flash vision calls normally
// return in 1-4s. This must stay well UNDER the reverse proxy's hard ~30s
// request budget: the bulk-reanalyze path runs several AI calls synchronously
// within a single proxied request. maxRetries is 0 so a timeout/failure
// doesn't multiply latency — callers should surface the error rather than
// silently retry.
//
// The live value is read from app_config (openrouter / request_timeout_ms) on
// every call so an admin override survives a server restart without a deploy.
// The singleton client is rebuilt only when the timeout value changes.
const REQUEST_TIMEOUT_MS_DEFAULT = 12_000;

function makeOpenRouterClient(timeoutMs: number): OpenAI {
  return new OpenAI({
    apiKey: env.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": "https://app.batchelor.app",
      "X-Title": "Batchelor App",
    },
  });
}

let _openrouterClient: { client: OpenAI; timeoutMs: number } | null = null;

export async function getOpenRouterClient(): Promise<OpenAI> {
  const timeoutMs = await getConfig("openrouter", "request_timeout_ms", 12_000);
  if (!_openrouterClient || _openrouterClient.timeoutMs !== timeoutMs) {
    _openrouterClient = { client: makeOpenRouterClient(timeoutMs), timeoutMs };
  }
  return _openrouterClient.client;
}

/**
 * Call a model via OpenRouter, specifying the OpenRouter model identifier.
 * This is the standard entry point for all chat/vision AI calls in the app.
 */
export async function callModel<T>(
  model: string,
  fn: (client: OpenAI, model: string) => Promise<T>,
): Promise<T> {
  const client = await getOpenRouterClient();
  return circuitBreaker.execute("openrouter", () => fn(client, model));
}

/**
 * Like callModel(), but also offers the executing model an
 * `openrouter:advisor` server tool so it can self-escalate to
 * MODELS.ADVISOR mid-generation on ambiguous/hard cases instead of us always
 * paying premium rates, or always leaving hard cases under-served by a cheap
 * model. The tool is a no-op (never invoked) on the easy majority of calls,
 * so normal-case cost is unchanged.
 */
export async function callModelWithAdvisor<T>(
  model: string,
  advisorInstructions: string,
  fn: (
    client: OpenAI,
    model: string,
    tools: OpenRouterServerTool[] | undefined,
  ) => Promise<T>,
): Promise<T> {
  const config = await getElaineGlobalConfig();
  if (!config.features.enableAdvisor) {
    return fn(await getOpenRouterClient(), model, undefined);
  }
  const tools: OpenRouterServerTool[] = [
    {
      type: "openrouter:advisor",
      parameters: {
        model: config.models.advisor,
        instructions: advisorInstructions,
      },
    },
  ];
  return fn(await getOpenRouterClient(), model, tools);
}

/**
 * Like callModel(), but offers the executing (frontier) model an
 * `openrouter:subagent` server tool so it can delegate self-contained,
 * routine sub-tasks (summarizing, extracting, reformatting) to
 * MODELS.SUBAGENT_WORKER mid-generation instead of spending its own,
 * more expensive tokens on busywork.
 */
export async function callModelWithSubagent<T>(
  model: string,
  subagentInstructions: string,
  fn: (
    client: OpenAI,
    model: string,
    tools: OpenRouterServerTool[],
  ) => Promise<T>,
  options?: { subagentModel?: string },
): Promise<T> {
  const config = await getElaineGlobalConfig();
  const tools: OpenRouterServerTool[] = config.features.enableSubagent
    ? [
        {
          type: "openrouter:subagent",
          parameters: {
            model: options?.subagentModel ?? config.subagentModel,
            instructions: subagentInstructions,
          },
        },
      ]
    : [];
  return fn(await getOpenRouterClient(), model, tools);
}

/**
 * Resolved model slots for the current request, pulled from the admin-
 * editable global config (see lib/elaine-config.ts) with hardcoded fallbacks
 * if the config can't be loaded. Prefer this over the static `MODELS`
 * constant in any new call site so an admin can retune models without a
 * deploy.
 */
export interface ResolvedModels {
  fastVision: string;
  smartVision: string;
  advisor: string;
  subagentWorker: string;
  research: string;
  expertPanelAlt: string;
  embedding: string;
  rerank: string;
  visualEmbed: string;
  fusionModels: string[];
  fusionJudge: string;
}

export async function getModels(): Promise<ResolvedModels> {
  try {
    const config = await getElaineGlobalConfig();
    return {
      fastVision: config.models.fastVision,
      smartVision: config.models.smartVision,
      advisor: config.models.advisor,
      subagentWorker: config.subagentModel,
      research: config.models.research,
      expertPanelAlt: config.models.expertPanelAlt,
      embedding: config.models.embedding,
      rerank: config.models.rerank,
      visualEmbed: config.models.visualEmbed,
      fusionModels: config.models.fusionModels,
      fusionJudge: config.models.fusionJudge,
    };
  } catch (err) {
    logger.error(
      { err },
      "Failed to resolve global model config, using hardcoded defaults",
    );
    return {
      fastVision: MODELS.FAST_VISION,
      smartVision: MODELS.SMART_VISION,
      advisor: MODELS.ADVISOR,
      subagentWorker: MODELS.SUBAGENT_WORKER,
      research: MODELS.RESEARCH,
      expertPanelAlt: MODELS.EXPERT_PANEL_ALT,
      embedding: MODELS.EMBEDDING,
      rerank: "rerank-2.5",
      visualEmbed: "jina-clip-v2",
      fusionModels: ["anthropic/claude-opus-4.8", "openai/gpt-5.1"],
      fusionJudge: "z-ai/glm-5.2",
    };
  }
}

export async function getTimeouts() {
  return (await getElaineGlobalConfig()).timeouts;
}

export async function getFeatures() {
  return (await getElaineGlobalConfig()).features;
}

export async function getThresholds() {
  return (await getElaineGlobalConfig()).thresholds;
}

/**
 * "Fusion" escalation tier: an independent multi-model panel + cheap-judge
 * synthesis, reserved for the two highest-value/most-ambiguous call sites in
 * the app (pottery expert/maker attribution, travel document extraction
 * fallback) since it costs several model calls per invocation. Mirrors the
 * pattern in lib/expert-consult.ts (parallel independent opinions + merge)
 * but is generic over a caller-supplied prompt/parser rather than baked into
 * the elAIne advice-panel flow.
 *
 * Gated by `features.enableFusionPotteryExpert` /
 * `features.enableFusionTravelDocFallback` — callers should check the
 * relevant flag before invoking this, since it's meant to be an occasional
 * fallback, not the default path.
 */
export async function callFusion(
  buildMessages: (
    model: string,
  ) => OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  options?: { maxTokens?: number; responseFormatJson?: boolean },
): Promise<string> {
  const config = await getElaineGlobalConfig();
  const panel =
    config.models.fusionModels.length > 0
      ? config.models.fusionModels
      : DEFAULT_MODELS_FALLBACK.fusionModels;
  const client = await getOpenRouterClient();

  const settled = await Promise.allSettled(
    panel.map((model) =>
      client.chat.completions.create(
        {
          model,
          messages: buildMessages(model),
          max_tokens: options?.maxTokens ?? 800,
          ...(options?.responseFormatJson
            ? { response_format: { type: "json_object" as const } }
            : {}),
        },
        { timeout: config.timeouts.fusionMs },
      ),
    ),
  );

  const opinions = settled
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<OpenAI.Chat.Completions.ChatCompletion> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value.choices[0]?.message?.content?.trim() ?? "")
    .filter((text) => text.length > 0);

  if (opinions.length === 0) {
    logger.error("Fusion panel: every model call failed");
    return "";
  }
  if (opinions.length === 1) return opinions[0];

  try {
    const judged = await client.chat.completions.create(
      {
        model: config.models.fusionJudge,
        messages: [
          {
            role: "system",
            content:
              "You are given the same task description followed by two or more independent model outputs for it. Pick the single best answer, or synthesize the strongest parts of each into one final answer. Return ONLY the final answer in the exact same format the individual outputs used (e.g. if they are JSON, return JSON only) — no commentary about the merge process.",
          },
          {
            role: "user",
            content: opinions
              .map((text, i) => `Output ${i + 1}:\n${text}`)
              .join("\n\n"),
          },
        ],
        max_tokens: options?.maxTokens ?? 800,
        ...(options?.responseFormatJson
          ? { response_format: { type: "json_object" as const } }
          : {}),
      },
      { timeout: config.timeouts.fusionMs },
    );
    const answer = judged.choices[0]?.message?.content?.trim();
    if (answer) return answer;
  } catch (err) {
    logger.error({ err }, "Fusion judge step failed, using first opinion");
  }
  return opinions[0];
}

const DEFAULT_MODELS_FALLBACK = {
  fusionModels: ["anthropic/claude-opus-4.8", "openai/gpt-5.1"],
};
