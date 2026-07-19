/**
 * Admin-only routes for triggering and ingesting the HookedOnHallmark crawl.
 *
 * hookedonhallmark.com is the world's largest Hallmark ornament retailer.
 * Their sitemap lists all ~16 500 product URLs, each of which embeds
 * a `var _3d_item = {...}` JS literal with price, SKU, and availability
 * in static HTML — no JavaScript rendering needed.
 *
 * POST /ornaments/admin/hooh-crawl
 *   Fetches the sitemap, extracts all product URLs, fires the Apify actor
 *   (non-blocking). Returns {runId, productUrlCount, resurrectEndpoint}.
 *   Attaches an ad-hoc Apify webhook (if APIFY_WEBHOOK_SECRET is set) so
 *   ingest triggers automatically on completion. Requires isOwner.
 *
 * GET /ornaments/admin/hooh-crawl/:runId
 *   Check run status. If SUCCEEDED or TIMED-OUT and ?ingest=true, pull all
 *   dataset items and upsert into hallmark_hooh_catalog, then backfill
 *   prices on hallmark_historical_catalog by SKU. Requires isOwner.
 *
 * POST /ornaments/admin/hooh-crawl/:runId/resurrect
 *   Resume a TIMED-OUT or ABORTED run. Requires isOwner.
 *
 * GET /ornaments/admin/hooh-crawl/stats
 *   Row count and coverage summary from hallmark_hooh_catalog.
 *   Requires auth (any household member).
 */

import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import {
  startApifyActor,
  getApifyRunStatus,
  resurrectApifyRun,
} from "../../lib/apify-client";
import { ingestHoohDataset } from "../../lib/ornaments/ingest-hooh";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

// Apify actor ID for hallmark-hooh-crawl
// Created 2026-07-19 via Apify REST API from apify-actors/hallmark-hooh-crawl/
const ACTOR_ID = "rFw8VLb3KM2g4DVrE";

const SITEMAP_URL = "https://www.hookedonhallmark.com/sitemap.xml";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/hooh-crawl/stats — coverage summary (any authenticated user)
// ---------------------------------------------------------------------------
router.get("/admin/hooh-crawl/stats", requireAuth, async (_req, res) => {
  const row = await db.execute(sql`
    SELECT
      COUNT(*)::int                        AS total,
      COUNT(*) FILTER (WHERE year IS NOT NULL)::int         AS with_year,
      COUNT(*) FILTER (WHERE series_name IS NOT NULL)::int  AS with_series,
      COUNT(*) FILTER (WHERE hallmark_sku IS NOT NULL)::int AS with_sku,
      COUNT(*) FILTER (WHERE retail_price_usd IS NOT NULL)::int AS with_price,
      COUNT(*) FILTER (WHERE in_stock = true)::int          AS in_stock,
      MIN(year)                            AS earliest_year,
      MAX(year)                            AS latest_year,
      MAX(crawled_at)                      AS last_crawled_at
    FROM hallmark_hooh_catalog
  `);
  res.json({ stats: row.rows[0] });
});

// ---------------------------------------------------------------------------
// POST /admin/hooh-crawl — fetch sitemap + fire actor (owner only)
// ---------------------------------------------------------------------------
router.post("/admin/hooh-crawl", requireOwner, async (req, res) => {
  const token = env.apifyApiToken;
  if (!token) {
    res.status(503).json({ error: "APIFY_API_TOKEN not configured" });
    return;
  }

  // Fetch sitemap.xml to collect all product URLs
  let productUrls: string[] = [];
  try {
    const sitemapResp = await fetch(SITEMAP_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Batchelor Bot)" },
      signal: AbortSignal.timeout(15_000),
    });
    const sitemapXml = await sitemapResp.text();
    const allUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    productUrls = allUrls.filter((u) => /_p_\d+/.test(u));
    logger.info(
      { total: allUrls.length, products: productUrls.length },
      "ornaments: hooh sitemap fetched",
    );
  } catch (err) {
    logger.error({ err }, "ornaments: hooh sitemap fetch failed");
    res
      .status(502)
      .json({ error: "Failed to fetch sitemap from hookedonhallmark.com" });
    return;
  }

  if (productUrls.length === 0) {
    res.status(502).json({ error: "Sitemap contained no product URLs" });
    return;
  }

  const webhookSecret = env.apifyWebhookSecret;
  const baseUrl = `https://${req.hostname}`;
  const webhookUrl = webhookSecret
    ? `${baseUrl}/api/ornaments/webhook/apify?token=${webhookSecret}`
    : undefined;

  const body = req.body as Record<string, unknown>;
  const maxItems =
    typeof body["maxItems"] === "number" ? body["maxItems"] : undefined;

  const input: Record<string, unknown> = {
    startUrls: productUrls,
  };
  if (maxItems && maxItems > 0) {
    input["maxItems"] = maxItems;
  }

  // 1 024 MB memory, 2-hour platform timeout (16 500 pages at 20 concurrency)
  const run = await startApifyActor(
    ACTOR_ID,
    input,
    token,
    1024,
    7200,
    webhookUrl,
  );

  logger.info(
    { runId: run.runId, productUrlCount: productUrls.length },
    "ornaments: hooh crawl triggered",
  );

  res.json({
    runId: run.runId,
    actorId: ACTOR_ID,
    productUrlCount: productUrls.length,
    resurrectEndpoint: `/api/ornaments/admin/hooh-crawl/${run.runId}/resurrect`,
    webhookAttached: !!webhookUrl,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/hooh-crawl/:runId — check status + optional ingest (owner only)
// ---------------------------------------------------------------------------
router.get("/admin/hooh-crawl/:runId", requireOwner, async (req, res) => {
  const runId = String(req.params["runId"]);
  const ingest = req.query["ingest"] === "true";
  const token = env.apifyApiToken;
  if (!token) {
    res.status(503).json({ error: "APIFY_API_TOKEN not configured" });
    return;
  }

  const run = await getApifyRunStatus(ACTOR_ID, runId, token);

  if (
    ingest &&
    (run.status === "SUCCEEDED" || run.status === "TIMED-OUT") &&
    run.defaultDatasetId
  ) {
    const result = await ingestHoohDataset(run.defaultDatasetId, token);
    res.json({ runId, status: run.status, ingest: result });
    return;
  }

  res.json({
    runId,
    status: run.status,
    defaultDatasetId: run.defaultDatasetId,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/hooh-crawl/:runId/resurrect — resume timed-out run (owner only)
// ---------------------------------------------------------------------------
router.post("/admin/hooh-crawl/resurrect", requireOwner, async (_req, res) => {
  res.status(400).json({
    error: "Provide a runId: POST /admin/hooh-crawl/:runId/resurrect",
  });
});

router.post(
  "/admin/hooh-crawl/:runId/resurrect",
  requireOwner,
  async (req, res) => {
    const runId = String(req.params["runId"]);
    const token = env.apifyApiToken;
    if (!token) {
      res.status(503).json({ error: "APIFY_API_TOKEN not configured" });
      return;
    }

    const result = await resurrectApifyRun(runId, token);
    logger.info({ runId }, "ornaments: hooh run resurrected");
    res.json({ runId, status: result.status });
  },
);

export default router;
