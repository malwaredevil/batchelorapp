import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { adminLimiter } from "../../middleware/rateLimit";
import { enqueueJob } from "../../lib/jobs/queue";

const router = Router();
router.use(adminLimiter, requireAuth, requireOwner);

router.post("/reconcile", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `storage.reconcile:${today}`;
  const triggeredBy =
    typeof req.body?.triggeredBy === "string"
      ? req.body.triggeredBy
      : `user:${String(req.session?.userId ?? "unknown")}`;

  const jobId = await enqueueJob({
    type: "storage.reconcile",
    payload: { triggeredBy },
    idempotencyKey,
    createdByUserId: req.session?.userId,
  });

  res.status(202).json({
    jobId,
    idempotencyKey,
    message:
      "Storage reconciliation job enqueued. Only one scan runs per day — subsequent calls today return the same job id.",
  });
});

router.get("/reconcile/latest", async (_req, res) => {
  const result = await pool.query<{
    id: number;
    status: string;
    result: unknown;
    progress_percent: number;
    progress_message: string | null;
    created_at: string;
    completed_at: string | null;
    idempotency_key: string | null;
  }>(
    `SELECT id, status, result, progress_percent, progress_message,
            created_at, completed_at, idempotency_key
     FROM app_jobs
     WHERE type = 'storage.reconcile'
       AND status = 'succeeded'
       AND result IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  );

  if (result.rows.length === 0) {
    res.status(404).json({
      error:
        "No storage reconciliation scan has been run yet. POST /api/admin/storage/reconcile to start one.",
    });
    return;
  }

  const job = result.rows[0];
  res.json({ job });
});

router.get("/reconcile/history", async (req, res) => {
  const parsed = z
    .object({ limit: z.coerce.number().int().positive().max(50).default(10) })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { limit } = parsed.data;

  const result = await pool.query<{
    id: number;
    status: string;
    progress_percent: number;
    progress_message: string | null;
    created_at: string;
    completed_at: string | null;
    idempotency_key: string | null;
  }>(
    `SELECT id, status, progress_percent, progress_message,
              created_at, completed_at, idempotency_key
       FROM app_jobs
       WHERE type = 'storage.reconcile'
       ORDER BY created_at DESC
       LIMIT $1`,
    [limit],
  );

  res.json({ jobs: result.rows });
});

export default router;
