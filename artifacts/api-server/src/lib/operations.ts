import { pool } from "@workspace/db";

const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|cookie|prompt|body|transcript|document|email|phone)/i;

export type ExternalOperationContext = {
  provider: string;
  operation: string;
  feature: string;
  module: string;
  userId?: number;
  requestId?: string;
  jobId?: number;
  parentJobId?: number;
  modelOrActor?: string;
  cacheKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ExternalOperationResult = {
  status:
    | "success"
    | "failure"
    | "timeout"
    | "rate_limited"
    | "cancelled"
    | "circuit_open";
  retryCount?: number;
  cacheStatus?: "hit" | "miss" | "bypass" | "stale" | "not_applicable";
  inputUnits?: number;
  outputUnits?: number;
  billedUnits?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  providerRequestId?: string;
  errorCode?: string;
};

export function redactMetadata(
  metadata: Record<string, string | number | boolean | null> = {},
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      SENSITIVE_KEY_RE.test(key) ? "[redacted]" : value,
    ]),
  );
}

export async function recordExternalOperation(
  context: ExternalOperationContext,
  result: ExternalOperationResult & { durationMs: number },
): Promise<void> {
  await pool.query(
    `
      INSERT INTO external_operation_events
        (provider, operation, model_or_actor, feature, module, user_id,
         request_id, job_id, parent_job_id, status, error_code, started_at,
         completed_at, duration_ms, retry_count, cache_status, input_units,
         output_units, billed_units, estimated_cost_usd, actual_cost_usd,
         provider_request_id, metadata)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         now() - ($12::text || ' milliseconds')::interval, now(), $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)
    `,
    [
      context.provider,
      context.operation,
      context.modelOrActor ?? null,
      context.feature,
      context.module,
      context.userId ?? null,
      context.requestId ?? null,
      context.jobId ?? null,
      context.parentJobId ?? null,
      result.status,
      result.errorCode ?? null,
      result.durationMs,
      result.retryCount ?? 0,
      result.cacheStatus ?? "not_applicable",
      result.inputUnits ?? null,
      result.outputUnits ?? null,
      result.billedUnits ?? null,
      result.estimatedCostUsd ?? null,
      result.actualCostUsd ?? null,
      result.providerRequestId ?? null,
      JSON.stringify(redactMetadata(context.metadata)),
    ],
  );
}

export async function withExternalOperation<T>(
  context: ExternalOperationContext,
  operation: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const value = await operation();
    await recordExternalOperation(context, {
      status: "success",
      durationMs: Date.now() - start,
      cacheStatus: "not_applicable",
    });
    return value;
  } catch (err) {
    await recordExternalOperation(context, {
      status: "failure",
      durationMs: Date.now() - start,
      cacheStatus: "not_applicable",
      errorCode: err instanceof Error ? err.name : "UnknownError",
    });
    throw err;
  }
}
