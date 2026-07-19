/**
 * Apify webhook receiver — auto-ingests crawl results when a run finishes.
 *
 * POST /ornaments/webhook/apify?token=<APIFY_WEBHOOK_SECRET>
 *
 * No session auth. Authenticated solely by the secret token in the URL query
 * param (registered as part of the webhook URL when starting a crawl). Apify
 * calls this endpoint when a run reaches SUCCEEDED, TIMED-OUT, or FAILED.
 *
 * On SUCCEEDED or TIMED-OUT: fetches the dataset and upserts into the
 *   appropriate table based on which actor sent the event.
 * On FAILED: logs only (no partial data to ingest).
 *
 * Returns 200 immediately for all authenticated requests; ingest runs async
 * so Apify doesn't wait and retry unnecessarily.
 *
 * To enable:
 *   1. Set APIFY_WEBHOOK_SECRET in Replit Secrets.
 *   2. The next crawl trigger will automatically attach an ad-hoc webhook
 *      using the secret token. No manual Apify console configuration needed.
 */

import { Router, type IRouter } from "express";
import { timingSafeEqual } from "crypto";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { ingestHistoricalDataset } from "../../lib/ornaments/ingest-historical";
import { ingestCatalogDataset } from "../../lib/ornaments/ingest-catalog";

// Actor IDs — must match the IDs used in catalog-crawl.ts and historical-crawl.ts
const HISTORICAL_ACTOR_ID = "yGAVM3iruskyfE4ZQ";
const CATALOG_ACTOR_ID = "Kb7QGS6aXUVgTDoIV";

const INGESTABLE_STATUSES = new Set(["SUCCEEDED", "TIMED-OUT"]);

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /webhook/apify — Apify run-completion callback
// ---------------------------------------------------------------------------
router.post("/webhook/apify", async (req, res) => {
  const secret = env.apifyWebhookSecret;
  if (!secret) {
    res.status(503).json({ error: "Apify webhook not configured" });
    return;
  }

  // Verify token from URL query param using timing-safe comparison
  const providedToken = String(req.query["token"] ?? "");
  let tokenValid = false;
  try {
    tokenValid =
      providedToken.length === secret.length &&
      timingSafeEqual(Buffer.from(providedToken), Buffer.from(secret));
  } catch {
    tokenValid = false;
  }

  if (!tokenValid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Parse the Apify webhook payload
  const body = req.body as Record<string, unknown>;
  const eventType = String(body["eventType"] ?? "");
  const actorId = String(body["actorId"] ?? "");
  const actorRunId = String(body["actorRunId"] ?? "");
  const defaultDatasetId = String(body["defaultDatasetId"] ?? "");
  const status = String(body["status"] ?? "");

  logger.info(
    { eventType, actorId, actorRunId, status },
    "ornaments: Apify webhook received",
  );

  // Respond immediately — ingest runs async so Apify doesn't timeout + retry
  res.json({ received: true, actorRunId, eventType });

  if (!INGESTABLE_STATUSES.has(status) || !defaultDatasetId) {
    logger.info(
      { actorRunId, status },
      "ornaments: webhook skipping ingest (non-ingestable status or no dataset)",
    );
    return;
  }

  const token = env.apifyApiToken;
  if (!token) {
    logger.warn("ornaments: Apify API token missing — cannot auto-ingest");
    return;
  }

  // Identify which crawl type this is by actor ID
  if (actorId === HISTORICAL_ACTOR_ID) {
    ingestHistoricalDataset(defaultDatasetId, token)
      .then((result) => {
        logger.info(
          { actorRunId, ...result },
          "ornaments: webhook historical auto-ingest complete",
        );
      })
      .catch((err: unknown) => {
        logger.error(
          { actorRunId, err },
          "ornaments: webhook historical auto-ingest failed",
        );
      });
    return;
  }

  if (actorId === CATALOG_ACTOR_ID) {
    ingestCatalogDataset(defaultDatasetId, token)
      .then((result) => {
        logger.info(
          { actorRunId, ...result },
          "ornaments: webhook catalog auto-ingest complete",
        );
      })
      .catch((err: unknown) => {
        logger.error(
          { actorRunId, err },
          "ornaments: webhook catalog auto-ingest failed",
        );
      });
    return;
  }

  logger.warn(
    { actorId, actorRunId },
    "ornaments: webhook received for unknown actor — skipping ingest",
  );
});

export default router;
