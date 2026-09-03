import { Router, type IRouter } from "express";
import { db, ornamentsItems } from "@workspace/db";
import {
  GetOrnamentStatsResponse,
  ListOrnamentSeriesResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { isNull } from "drizzle-orm";
import { computeOrnamentEstimatedValue } from "@workspace/ornaments-shared";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/stats", async (_req, res) => {
  const rows = await db
    .select({
      seriesOrCollection: ornamentsItems.seriesOrCollection,
      quantity: ornamentsItems.quantity,
      bookValue: ornamentsItems.bookValue,
      retailValueUsd: ornamentsItems.retailValueUsd,
      ebayPriceMinUsd: ornamentsItems.ebayPriceMinUsd,
      ebayPriceMaxUsd: ornamentsItems.ebayPriceMaxUsd,
      ebayLastSoldPriceUsd: ornamentsItems.ebayLastSoldPriceUsd,
      aiAppraisal: ornamentsItems.aiAppraisal,
    })
    .from(ornamentsItems)
    .where(isNull(ornamentsItems.deletedAt));

  let totalItems = 0;
  let totalQuantity = 0;
  let totalEstimatedValue = 0;
  let itemsWithEstimatedValue = 0;
  const bySeries = new Map<string, { count: number; totalValue: number }>();

  for (const row of rows) {
    totalItems += 1;
    totalQuantity += row.quantity ?? 1;
    const estimated = computeOrnamentEstimatedValue({
      bookValue: row.bookValue !== null ? Number(row.bookValue) : null,
      retailValueUsd:
        row.retailValueUsd !== null ? Number(row.retailValueUsd) : null,
      ebayPriceMinUsd:
        row.ebayPriceMinUsd !== null ? Number(row.ebayPriceMinUsd) : null,
      ebayPriceMaxUsd:
        row.ebayPriceMaxUsd !== null ? Number(row.ebayPriceMaxUsd) : null,
      ebayLastSoldPriceUsd:
        row.ebayLastSoldPriceUsd !== null
          ? Number(row.ebayLastSoldPriceUsd)
          : null,
      aiAppraisal: row.aiAppraisal,
    });
    if (estimated.value !== null) {
      totalEstimatedValue += estimated.value * (row.quantity ?? 1);
      itemsWithEstimatedValue += 1;
    }
    const seriesKey = row.seriesOrCollection?.trim() || "Uncategorized";
    const entry = bySeries.get(seriesKey) ?? { count: 0, totalValue: 0 };
    entry.count += 1;
    if (estimated.value !== null) {
      entry.totalValue += estimated.value * (row.quantity ?? 1);
    }
    bySeries.set(seriesKey, entry);
  }

  const bySeriesOrCollection = [...bySeries.entries()]
    .map(([seriesOrCollection, v]) => ({ seriesOrCollection, ...v }))
    .sort((a, b) => b.count - a.count);

  res.json(
    GetOrnamentStatsResponse.parse({
      totalItems,
      totalQuantity,
      totalEstimatedValue,
      itemsWithEstimatedValue,
      valuationPolicy: "market_signals_then_retail_fallback",
      bySeriesOrCollection,
    }),
  );
});

router.get("/series", async (_req, res) => {
  const rows = await db
    .select({ seriesOrCollection: ornamentsItems.seriesOrCollection })
    .from(ornamentsItems)
    .where(isNull(ornamentsItems.deletedAt));

  const counts = new Map<
    string,
    { seriesOrCollection: string; count: number }
  >();
  for (const row of rows) {
    const key = row.seriesOrCollection?.trim();
    if (!key) continue;
    // Keep the first stored spelling while treating casing variants as the
    // same suggestion. This also keeps the endpoint useful as old data with
    // inconsistent casing is encountered.
    const normalizedKey = key.toLowerCase();
    const entry = counts.get(normalizedKey);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(normalizedKey, { seriesOrCollection: key, count: 1 });
    }
  }

  const result = [...counts.values()].sort((a, b) => b.count - a.count);

  res.json(ListOrnamentSeriesResponse.parse(result));
});

export default router;
