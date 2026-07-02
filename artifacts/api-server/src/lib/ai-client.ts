import OpenAI from "openai";
import { env } from "./env";

/**
 * Named model pairs for best-of-breed routing.
 * Via OpenRouter → Gemini 2.5 Flash: fast, accurate, vision-capable, and
 * deterministic. We intentionally do NOT use "openrouter/auto" here: auto
 * routes unpredictably and can land on slow reasoning models, which blows the
 * bulk-reanalyze request past the proxy's hard request timeout (it hangs).
 * Pinning a known fast model keeps latency predictable.
 * Direct OpenAI fallback kicks in when OPENROUTER_API_KEY is absent, or when
 * OpenRouter returns an availability/rate error, or the call times out
 * (see callModel / callWithFallback below) — so availability is still resilient.
 */
export const MODELS = {
  FAST_VISION: {
    openrouter: "google/gemini-2.5-flash",
    openai: "gpt-4o-mini",
  },
  SMART_VISION: {
    openrouter: "google/gemini-2.5-flash",
    openai: "gpt-4o",
  },
  // Frontier model consulted by the `openrouter:advisor` server tool when a
  // cheap/fast model hits an ambiguous case mid-generation. Only ever reached
  // when the executing model actually decides it's stuck — most requests
  // never invoke it, so normal-case cost stays at the FAST/SMART_VISION rate.
  ADVISOR: "anthropic/claude-opus-4.8",
  // Cheap worker model handed routine sub-tasks by the `openrouter:subagent`
  // server tool (summarizing, extracting, reformatting) so a frontier
  // orchestrator model doesn't burn its own (expensive) tokens on busywork.
  SUBAGENT_WORKER: "z-ai/glm-5.2",
} as const;

/**
 * OpenRouter "server tools" (beta, June 2026): tools executed by OpenRouter
 * itself, not by our code, that the model can invoke mid-generation.
 * - openrouter:advisor  — escalate UP to a stronger model when stuck.
 * - openrouter:subagent — delegate DOWN routine work to a cheaper model.
 * These tool types aren't part of the OpenAI SDK's ChatCompletionTool union
 * (which only knows "function"), so callers pass this type and cast it at
 * the request site. They are also OpenRouter-specific — the direct-OpenAI
 * fallback path must never receive them, since the plain OpenAI API doesn't
 * recognize these tool types and would error.
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
// proxied request, so one stuck upstream call has to fail fast enough to leave
// room for the OpenAI fallback before the proxy terminates the connection.
// maxRetries is 0 so a timeout/failure doesn't multiply latency (the explicit
// OpenAI fallback in callModel / callWithFallback is our retry instead).
const REQUEST_TIMEOUT_MS = 12_000;

function makeOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: env.openrouterApiKey!,
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
let _openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!_openaiClient)
    _openaiClient = new OpenAI({
      apiKey: env.openaiApiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
  return _openaiClient;
}

export function getOpenRouterClient(): OpenAI | null {
  if (!env.openrouterApiKey) return null;
  if (!_openrouterClient) _openrouterClient = makeOpenRouterClient();
  return _openrouterClient;
}

/**
 * Run fn against OpenRouter when configured, falling back transparently to
 * OpenAI on rate-limit (429) or service-unavailable (503) errors.
 * Falls directly to OpenAI when OPENROUTER_API_KEY is absent.
 *
 * NOTE: Both clients receive the same model string passed inside fn.
 * Prefer callModel() when you want best-of-breed routing with different model
 * identifiers per provider (e.g. Gemini via OpenRouter, gpt-4o-mini direct).
 */
// Status codes from OpenRouter that mean "try the direct OpenAI path instead".
// 404 = model not available on this account/endpoint (e.g. no credits for that
//       provider, model deprecated, or key lacks access).
// 408 = request timeout; 429 = rate-limited; 5xx = OpenRouter unavailable.
const OPENROUTER_FALLBACK_STATUSES = new Set([
  404, 408, 429, 500, 502, 503, 504,
]);

// True when an OpenRouter error should trigger the direct-OpenAI fallback.
// Covers HTTP statuses above plus connection-level failures (timeouts, socket
// resets) which surface as APIConnectionError with no .status set.
function shouldFallbackToOpenAI(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true; // includes timeouts
  if (err instanceof OpenAI.APIError && typeof err.status === "number") {
    return OPENROUTER_FALLBACK_STATUSES.has(err.status);
  }
  return false;
}

export async function callWithFallback<T>(
  fn: (client: OpenAI) => Promise<T>,
): Promise<T> {
  const or = getOpenRouterClient();
  if (!or) return fn(getOpenAIClient());
  try {
    return await fn(or);
  } catch (err) {
    if (shouldFallbackToOpenAI(err)) {
      return fn(getOpenAIClient());
    }
    throw err;
  }
}

/**
 * Call a model that has different identifiers on OpenRouter vs OpenAI.
 *
 * Prefer this over callWithFallback() for all vision tasks — it routes to
 * the best-value model via OpenRouter (e.g. google/gemini-2.5-flash) and falls
 * back to the specified OpenAI model on rate-limit / unavailability / timeout.
 * Use MODELS.FAST_VISION or MODELS.SMART_VISION for standard routing.
 */
export async function callModel<T>(
  models: { openrouter: string; openai: string },
  fn: (client: OpenAI, model: string) => Promise<T>,
): Promise<T> {
  const or = getOpenRouterClient();
  if (!or) return fn(getOpenAIClient(), models.openai);
  try {
    return await fn(or, models.openrouter);
  } catch (err) {
    if (shouldFallbackToOpenAI(err)) {
      return fn(getOpenAIClient(), models.openai);
    }
    throw err;
  }
}

/**
 * Like callModel(), but also offers the executing model an
 * `openrouter:advisor` server tool so it can self-escalate to
 * MODELS.ADVISOR mid-generation on ambiguous/hard cases instead of us always
 * paying premium rates, or always leaving hard cases under-served by a cheap
 * model. The tool is a no-op (never invoked) on the easy majority of calls,
 * so normal-case cost is unchanged.
 *
 * `tools` is undefined on the direct-OpenAI fallback path (no OPENROUTER_API_KEY,
 * or OpenRouter unavailable) — the plain OpenAI API doesn't understand this
 * tool type, so `fn` must only attach `tools` to the request when it's defined.
 */
export async function callModelWithAdvisor<T>(
  models: { openrouter: string; openai: string },
  advisorInstructions: string,
  fn: (
    client: OpenAI,
    model: string,
    tools: OpenRouterServerTool[] | undefined,
  ) => Promise<T>,
): Promise<T> {
  const or = getOpenRouterClient();
  if (!or) return fn(getOpenAIClient(), models.openai, undefined);
  const tools: OpenRouterServerTool[] = [
    {
      type: "openrouter:advisor",
      parameters: { model: MODELS.ADVISOR, instructions: advisorInstructions },
    },
  ];
  try {
    return await fn(or, models.openrouter, tools);
  } catch (err) {
    if (shouldFallbackToOpenAI(err)) {
      return fn(getOpenAIClient(), models.openai, undefined);
    }
    throw err;
  }
}

/**
 * Like callModel(), but offers the executing (frontier) model an
 * `openrouter:subagent` server tool so it can delegate self-contained,
 * routine sub-tasks (summarizing, extracting, reformatting) to
 * MODELS.SUBAGENT_WORKER mid-generation instead of spending its own,
 * more expensive tokens on busywork. Same fallback rules as callModelWithAdvisor.
 */
export async function callModelWithSubagent<T>(
  models: { openrouter: string; openai: string },
  subagentInstructions: string,
  fn: (
    client: OpenAI,
    model: string,
    tools: OpenRouterServerTool[] | undefined,
  ) => Promise<T>,
): Promise<T> {
  const or = getOpenRouterClient();
  if (!or) return fn(getOpenAIClient(), models.openai, undefined);
  const tools: OpenRouterServerTool[] = [
    {
      type: "openrouter:subagent",
      parameters: {
        model: MODELS.SUBAGENT_WORKER,
        instructions: subagentInstructions,
      },
    },
  ];
  try {
    return await fn(or, models.openrouter, tools);
  } catch (err) {
    if (shouldFallbackToOpenAI(err)) {
      return fn(getOpenAIClient(), models.openai, undefined);
    }
    throw err;
  }
}
