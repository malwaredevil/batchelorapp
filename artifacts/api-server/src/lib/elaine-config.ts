import { db, elaineGlobalConfig } from "@workspace/db";
import { logger } from "./logger";

/**
 * Global, admin-configurable settings for the whole app's AI behaviour.
 * Started as Elaine-only config (chatModel/subagentModel/requestTimeoutMs/
 * maxResponseTokens); now also covers every other hardcoded model slot,
 * timeout, feature toggle, and threshold used across Pottery, Quilting, and
 * Travels — see the "Global Configuration" admin page. Distinct from the
 * per-user `elaine_settings` table (enabled/confirmation mode) — this is a
 * single row (id=1) that applies to every user across every app surface,
 * editable only by the app owner via /api/elaine/admin/*.
 *
 * `models`/`timeouts`/`features`/`thresholds` are stored as loosely-typed
 * JSONB (see lib/db/src/schema/elaine.ts) and deep-merged over DEFAULTS here
 * so a partially-populated or stale row never crashes — every new
 * configurable key just needs an entry in DEFAULTS, no migration required.
 */
export interface ExtraModelsConfig {
  fastVision: string;
  smartVision: string;
  advisor: string;
  research: string;
  expertPanelAlt: string;
  embedding: string;
  // Direct-provider specialized services (not OpenRouter) — small fixed
  // catalogs, but still admin-configurable rather than hardcoded.
  rerank: string; // Voyage reranker
  visualEmbed: string; // Jina CLIP visual embeddings
  // "Fusion" escalation tier: an independent multi-model panel + judge
  // synthesis, reserved for the two highest-value/most-ambiguous cases
  // (pottery expert attribution, travel document extraction fallback) since
  // it costs several model calls per invocation.
  fusionModels: string[];
  fusionJudge: string;
}

export interface TimeoutsConfig {
  expertConsultMs: number;
  rerankerMs: number;
  geocodingMs: number;
  fusionMs: number;
}

export interface FeaturesConfig {
  enableAdvisor: boolean;
  enableSubagent: boolean;
  enableFusionPotteryExpert: boolean;
  enableFusionTravelDocFallback: boolean;
}

export interface ThresholdsConfig {
  // Pottery compare: RRF-fused similarity score bands that map to the
  // "yes"/"maybe"/"no" verdict shown to the user.
  potterySimilarityYes: number;
  potterySimilarityMaybe: number;
  potterySimilarityNo: number;
  // Body-crop ratios used before generating a pottery zone visual embedding.
  visualEmbedCropTop: number;
  visualEmbedCropHeight: number;
  // JPEG re-encode quality for AI-facing image payloads.
  aiJpegQuality: number;
  // Per-feature max_tokens caps.
  potteryZoneAnalysisMaxTokens: number;
  potteryBackstampMaxTokens: number;
  travelDocExtractionMaxTokens: number;
}

export interface ElaineGlobalConfig {
  chatModel: string;
  subagentModel: string;
  requestTimeoutMs: number;
  maxResponseTokens: number;
  models: ExtraModelsConfig;
  timeouts: TimeoutsConfig;
  features: FeaturesConfig;
  thresholds: ThresholdsConfig;
  updatedAt: string | null;
}

export const DEFAULT_MODELS: ExtraModelsConfig = {
  fastVision: "google/gemini-2.5-flash",
  smartVision: "google/gemini-2.5-flash",
  advisor: "anthropic/claude-opus-4.8",
  research: "perplexity/sonar",
  expertPanelAlt: "openai/gpt-5.1",
  embedding: "openai/text-embedding-3-small",
  rerank: "rerank-2.5",
  visualEmbed: "jina-clip-v2",
  fusionModels: ["anthropic/claude-opus-4.8", "openai/gpt-5.1"],
  fusionJudge: "z-ai/glm-5.2",
};

export const DEFAULT_TIMEOUTS: TimeoutsConfig = {
  expertConsultMs: 15_000,
  rerankerMs: 10_000,
  geocodingMs: 5_000,
  fusionMs: 20_000,
};

export const DEFAULT_FEATURES: FeaturesConfig = {
  enableAdvisor: true,
  enableSubagent: true,
  enableFusionPotteryExpert: false,
  enableFusionTravelDocFallback: false,
};

export const DEFAULT_THRESHOLDS: ThresholdsConfig = {
  potterySimilarityYes: 0.9,
  potterySimilarityMaybe: 0.78,
  potterySimilarityNo: 0,
  visualEmbedCropTop: 0.15,
  visualEmbedCropHeight: 0.7,
  aiJpegQuality: 88,
  potteryZoneAnalysisMaxTokens: 1024,
  potteryBackstampMaxTokens: 512,
  travelDocExtractionMaxTokens: 1000,
};

const DEFAULTS: ElaineGlobalConfig = {
  chatModel: "google/gemini-2.5-flash",
  subagentModel: "z-ai/glm-5.2",
  requestTimeoutMs: 12_000,
  maxResponseTokens: 700,
  models: DEFAULT_MODELS,
  timeouts: DEFAULT_TIMEOUTS,
  features: DEFAULT_FEATURES,
  thresholds: DEFAULT_THRESHOLDS,
  updatedAt: null,
};

function mergeModels(stored: unknown): ExtraModelsConfig {
  const s = (stored ?? {}) as Partial<ExtraModelsConfig>;
  return {
    ...DEFAULT_MODELS,
    ...s,
    fusionModels:
      Array.isArray(s.fusionModels) && s.fusionModels.length > 0
        ? s.fusionModels
        : DEFAULT_MODELS.fusionModels,
  };
}

function mergeTimeouts(stored: unknown): TimeoutsConfig {
  return {
    ...DEFAULT_TIMEOUTS,
    ...((stored ?? {}) as Partial<TimeoutsConfig>),
  };
}

function mergeFeatures(stored: unknown): FeaturesConfig {
  return {
    ...DEFAULT_FEATURES,
    ...((stored ?? {}) as Partial<FeaturesConfig>),
  };
}

function mergeThresholds(stored: unknown): ThresholdsConfig {
  return {
    ...DEFAULT_THRESHOLDS,
    ...((stored ?? {}) as Partial<ThresholdsConfig>),
  };
}

// Short in-memory cache so every chat turn / AI call doesn't hit the DB, but
// an admin edit takes effect within a few seconds without needing a server
// restart.
const CACHE_TTL_MS = 30_000;
let cached: { value: ElaineGlobalConfig; expiresAt: number } | null = null;

export async function getElaineGlobalConfig(): Promise<ElaineGlobalConfig> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value: ElaineGlobalConfig = DEFAULTS;
  try {
    const [row] = await db.select().from(elaineGlobalConfig).limit(1);
    if (row) {
      value = {
        chatModel: row.chatModel,
        subagentModel: row.subagentModel,
        requestTimeoutMs: row.requestTimeoutMs,
        maxResponseTokens: row.maxResponseTokens,
        models: mergeModels(row.extraModels),
        timeouts: mergeTimeouts(row.timeouts),
        features: mergeFeatures(row.features),
        thresholds: mergeThresholds(row.thresholds),
        updatedAt: row.updatedAt?.toISOString() ?? null,
      };
    }
  } catch (err) {
    logger.error(
      { err },
      "Failed to load elaine_global_config, falling back to defaults",
    );
    value = DEFAULTS;
  }
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateElaineGlobalConfigCache(): void {
  cached = null;
}
