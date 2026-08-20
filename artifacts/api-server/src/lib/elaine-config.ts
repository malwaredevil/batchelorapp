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
  // Direct OpenAI Responses API model roles. Keep these separate from the
  // OpenRouter model IDs above: they are sent to api.openai.com and may be
  // independently rolled back from the admin configuration.
  openAIReasoning: string;
  openAIBalanced: string;
  openAIFast: string;
  // OpenRouter model used for restricted-channel text turns (SMS, Slack,
  // inbound email, group messenger) that are NOT real-time voice. These
  // channels don't have the sub-second dead-air constraint that keeps voice
  // pinned to `chatModel`, so they get a stronger reasoning model instead.
  // Deliberately a separate key from `chatModel`/`expertPanelAlt` so voice's
  // latency-critical default and the occasional expert-consult panel model
  // can each be tuned independently of this one.
  restrictedTextModel: string;
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
  openAIResponsesMs: number;
}

export interface FeaturesConfig {
  enableAdvisor: boolean;
  enableSubagent: boolean;
  enableFusionPotteryExpert: boolean;
  enableFusionTravelDocFallback: boolean;
  enableOpenAIResponses: boolean;
  enableOpenAIAppWorkflows: boolean;
  enableOpenAIResponsesFallback: boolean;
  // When true and Responses API is active, Elaine uses OpenAI's built-in
  // web_search tool instead of the custom Perplexity/OpenRouter function tool,
  // eliminating the extra OpenRouter hop and giving richer citation data.
  enableBuiltinWebSearch: boolean;
  // When true and Responses API is active, request a reasoning summary from
  // the model and surface it as a collapsible "Thinking…" disclosure in the
  // chat UI. Summaries are also persisted so users can re-read them after a
  // page refresh.
  showReasoningSummary: boolean;
  // OpenAI Responses API storage-retention controls. `openAIStoreEnabledDefault`
  // applies when no scope/role override is set. Overrides are optional so admins
  // can change only the surfaces they care about.
  openAIStoreEnabledDefault: boolean;
  openAIStoreScopeOverrides?: {
    elaine?: boolean;
    app?: boolean;
  };
  openAIStoreRoleOverrides?: {
    reasoning?: boolean;
    balanced?: boolean;
    fast?: boolean;
  };
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
  // Responses max_output_tokens includes both hidden reasoning and visible
  // output. Compaction is deliberately below the model context limit so
  // stateful Elaine threads compact before they can fail from context growth.
  // Kept generous relative to older, lower-reasoning-effort defaults: "high"
  // reasoning effort can spend a large share of this budget on hidden
  // reasoning tokens before any visible text is produced, and a too-tight
  // cap would silently truncate the actual reply.
  openAIResponsesMaxOutputTokens: number;
  openAICompactionThresholdTokens: number;
  // Stored response IDs expire at the provider after 30 days by default.
  // Treat them as stale one day earlier so Elaine can rebuild from durable
  // local history without putting an expected expiration on the hot path.
  openAIStateMaxAgeDays: number;
  // How many times the exact same self-heal lesson must recur
  // (elaine_lessons.occurrenceCount) before Elaine is given a bounded,
  // read-only look at the source file(s) tied to that pattern to form a
  // code-grounded suggestion for human review (#895). Deliberately >1 so
  // this never fires on a single occurrence — see
  // lib/elaine-code-diagnosis.ts.
  codeDiagnosisRecurrenceThreshold: number;
  // Max successful broadcasts per user per rolling hour window. Persisted in
  // the DB so the cap survives server restarts. Raise if a household needs to
  // send bulk announcements more frequently.
  broadcastHourlyLimit: number;
  // Max supplemental images forwarded to the AI per pottery analysis call
  // (primary + this many supplemental). Keeps in-memory buffer use and token
  // cost bounded regardless of how many supplemental images are stored.
  potteryMaxAiSupplemental: number;
  // Max pottery items per bulk-reanalyze request. Raise if the owner needs
  // to re-process large batches in a single call.
  potteryBulkReanalyzeLimit: number;
  // Max ornament items per bulk-reanalyze request.
  ornamentsBulkReanalyzeLimit: number;
  // Max quilting items (fabrics/patterns/quilts) per bulk-reanalyze request.
  quiltingBulkReanalyzeLimit: number;
}

/**
 * Ceilings for Elaine's per-turn agentic loop (see
 * artifacts/api-server/src/elaine/runtime/turn-runtime.ts). Previously a
 * hardcoded literal object built at the chat call site — moved here so the
 * owner can raise/lower them (e.g. after seeing "Runtime budget exhausted"
 * in a trace) without a code change.
 */
export interface RuntimeBudgetConfig {
  // Cap on how many times the model can be called in a single turn
  // (tool-call round-trips + the final answer). Each replan (see
  // maxReplans) also consumes a model round.
  maxModelRounds: number;
  // Cap on the total number of tool calls attempted in a single turn,
  // across all rounds.
  maxToolCalls: number;
  // Cap on how many times the runtime may adapt the plan mid-turn (add an
  // unplanned step, or ask the model to try again after incomplete
  // evidence). Distinct from maxModelRounds: a replan always costs a model
  // round, but not every model round is a replan.
  maxReplans: number;
  // Wall-clock cap for the whole turn, in milliseconds, independent of
  // round/tool-call/replan counts.
  maxElapsedMs: number;
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
  runtimeBudget: RuntimeBudgetConfig;
  updatedAt: string | null;
}

export const DEFAULT_MODELS: ExtraModelsConfig = {
  fastVision: "google/gemini-2.5-flash",
  smartVision: "google/gemini-2.5-flash",
  advisor: "anthropic/claude-opus-4.8",
  research: "perplexity/sonar",
  expertPanelAlt: "openai/gpt-5.1",
  embedding: "openai/text-embedding-3-small",
  openAIReasoning: "gpt-5.6-sol",
  openAIBalanced: "gpt-5.6-terra",
  openAIFast: "gpt-5.6-luna",
  restrictedTextModel: "openai/gpt-5.1",
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
  openAIResponsesMs: 60_000,
};

export const DEFAULT_FEATURES: FeaturesConfig = {
  enableAdvisor: true,
  enableSubagent: true,
  enableFusionPotteryExpert: false,
  enableFusionTravelDocFallback: false,
  enableOpenAIResponses: true,
  enableOpenAIAppWorkflows: true,
  enableOpenAIResponsesFallback: true,
  enableBuiltinWebSearch: true,
  showReasoningSummary: true,
  openAIStoreEnabledDefault: true,
  openAIStoreScopeOverrides: {},
  openAIStoreRoleOverrides: {},
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
  openAIResponsesMaxOutputTokens: 12_000,
  openAICompactionThresholdTokens: 80_000,
  openAIStateMaxAgeDays: 29,
  codeDiagnosisRecurrenceThreshold: 3,
  broadcastHourlyLimit: 3,
  potteryMaxAiSupplemental: 5,
  potteryBulkReanalyzeLimit: 20,
  ornamentsBulkReanalyzeLimit: 20,
  quiltingBulkReanalyzeLimit: 20,
};

export const DEFAULT_RUNTIME_BUDGET: RuntimeBudgetConfig = {
  maxModelRounds: 8,
  maxToolCalls: 24,
  maxReplans: 10,
  maxElapsedMs: 240_000,
};
export const ELAINE_CONFIG_DEFAULTS: ElaineGlobalConfig = {
  chatModel: "google/gemini-2.5-flash",
  subagentModel: "z-ai/glm-5.2",
  requestTimeoutMs: 12_000,
  maxResponseTokens: 700,
  models: DEFAULT_MODELS,
  timeouts: DEFAULT_TIMEOUTS,
  features: DEFAULT_FEATURES,
  thresholds: DEFAULT_THRESHOLDS,
  runtimeBudget: DEFAULT_RUNTIME_BUDGET,
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

function mergeRuntimeBudget(stored: unknown): RuntimeBudgetConfig {
  return {
    ...DEFAULT_RUNTIME_BUDGET,
    ...((stored ?? {}) as Partial<RuntimeBudgetConfig>),
  };
}
const CACHE_TTL_MS = 30_000;
let cached: { value: ElaineGlobalConfig; expiresAt: number } | null = null;

export async function getElaineGlobalConfig(): Promise<ElaineGlobalConfig> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value: ElaineGlobalConfig = ELAINE_CONFIG_DEFAULTS;
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
        runtimeBudget: mergeRuntimeBudget(row.runtimeBudget),
        updatedAt: row.updatedAt?.toISOString() ?? null,
      };
    }
  } catch (err) {
    logger.error(
      { err },
      "Failed to load elaine_global_config, falling back to defaults",
    );
    value = ELAINE_CONFIG_DEFAULTS;
  }
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateElaineGlobalConfigCache(): void {
  cached = null;
}
