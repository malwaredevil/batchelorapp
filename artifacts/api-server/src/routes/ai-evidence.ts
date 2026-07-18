/**
 * AI evidence / provenance routes (#229) — owner-only.
 *
 * Surfaces AI generation runs, per-field candidates, and acceptance decisions
 * for debugging "why did the AI fill that value?" and tracking model quality.
 * Never accessible to regular users — every route requires requireOwner.
 */

import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import { adminLimiter } from "../middleware/rateLimit";
import { recordFieldDecision } from "../lib/ai-provenance";

const router = Router();
router.use(adminLimiter, requireAuth, requireOwner);

const ALLOWED_TARGET_TYPES = new Set([
  "pottery_item",
  "quilting_fabric",
  "quilting_pattern",
  "quilting_quilt",
  "ornament_item",
  "travels_trip_document",
  "elaine_memory",
]);

router.get("/:targetType/:targetId", async (req, res) => {
  const { targetType, targetId } = req.params;
  if (!ALLOWED_TARGET_TYPES.has(targetType)) {
    res.status(400).json({ error: "Invalid target type" });
    return;
  }
  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid target id" });
    return;
  }

  const runs = await pool.query(
    `SELECT r.id, r.module, r.feature, r.provider, r.model,
            r.status, r.started_at, r.completed_at, r.duration_ms,
            r.error_code,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', c.id,
                  'fieldPath', c.field_path,
                  'candidateValue', c.candidate_value,
                  'confidenceScore', c.confidence_score,
                  'confidenceMethod', c.confidence_method,
                  'authorityClass', c.authority_class,
                  'disposition', c.disposition,
                  'appliedAt', c.applied_at
                ) ORDER BY c.id
              ) FILTER (WHERE c.id IS NOT NULL),
              '[]'
            ) AS candidates
     FROM ai_generation_runs r
     LEFT JOIN ai_field_candidates c ON c.generation_run_id = r.id
     WHERE r.target_type = $1 AND r.target_id = $2
     GROUP BY r.id
     ORDER BY r.started_at DESC
     LIMIT 50`,
    [targetType, id],
  );

  res.json({ targetType, targetId: id, runs: runs.rows });
});

router.get("/summary", async (_req, res) => {
  const result = await pool.query(
    `SELECT module, feature, model,
            COUNT(*)::int AS run_count,
            COUNT(*) FILTER (WHERE status='success')::int AS success_count,
            AVG(duration_ms)::int AS avg_duration_ms,
            COUNT(DISTINCT c.id)::int AS total_candidates,
            COUNT(c.id) FILTER (WHERE c.disposition='accepted')::int AS accepted_candidates,
            COUNT(c.id) FILTER (WHERE c.disposition='rejected')::int AS rejected_candidates
     FROM ai_generation_runs r
     LEFT JOIN ai_field_candidates c ON c.generation_run_id = r.id
     WHERE r.created_at >= now() - interval '30 days'
     GROUP BY module, feature, model
     ORDER BY run_count DESC`,
  );
  res.json({ summary: result.rows });
});

router.get("/runs", async (req, res) => {
  const query = z
    .object({
      module: z.string().optional(),
      feature: z.string().optional(),
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(req.query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (query.module) {
    conditions.push(`r.module = $${idx++}`);
    params.push(query.module);
  }
  if (query.feature) {
    conditions.push(`r.feature = $${idx++}`);
    params.push(query.feature);
  }
  if (query.status) {
    conditions.push(`r.status = $${idx++}`);
    params.push(query.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(query.limit);

  const rows = await pool.query(
    `SELECT r.*, COUNT(c.id)::int AS candidate_count
     FROM ai_generation_runs r
     LEFT JOIN ai_field_candidates c ON c.generation_run_id = r.id
     ${where}
     GROUP BY r.id
     ORDER BY r.started_at DESC
     LIMIT $${idx}`,
    params,
  );

  res.json({ runs: rows.rows });
});

const DecisionBody = z.object({
  decisionType: z.enum(["accept", "reject", "edit", "lock", "unlock"]),
  finalValue: z.unknown().optional(),
  correctionCategory: z.string().optional(),
  contextSource: z.string().optional(),
});

router.post("/candidates/:candidateId/decision", async (req, res) => {
  const candidateId = Number(req.params.candidateId);
  if (!Number.isInteger(candidateId) || candidateId <= 0) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const body = DecisionBody.parse(req.body);

  const candidate = await pool.query<{
    id: number;
    candidate_value: unknown;
    disposition: string;
  }>(
    `SELECT id, candidate_value, disposition FROM ai_field_candidates WHERE id=$1`,
    [candidateId],
  );

  if (candidate.rows.length === 0) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const row = candidate.rows[0];

  await recordFieldDecision(
    candidateId,
    body.decisionType,
    req.session?.userId,
    row.candidate_value,
    body.finalValue ?? row.candidate_value,
    {
      correctionCategory: body.correctionCategory,
      contextSource: body.contextSource,
    },
  );

  const newDisposition =
    body.decisionType === "accept" || body.decisionType === "edit"
      ? "accepted"
      : body.decisionType === "reject"
        ? "rejected"
        : row.disposition;

  await pool.query(
    `UPDATE ai_field_candidates SET disposition=$2, applied_at=now() WHERE id=$1`,
    [candidateId, newDisposition],
  );

  res.json({ ok: true, disposition: newDisposition });
});

export default router;
