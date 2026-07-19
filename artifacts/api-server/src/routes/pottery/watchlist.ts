/**
 * #249 — Pottery marketplace watchlist
 *
 * Household-shared (no per-user scoping on reads, consistent with pottery
 * items and all other household-shared data in this app).  `createdByUserId`
 * is stored for attribution only.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, desc, asc } from "drizzle-orm";
import {
  db,
  potteryWatchlistItems,
  potteryWatchlistAlerts,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import {
  lookupEbayMarketValue,
  buildEbayQuery,
} from "../../lib/pottery/ebay-market-value";
import { env } from "../../lib/env";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateWatchlistItemBody = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .transform((s) => s.trim()),
  keywords: z
    .string()
    .min(1)
    .max(500)
    .transform((s) => s.trim()),
  priceMinUsd: z.number().positive().nullable().optional(),
  priceMaxUsd: z.number().positive().nullable().optional(),
});

const UpdateWatchlistItemBody = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .transform((s) => s.trim())
    .optional(),
  keywords: z
    .string()
    .min(1)
    .max(500)
    .transform((s) => s.trim())
    .optional(),
  priceMinUsd: z.number().positive().nullable().optional(),
  priceMaxUsd: z.number().positive().nullable().optional(),
  active: z.boolean().optional(),
});

const WatchlistIdParams = z.object({ id: z.coerce.number().int().positive() });
const AlertIdParams = z.object({ alertId: z.coerce.number().int().positive() });

// ---------------------------------------------------------------------------
// Watchlist items CRUD
// ---------------------------------------------------------------------------

router.get("/watchlist", async (_req, res) => {
  const rows = await db
    .select()
    .from(potteryWatchlistItems)
    .orderBy(desc(potteryWatchlistItems.createdAt));
  res.json(rows);
});

router.post("/watchlist", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateWatchlistItemBody.parse(req.body);
  const [row] = await db
    .insert(potteryWatchlistItems)
    .values({
      createdByUserId: userId,
      title: body.title,
      keywords: body.keywords,
      priceMinUsd: body.priceMinUsd ? String(body.priceMinUsd) : null,
      priceMaxUsd: body.priceMaxUsd ? String(body.priceMaxUsd) : null,
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/watchlist/:id", async (req, res) => {
  const { id } = WatchlistIdParams.parse(req.params);
  const body = UpdateWatchlistItemBody.parse(req.body);

  const [existing] = await db
    .select({ id: potteryWatchlistItems.id })
    .from(potteryWatchlistItems)
    .where(eq(potteryWatchlistItems.id, id));
  if (!existing) {
    res.status(404).json({ error: "Watchlist item not found." });
    return;
  }

  const update: Partial<typeof potteryWatchlistItems.$inferInsert> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.keywords !== undefined) update.keywords = body.keywords;
  if ("priceMinUsd" in body)
    update.priceMinUsd = body.priceMinUsd ? String(body.priceMinUsd) : null;
  if ("priceMaxUsd" in body)
    update.priceMaxUsd = body.priceMaxUsd ? String(body.priceMaxUsd) : null;
  if (body.active !== undefined) update.active = body.active;

  const [updated] = await db
    .update(potteryWatchlistItems)
    .set(update)
    .where(eq(potteryWatchlistItems.id, id))
    .returning();
  res.json(updated);
});

router.delete("/watchlist/:id", async (req, res) => {
  const { id } = WatchlistIdParams.parse(req.params);
  const [existing] = await db
    .select({ id: potteryWatchlistItems.id })
    .from(potteryWatchlistItems)
    .where(eq(potteryWatchlistItems.id, id));
  if (!existing) {
    res.status(404).json({ error: "Watchlist item not found." });
    return;
  }
  await db
    .delete(potteryWatchlistItems)
    .where(eq(potteryWatchlistItems.id, id));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// On-demand scan — runs eBay sold-listings search and upserts alerts
// ---------------------------------------------------------------------------

router.post("/watchlist/:id/scan", aiLimiter, async (req, res) => {
  const { id } = WatchlistIdParams.parse(req.params);

  if (!env.apifyApiToken) {
    res.status(503).json({ error: "Apify integration not configured." });
    return;
  }

  const [item] = await db
    .select()
    .from(potteryWatchlistItems)
    .where(eq(potteryWatchlistItems.id, id));
  if (!item) {
    res.status(404).json({ error: "Watchlist item not found." });
    return;
  }

  const query = buildEbayQuery(item.keywords, {});
  const result = await lookupEbayMarketValue(query, env.apifyApiToken);

  if (!result) {
    await db
      .update(potteryWatchlistItems)
      .set({ lastCheckedAt: new Date() })
      .where(eq(potteryWatchlistItems.id, id));
    res.json({ newAlerts: 0, totalListings: 0 });
    return;
  }

  // Filter by price range if configured
  const listings = result.listings.filter((l) => {
    const price = l.soldPrice;
    if (typeof price !== "number") return true;
    if (item.priceMinUsd && price < Number(item.priceMinUsd)) return false;
    if (item.priceMaxUsd && price > Number(item.priceMaxUsd)) return false;
    return true;
  });

  let newAlerts = 0;
  for (const listing of listings) {
    // Use itemUrl as a stable dedup key (no separate listing ID in this actor's output)
    const listingId = listing.itemUrl ?? listing.title ?? "";
    if (!listingId) continue;

    const existing = await db
      .select({ id: potteryWatchlistAlerts.id })
      .from(potteryWatchlistAlerts)
      .where(
        and(
          eq(potteryWatchlistAlerts.watchlistItemId, id),
          eq(potteryWatchlistAlerts.platform, "ebay"),
          eq(potteryWatchlistAlerts.listingId, listingId),
        ),
      );

    if (existing.length === 0) {
      await db.insert(potteryWatchlistAlerts).values({
        watchlistItemId: id,
        platform: "ebay",
        listingId,
        title: listing.title,
        priceUsd: listing.soldPrice != null ? String(listing.soldPrice) : null,
        condition: listing.condition,
        imageUrl: listing.imageUrl,
        listingUrl: listing.itemUrl ?? "",
        soldAt: listing.soldDate != null ? new Date(listing.soldDate) : null,
      });
      newAlerts++;
    }
  }

  await db
    .update(potteryWatchlistItems)
    .set({
      lastCheckedAt: new Date(),
      ...(newAlerts > 0 ? { lastAlertAt: new Date() } : {}),
    })
    .where(eq(potteryWatchlistItems.id, id));

  res.json({ newAlerts, totalListings: listings.length, searchQuery: query });
});

// ---------------------------------------------------------------------------
// Alerts — list, dismiss
// ---------------------------------------------------------------------------

router.get("/watchlist/:id/alerts", async (req, res) => {
  const { id } = WatchlistIdParams.parse(req.params);
  const rows = await db
    .select()
    .from(potteryWatchlistAlerts)
    .where(eq(potteryWatchlistAlerts.watchlistItemId, id))
    .orderBy(desc(potteryWatchlistAlerts.seenAt));
  res.json(rows);
});

router.patch("/watchlist/:id/alerts/:alertId/dismiss", async (req, res) => {
  const { id } = WatchlistIdParams.parse(req.params);
  const { alertId } = AlertIdParams.parse(req.params);
  const [row] = await db
    .update(potteryWatchlistAlerts)
    .set({ dismissed: true })
    .where(
      and(
        eq(potteryWatchlistAlerts.id, alertId),
        eq(potteryWatchlistAlerts.watchlistItemId, id),
      ),
    )
    .returning({ id: potteryWatchlistAlerts.id });
  if (!row) {
    res.status(404).json({ error: "Alert not found." });
    return;
  }
  res.json({ dismissed: true });
});

router.get("/watchlist/alerts/unseen", async (_req, res) => {
  const rows = await db
    .select()
    .from(potteryWatchlistAlerts)
    .where(eq(potteryWatchlistAlerts.dismissed, false))
    .orderBy(
      asc(potteryWatchlistAlerts.watchlistItemId),
      desc(potteryWatchlistAlerts.seenAt),
    );
  res.json(rows);
});

export default router;
