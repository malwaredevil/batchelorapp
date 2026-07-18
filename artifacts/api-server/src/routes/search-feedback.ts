/**
 * Search feedback routes (#233).
 *
 * Capture user verdicts on item pairs (same/different/similar) so the hybrid
 * search can eventually recalibrate similarity thresholds. Any authenticated
 * household member may submit feedback; the owner-only summary endpoint shows
 * aggregated calibration data.
 */

import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import { adminLimiter, aiLimiter } from "../middleware/rateLimit";

const router = Router();

const ALLOWED_MODULES = new Set([
  "pottery",
  "quilting",
  "ornaments",
  "travels",
]);

const ALLOWED_ITEM_TYPES = new Set([
  "pottery_item",
  "quilting_fabric",
  "quilting_pattern",
  "quilting_quilt",
  "ornament_item",
  "travels_trip",
  "travels_trip_document",
]);

const ALLOWED_VERDICTS = new Set(["same", "different", "similar"]);

const FeedbackBody = z.object({
  module: z.string(),
  itemAType: z.string(),
  itemAId: z.coerce.number().int().positive(),
  itemBType: z.string(),
  itemBId: z.coerce.number().int().positive(),
  verdict: z.string(),
  notes: z.string().max(500).optional(),
});

router.post("/search/feedback", aiLimiter, requireAuth, async (req, res) => {
  const body = FeedbackBody.parse(req.body);

  if (!ALLOWED_MODULES.has(body.module)) {
    res.status(400).json({ error: "Invalid module" });
    return;
  }
  if (
    !ALLOWED_ITEM_TYPES.has(body.itemAType) ||
    !ALLOWED_ITEM_TYPES.has(body.itemBType)
  ) {
    res.status(400).json({ error: "Invalid item type" });
    return;
  }
  if (!ALLOWED_VERDICTS.has(body.verdict)) {
    res.status(400).json({ error: "Invalid verdict" });
    return;
  }
  if (body.itemAType === body.itemBType && body.itemAId === body.itemBId) {
    res.status(400).json({ error: "Items must be different" });
    return;
  }

  await pool.query(
    `INSERT INTO search_feedback
         (user_id, module, item_a_type, item_a_id, item_b_type, item_b_id,
          verdict, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, item_a_type, item_a_id, item_b_type, item_b_id)
       DO UPDATE SET verdict=EXCLUDED.verdict, notes=EXCLUDED.notes`,
    [
      req.session?.userId ?? null,
      body.module,
      body.itemAType,
      body.itemAId,
      body.itemBType,
      body.itemBId,
      body.verdict,
      body.notes ?? null,
    ],
  );

  res.json({ ok: true });
});

router.get(
  "/search/feedback/summary",
  adminLimiter,
  requireAuth,
  requireOwner,
  async (req, res) => {
    const query = z
      .object({
        module: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (query.module) {
      conditions.push(`module=$${idx++}`);
      params.push(query.module);
    }
    params.push(query.limit);

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT module, verdict,
              COUNT(*)::int AS count,
              item_a_type, item_b_type
       FROM search_feedback
       ${where}
       GROUP BY module, verdict, item_a_type, item_b_type
       ORDER BY module, count DESC
       LIMIT $${idx}`,
      params,
    );

    res.json({ summary: result.rows });
  },
);

// ── Similarity evaluations (#233) ─────────────────────────────────────────────

const EvaluationBody = z.object({
  module: z.string().min(1),
  workflow: z.string().min(1),
  queryArtifactType: z.string().min(1),
  queryArtifactId: z.coerce.number().int().positive().optional(),
  candidateTargetType: z.string().min(1),
  candidateTargetId: z.coerce.number().int().positive(),
  searchConfigVersion: z.string().optional(),
  textEmbeddingModel: z.string().optional(),
  textCosineScore: z.coerce.number().min(-1).max(1).optional(),
  textRank: z.coerce.number().int().min(1).optional(),
  visualEmbeddingModel: z.string().optional(),
  visualCosineScore: z.coerce.number().min(-1).max(1).optional(),
  visualRank: z.coerce.number().int().min(1).optional(),
  zoneCosineScore: z.coerce.number().min(-1).max(1).optional(),
  zoneRank: z.coerce.number().int().min(1).optional(),
  rrfScore: z.coerce.number().optional(),
  rerankerModel: z.string().optional(),
  rerankerScore: z.coerce.number().optional(),
  rerankerRank: z.coerce.number().int().min(1).optional(),
  userVerdict: z.enum(["same", "similar", "different"]).optional(),
});

router.post("/search/evaluations", aiLimiter, requireAuth, async (req, res) => {
  const body = EvaluationBody.parse(req.body);

  if (!ALLOWED_MODULES.has(body.module)) {
    res.status(400).json({ error: "Invalid module" });
    return;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO similarity_evaluations
         (module, workflow,
          query_artifact_type, query_artifact_id,
          candidate_target_type, candidate_target_id,
          search_config_version,
          text_embedding_model, text_cosine_score, text_rank,
          visual_embedding_model, visual_cosine_score, visual_rank,
          zone_cosine_score, zone_rank,
          rrf_score,
          reranker_model, reranker_score, reranker_rank,
          user_verdict, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
    [
      body.module,
      body.workflow,
      body.queryArtifactType,
      body.queryArtifactId ?? null,
      body.candidateTargetType,
      body.candidateTargetId,
      body.searchConfigVersion ?? null,
      body.textEmbeddingModel ?? null,
      body.textCosineScore ?? null,
      body.textRank ?? null,
      body.visualEmbeddingModel ?? null,
      body.visualCosineScore ?? null,
      body.visualRank ?? null,
      body.zoneCosineScore ?? null,
      body.zoneRank ?? null,
      body.rrfScore ?? null,
      body.rerankerModel ?? null,
      body.rerankerScore ?? null,
      body.rerankerRank ?? null,
      body.userVerdict ?? null,
      req.session?.userId ?? null,
    ],
  );

  res.status(201).json({ ok: true, id: result.rows[0].id });
});

router.get(
  "/search/evaluations/summary",
  adminLimiter,
  requireAuth,
  requireOwner,
  async (req, res) => {
    const query = z
      .object({
        module: z.string().optional(),
        workflow: z.string().optional(),
        days: z.coerce.number().int().min(1).max(365).default(30),
      })
      .parse(req.query);

    const conditions: string[] = [
      `recorded_at >= now() - ($${1}::int || ' days')::interval`,
    ];
    const params: unknown[] = [query.days];
    let idx = 2;

    if (query.module) {
      conditions.push(`module = $${idx++}`);
      params.push(query.module);
    }
    if (query.workflow) {
      conditions.push(`workflow = $${idx++}`);
      params.push(query.workflow);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const rows = await pool.query(
      `SELECT
         module, workflow,
         COUNT(*)::int                                                          AS eval_count,
         AVG(text_cosine_score)::numeric(5,4)                                  AS avg_text_score,
         AVG(visual_cosine_score)::numeric(5,4)                                AS avg_visual_score,
         AVG(zone_cosine_score)::numeric(5,4)                                  AS avg_zone_score,
         AVG(rrf_score)::numeric(8,6)                                          AS avg_rrf_score,
         AVG(reranker_score)::numeric(7,4)                                     AS avg_reranker_score,
         COUNT(user_verdict)::int                                               AS verdict_count,
         COUNT(user_verdict) FILTER (WHERE user_verdict='same')::int           AS verdict_same,
         COUNT(user_verdict) FILTER (WHERE user_verdict='similar')::int        AS verdict_similar,
         COUNT(user_verdict) FILTER (WHERE user_verdict='different')::int      AS verdict_different
       FROM similarity_evaluations
       ${where}
       GROUP BY module, workflow
       ORDER BY eval_count DESC`,
      params,
    );

    res.json({ summary: rows.rows, days: query.days });
  },
);

export default router;
