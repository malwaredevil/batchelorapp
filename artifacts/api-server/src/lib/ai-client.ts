import OpenAI from "openai";
import { env } from "./env";

/**
 * Named model pairs for best-of-breed routing.
 * Via OpenRouter → openrouter/auto (OpenRouter picks the best available model
 * for each request; avoids hardcoding a specific model that may lack access).
 * Direct OpenAI fallback when OPENROUTER_API_KEY is absent or OpenRouter fails.
 */
export const MODELS = {
  FAST_VISION: {
    openrouter: "openrouter/auto",
    openai: "gpt-4o-mini",
  },
  SMART_VISION: {
    openrouter: "openrouter/auto",
    openai: "gpt-4o",
  },
} as const;

function makeOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: env.openrouterApiKey!,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://app.batchelor.app",
      "X-Title": "Batchelor App",
    },
  });
}

let _openrouterClient: OpenAI | null = null;
let _openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!_openaiClient) _openaiClient = new OpenAI({ apiKey: env.openaiApiKey });
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
// 429 = OpenRouter rate-limited; 503 = OpenRouter service unavailable.
const OPENROUTER_FALLBACK_STATUSES = new Set([404, 429, 503]);

export async function callWithFallback<T>(
  fn: (client: OpenAI) => Promise<T>,
): Promise<T> {
  const or = getOpenRouterClient();
  if (!or) return fn(getOpenAIClient());
  try {
    return await fn(or);
  } catch (err) {
    if (
      err instanceof OpenAI.APIError &&
      OPENROUTER_FALLBACK_STATUSES.has(err.status)
    ) {
      return fn(getOpenAIClient());
    }
    throw err;
  }
}

/**
 * Call a model that has different identifiers on OpenRouter vs OpenAI.
 *
 * Prefer this over callWithFallback() for all vision tasks — it routes to
 * the best-value model via OpenRouter (e.g. google/gemini-2.0-flash-001)
 * and falls back to the specified OpenAI model on rate-limit / unavailability.
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
    if (
      err instanceof OpenAI.APIError &&
      OPENROUTER_FALLBACK_STATUSES.has(err.status)
    ) {
      return fn(getOpenAIClient(), models.openai);
    }
    throw err;
  }
}
