import OpenAI from "openai";
import { env } from "./env";

function makeOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: env.openrouterApiKey!,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://quilting.batchelor.app",
      "X-Title": "Batchelor Quilting App",
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
 */
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
      (err.status === 429 || err.status === 503)
    ) {
      return fn(getOpenAIClient());
    }
    throw err;
  }
}

/**
 * Call a model that has different identifiers on OpenRouter vs OpenAI.
 * Use this for features that need provider-specific model names (e.g. Perplexity
 * via OpenRouter, which has no OpenAI equivalent).
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
      (err.status === 429 || err.status === 503)
    ) {
      return fn(getOpenAIClient(), models.openai);
    }
    throw err;
  }
}
