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

export default router;
