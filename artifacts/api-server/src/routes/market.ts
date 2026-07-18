/**
 * Market intelligence routes (#234) — authenticated (household-shared reads,
 * owner-only writes for valuations).
 *
 * Observations: any authenticated user may POST (record a sighting) or GET.
 * Valuations: owner-only POST/DELETE; any authenticated user may GET.
 * Watches: household-shared CRUD (no per-user ownership — all household
 *          members share one pool of watch targets, consistent with the rest
 *          of the app's household model).
 */

import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import { adminLimiter, aiLimiter } from "../middleware/rateLimit";

const router = Router();
router.use(requireAuth);

const ALLOWED_MODULES = new Set([
  "pottery",
  "quilting",
  "ornaments",
  "travels",
  "general",
]);

const ALLOWED_PLATFORMS = new Set([
  "ebay",
  "etsy",
  "craigslist",
  "facebook",
  "ruby_lane",
  "replacements",
  "worthpoint",
  "liveauctioneers",
  "invaluable",
  "bonanza",
  "other",
  "manual",
]);

// ── Observations ──────────────────────────────────────────────────────────────

const ObservationQuery = z.object({
  module: z.string().optional(),
  itemType: z.string().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  platform: z.string().optional(),
  listingStatus: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/market/observations", async (req, res) => {
  const query = ObservationQuery.parse(req.query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (query.module) {
    conditions.push(`module = $${idx++}`);
    params.push(query.module);
  }
  if (query.itemType) {
    conditions.push(`item_type = $${idx++}`);
    params.push(query.itemType);
  }
  if (query.itemId !== undefined) {
    conditions.push(`item_id = $${idx++}`);
    params.push(query.itemId);
  }
  if (query.platform) {
    conditions.push(`platform = $${idx++}`);
    params.push(query.platform);
  }
  if (query.listingStatus) {
    conditions.push(`listing_status = $${idx++}`);
    params.push(query.listingStatus);
  }
  if (query.minPrice !== undefined) {
    conditions.push(`observed_price >= $${idx++}`);
    params.push(query.minPrice);
  }
  if (query.maxPrice !== undefined) {
    conditions.push(`observed_price <= $${idx++}`);
    params.push(query.maxPrice);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(query.limit, query.offset);

  const [rows, countRow] = await Promise.all([
    pool.query(
      `SELECT id, module, item_type, item_id, platform,
              listing_url, listing_title,
              observed_price, currency, condition, listing_status,
              listed_at, sold_at, confidence_score, notes,
              created_at, updated_at
       FROM market_observations
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM market_observations ${where}`,
      params.slice(0, params.length - 2),
    ),
  ]);

  res.json({
    observations: rows.rows,
    total: parseInt(countRow.rows[0]?.count ?? "0", 10),
    limit: query.limit,
    offset: query.offset,
  });
});

router.get("/market/observations/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const row = await pool.query(
    `SELECT * FROM market_observations WHERE id=$1`,
    [id],
  );
  if (row.rows.length === 0) {
    res.status(404).json({ error: "Observation not found" });
    return;
  }
  res.json({ observation: row.rows[0] });
});

const ObservationBody = z.object({
  module: z.string().min(1),
  itemType: z.string().min(1),
  itemId: z.coerce.number().int().positive().optional(),
  ingestionCandidateId: z.coerce.number().int().positive().optional(),
  platform: z.string().min(1),
  listingUrl: z.string().url().optional(),
  listingTitle: z.string().max(500).optional(),
  observedPrice: z.coerce.number().positive().optional(),
  currency: z.string().length(3).default("USD"),
  condition: z.string().max(100).optional(),
  listingStatus: z
    .enum(["active", "sold", "expired", "unknown"])
    .default("active"),
  listedAt: z.string().datetime().optional(),
  soldAt: z.string().datetime().optional(),
  sourceJson: z.record(z.string(), z.unknown()).optional(),
  confidenceScore: z.coerce.number().min(0).max(1).optional(),
  notes: z.string().max(1000).optional(),
});

router.post("/market/observations", aiLimiter, async (req, res) => {
  const body = ObservationBody.parse(req.body);

  if (!ALLOWED_MODULES.has(body.module)) {
    res.status(400).json({ error: "Invalid module" });
    return;
  }
  if (!ALLOWED_PLATFORMS.has(body.platform)) {
    res.status(400).json({ error: "Invalid platform" });
    return;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO market_observations
       (module, item_type, item_id, ingestion_candidate_id,
        platform, listing_url, listing_title,
        observed_price, currency, condition, listing_status,
        listed_at, sold_at, source_json, confidence_score, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
     RETURNING id`,
    [
      body.module,
      body.itemType,
      body.itemId ?? null,
      body.ingestionCandidateId ?? null,
      body.platform,
      body.listingUrl ?? null,
      body.listingTitle ?? null,
      body.observedPrice ?? null,
      body.currency,
      body.condition ?? null,
      body.listingStatus,
      body.listedAt ?? null,
      body.soldAt ?? null,
      body.sourceJson ? JSON.stringify(body.sourceJson) : null,
      body.confidenceScore ?? null,
      body.notes ?? null,
    ],
  );

  res.status(201).json({ ok: true, id: result.rows[0].id });
});

router.patch("/market/observations/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = ObservationBody.partial().parse(req.body);
  const fields: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;

  if (body.listingStatus !== undefined) {
    fields.push(`listing_status=$${idx++}`);
    params.push(body.listingStatus);
  }
  if (body.observedPrice !== undefined) {
    fields.push(`observed_price=$${idx++}`);
    params.push(body.observedPrice);
  }
  if (body.notes !== undefined) {
    fields.push(`notes=$${idx++}`);
    params.push(body.notes);
  }
  if (body.soldAt !== undefined) {
    fields.push(`sold_at=$${idx++}`);
    params.push(body.soldAt);
  }
  if (body.confidenceScore !== undefined) {
    fields.push(`confidence_score=$${idx++}`);
    params.push(body.confidenceScore);
  }

  if (fields.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push(`updated_at=now()`);

  await pool.query(
    `UPDATE market_observations SET ${fields.join(",")} WHERE id=$1`,
    params,
  );
  res.json({ ok: true });
});

router.delete("/market/observations/:id", requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const result = await pool.query(
    `DELETE FROM market_observations WHERE id=$1 RETURNING id`,
    [id],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Observation not found" });
    return;
  }
  res.json({ ok: true });
});

// ── Valuations ────────────────────────────────────────────────────────────────

router.get("/market/valuations", async (req, res) => {
  const query = z
    .object({
      module: z.string().optional(),
      itemType: z.string().optional(),
      itemId: z.coerce.number().int().positive().optional(),
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
  if (query.itemType) {
    conditions.push(`item_type=$${idx++}`);
    params.push(query.itemType);
  }
  if (query.itemId !== undefined) {
    conditions.push(`item_id=$${idx++}`);
    params.push(query.itemId);
  }
  params.push(query.limit);
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await pool.query(
    `SELECT id, module, item_type, item_id,
            valuation_method, estimated_value, value_low, value_high, currency,
            sample_size, valid_until, notes, computed_at
     FROM market_valuations
     ${where}
     ORDER BY computed_at DESC
     LIMIT $${idx}`,
    params,
  );

  res.json({ valuations: rows.rows });
});

const ValuationBody = z.object({
  module: z.string().min(1),
  itemType: z.string().min(1),
  itemId: z.coerce.number().int().positive().optional(),
  valuationMethod: z
    .enum(["median", "mean", "weighted", "manual"])
    .default("median"),
  estimatedValue: z.coerce.number().positive(),
  valueLow: z.coerce.number().positive().optional(),
  valueHigh: z.coerce.number().positive().optional(),
  currency: z.string().length(3).default("USD"),
  sampleSize: z.coerce.number().int().min(0).optional(),
  observationIds: z.array(z.number().int().positive()).optional(),
  validUntil: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

router.post(
  "/market/valuations",
  adminLimiter,
  requireOwner,
  async (req, res) => {
    const body = ValuationBody.parse(req.body);

    if (!ALLOWED_MODULES.has(body.module)) {
      res.status(400).json({ error: "Invalid module" });
      return;
    }

    const result = await pool.query<{ id: number }>(
      `INSERT INTO market_valuations
         (module, item_type, item_id, valuation_method,
          estimated_value, value_low, value_high, currency,
          sample_size, observation_ids, valid_until, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
       RETURNING id`,
      [
        body.module,
        body.itemType,
        body.itemId ?? null,
        body.valuationMethod,
        body.estimatedValue,
        body.valueLow ?? null,
        body.valueHigh ?? null,
        body.currency,
        body.sampleSize ?? null,
        body.observationIds ? JSON.stringify(body.observationIds) : null,
        body.validUntil ?? null,
        body.notes ?? null,
        req.session?.userId ?? null,
      ],
    );

    res.status(201).json({ ok: true, id: result.rows[0].id });
  },
);

// ── Watches ────────────────────────────────────────────────────────────────────

router.get("/market/watches", async (req, res) => {
  const query = z
    .object({
      module: z.string().optional(),
      enabled: z.coerce.boolean().optional(),
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
  if (query.enabled !== undefined) {
    conditions.push(`enabled=$${idx++}`);
    params.push(query.enabled);
  }
  params.push(query.limit);
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await pool.query(
    `SELECT id, user_id, module, item_type, item_id, search_query,
            platforms, enabled, alert_threshold_low, alert_threshold_high,
            alert_currency, last_run_at, notes, created_at, updated_at
     FROM market_watches
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );

  res.json({ watches: rows.rows });
});

const WatchBody = z.object({
  module: z.string().min(1),
  itemType: z.string().optional(),
  itemId: z.coerce.number().int().positive().optional(),
  searchQuery: z.string().max(500).optional(),
  platforms: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  alertThresholdLow: z.coerce.number().positive().optional(),
  alertThresholdHigh: z.coerce.number().positive().optional(),
  alertCurrency: z.string().length(3).default("USD"),
  notes: z.string().max(500).optional(),
});

router.post("/market/watches", async (req, res) => {
  const body = WatchBody.parse(req.body);

  if (!ALLOWED_MODULES.has(body.module)) {
    res.status(400).json({ error: "Invalid module" });
    return;
  }
  if (!body.itemId && !body.searchQuery) {
    res.status(400).json({ error: "Either itemId or searchQuery is required" });
    return;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO market_watches
       (user_id, module, item_type, item_id, search_query,
        platforms, enabled,
        alert_threshold_low, alert_threshold_high, alert_currency, notes)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      req.session?.userId ?? null,
      body.module,
      body.itemType ?? null,
      body.itemId ?? null,
      body.searchQuery ?? null,
      JSON.stringify(body.platforms),
      body.enabled,
      body.alertThresholdLow ?? null,
      body.alertThresholdHigh ?? null,
      body.alertCurrency,
      body.notes ?? null,
    ],
  );

  res.status(201).json({ ok: true, id: result.rows[0].id });
});

router.patch("/market/watches/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = WatchBody.partial().parse(req.body);
  const fields: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;

  if (body.enabled !== undefined) {
    fields.push(`enabled=$${idx++}`);
    params.push(body.enabled);
  }
  if (body.platforms !== undefined) {
    fields.push(`platforms=$${idx++}::jsonb`);
    params.push(JSON.stringify(body.platforms));
  }
  if (body.searchQuery !== undefined) {
    fields.push(`search_query=$${idx++}`);
    params.push(body.searchQuery);
  }
  if (body.alertThresholdLow !== undefined) {
    fields.push(`alert_threshold_low=$${idx++}`);
    params.push(body.alertThresholdLow);
  }
  if (body.alertThresholdHigh !== undefined) {
    fields.push(`alert_threshold_high=$${idx++}`);
    params.push(body.alertThresholdHigh);
  }
  if (body.notes !== undefined) {
    fields.push(`notes=$${idx++}`);
    params.push(body.notes);
  }

  if (fields.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  fields.push(`updated_at=now()`);

  const result = await pool.query(
    `UPDATE market_watches SET ${fields.join(",")} WHERE id=$1 RETURNING id`,
    params,
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Watch not found" });
    return;
  }
  res.json({ ok: true });
});

router.delete("/market/watches/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const result = await pool.query(
    `DELETE FROM market_watches WHERE id=$1 RETURNING id`,
    [id],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Watch not found" });
    return;
  }
  res.json({ ok: true });
});

// ── Summary (owner-only dashboard view) ──────────────────────────────────────

router.get("/market/summary", adminLimiter, requireOwner, async (_req, res) => {
  const [obsRows, valRows, watchRows] = await Promise.all([
    pool.query<{
      module: string;
      platform: string;
      listing_status: string;
      count: string;
      avg_price: string;
    }>(
      `SELECT module, platform, listing_status,
                COUNT(*)::text AS count,
                AVG(observed_price)::numeric(12,2)::text AS avg_price
         FROM market_observations
         WHERE created_at >= now() - interval '90 days'
         GROUP BY module, platform, listing_status
         ORDER BY module, COUNT(*) DESC`,
    ),
    pool.query<{
      module: string;
      item_type: string;
      count: string;
      avg_value: string;
    }>(
      `SELECT module, item_type,
                COUNT(*)::text AS count,
                AVG(estimated_value)::numeric(12,2)::text AS avg_value
         FROM market_valuations
         WHERE computed_at >= now() - interval '90 days'
         GROUP BY module, item_type
         ORDER BY module, COUNT(*) DESC`,
    ),
    pool.query<{ enabled: boolean; count: string }>(
      `SELECT enabled, COUNT(*)::text AS count FROM market_watches GROUP BY enabled`,
    ),
  ]);

  res.json({
    observations: obsRows.rows,
    valuations: valRows.rows,
    watches: watchRows.rows,
  });
});

export default router;
