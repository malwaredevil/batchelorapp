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
  lease_owner?: string;
};

type ActiveWorker = {
  controller: AbortController;
};

const LEASE_DURATION_SQL = "5 minutes";
const HEARTBEAT_INTERVAL_MS = 60_000;

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
          lease_expires_at = now() + interval '${LEASE_DURATION_SQL}',
          started_at = COALESCE(started_at, now()),
          attempt_count = attempt_count + 1,
          updated_at = now()
      WHERE id = (
        SELECT id
        FROM app_jobs
        WHERE (
          (status IN ('queued', 'scheduled', 'retry_wait')
           AND scheduled_for <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at < now()))
          OR
          (status = 'running' AND lease_expires_at < now())
        )
          ${queueFilter}
        ORDER BY priority DESC, scheduled_for ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, attempt_count, max_attempts, lease_owner
    `,
    params,
  );
  return result.rows[0] ?? null;
}

async function beginAttempt(
  job: ClaimedJob,
  leaseOwner: string,
): Promise<number | null> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO app_job_attempts
       (job_id, attempt_number, status, metadata)
     VALUES ($1, $2, 'running', jsonb_build_object('leaseOwner', $3::text))
     RETURNING id`,
    [job.id, job.attempt_count, leaseOwner],
  );
  return result.rows[0]?.id ?? null;
}

async function finishAttempt(
  attemptId: number | null,
  status: "succeeded" | "retry_wait" | "dead_letter" | "lease_lost",
  err?: unknown,
): Promise<void> {
  if (attemptId == null) return;
  const message =
    err instanceof Error ? err.message : err == null ? null : String(err);
  await pool.query(
    `UPDATE app_job_attempts
     SET status = $2,
         completed_at = now(),
         error_code = $3,
         error_message = $4
     WHERE id = $1`,
    [
      attemptId,
      status,
      err instanceof Error ? err.name : err == null ? null : "JobError",
      message?.slice(0, 500) ?? null,
    ],
  );
}

async function renewLease(jobId: number, leaseOwner: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE app_jobs
     SET lease_expires_at = now() + interval '${LEASE_DURATION_SQL}',
         updated_at = now()
     WHERE id = $1
       AND status = 'running'
       AND lease_owner = $2
     RETURNING id`,
    [jobId, leaseOwner],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

async function markSucceeded(
  jobId: number,
  leaseOwner: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE app_jobs
     SET status = 'succeeded', completed_at = now(), lease_owner = NULL,
         lease_expires_at = NULL, progress_percent = 100, updated_at = now()
     WHERE id = $1
       AND status = 'running'
       AND lease_owner = $2
     RETURNING id`,
    [jobId, leaseOwner],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

async function markFailed(
  job: ClaimedJob,
  leaseOwner: string,
  err: unknown,
): Promise<"retry_wait" | "dead_letter" | "lease_lost"> {
  const retryable = job.attempt_count < job.max_attempts;
  const nextStatus = retryable ? "retry_wait" : "dead_letter";
  const message = err instanceof Error ? err.message : String(err);
  const result = await pool.query(
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
     WHERE id = $1
       AND status = 'running'
       AND lease_owner = $6
     RETURNING id`,
    [
      job.id,
      nextStatus,
      job.attempt_count,
      err instanceof Error ? err.name : "JobError",
      message.slice(0, 500),
      leaseOwner,
    ],
  );
  return (result.rowCount ?? result.rows.length) > 0
    ? nextStatus
    : "lease_lost";
}

async function processOne(
  workerId: string,
  workerSignal: AbortSignal,
  queue?: string,
): Promise<void> {
  const job = await claimJob(workerId, queue);
  if (!job) return;
  const leaseOwner = job.lease_owner ?? workerId;
  const definition = JOB_REGISTRY_BY_TYPE.get(job.type);
  const attemptId = await beginAttempt(job, leaseOwner);
  if (!definition) {
    const status = await markFailed(
      job,
      leaseOwner,
      new Error(`No handler registered for ${job.type}`),
    );
    await finishAttempt(
      attemptId,
      status,
      new Error(`No handler registered for ${job.type}`),
    );
    return;
  }

  const jobController = new AbortController();
  const abortForShutdown = () => jobController.abort(workerSignal.reason);
  workerSignal.addEventListener("abort", abortForShutdown, { once: true });
  let heartbeatInFlight = false;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || jobController.signal.aborted) return;
    heartbeatInFlight = true;
    void renewLease(job.id, leaseOwner)
      .then((owned) => {
        if (!owned) {
          leaseLost = true;
          jobController.abort(new Error("Job lease lost"));
        }
      })
      .catch((err) => {
        logger.warn(
          { err, jobId: job.id },
          "job-worker: lease heartbeat failed",
        );
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    const payload = definition.payloadSchema.parse(job.payload);
    await definition.handler(payload, {
      jobId: job.id,
      attempt: job.attempt_count,
      signal: jobController.signal,
      updateProgress: (progressPercent, message) =>
        updateProgress(job.id, leaseOwner, progressPercent, message),
      saveCheckpoint: async (result, progressPercent, message) => {
        const boundedProgress = Number.isFinite(progressPercent)
          ? Math.max(0, Math.min(100, Math.round(progressPercent)))
          : 0;
        const saved = await pool.query(
          `UPDATE app_jobs
           SET result = $3::jsonb,
               progress_percent = $4,
               progress_message = $5,
               updated_at = now()
           WHERE id = $1
             AND status = 'running'
             AND lease_owner = $2
           RETURNING id`,
          [
            job.id,
            leaseOwner,
            JSON.stringify(result),
            boundedProgress,
            message.slice(0, 500),
          ],
        );
        return (saved.rowCount ?? saved.rows.length) > 0;
      },
    });
    const succeeded = await markSucceeded(job.id, leaseOwner);
    if (!succeeded) {
      leaseLost = true;
      logger.warn(
        { jobId: job.id, leaseOwner },
        "job-worker: success write rejected after lease loss",
      );
      await finishAttempt(attemptId, "lease_lost");
      return;
    }
    await finishAttempt(attemptId, "succeeded");
  } catch (err) {
    if (leaseLost) {
      logger.warn(
        { err, jobId: job.id, type: job.type },
        "job-worker: handler stopped after lease loss",
      );
      await finishAttempt(attemptId, "lease_lost", err);
      return;
    }
    logger.warn({ err, jobId: job.id, type: job.type }, "job failed");
    const status = await markFailed(job, leaseOwner, err);
    await finishAttempt(attemptId, status, err);
  } finally {
    clearInterval(heartbeat);
    workerSignal.removeEventListener("abort", abortForShutdown);
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

async function pollLoop(
  workerId: string,
  signal: AbortSignal,
  queue?: string,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await processOne(workerId, signal, queue);
    } catch (err) {
      logger.warn(
        { err },
        "job-worker: transient error in poll loop, retrying",
      );
    }
    await sleep(5_000, signal);
  }
}

export function startJobWorker(queue?: string): void {
  const key = queue ?? "__all__";
  if (activeWorkers.has(key)) return;
  const workerId = `api-${process.pid}-${queue ?? "all"}-${randomUUID()}`;
  const controller = new AbortController();
  void pollLoop(workerId, controller.signal, queue);
  activeWorkers.set(key, { controller });
  logger.info({ workerId, queue: queue ?? "(all)" }, "job-worker: started");
}

export async function stopJobWorker(queue?: string): Promise<void> {
  const key = queue ?? "__all__";
  const worker = activeWorkers.get(key);
  if (!worker) return;
  worker.controller.abort();
  activeWorkers.delete(key);
  logger.info({ queue: queue ?? "(all)" }, "job-worker: stopped");
}

export async function stopAllJobWorkers(): Promise<void> {
  for (const [key, worker] of activeWorkers) {
    worker.controller.abort();
    activeWorkers.delete(key);
  }
  logger.info("job-worker: all workers stopped");
}
