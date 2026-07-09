import { Router, type IRouter } from "express";
import { db, ornamentsItems } from "@workspace/db";
import {
  GetOrnamentStatsResponse,
  ListOrnamentSeriesResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/stats", async (_req, res) => {
  const rows = await db
    .select({
      seriesOrCollection: ornamentsItems.seriesOrCollection,
      quantity: ornamentsItems.quantity,
      bookValue: ornamentsItems.bookValue,
    })
    .from(ornamentsItems);

  let totalItems = 0;
  let totalQuantity = 0;
  let totalBookValue = 0;
  let itemsWithBookValue = 0;
  const bySeries = new Map<string, { count: number; totalValue: number }>();

  for (const row of rows) {
    totalItems += 1;
    totalQuantity += row.quantity ?? 1;
    const value = row.bookValue !== null ? Number(row.bookValue) : null;
    if (value !== null && Number.isFinite(value)) {
      totalBookValue += value * (row.quantity ?? 1);
      itemsWithBookValue += 1;
    }
    const seriesKey = row.seriesOrCollection?.trim() || "Uncategorized";
    const entry = bySeries.get(seriesKey) ?? { count: 0, totalValue: 0 };
    entry.count += 1;
    if (value !== null && Number.isFinite(value)) {
      entry.totalValue += value * (row.quantity ?? 1);
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
      totalBookValue,
      itemsWithBookValue,
      bySeriesOrCollection,
    }),
  );
});

router.get("/series", async (_req, res) => {
  const rows = await db
    .select({ seriesOrCollection: ornamentsItems.seriesOrCollection })
    .from(ornamentsItems);

  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.seriesOrCollection?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result = [...counts.entries()]
    .map(([seriesOrCollection, count]) => ({ seriesOrCollection, count }))
    .sort((a, b) => b.count - a.count);

  res.json(ListOrnamentSeriesResponse.parse(result));
});

export default router;
