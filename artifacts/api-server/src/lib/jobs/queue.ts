import { pool } from "@workspace/db";
import { JOB_REGISTRY_BY_TYPE, type JobStatus } from "./registry";

type EnqueueInput = {
  type: string;
  payload: unknown;
  idempotencyKey?: string;
  createdByUserId?: number;
  scheduledFor?: Date;
  parentJobId?: number;
  priority?: number;
  domain?: string;
};

export async function enqueueJob(input: EnqueueInput): Promise<number> {
  const definition = JOB_REGISTRY_BY_TYPE.get(input.type);
  if (!definition) throw new Error(`Unknown job type: ${input.type}`);
  const payload = definition.payloadSchema.parse(input.payload);
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO app_jobs
        (type, queue, status, priority, payload, payload_schema_version,
         idempotency_key, created_by_user_id, scheduled_for, parent_job_id,
         max_attempts, domain)
      VALUES
        ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (type, idempotency_key) DO UPDATE
        SET updated_at = now()
      RETURNING id
    `,
    [
      input.type,
      definition.queue,
      input.scheduledFor && input.scheduledFor > new Date()
        ? "scheduled"
        : "queued",
      input.priority ?? 0,
      JSON.stringify(payload),
      definition.payloadSchemaVersion,
      input.idempotencyKey ?? null,
      input.createdByUserId ?? null,
      input.scheduledFor ?? new Date(),
      input.parentJobId ?? null,
      definition.maxAttempts,
      input.domain ?? null,
    ],
  );
  return result.rows[0].id;
}

export async function listJobs(filters: {
  type?: string;
  status?: JobStatus;
  parentJobId?: number;
  limit?: number;
}): Promise<unknown[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.type) {
    values.push(filters.type);
    where.push(`type = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`status = $${values.length}`);
  }
  if (filters.parentJobId) {
    values.push(filters.parentJobId);
    where.push(`parent_job_id = $${values.length}`);
  }
  values.push(Math.min(filters.limit ?? 100, 250));
  const result = await pool.query(
    `
      SELECT id, type, queue, status, priority, payload_schema_version,
             idempotency_key, created_by_user_id, domain, scheduled_for,
             attempt_count, max_attempts, started_at, completed_at,
             progress_percent, progress_message, last_error_code,
             last_error_message, provider_request_id, parent_job_id,
             created_at, updated_at
      FROM app_jobs
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY priority DESC, scheduled_for ASC, id ASC
      LIMIT $${values.length}
    `,
    values,
  );
  return result.rows;
}

export async function getJob(id: number): Promise<unknown | null> {
  const result = await pool.query(
    `
      SELECT j.id, j.type, j.queue, j.status, j.priority,
             j.payload_schema_version, j.idempotency_key, j.created_by_user_id,
             j.domain, j.scheduled_for, j.attempt_count, j.max_attempts,
             j.started_at, j.completed_at, j.progress_percent,
             j.progress_message, j.last_error_code, j.last_error_message,
             j.provider_request_id, j.parent_job_id, j.created_at, j.updated_at,
             COALESCE(json_agg(a ORDER BY a.attempt_number)
               FILTER (WHERE a.id IS NOT NULL), '[]') AS attempts
      FROM app_jobs j
      LEFT JOIN app_job_attempts a ON a.job_id = j.id
      WHERE j.id = $1
      GROUP BY j.id
    `,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateProgress(
  jobId: number,
  progressPercent: number,
  message: string,
): Promise<void> {
  await pool.query(
    `UPDATE app_jobs
     SET progress_percent = $2, progress_message = $3, updated_at = now()
     WHERE id = $1`,
    [jobId, progressPercent, message],
  );
}

export async function cancelJob(id: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE app_jobs
     SET status = 'cancelled', completed_at = now(), updated_at = now()
     WHERE id = $1 AND status IN ('queued', 'scheduled', 'retry_wait')
     RETURNING id`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function retryJob(id: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE app_jobs
     SET status = 'queued', scheduled_for = now(), lease_owner = NULL,
         lease_expires_at = NULL, completed_at = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('failed', 'dead_letter')
     RETURNING id`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getJobHealth(): Promise<unknown> {
  const result = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('queued', 'scheduled', 'retry_wait'))::int AS queued_count,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running_count,
        COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count,
        MIN(scheduled_for) FILTER (WHERE status IN ('queued', 'scheduled', 'retry_wait')) AS oldest_queued_at
      FROM app_jobs
    `,
  );
  return {
    ...result.rows[0],
    registeredJobTypes: Array.from(JOB_REGISTRY_BY_TYPE.keys()),
  };
}
