/**
 * Admin-only routes for triggering and ingesting the Hallmark catalog crawl.
 *
 * POST /ornaments/admin/catalog-crawl
 *   Fire the Apify catalog-crawl actor (non-blocking). Returns runId immediately.
 *   Requires isOwner.
 *
 * GET /ornaments/admin/catalog-crawl/:runId
 *   Check run status. If SUCCEEDED and ?ingest=true, pull all dataset items
 *   and upsert them into hallmark_catalog. Returns status + counts.
 *   Requires isOwner.
 *
 * GET /ornaments/admin/catalog-crawl/stats
 *   Return row count and coverage summary from hallmark_catalog.
 *   Requires auth (any household member).
 */

import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, hallmarkCatalog } from "@workspace/db";
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
// GET /admin/catalog-crawl/stats — catalog coverage (any authenticated user)
// ---------------------------------------------------------------------------
router.get("/admin/catalog-crawl/stats", requireAuth, async (req, res) => {
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

  const { runId, defaultDatasetId } = await startApifyActor(
    ACTOR_ID,
    { mode: "catalog-crawl", sitemapUrl, urlFilter, maxProducts },
    token,
    1024, // CheerioCrawler is lightweight — 1 GB is plenty
  );

  logger.info(
    { runId, defaultDatasetId, urlFilter, maxProducts },
    "ornaments: catalog crawl started",
  );

  res.status(202).json({
    message: "Catalog crawl started",
    runId,
    defaultDatasetId,
    apifyRunUrl: `https://console.apify.com/actors/${ACTOR_ID}/runs/${runId}`,
    statusEndpoint: `/api/ornaments/admin/catalog-crawl/${runId}?ingest=true`,
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

  const runData = await getApifyRunStatus(ACTOR_ID, runId, token);
  const { status, defaultDatasetId } = runData;

  if (status !== "SUCCEEDED" || !ingest) {
    res.json({
      runId,
      status,
      ingestRequested: ingest,
      message:
        status === "SUCCEEDED"
          ? "Run succeeded. Add ?ingest=true to ingest results."
          : `Run is ${status}. Check back later.`,
    });
    return;
  }

  // ── Ingest dataset into hallmark_catalog ──────────────────────────────
  logger.info(
    { runId, defaultDatasetId },
    "ornaments: ingesting catalog crawl results",
  );

  const items = await fetchApifyDataset(defaultDatasetId, token, 10_000);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    const sku = item["hallmarkSku"] as string | null;
    const name = item["name"] as string | null;

    if (!sku || !name) {
      skipped++;
      continue;
    }

    try {
      await db
        .insert(hallmarkCatalog)
        .values({
          hallmarkSku: sku,
          name,
          description: (item["description"] as string | null) ?? null,
          seriesName: (item["seriesName"] as string | null) ?? null,
          sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
          year: (item["year"] as number | null) ?? null,
          artist: (item["artist"] as string | null) ?? null,
          retailPriceUsd:
            (item["retailPriceUsd"] as number | null) != null
              ? String(item["retailPriceUsd"])
              : null,
          productUrl: (item["productUrl"] as string | null) ?? null,
          images: Array.isArray(item["images"])
            ? (item["images"] as string[])
            : [],
          ornamentCategory: (item["ornamentCategory"] as string | null) ?? null,
          crawledAt: item["crawledAt"]
            ? new Date(item["crawledAt"] as string)
            : new Date(),
        })
        .onConflictDoUpdate({
          target: hallmarkCatalog.hallmarkSku,
          set: {
            name,
            description: (item["description"] as string | null) ?? null,
            seriesName: (item["seriesName"] as string | null) ?? null,
            sequenceNumber: (item["sequenceNumber"] as number | null) ?? null,
            year: (item["year"] as number | null) ?? null,
            artist: (item["artist"] as string | null) ?? null,
            retailPriceUsd:
              (item["retailPriceUsd"] as number | null) != null
                ? String(item["retailPriceUsd"])
                : null,
            productUrl: (item["productUrl"] as string | null) ?? null,
            images: Array.isArray(item["images"])
              ? (item["images"] as string[])
              : [],
            ornamentCategory:
              (item["ornamentCategory"] as string | null) ?? null,
            crawledAt: item["crawledAt"]
              ? new Date(item["crawledAt"] as string)
              : new Date(),
            updatedAt: new Date(),
          },
        });
      inserted++;
    } catch (err) {
      errors++;
      logger.warn({ sku, err }, "ornaments: catalog ingest row error");
    }
  }

  logger.info(
    { runId, inserted, skipped, errors, total: items.length },
    "ornaments: catalog ingest complete",
  );

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
