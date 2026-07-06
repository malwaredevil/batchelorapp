import { logger } from "./logger";

/**
 * Browsable list of OpenRouter models for the Elaine admin config UI, backed
 * by OpenRouter's public model-listing REST endpoint
 * (https://openrouter.ai/api/v1/models). This is a plain unauthenticated GET
 * — no API key or MCP client needed just to list models. Cached in-memory to
 * keep this admin-only lookup bounded and avoid hammering OpenRouter.
 */
export interface OpenRouterModelSummary {
  id: string;
  name: string;
  contextLength: number | null;
  promptPricePerMTok: number | null;
  completionPricePerMTok: number | null;
}

interface OpenRouterModelsApiResponse {
  data: Array<{
    id: string;
    name?: string;
    context_length?: number | null;
    pricing?: { prompt?: string; completion?: string };
  }>;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 8_000;

let cached: { value: OpenRouterModelSummary[]; expiresAt: number } | null =
  null;

export async function listOpenRouterModels(): Promise<
  OpenRouterModelSummary[]
> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter models list failed: ${res.status}`);
    }
    const json = (await res.json()) as OpenRouterModelsApiResponse;
    const value: OpenRouterModelSummary[] = json.data
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        contextLength: m.context_length ?? null,
        promptPricePerMTok: m.pricing?.prompt
          ? Number(m.pricing.prompt) * 1_000_000
          : null,
        completionPricePerMTok: m.pricing?.completion
          ? Number(m.pricing.completion) * 1_000_000
          : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (err) {
    logger.error({ err }, "Failed to fetch OpenRouter model list");
    // Serve stale cache rather than nothing if we have one.
    if (cached) return cached.value;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
