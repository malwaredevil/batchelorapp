/**
 * POST /ornaments/items/:id/hallmark-search
 *
 * Triggers a real hallmark.com headless scrape for the given ornament item.
 * Responds immediately with 202 and runs the actor in the background.
 * Results are written back to `ornaments_barcode_cache` (enrichment columns)
 *
 * GET /ornaments/items/:id/hallmark-search
 * Returns the cached Hallmark enrichment for the item's barcode (if any).
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ornamentsItems, ornamentsBarcodeCache } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { searchHallmark } from "../../lib/ornaments/hallmark-search";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /items/:id/hallmark-search — return cached enrichment
// ---------------------------------------------------------------------------
router.get("/items/:id/hallmark-search", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const [item] = await db
    .select()
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  if (!item.barcodeValue) {
    res.json({ cached: null, reason: "item has no barcode" });
    return;
  }

  const [cache] = await db
    .select()
    .from(ornamentsBarcodeCache)
    .where(eq(ornamentsBarcodeCache.barcode, item.barcodeValue));

  if (!cache || !cache.hallmarkEnrichedAt) {
    res.json({ cached: null, reason: "not yet enriched" });
    return;
  }

  res.json({
    cached: {
      hallmarkSku: cache.hallmarkSku,
      seriesName: cache.hallmarkSeriesName,
      sequenceNumber: cache.hallmarkSequenceNumber,
      artist: cache.hallmarkArtist,
      originalRetailPrice: cache.hallmarkOriginalRetailPrice,
      productUrl: cache.hallmarkProductUrl,
      confidence: cache.hallmarkConfidence,
      enrichedAt: cache.hallmarkEnrichedAt,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /items/:id/hallmark-search — kick off a live Hallmark scrape
// ---------------------------------------------------------------------------
router.post("/items/:id/hallmark-search", aiLimiter, async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const [item] = await db
    .select()
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  // Actor input: prefer series/name+year for the search query.
  // hallmarkSku would come from UPCitemdb "model" field extraction upstream.
  const name = item.name ?? undefined;
  const year = item.year ?? undefined;

  if (!name) {
    res.status(422).json({
      error: "Item has no name — cannot build a Hallmark search query",
    });
    return;
  }

  res.status(202).json({
    status: "running",
    message:
      "Hallmark search started. Enrichment will be cached on completion (~60 s).",
  });

  void (async () => {
    try {
      const result = await searchHallmark({ name, year });

      if (!result) {
        logger.info(
          { itemId: id, name, year },
          "hallmark-search: no confident match found",
        );
        return;
      }

      // Upsert enrichment onto the barcode cache row (or create one if missing).
      // If the item has no barcode we key by a synthetic "item:<id>" key so we
      // still persist the result.
      const barcode = item.barcodeValue ?? `item:${id}`;
      await db
        .insert(ornamentsBarcodeCache)
        .values({
          barcode,
          found: 1,
          name: result.name,
          brand: result.brand,
          seriesOrCollection: result.seriesName,
          year: result.year,
          description: result.description,
          imageUrl: result.images[0] ?? null,
          hallmarkSku: result.hallmarkSku,
          hallmarkSeriesName: result.seriesName,
          hallmarkSequenceNumber: result.sequenceNumber,
          hallmarkArtist: result.artist,
          hallmarkOriginalRetailPrice: result.originalRetailPrice
            ? String(result.originalRetailPrice)
            : null,
          hallmarkProductUrl: result.hallmarkProductUrl,
          hallmarkConfidence: String(result.confidence),
          hallmarkEnrichedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ornamentsBarcodeCache.barcode,
          set: {
            hallmarkSku: result.hallmarkSku,
            hallmarkSeriesName: result.seriesName,
            hallmarkSequenceNumber: result.sequenceNumber,
            hallmarkArtist: result.artist,
            hallmarkOriginalRetailPrice: result.originalRetailPrice
              ? String(result.originalRetailPrice)
              : null,
            hallmarkProductUrl: result.hallmarkProductUrl,
            hallmarkConfidence: String(result.confidence),
            hallmarkEnrichedAt: new Date(),
          },
        });

      logger.info(
        {
          itemId: id,
          hallmarkSku: result.hallmarkSku,
          seriesName: result.seriesName,
          confidence: result.confidence,
        },
        "hallmark-search: enrichment saved to barcode cache",
      );
    } catch (err) {
      // Log loudly — this is the "fail loudly" contract
      logger.error(
        { err, itemId: id, name, year },
        "hallmark-search: actor run failed",
      );
    }
  })();
});

export default router;
