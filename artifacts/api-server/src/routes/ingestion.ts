/**
 * Ingestion routes (#230) — owner-only.
 *
 * Manage ingestion sources, trigger runs, and inspect candidates.
 */

import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import { adminLimiter } from "../middleware/rateLimit";
import { runIngestion } from "../lib/ingestion";
import { RestAdapter } from "../lib/ingestion/rest-adapter";
import { ApifyAdapter } from "../lib/ingestion/apify-adapter";
import { env } from "../lib/env";

const router = Router();
router.use(adminLimiter, requireAuth, requireOwner);

router.get("/sources", async (_req, res) => {
  const result = await pool.query(
    `SELECT id, name, slug, adapter_type, module, feature, enabled,
            owner_notes, created_at, updated_at
     FROM ingestion_sources ORDER BY module, name`,
  );
  res.json({ sources: result.rows });
});

const SourceBody = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  adapterType: z.enum(["apify", "rest", "webhook", "manual"]),
  adapterConfig: z.record(z.string(), z.unknown()).default({}),
  module: z.string().min(1),
  feature: z.string().optional(),
  enabled: z.boolean().default(true),
  ownerNotes: z.string().optional(),
});

router.post("/sources", async (req, res) => {
  const body = SourceBody.parse(req.body);
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ingestion_sources
       (name, slug, adapter_type, adapter_config, module, feature, enabled, owner_notes)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
     RETURNING id`,
    [
      body.name,
      body.slug,
      body.adapterType,
      JSON.stringify(body.adapterConfig),
      body.module,
      body.feature ?? null,
      body.enabled,
      body.ownerNotes ?? null,
    ],
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.patch("/sources/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = SourceBody.partial().parse(req.body);
  const fields: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;

  if (body.name !== undefined) {
    fields.push(`name=$${idx++}`);
    params.push(body.name);
  }
  if (body.adapterConfig !== undefined) {
    fields.push(`adapter_config=$${idx++}::jsonb`);
    params.push(JSON.stringify(body.adapterConfig));
  }
  if (body.enabled !== undefined) {
    fields.push(`enabled=$${idx++}`);
    params.push(body.enabled);
  }
  if (body.ownerNotes !== undefined) {
    fields.push(`owner_notes=$${idx++}`);
    params.push(body.ownerNotes);
  }
  if (body.feature !== undefined) {
    fields.push(`feature=$${idx++}`);
    params.push(body.feature);
  }
  if (fields.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push(`updated_at=now()`);
  await pool.query(
    `UPDATE ingestion_sources SET ${fields.join(",")} WHERE id=$1`,
    params,
  );
  res.json({ ok: true });
});

router.post("/sources/:id/run", async (req, res) => {
  const id = Number(req.params.id);
  const source = await pool.query<{
    id: number;
    adapter_type: string;
    adapter_config: Record<string, unknown>;
    enabled: boolean;
  }>(
    `SELECT id, adapter_type, adapter_config, enabled FROM ingestion_sources WHERE id=$1`,
    [id],
  );

  if (source.rows.length === 0) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  const src = source.rows[0];
  if (!src.enabled) {
    res.status(400).json({ error: "Source is disabled" });
    return;
  }

  let adapter;
  if (src.adapter_type === "apify") {
    adapter = new ApifyAdapter();
    if (!src.adapter_config.apiToken) {
      (src.adapter_config as Record<string, unknown>).apiToken =
        env.apifyApiToken ?? "";
    }
  } else if (src.adapter_type === "rest") {
    adapter = new RestAdapter();
  } else {
    res.status(400).json({
      error: `Adapter type '${src.adapter_type}' requires manual trigger`,
    });
    return;
  }

  const { runId, itemsFetched, itemsRejected } = await runIngestion(
    {
      sourceId: id,
      triggeredBy: req.session?.userId,
      triggerType: "manual",
      adapterConfig: src.adapter_config,
    },
    adapter,
  );

  res.json({ runId, itemsFetched, itemsRejected });
});

router.get("/runs", async (req, res) => {
  const query = z
    .object({
      sourceId: z.coerce.number().int().positive().optional(),
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .parse(req.query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (query.sourceId) {
    conditions.push(`r.source_id=$${idx++}`);
    params.push(query.sourceId);
  }
  if (query.status) {
    conditions.push(`r.status=$${idx++}`);
    params.push(query.status);
  }
  params.push(query.limit);

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT r.*, s.name AS source_name, s.module
     FROM ingestion_runs r
     JOIN ingestion_sources s ON s.id = r.source_id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${idx}`,
    params,
  );
  res.json({ runs: result.rows });
});

router.get("/runs/:runId/candidates", async (req, res) => {
  const runId = Number(req.params.runId);
  const query = z
    .object({
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(req.query);

  const conditions: string[] = [`c.run_id=$1`];
  const params: unknown[] = [runId];
  let idx = 2;

  if (query.status) {
    conditions.push(`c.status=$${idx++}`);
    params.push(query.status);
  }
  params.push(query.limit);

  const result = await pool.query(
    `SELECT c.* FROM ingestion_candidates c
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.created_at ASC
     LIMIT $${idx}`,
    params,
  );
  res.json({ candidates: result.rows });
});

export default router;
