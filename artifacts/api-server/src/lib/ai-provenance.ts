/**
 * AI provenance library (#229).
 *
 * Records every AI call (generation run) and the field-level candidates it
 * produces. Entirely backend-only — surfaced through the owner-only
 * /api/ai-evidence routes; never shown in regular-user UI.
 *
 * Usage pattern:
 *
 *   const runId = await startGenerationRun({ module, feature, targetType,
 *     targetId, provider, model, userId });
 *   // ...run the AI call...
 *   await recordFieldCandidates(runId, targetType, targetId, [
 *     { fieldPath: "name", value: "Blue Floral Batik", confidence: 0.87, ... },
 *   ]);
 *   await finalizeGenerationRun(runId, "success", durationMs);
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

export type AuthorityClass =
  | "vision"
  | "barcode"
  | "document_text"
  | "official_api"
  | "marketplace"
  | "user";

export type ConfidenceMethod =
  | "exact_identifier_match"
  | "multi_source_agreement"
  | "schema_completeness"
  | "ocr_quality"
  | "similarity_margin"
  | "provider_supplied"
  | "vision_inference"
  | "heuristic";

export interface StartGenerationRunInput {
  module: string;
  feature: string;
  targetType: string;
  targetId?: number;
  jobId?: number;
  operationEventId?: number;
  userId?: number;
  provider: string;
  model: string;
  modelProviderRunId?: string;
  promptTemplateId?: string;
  inputArtifactHashes?: string[];
}

export interface FieldCandidateInput {
  fieldPath: string;
  value: unknown;
  confidenceScore?: number;
  confidenceMethod?: ConfidenceMethod;
  authorityClass?: AuthorityClass;
  sourceReferences?: Record<string, unknown>[];
}

export async function startGenerationRun(
  input: StartGenerationRunInput,
): Promise<number> {
  try {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO ai_generation_runs
         (module, feature, target_type, target_id, job_id, operation_event_id,
          user_id, provider, model, model_provider_run_id, prompt_template_id,
          input_artifact_hashes, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'pending',now())
       RETURNING id`,
      [
        input.module,
        input.feature,
        input.targetType,
        input.targetId ?? null,
        input.jobId ?? null,
        input.operationEventId ?? null,
        input.userId ?? null,
        input.provider,
        input.model,
        input.modelProviderRunId ?? null,
        input.promptTemplateId ?? null,
        JSON.stringify(input.inputArtifactHashes ?? []),
      ],
    );
    return result.rows[0].id;
  } catch (err) {
    logger.warn({ err }, "ai-provenance: failed to start generation run");
    return -1;
  }
}

export async function finalizeGenerationRun(
  runId: number,
  status: "success" | "failure" | "timeout" | "rate_limited",
  durationMs: number,
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  if (runId < 0) return;
  try {
    await pool.query(
      `UPDATE ai_generation_runs
       SET status=$2, completed_at=now(), duration_ms=$3,
           error_code=$4, error_message=$5
       WHERE id=$1`,
      [runId, status, durationMs, errorCode ?? null, errorMessage ?? null],
    );
  } catch (err) {
    logger.warn({ err, runId }, "ai-provenance: failed to finalize run");
  }
}

export async function recordFieldCandidates(
  runId: number,
  targetType: string,
  targetId: number | undefined,
  candidates: FieldCandidateInput[],
): Promise<void> {
  if (runId < 0 || candidates.length === 0) return;
  try {
    const values = candidates.map((c, i) => {
      const base = i * 9;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::jsonb,$${base + 6},$${base + 7},$${base + 8},$${base + 9}::jsonb)`;
    });
    const params: unknown[] = [];
    for (const c of candidates) {
      params.push(
        runId,
        targetType,
        targetId ?? null,
        c.fieldPath,
        JSON.stringify(c.value ?? null),
        c.confidenceScore ?? null,
        c.confidenceMethod ?? "vision_inference",
        c.authorityClass ?? "vision",
        JSON.stringify(c.sourceReferences ?? []),
      );
    }
    await pool.query(
      `INSERT INTO ai_field_candidates
         (generation_run_id, target_type, target_id, field_path,
          candidate_value, confidence_score, confidence_method,
          authority_class, source_references)
       VALUES ${values.join(",")}`,
      params,
    );
  } catch (err) {
    logger.warn({ err, runId }, "ai-provenance: failed to record candidates");
  }
}

export async function recordFieldDecision(
  candidateId: number,
  decisionType: "accept" | "reject" | "edit" | "lock" | "unlock",
  decidingUserId: number | undefined,
  priorValue: unknown,
  finalValue: unknown,
  options?: {
    correctionCategory?: string;
    contextSource?: string;
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_field_decisions
         (candidate_id, deciding_user_id, decision_type,
          prior_value, final_value, correction_category, context_source)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [
        candidateId,
        decidingUserId ?? null,
        decisionType,
        JSON.stringify(priorValue ?? null),
        JSON.stringify(finalValue ?? null),
        options?.correctionCategory ?? null,
        options?.contextSource ?? "manual_edit",
      ],
    );
  } catch (err) {
    logger.warn(
      { err, candidateId },
      "ai-provenance: failed to record decision",
    );
  }
}

/**
 * Convenience wrapper: run an AI call with full provenance tracking.
 * Automatically starts a run, calls fn(), records candidates, finalizes.
 */
export async function withProvenance<T extends Record<string, unknown>>(
  input: StartGenerationRunInput,
  fn: (runId: number) => Promise<{
    result: T;
    candidates?: FieldCandidateInput[];
  }>,
): Promise<{ result: T; runId: number }> {
  const runId = await startGenerationRun(input);
  const start = Date.now();
  try {
    const { result, candidates } = await fn(runId);
    const durationMs = Date.now() - start;
    if (candidates && candidates.length > 0) {
      await recordFieldCandidates(
        runId,
        input.targetType,
        input.targetId,
        candidates,
      );
    }
    await finalizeGenerationRun(runId, "success", durationMs);
    return { result, runId };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorCode =
      err instanceof Error ? err.constructor.name : "UnknownError";
    const errorMessage = err instanceof Error ? err.message : String(err);
    await finalizeGenerationRun(
      runId,
      "failure",
      durationMs,
      errorCode,
      errorMessage,
    );
    throw err;
  }
}
