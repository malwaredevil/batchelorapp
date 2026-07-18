/**
 * Ingestion coordinator (#230).
 *
 * Orchestrates a full ingestion run: creates the DB run record, streams items
 * from an adapter, inserts candidates, and finalizes the run on success/failure.
 */

import { pool } from "@workspace/db";
import { logger } from "../logger";
import type {
  IngestionAdapter,
  IngestionContext,
  IngestionItem,
} from "./types";

export interface RunIngestionInput {
  sourceId: number;
  jobId?: number;
  triggeredBy?: number;
  triggerType?: "manual" | "scheduled" | "event";
  adapterConfig: Record<string, unknown>;
}

async function createRun(
  sourceId: number,
  jobId: number | undefined,
  triggeredBy: number | undefined,
  triggerType: string,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ingestion_runs (source_id, job_id, triggered_by, trigger_type, status)
     VALUES ($1,$2,$3,$4,'running') RETURNING id`,
    [sourceId, jobId ?? null, triggeredBy ?? null, triggerType],
  );
  return result.rows[0].id;
}

async function insertCandidate(
  runId: number,
  sourceId: number,
  item: IngestionItem,
): Promise<void> {
  await pool.query(
    `INSERT INTO ingestion_candidates
       (run_id, source_id, source_key, target_type, target_id,
        normalized_data, confidence_score, status)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'pending')
     ON CONFLICT (source_id, source_key) DO UPDATE
       SET normalized_data = EXCLUDED.normalized_data,
           confidence_score = EXCLUDED.confidence_score`,
    [
      runId,
      sourceId,
      item.sourceKey,
      item.targetType ?? null,
      item.targetId ?? null,
      JSON.stringify(item.normalizedData),
      item.confidenceScore ?? null,
    ],
  );
}

async function finalizeRun(
  runId: number,
  counts: {
    fetched: number;
    rejected: number;
  },
  error?: { code: string; message: string },
): Promise<void> {
  await pool.query(
    `UPDATE ingestion_runs
     SET status=$2, completed_at=now(),
         items_fetched=$3, items_rejected=$4,
         error_code=$5, error_message=$6
     WHERE id=$1`,
    [
      runId,
      error ? "failed" : "completed",
      counts.fetched,
      counts.rejected,
      error?.code ?? null,
      error?.message ?? null,
    ],
  );
}

export async function runIngestion(
  input: RunIngestionInput,
  adapter: IngestionAdapter,
): Promise<{ runId: number; itemsFetched: number; itemsRejected: number }> {
  const sourceResult = await pool.query<{
    id: number;
    module: string;
    feature: string | null;
  }>(
    `SELECT id, module, feature FROM ingestion_sources WHERE id=$1 AND enabled=true`,
    [input.sourceId],
  );

  if (sourceResult.rows.length === 0) {
    throw new Error(`Ingestion source ${input.sourceId} not found or disabled`);
  }

  const source = sourceResult.rows[0];

  const runId = await createRun(
    input.sourceId,
    input.jobId,
    input.triggeredBy,
    input.triggerType ?? "manual",
  );

  logger.info(
    { runId, sourceId: input.sourceId, module: source.module },
    "ingestion: run started",
  );

  let fetched = 0;
  let rejected = 0;

  try {
    const context: IngestionContext = {
      sourceId: input.sourceId,
      runId,
      module: source.module,
      feature: source.feature ?? undefined,
      userId: input.triggeredBy,
    };

    const itemsOrGen = await (
      adapter.fetchItems as (
        config: Record<string, unknown>,
        ctx: IngestionContext,
      ) => Promise<IngestionItem[]> | AsyncGenerator<IngestionItem>
    )(input.adapterConfig, context);

    const items: IngestionItem[] = Array.isArray(itemsOrGen)
      ? itemsOrGen
      : await collectGenerator(itemsOrGen as AsyncGenerator<IngestionItem>);

    for (const item of items) {
      try {
        await insertCandidate(runId, input.sourceId, item);
        fetched++;
      } catch {
        rejected++;
      }
    }

    await finalizeRun(runId, { fetched, rejected });
    logger.info({ runId, fetched, rejected }, "ingestion: run completed");

    return { runId, itemsFetched: fetched, itemsRejected: rejected };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof Error ? err.constructor.name : "UnknownError";
    await finalizeRun(runId, { fetched, rejected }, { code, message });
    logger.error({ err, runId }, "ingestion: run failed");
    throw err;
  }
}

async function collectGenerator<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}
