/**
 * Admin-only routes for triggering and ingesting the historical Hallmark
 * catalog crawl from hallmarkornaments.com (1973–present).
 *
 * POST /ornaments/admin/historical-crawl
 *   Fire the Apify historical-crawl actor (non-blocking). Returns runId.
 *   Requires isOwner.
 *
 * GET /ornaments/admin/historical-crawl/:runId
 *   Check run status. If done (SUCCEEDED or TIMED-OUT) and ?ingest=true,
 *   pull all dataset items and upsert into hallmark_historical_catalog.
 *   Requires isOwner.
 *
 * GET /ornaments/admin/historical-crawl/stats
 *   Row count and year coverage summary from hallmark_historical_catalog.
 *   Requires auth (any household member).
 */

import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, hallmarkHistoricalCatalog } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import {
  startApifyActor,
  getApifyRunStatus,
  fetchApifyDataset,
} from "../../lib/apify-client";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

const ACTOR_ID = "AjsBGHmLvJOQrNbZL";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/historical-crawl/stats — coverage (any authenticated user)
// ---------------------------------------------------------------------------
router.get("/admin/historical-crawl/stats", requireAuth, async (req, res) => {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*)::int                                        AS total,
      COUNT(*) FILTER (WHERE year IS NOT NULL)::int        AS with_year,
      COUNT(*) FILTER (WHERE series_name IS NOT NULL)::int AS with_series,
      COUNT(*) FILTER (WHERE artist IS NOT NULL)::int      AS with_artist,
      COUNT(*) FILTER (WHERE hallmark_sku IS NOT NULL)::int AS with_sku,
      COUNT(*) FILTER (WHERE collector_price_usd IS NOT NULL)::int AS with_price,
      MIN(year)                                            AS earliest_year,
      MAX(year)                                            AS latest_year,
      MAX(crawled_at)                                      AS last_crawled_at
    FROM hallmark_historical_catalog
  `);
  res.json({ stats: rows.rows[0] ?? {} });
});

// ---------------------------------------------------------------------------
// POST /admin/historical-crawl — trigger crawl (owner only)
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

  const { runId, defaultDatasetId } = await startApifyActor(
    ACTOR_ID,
    { mode: "historical-crawl", startYear, endYear, maxOrnamentsPerYear },
    token,
    2048, // historical crawl may queue ~10k+ product pages
    7200, // 2-hour platform timeout for full 1973–2026 crawl
  );

  logger.info(
    { runId, defaultDatasetId, startYear, endYear },
    "ornaments: historical crawl started",
  );

  res.status(202).json({
    message: "Historical crawl started",
    runId,
    defaultDatasetId,
    apifyRunUrl: `https://console.apify.com/actors/${ACTOR_ID}/runs/${runId}`,
    statusEndpoint: `/api/ornaments/admin/historical-crawl/${runId}?ingest=true`,
    estimatedOrnaments: `${endYear - startYear + 1} years × ~100–200 ornaments/year`,
  });
});

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

  const runData = await getApifyRunStatus(ACTOR_ID, runId, token);
  const { status, defaultDatasetId } = runData;

  const canIngest = ["SUCCEEDED", "TIMED-OUT"].includes(status);
  if (!canIngest || !ingest) {
    res.json({
      runId,
      status,
      ingestRequested: ingest,
      message: canIngest
        ? `Run ${status.toLowerCase()} — add ?ingest=true to pull results.`
        : `Run is ${status}. Check back later.`,
    });
    return;
  }

  logger.info(
    { runId, defaultDatasetId },
    "ornaments: ingesting historical crawl results",
  );

  const items = await fetchApifyDataset(defaultDatasetId, token, 50_000);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    const productUrl = item["productUrl"] as string | null;
    const name = item["name"] as string | null;

    if (!productUrl || !name) {
      skipped++;
      continue;
    }

    try {
      await db
        .insert(hallmarkHistoricalCatalog)
        .values({
          hallmarkSku: (item["hallmarkSku"] as string | null) ?? null,
          name,
          year: (item["year"] as number | null) ?? null,
          seriesName: (item["seriesName"] as string | null) ?? null,
          sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
          artist: (item["artist"] as string | null) ?? null,
          collectorPriceUsd:
            (item["collectorPriceUsd"] as number | null) != null
              ? String(item["collectorPriceUsd"])
              : null,
          productUrl,
          images: Array.isArray(item["images"])
            ? (item["images"] as string[])
            : [],
          source: "hallmarkornaments.com",
          crawledAt: item["crawledAt"]
            ? new Date(item["crawledAt"] as string)
            : new Date(),
        })
        .onConflictDoUpdate({
          target: hallmarkHistoricalCatalog.productUrl,
          set: {
            hallmarkSku: (item["hallmarkSku"] as string | null) ?? null,
            name,
            year: (item["year"] as number | null) ?? null,
            seriesName: (item["seriesName"] as string | null) ?? null,
            sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
            artist: (item["artist"] as string | null) ?? null,
            collectorPriceUsd:
              (item["collectorPriceUsd"] as number | null) != null
                ? String(item["collectorPriceUsd"])
                : null,
            images: Array.isArray(item["images"])
              ? (item["images"] as string[])
              : [],
            crawledAt: item["crawledAt"]
              ? new Date(item["crawledAt"] as string)
              : new Date(),
            updatedAt: new Date(),
          },
        });
      inserted++;
    } catch (err) {
      logger.warn(
        { url: productUrl, err },
        "ornaments: historical ingest row error",
      );
      errors++;
    }
  }

  res.json({
    runId,
    status,
    totalItems: items.length,
    inserted,
    skipped,
    errors,
  });
});

export default router;
