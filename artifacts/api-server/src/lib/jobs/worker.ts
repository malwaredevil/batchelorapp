import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { JOB_REGISTRY_BY_TYPE } from "./registry";
import { updateProgress } from "./queue";

type ClaimedJob = {
  id: number;
  type: string;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
};

let interval: NodeJS.Timeout | null = null;
let controller: AbortController | null = null;

async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const result = await pool.query<ClaimedJob>(
    `
      UPDATE app_jobs
      SET status = 'running',
          lease_owner = $1,
          lease_expires_at = now() + interval '5 minutes',
          started_at = COALESCE(started_at, now()),
          attempt_count = attempt_count + 1,
          updated_at = now()
      WHERE id = (
        SELECT id
        FROM app_jobs
        WHERE status IN ('queued', 'scheduled', 'retry_wait')
          AND scheduled_for <= now()
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
        ORDER BY priority DESC, scheduled_for ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, attempt_count, max_attempts
    `,
    [workerId],
  );
  return result.rows[0] ?? null;
}

async function markSucceeded(jobId: number): Promise<void> {
  await pool.query(
    `UPDATE app_jobs
     SET status = 'succeeded', completed_at = now(), lease_owner = NULL,
         lease_expires_at = NULL, progress_percent = 100, updated_at = now()
     WHERE id = $1`,
    [jobId],
  );
}

async function markFailed(job: ClaimedJob, err: unknown): Promise<void> {
  const retryable = job.attempt_count < job.max_attempts;
  const message = err instanceof Error ? err.message : String(err);
  await pool.query(
    `UPDATE app_jobs
     SET status = $2,
         scheduled_for = CASE WHEN $2 = 'retry_wait'
           THEN now() + (($3::int * $3::int) || ' minutes')::interval
           ELSE scheduled_for
         END,
         completed_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE completed_at END,
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error_code = $4,
         last_error_message = $5,
         updated_at = now()
     WHERE id = $1`,
    [
      job.id,
      retryable ? "retry_wait" : "dead_letter",
      job.attempt_count,
      err instanceof Error ? err.name : "JobError",
      message.slice(0, 500),
    ],
  );
}

async function processOne(
  workerId: string,
  signal: AbortSignal,
): Promise<void> {
  const job = await claimJob(workerId);
  if (!job) return;
  const definition = JOB_REGISTRY_BY_TYPE.get(job.type);
  if (!definition) {
    await markFailed(job, new Error(`No handler registered for ${job.type}`));
    return;
  }

  try {
    const payload = definition.payloadSchema.parse(job.payload);
    await definition.handler(payload, {
      jobId: job.id,
      attempt: job.attempt_count,
      signal,
      updateProgress: (progressPercent, message) =>
        updateProgress(job.id, progressPercent, message),
    });
    await markSucceeded(job.id);
  } catch (err) {
    logger.warn({ err, jobId: job.id, type: job.type }, "job failed");
    await markFailed(job, err);
  }
}

export function startJobWorker(): void {
  if (interval) return;
  const workerId = `api-${process.pid}-${randomUUID()}`;
  controller = new AbortController();
  interval = setInterval(() => {
    void processOne(workerId, controller!.signal);
  }, 5_000);
  interval.unref();
  logger.info({ workerId }, "job-worker: started");
}

export async function stopJobWorker(): Promise<void> {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
  controller?.abort();
  controller = null;
  logger.info("job-worker: stopped");
}
