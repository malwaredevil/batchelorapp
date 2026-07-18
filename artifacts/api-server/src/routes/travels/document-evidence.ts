/**
 * Travel document evidence and field-conflict routes (#232).
 *
 * Exposes page-level extraction metadata, per-field source evidence,
 * and structured conflict records for a trip's documents.
 * All routes require authentication; conflict resolution requires ownership.
 */

import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";

const router: IRouter = Router();

router.use(requireAuth);

// ── Document pages ────────────────────────────────────────────────────────────

router.get("/documents/:docId/pages", async (req, res) => {
  const docId = Number(req.params.docId);
  if (!Number.isInteger(docId) || docId <= 0) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }

  const result = await pool.query(
    `SELECT p.id, p.page_index, p.media_type,
            p.width_px, p.height_px,
            p.ocr_engine, p.ocr_engine_version,
            p.extraction_status, p.extraction_warnings,
            p.content_hash, p.created_at,
            -- include text only if small enough to be useful inline
            CASE WHEN length(p.extracted_text) <= 4000
                 THEN p.extracted_text ELSE NULL END AS extracted_text_preview
     FROM travels_document_pages p
     WHERE p.trip_document_id = $1
     ORDER BY p.page_index ASC`,
    [docId],
  );

  res.json({ docId, pages: result.rows });
});

// ── Field conflicts for a trip ────────────────────────────────────────────────

const ConflictQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  fieldPath: z.string().optional(),
});

router.get("/trips/:tripId/conflicts", async (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    res.status(400).json({ error: "Invalid trip id" });
    return;
  }

  const query = ConflictQuery.parse(req.query);

  const conditions: string[] = ["c.trip_id = $1"];
  const params: unknown[] = [tripId];
  let idx = 2;

  if (query.status !== "all") {
    conditions.push(`c.status = $${idx++}`);
    params.push(query.status);
  }
  if (query.fieldPath) {
    conditions.push(`c.field_path = $${idx++}`);
    params.push(query.fieldPath);
  }

  const result = await pool.query(
    `SELECT c.id, c.field_path, c.conflict_type, c.status,
            c.accepted_value, c.competing_candidate_ids,
            c.recommended_rationale,
            c.deciding_user_id, c.decided_at,
            c.created_at, c.updated_at,
            -- accepted candidate detail
            ac.field_path AS accepted_candidate_field,
            ac.candidate_value AS accepted_candidate_value,
            ac.confidence_score AS accepted_candidate_confidence,
            -- recommended candidate detail
            rc.candidate_value AS recommended_candidate_value,
            rc.confidence_score AS recommended_candidate_confidence
     FROM travels_field_conflicts c
     LEFT JOIN ai_field_candidates ac ON ac.id = c.accepted_candidate_id
     LEFT JOIN ai_field_candidates rc ON rc.id = c.recommended_candidate_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.created_at DESC`,
    params,
  );

  res.json({ tripId, conflicts: result.rows });
});

// ── Resolve a conflict (owner-only) ──────────────────────────────────────────

const ResolveBody = z.object({
  acceptedCandidateId: z.number().int().positive().optional(),
  acceptedValue: z.unknown().optional(),
  status: z.enum(["resolved"]),
});

router.patch(
  "/trips/:tripId/conflicts/:conflictId",
  requireOwner,
  async (req, res) => {
    const tripId = Number(req.params.tripId);
    const conflictId = Number(req.params.conflictId);
    if (
      !Number.isInteger(tripId) ||
      tripId <= 0 ||
      !Number.isInteger(conflictId) ||
      conflictId <= 0
    ) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = ResolveBody.parse(req.body);

    const existing = await pool.query<{ id: number; trip_id: number }>(
      `SELECT id, trip_id FROM travels_field_conflicts WHERE id=$1`,
      [conflictId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Conflict not found" });
      return;
    }
    if (existing.rows[0].trip_id !== tripId) {
      res.status(404).json({ error: "Conflict not found for this trip" });
      return;
    }

    await pool.query(
      `UPDATE travels_field_conflicts
       SET status            = $2,
           accepted_candidate_id = COALESCE($3, accepted_candidate_id),
           accepted_value    = COALESCE($4::jsonb, accepted_value),
           deciding_user_id  = $5,
           decided_at        = now(),
           updated_at        = now()
       WHERE id = $1`,
      [
        conflictId,
        body.status,
        body.acceptedCandidateId ?? null,
        body.acceptedValue !== undefined
          ? JSON.stringify(body.acceptedValue)
          : null,
        req.session?.userId ?? null,
      ],
    );

    res.json({ ok: true, conflictId, status: body.status });
  },
);

export default router;
