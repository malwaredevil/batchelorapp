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
} as const;

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
