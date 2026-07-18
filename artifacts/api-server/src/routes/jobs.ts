import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import {
  cancelJob,
  getJob,
  getJobHealth,
  listJobs,
  retryJob,
} from "../lib/jobs/queue";
import { JOB_REGISTRY } from "../lib/jobs/registry";

const router = Router();
router.use(requireAuth, requireOwner);

const jobQuerySchema = z.object({
  type: z.string().optional(),
  status: z
    .enum([
      "queued",
      "scheduled",
      "running",
      "retry_wait",
      "succeeded",
      "failed",
      "cancelled",
      "dead_letter",
    ])
    .optional(),
  parentJobId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(250).optional(),
});

router.get("/", async (req, res) => {
  const filters = jobQuerySchema.parse(req.query);
  res.json({
    jobs: await listJobs(filters),
    registry: JOB_REGISTRY.map((job) => ({
      type: job.type,
      queue: job.queue,
      payloadSchemaVersion: job.payloadSchemaVersion,
      maxAttempts: job.maxAttempts,
      idempotencyStrategy: job.idempotencyStrategy,
    })),
  });
});

router.get("/health", async (_req, res) => {
  res.json(await getJobHealth());
});

router.get("/:id", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const job = await getJob(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job });
});

router.post("/:id/cancel", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  res.json({ cancelled: await cancelJob(id) });
});

router.post("/:id/retry", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  res.json({ retried: await retryJob(id) });
});

export default router;
