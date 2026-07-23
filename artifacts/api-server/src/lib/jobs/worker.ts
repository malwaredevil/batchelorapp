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

type ActiveWorker = {
  controller: AbortController;
};

// Keyed by queue name ("__all__" when no queue filter is set).
const activeWorkers = new Map<string, ActiveWorker>();

async function claimJob(
  workerId: string,
  queue?: string,
): Promise<ClaimedJob | null> {
  const queueFilter = queue ? "AND queue = $2" : "";
  const params: unknown[] = queue ? [workerId, queue] : [workerId];
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
        WHERE (
          -- Normal claim: ready jobs that have never been leased or whose
          -- retry backoff has elapsed.
          (status IN ('queued', 'scheduled', 'retry_wait')
           AND scheduled_for <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at < now()))
          OR
          -- Stale-lease recovery: a running job whose lease expired means the
          -- worker process died mid-turn.  Re-claim it so the job is retried
          -- automatically rather than stuck in 'running' forever.
          (status = 'running' AND lease_expires_at < now())
        )
          ${queueFilter}
        ORDER BY priority DESC, scheduled_for ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, attempt_count, max_attempts
    `,
    params,
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
  queue?: string,
): Promise<void> {
  const job = await claimJob(workerId, queue);
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Async poll loop — awaits each processOne before sleeping, so only one
// query per worker is in-flight at a time. This prevents setInterval
// tick pile-up which exhausted the Supabase session-mode connection pool.
async function pollLoop(
  workerId: string,
  signal: AbortSignal,
  queue?: string,
): Promise<void> {
  while (!signal.aborted) {
    await processOne(workerId, signal, queue);
    await sleep(5_000, signal);
  }
}

// Starts a polling worker for the given queue (or all queues when omitted).
// Multiple independent workers can be started for different queues.
// Calling startJobWorker with the same queue argument a second time is a no-op.
export function startJobWorker(queue?: string): void {
  const key = queue ?? "__all__";
  if (activeWorkers.has(key)) return;
  const workerId = `api-${process.pid}-${queue ?? "all"}-${randomUUID()}`;
  const controller = new AbortController();
  void pollLoop(workerId, controller.signal, queue);
  activeWorkers.set(key, { controller });
  logger.info({ workerId, queue: queue ?? "(all)" }, "job-worker: started");
}

// Stops the worker for the given queue (or all queues when omitted).
export async function stopJobWorker(queue?: string): Promise<void> {
  const key = queue ?? "__all__";
  const worker = activeWorkers.get(key);
  if (!worker) return;
  worker.controller.abort();
  activeWorkers.delete(key);
  logger.info({ queue: queue ?? "(all)" }, "job-worker: stopped");
}

// Stops all active workers (used during graceful shutdown).
export async function stopAllJobWorkers(): Promise<void> {
  for (const [key, worker] of activeWorkers) {
    worker.controller.abort();
    activeWorkers.delete(key);
  }
  logger.info("job-worker: all workers stopped");
}
