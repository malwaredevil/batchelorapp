import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import { adminLimiter } from "../middleware/rateLimit";
import { redactMetadata } from "../lib/operations";

const router = Router();
router.use(adminLimiter, requireAuth, requireOwner);

router.get("/summary", async (_req, res) => {
  const result = await pool.query(`
    SELECT provider,
           COUNT(*)::int AS total_events,
           COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0)::text AS spend_usd,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_latency_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_latency_ms,
           COUNT(*) FILTER (WHERE status != 'success')::int AS non_success_events
    FROM external_operation_events
    WHERE created_at >= now() - interval '30 days'
    GROUP BY provider
    ORDER BY spend_usd DESC, provider ASC
  `);
  res.json({ providers: result.rows });
});

router.get("/events", async (req, res) => {
  const query = z
    .object({
      provider: z.string().optional(),
      limit: z.coerce.number().int().positive().max(250).default(100),
    })
    .parse(req.query);
  const values: unknown[] = [];
  const where: string[] = [];
  if (query.provider) {
    values.push(query.provider);
    where.push(`provider = $${values.length}`);
  }
  values.push(query.limit);
  const result = await pool.query(
    `
      SELECT id, provider, operation, model_or_actor, feature, module,
             user_id, request_id, job_id, parent_job_id, status, error_code,
             duration_ms, retry_count, cache_status, input_units, output_units,
             billed_units::text, estimated_cost_usd::text, actual_cost_usd::text,
             currency, provider_request_id, metadata, created_at
      FROM external_operation_events
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );
  res.json({
    events: result.rows.map((row) => ({
      ...row,
      metadata: redactMetadata(row.metadata ?? {}),
    })),
  });
});

router.get("/providers", async (_req, res) => {
  const result = await pool.query(`
    SELECT provider,
           COUNT(DISTINCT operation)::int AS operations,
           MAX(created_at) AS last_seen_at
    FROM external_operation_events
    GROUP BY provider
    ORDER BY provider ASC
  `);
  res.json({ providers: result.rows });
});

router.get("/budgets", async (_req, res) => {
  const result = await pool.query(`
    SELECT id, scope, scope_value, period, soft_threshold_usd::text,
           hard_threshold_usd::text, warning_policy, degradation_action,
           enabled, override_until, created_at, updated_at
    FROM external_budget_policies
    ORDER BY scope, scope_value NULLS FIRST
  `);
  res.json({ budgets: result.rows });
});

router.put("/budgets/:id", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = z
    .object({
      softThresholdUsd: z.coerce.number().nonnegative(),
      hardThresholdUsd: z.coerce.number().nonnegative(),
      enabled: z.boolean(),
      degradationAction: z.string().min(1),
    })
    .parse(req.body);
  const result = await pool.query(
    `
      UPDATE external_budget_policies
      SET soft_threshold_usd = $2, hard_threshold_usd = $3, enabled = $4,
          degradation_action = $5, updated_at = now()
      WHERE id = $1
      RETURNING id, scope, scope_value, period, soft_threshold_usd::text,
                hard_threshold_usd::text, warning_policy, degradation_action,
                enabled, override_until, created_at, updated_at
    `,
    [
      id,
      body.softThresholdUsd,
      body.hardThresholdUsd,
      body.enabled,
      body.degradationAction,
    ],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Budget policy not found" });
    return;
  }
  res.json({ budget: result.rows[0] });
});

router.post("/budgets/:id/override", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = z.object({ expiresAt: z.string().datetime() }).parse(req.body);
  const result = await pool.query(
    `
      UPDATE external_budget_policies
      SET override_until = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, override_until
    `,
    [id, body.expiresAt],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Budget policy not found" });
    return;
  }
  res.json({ budget: result.rows[0] });
});

router.get("/export", async (_req, res) => {
  const result = await pool.query(`
    SELECT provider, operation, module, feature, status, cache_status,
           duration_ms, COALESCE(actual_cost_usd, estimated_cost_usd, 0)::text AS cost_usd,
           created_at
    FROM external_operation_events
    WHERE created_at >= now() - interval '90 days'
    ORDER BY created_at DESC
    LIMIT 5000
  `);
  res
    .type("text/csv")
    .send(
      [
        "provider,operation,module,feature,status,cache_status,duration_ms,cost_usd,created_at",
        ...result.rows.map((row) =>
          [
            row.provider,
            row.operation,
            row.module,
            row.feature,
            row.status,
            row.cache_status,
            row.duration_ms,
            row.cost_usd,
            row.created_at.toISOString(),
          ]
            .map((value) => JSON.stringify(String(value ?? "")))
            .join(","),
        ),
      ].join("\n"),
    );
});

export default router;
