/**
 * Admin-only routes for triggering and ingesting the Hallmark catalog crawl.
 *
 * POST /ornaments/admin/catalog-crawl
 *   Fire the Apify catalog-crawl actor (non-blocking). Returns runId immediately.
 *   Attaches an ad-hoc Apify webhook (if APIFY_WEBHOOK_SECRET is set) so
 *   ingest triggers automatically on completion. Requires isOwner.
 *
 * GET /ornaments/admin/catalog-crawl/:runId
 *   Check run status. If SUCCEEDED or TIMED-OUT and ?ingest=true, pull all
 *   dataset items and upsert them into hallmark_catalog. Requires isOwner.
 *
 * POST /ornaments/admin/catalog-crawl/:runId/resurrect
 *   Resurrect a TIMED-OUT or ABORTED run to continue from where it left off.
 *   Requires isOwner.
 *
 * GET /ornaments/admin/catalog-crawl/stats
 *   Return row count and coverage summary from hallmark_catalog.
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
import { ingestCatalogDataset } from "../../lib/ornaments/ingest-catalog";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

// hallmark-catalog-crawl actor (apify-actors/hallmark-catalog-crawl in batchelorapp repo)
const ACTOR_ID = "Kb7QGS6aXUVgTDoIV";

const router: IRouter = Router();

/** Build the public webhook URL for Apify callbacks. */
function buildWebhookUrl(reqHost: string): string | undefined {
  const secret = env.apifyWebhookSecret;
  if (!secret) return undefined;
  const domain =
    process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim() ?? reqHost;
  return `https://${domain}/api/ornaments/webhook/apify?token=${secret}`;
}

// ---------------------------------------------------------------------------
// GET /admin/catalog-crawl/stats — catalog coverage (any authenticated user)
// ---------------------------------------------------------------------------
router.get("/admin/catalog-crawl/stats", requireAuth, async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*)::int                                        AS total,
      COUNT(*) FILTER (WHERE year IS NOT NULL)::int        AS with_year,
      COUNT(*) FILTER (WHERE series_name IS NOT NULL)::int AS with_series,
      COUNT(*) FILTER (WHERE artist IS NOT NULL)::int      AS with_artist,
      COUNT(*) FILTER (WHERE retail_price_usd IS NOT NULL)::int AS with_price,
      MIN(year)                                            AS earliest_year,
      MAX(year)                                            AS latest_year,
      MAX(crawled_at)                                      AS last_crawled_at
    FROM hallmark_catalog
  `);
  res.json({ stats: rows.rows[0] ?? {} });
});

// ---------------------------------------------------------------------------
// POST /admin/catalog-crawl — trigger a new catalog crawl (owner only)
// ---------------------------------------------------------------------------
router.post("/admin/catalog-crawl", requireOwner, async (req, res) => {
  const {
    urlFilter = "/ornaments/",
    maxProducts = 5000,
    sitemapUrl = "https://www.hallmark.com/sitemap_0-product.xml",
  } = req.body as {
    urlFilter?: string;
    maxProducts?: number;
    sitemapUrl?: string;
  };

  const token = env.apifyApiToken;
  if (!token) {
    res.status(503).json({ error: "Apify API token not configured" });
    return;
  }

  const webhookUrl = buildWebhookUrl(req.get("host") ?? "");

  const { runId, defaultDatasetId } = await startApifyActor(
    ACTOR_ID,
    { mode: "catalog-crawl", sitemapUrl, urlFilter, maxProducts },
    token,
    1024, // CheerioCrawler is lightweight — 1 GB is plenty
    3600, // 1-hour platform timeout for full catalog crawl
    webhookUrl,
  );

  logger.info(
    {
      runId,
      defaultDatasetId,
      urlFilter,
      maxProducts,
      webhookUrl: !!webhookUrl,
    },
    "ornaments: catalog crawl started",
  );

  res.status(202).json({
    message: "Catalog crawl started",
    runId,
    defaultDatasetId,
    webhookConfigured: !!webhookUrl,
    apifyRunUrl: `https://console.apify.com/actors/${ACTOR_ID}/runs/${runId}`,
    statusEndpoint: `/api/ornaments/admin/catalog-crawl/${runId}?ingest=true`,
    resurrectEndpoint: `/api/ornaments/admin/catalog-crawl/${runId}/resurrect`,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/catalog-crawl/:runId — check status + optionally ingest (owner only)
// ---------------------------------------------------------------------------
router.get("/admin/catalog-crawl/:runId", requireOwner, async (req, res) => {
  const runId = String(req.params["runId"]);
  const ingest = req.query["ingest"] === "true";

  const token = env.apifyApiToken;
  if (!token) {
    res.status(503).json({ error: "Apify API token not configured" });
    return;
  }

  const { status, defaultDatasetId } = await getApifyRunStatus(
    ACTOR_ID,
    runId,
    token,
  );

  const canIngest = ["SUCCEEDED", "TIMED-OUT"].includes(status);
  if (!canIngest || !ingest) {
    res.json({
      runId,
      status,
      ingestRequested: ingest,
      message: canIngest
        ? `Run ${status.toLowerCase()} — add ?ingest=true to pull results.`
        : `Run is ${status}. Check back later or use /resurrect to continue.`,
      resurrectEndpoint: `/api/ornaments/admin/catalog-crawl/${runId}/resurrect`,
    });
    return;
  }

  logger.info(
    { runId, defaultDatasetId },
    "ornaments: ingesting catalog crawl results",
  );

  const result = await ingestCatalogDataset(defaultDatasetId, token);
  res.json({ runId, status, ...result });
});

// ---------------------------------------------------------------------------
// POST /admin/catalog-crawl/:runId/resurrect — resume a timed-out run
// ---------------------------------------------------------------------------
router.post(
  "/admin/catalog-crawl/:runId/resurrect",
  requireOwner,
  async (req, res) => {
    const runId = String(req.params["runId"]);

    const token = env.apifyApiToken;
    if (!token) {
      res.status(503).json({ error: "Apify API token not configured" });
      return;
    }

    const result = await resurrectApifyRun(runId, token);

    logger.info({ runId, ...result }, "ornaments: catalog crawl resurrected");

    res.json({
      runId,
      status: result.status,
      defaultDatasetId: result.defaultDatasetId,
      message: `Run resurrected — status is now ${result.status}`,
      monitorUrl: `https://console.apify.com/actors/${ACTOR_ID}/runs/${runId}`,
      statusEndpoint: `/api/ornaments/admin/catalog-crawl/${runId}?ingest=true`,
    });
  },
);

export default router;
