import OpenAI from "openai";
import { env } from "./env";

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

// Per-request timeout (ms). Gemini 2.5 Flash vision calls normally return in
// 1-4s. This must stay well UNDER the reverse proxy's hard ~30s request budget:
// the bulk-reanalyze path runs several AI calls synchronously within a single
// proxied request. maxRetries is 0 so a timeout/failure doesn't multiply
// latency — callers should surface the error rather than silently retry.
const REQUEST_TIMEOUT_MS = 12_000;

function makeOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: env.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": "https://app.batchelor.app",
      "X-Title": "Batchelor App",
    },
  });
}

let _openrouterClient: OpenAI | null = null;

export function getOpenRouterClient(): OpenAI {
  if (!_openrouterClient) _openrouterClient = makeOpenRouterClient();
  return _openrouterClient;
}

/**
 * Call a model via OpenRouter, specifying the OpenRouter model identifier.
 * This is the standard entry point for all chat/vision AI calls in the app.
 */
export async function callModel<T>(
  model: string,
  fn: (client: OpenAI, model: string) => Promise<T>,
): Promise<T> {
  return fn(getOpenRouterClient(), model);
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
    tools: OpenRouterServerTool[],
  ) => Promise<T>,
): Promise<T> {
  const tools: OpenRouterServerTool[] = [
    {
      type: "openrouter:advisor",
      parameters: { model: MODELS.ADVISOR, instructions: advisorInstructions },
    },
  ];
  return fn(getOpenRouterClient(), model, tools);
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
  const tools: OpenRouterServerTool[] = [
    {
      type: "openrouter:subagent",
      parameters: {
        model: options?.subagentModel ?? MODELS.SUBAGENT_WORKER,
        instructions: subagentInstructions,
      },
    },
  ];
  return fn(getOpenRouterClient(), model, tools);
}
