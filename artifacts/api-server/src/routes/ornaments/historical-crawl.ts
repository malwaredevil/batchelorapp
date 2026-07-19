/**
 * Admin-only routes for triggering and ingesting the historical Hallmark
 * catalog crawl from hallmarkornaments.com (1973–present).
 *
 * POST /ornaments/admin/historical-crawl
 *   Fire the Apify historical-crawl actor (non-blocking). Returns runId.
 *   Attaches an ad-hoc Apify webhook (if APIFY_WEBHOOK_SECRET is set) so
 *   ingest triggers automatically on completion. Requires isOwner.
 *
 * GET /ornaments/admin/historical-crawl/:runId
 *   Check run status. If SUCCEEDED or TIMED-OUT and ?ingest=true, pull all
 *   dataset items and upsert into hallmark_historical_catalog. Requires isOwner.
 *
 * POST /ornaments/admin/historical-crawl/:runId/resurrect
 *   Resurrect a TIMED-OUT or ABORTED run to continue from where it left off.
 *   Requires isOwner.
 *
 * POST /ornaments/admin/historical-crawl/extract-series
 *   Post-process existing rows: parse series name + sequence number out of the
 *   product URL slug for any row where series_name IS NULL. Requires isOwner.
 *
 * GET /ornaments/admin/historical-crawl/stats
 *   Row count and year coverage summary from hallmark_historical_catalog.
 *   Requires auth (any household member).
 */

import { Router, type IRouter } from "express";
import { eq, isNull, sql } from "drizzle-orm";
import { db, hallmarkHistoricalCatalog } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import {
  startApifyActor,
  getApifyRunStatus,
  resurrectApifyRun,
} from "../../lib/apify-client";
import { ingestHistoricalDataset } from "../../lib/ornaments/ingest-historical";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

// hallmark-historical-crawl actor (apify-actors/hallmark-historical-crawl)
const ACTOR_ID = "yGAVM3iruskyfE4ZQ";

const router: IRouter = Router();

/** Same series-parsing regex used in the Apify actor. */
function parseSeriesFromSlug(slug: string): {
  seriesName: string | null;
  sequenceNumber: number | null;
} {
  const m = slug.match(
    /(\d+)(?:st|nd|rd|th)\s+in\s+(?:the\s+)?(.+?)\s+(?:Keepsake\s+Ornament\s+)?[Ss]eries/i,
  );
  if (!m) return { seriesName: null, sequenceNumber: null };
  return {
    sequenceNumber: parseInt(m[1], 10),
    seriesName: m[2].replace(/Keepsake Ornament/gi, "").trim(),
  };
}

/** Build the public webhook URL for Apify callbacks. */
function buildWebhookUrl(reqHost: string): string | undefined {
  const secret = env.apifyWebhookSecret;
  if (!secret) return undefined;
  const domain =
    process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim() ?? reqHost;
  return `https://${domain}/api/ornaments/webhook/apify?token=${secret}`;
}

// ---------------------------------------------------------------------------
// GET /admin/historical-crawl/stats — coverage (any authenticated user)
// ---------------------------------------------------------------------------
router.get("/admin/historical-crawl/stats", requireAuth, async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*)::int                                            AS total,
      COUNT(*) FILTER (WHERE year IS NOT NULL)::int            AS with_year,
      COUNT(*) FILTER (WHERE series_name IS NOT NULL)::int     AS with_series,
      COUNT(*) FILTER (WHERE artist IS NOT NULL)::int          AS with_artist,
      COUNT(*) FILTER (WHERE hallmark_sku IS NOT NULL)::int    AS with_sku,
      COUNT(*) FILTER (WHERE collector_price_usd IS NOT NULL)::int AS with_price,
      MIN(year)                                                AS earliest_year,
      MAX(year)                                                AS latest_year,
      MAX(crawled_at)                                          AS last_crawled_at
    FROM hallmark_historical_catalog
  `);
  res.json({ stats: rows.rows[0] ?? {} });
});

// ---------------------------------------------------------------------------
// POST /admin/historical-crawl — trigger a new historical crawl (owner only)
// ---------------------------------------------------------------------------
router.post("/admin/historical-crawl", requireOwner, async (req, res) => {
  const {
    startYear = 1973,
    endYear = 2026,
    maxOrnamentsPerYear = 0,
  } = req.body as {
    startYear?: number;
    endYear?: number;
    maxOrnamentsPerYear?: number;
  };

  const token = env.apifyApiToken;
  if (!token) {
    res.status(503).json({ error: "Apify API token not configured" });
    return;
  }

  const webhookUrl = buildWebhookUrl(req.get("host") ?? "");

  const { runId, defaultDatasetId } = await startApifyActor(
    ACTOR_ID,
    { startYear, endYear, maxOrnamentsPerYear },
    token,
    2048, // CheerioCrawler + 16k pages — 2 GB gives headroom
    7200, // 2-hour platform timeout for a full historical crawl
    webhookUrl,
  );

  logger.info(
    { runId, defaultDatasetId, startYear, endYear, webhookUrl: !!webhookUrl },
    "ornaments: historical crawl started",
  );

  res.status(202).json({
    message: "Historical crawl started",
    runId,
    defaultDatasetId,
    webhookConfigured: !!webhookUrl,
    apifyRunUrl: `https://console.apify.com/actors/${ACTOR_ID}/runs/${runId}`,
    statusEndpoint: `/api/ornaments/admin/historical-crawl/${runId}?ingest=true`,
    resurrectEndpoint: `/api/ornaments/admin/historical-crawl/${runId}/resurrect`,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/historical-crawl/extract-series
// Post-process existing rows: parse series from URL slug where series_name IS NULL.
// ---------------------------------------------------------------------------
router.post(
  "/admin/historical-crawl/extract-series",
  requireOwner,
  async (_req, res) => {
    // Fetch all rows missing series data
    const rows = await db
      .select({
        id: hallmarkHistoricalCatalog.id,
        productUrl: hallmarkHistoricalCatalog.productUrl,
      })
      .from(hallmarkHistoricalCatalog)
      .where(isNull(hallmarkHistoricalCatalog.seriesName));

    let updated = 0;
    let parsed = 0;

    for (const row of rows) {
      // Convert URL slug to readable text for regex matching
      // e.g. ".../1995-Frosty-Friends-16th-in-Frosty-Friends-Series_p_3422.html"
      //    → "1995 Frosty Friends 16th in Frosty Friends Series"
      const slug = row.productUrl
        .replace(/^.*\//, "") // strip path prefix
        .replace(/_p_\d+\.html$/, "") // strip product-ID suffix
        .replace(/-/g, " "); // dashes → spaces

      const { seriesName, sequenceNumber } = parseSeriesFromSlug(slug);
      if (!seriesName) continue;

      parsed++;
      try {
        await db
          .update(hallmarkHistoricalCatalog)
          .set({ seriesName, sequenceNumber, updatedAt: new Date() })
          .where(eq(hallmarkHistoricalCatalog.id, row.id));
        updated++;
      } catch (err) {
        logger.warn(
          { id: row.id, err },
          "ornaments: extract-series update error",
        );
      }
    }

    logger.info(
      { scanned: rows.length, parsed, updated },
      "ornaments: extract-series complete",
    );

    res.json({
      scanned: rows.length,
      parsedFromUrl: parsed,
      updated,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /admin/historical-crawl/:runId — status + optional ingest (owner only)
// ---------------------------------------------------------------------------
router.get("/admin/historical-crawl/:runId", requireOwner, async (req, res) => {
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
      resurrectEndpoint: `/api/ornaments/admin/historical-crawl/${runId}/resurrect`,
    });
    return;
  }

  logger.info(
    { runId, defaultDatasetId },
    "ornaments: ingesting historical crawl results",
  );

  const result = await ingestHistoricalDataset(defaultDatasetId, token);
  res.json({ runId, status, ...result });
});

// ---------------------------------------------------------------------------
// POST /admin/historical-crawl/:runId/resurrect — resume a timed-out run
// ---------------------------------------------------------------------------
router.post(
  "/admin/historical-crawl/:runId/resurrect",
  requireOwner,
  async (req, res) => {
    const runId = String(req.params["runId"]);

    const token = env.apifyApiToken;
    if (!token) {
      res.status(503).json({ error: "Apify API token not configured" });
      return;
    }

    const result = await resurrectApifyRun(runId, token);

    logger.info(
      { runId, ...result },
      "ornaments: historical crawl resurrected",
    );

    res.json({
      runId,
      status: result.status,
      defaultDatasetId: result.defaultDatasetId,
      message: `Run resurrected — status is now ${result.status}`,
      monitorUrl: `https://console.apify.com/actors/${ACTOR_ID}/runs/${runId}`,
      statusEndpoint: `/api/ornaments/admin/historical-crawl/${runId}?ingest=true`,
    });
  },
);

export default router;
