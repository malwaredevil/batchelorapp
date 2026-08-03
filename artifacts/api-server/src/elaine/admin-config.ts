import { db, elaineGlobalConfig } from "@workspace/db";
import { z } from "zod/v4";
import {
  ELAINE_CONFIG_DEFAULTS,
  getElaineGlobalConfig,
  invalidateElaineGlobalConfigCache,
} from "../lib/elaine-config";

export const AdminConfigBody = z.object({
  chatModel: z.string().min(1).max(200).optional(),
  subagentModel: z.string().min(1).max(200).optional(),
  requestTimeoutMs: z.number().int().min(2000).max(30000).optional(),
  maxResponseTokens: z.number().int().min(50).max(4000).optional(),
  models: z
    .object({
      fastVision: z.string().min(1).max(200).optional(),
      smartVision: z.string().min(1).max(200).optional(),
      advisor: z.string().min(1).max(200).optional(),
      research: z.string().min(1).max(200).optional(),
      expertPanelAlt: z.string().min(1).max(200).optional(),
      embedding: z.string().min(1).max(200).optional(),
      openAIReasoning: z.string().min(1).max(200).optional(),
      openAIBalanced: z.string().min(1).max(200).optional(),
      openAIFast: z.string().min(1).max(200).optional(),
      rerank: z.string().min(1).max(200).optional(),
      visualEmbed: z.string().min(1).max(200).optional(),
      fusionModels: z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(6)
        .optional(),
      fusionJudge: z.string().min(1).max(200).optional(),
    })
    .partial()
    .optional(),
  timeouts: z
    .object({
      expertConsultMs: z.number().int().min(1000).max(60000).optional(),
      rerankerMs: z.number().int().min(1000).max(60000).optional(),
      geocodingMs: z.number().int().min(1000).max(30000).optional(),
      fusionMs: z.number().int().min(1000).max(120000).optional(),
      openAIResponsesMs: z.number().int().min(5000).max(180000).optional(),
    })
    .partial()
    .optional(),
  features: z
    .object({
      enableAdvisor: z.boolean().optional(),
      enableSubagent: z.boolean().optional(),
      enableFusionPotteryExpert: z.boolean().optional(),
      enableFusionTravelDocFallback: z.boolean().optional(),
      enableOpenAIResponses: z.boolean().optional(),
      enableOpenAIAppWorkflows: z.boolean().optional(),
      enableOpenAIResponsesFallback: z.boolean().optional(),
      enableBuiltinWebSearch: z.boolean().optional(),
      showReasoningSummary: z.boolean().optional(),
      openAIStoreEnabledDefault: z.boolean().optional(),
      openAIStoreScopeOverrides: z
        .object({
          elaine: z.boolean().optional(),
          app: z.boolean().optional(),
        })
        .optional(),
      openAIStoreRoleOverrides: z
        .object({
          reasoning: z.boolean().optional(),
          balanced: z.boolean().optional(),
          fast: z.boolean().optional(),
        })
        .optional(),
    })
    .partial()
    .optional(),
  thresholds: z
    .object({
      potterySimilarityYes: z.number().min(0).max(1).optional(),
      potterySimilarityMaybe: z.number().min(0).max(1).optional(),
      potterySimilarityNo: z.number().min(0).max(1).optional(),
      visualEmbedCropTop: z.number().min(0).max(1).optional(),
      visualEmbedCropHeight: z.number().min(0).max(1).optional(),
      aiJpegQuality: z.number().int().min(1).max(100).optional(),
      potteryZoneAnalysisMaxTokens: z
        .number()
        .int()
        .min(50)
        .max(4000)
        .optional(),
      potteryBackstampMaxTokens: z.number().int().min(50).max(4000).optional(),
      travelDocExtractionMaxTokens: z
        .number()
        .int()
        .min(50)
        .max(4000)
        .optional(),
      openAIResponsesMaxOutputTokens: z
        .number()
        .int()
        .min(1000)
        .max(30000)
        .optional(),
      openAICompactionThresholdTokens: z
        .number()
        .int()
        .min(10000)
        .max(900000)
        .optional(),
      openAIStateMaxAgeDays: z.number().int().min(1).max(29).optional(),
    })
    .partial()
    .optional(),
});

export type AdminConfigPatch = z.infer<typeof AdminConfigBody>;

export async function applyAdminConfigPatch(
  patch: AdminConfigPatch,
  userId: number,
) {
  const current = await getElaineGlobalConfig();
  const nextTop = {
    chatModel: patch.chatModel ?? current.chatModel,
    subagentModel: patch.subagentModel ?? current.subagentModel,
    requestTimeoutMs: patch.requestTimeoutMs ?? current.requestTimeoutMs,
    maxResponseTokens: patch.maxResponseTokens ?? current.maxResponseTokens,
  };
  const nextModels = { ...current.models, ...patch.models };
  const nextTimeouts = { ...current.timeouts, ...patch.timeouts };
  const nextFeatures = { ...current.features, ...patch.features };
  const nextThresholds = { ...current.thresholds, ...patch.thresholds };

  await db
    .insert(elaineGlobalConfig)
    .values({
      id: 1,
      ...nextTop,
      extraModels: nextModels,
      timeouts: nextTimeouts,
      features: nextFeatures,
      thresholds: nextThresholds,
      updatedByUserId: userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: elaineGlobalConfig.id,
      set: {
        ...nextTop,
        extraModels: nextModels,
        timeouts: nextTimeouts,
        features: nextFeatures,
        thresholds: nextThresholds,
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    });

  invalidateElaineGlobalConfigCache();
  return getElaineGlobalConfig();
}

/**
 * Overwrite the single elaine_global_config row with ELAINE_CONFIG_DEFAULTS
 * exactly — unlike applyAdminConfigPatch (which merges a partial patch over
 * the *current* value), this discards every customization in one step so the
 * owner panel's "Reset to defaults" button has a true one-click reset.
 */
export async function resetElaineGlobalConfigToDefaults(userId: number) {
  const defaults = ELAINE_CONFIG_DEFAULTS;

  await db
    .insert(elaineGlobalConfig)
    .values({
      id: 1,
      chatModel: defaults.chatModel,
      subagentModel: defaults.subagentModel,
      requestTimeoutMs: defaults.requestTimeoutMs,
      maxResponseTokens: defaults.maxResponseTokens,
      extraModels: defaults.models,
      timeouts: defaults.timeouts,
      features: defaults.features,
      thresholds: defaults.thresholds,
      updatedByUserId: userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: elaineGlobalConfig.id,
      set: {
        chatModel: defaults.chatModel,
        subagentModel: defaults.subagentModel,
        requestTimeoutMs: defaults.requestTimeoutMs,
        maxResponseTokens: defaults.maxResponseTokens,
        extraModels: defaults.models,
        timeouts: defaults.timeouts,
        features: defaults.features,
        thresholds: defaults.thresholds,
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    });

  invalidateElaineGlobalConfigCache();
  return getElaineGlobalConfig();
}
